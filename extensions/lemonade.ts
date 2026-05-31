/**
 * Lemonade API abstraction.
 *
 * All Lemonade-specific logic lives here: credential encoding, server discovery,
 * HTTP calls, model mapping, and OAuth login flow.
 *
 * This module is framework-agnostic — it knows nothing about Pi.dev.
 * The Pi extension wiring is in `index.ts`.
 */

import dgram from "node:dgram"

interface OAuthCredentials {
    refresh: string;
    access: string;
    expires: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BEACON_PORT = 13305
// Lemonade's default HTTP port is 13305 (same port as the UDP beacon, but TCP).
// Listed first so the local-fallback scan finds it immediately. Other ports
// covered for users running a custom --port.
const HTTP_FALLBACK_PORTS = [13305, 8000, 1234, 9000, 8080]
const CREDS_TTL_MS = 24 * 60 * 60 * 1000

// ─── Types ────────────────────────────────────────────────────────────────────

interface LemonadeHealth {
    status: string;
    version: string;
    model_loaded: string | null;
    all_models_loaded?: Array<{ model_name: string }> | null;
    websocket_port?: number;
}

interface LemonadeModelInfo {
    id: string;
    created?: number;
    object?: string;
    owned_by?: string;
    checkpoint?: string;
    recipe?: string;
    size?: number; // GB
    max_context_window?: number;
    downloaded?: boolean;
    suggested?: boolean;
    labels?: string[];
    recipe_options?: Record<string, unknown>;
    image_defaults?: {
        steps?: number;
        cfg_scale?: number;
        width?: number;
        height?: number;
    };
}

export interface CredsPayload {
    baseUrl: string;
    apiKey: string;
    serverName: string;
}

interface BeaconResult {
    hostname: string;
    baseUrl: string;
}

// ─── Credential encoding ─────────────────────────────────────────────────────

function encodeCreds(payload: CredsPayload): OAuthCredentials {
    return {
        refresh: JSON.stringify(payload),
        access: payload.apiKey,
        expires: Date.now() + CREDS_TTL_MS,
    }
}

function decodeCreds(creds: OAuthCredentials): CredsPayload {
    try {
        const parsed = JSON.parse(creds.refresh ?? "")
        return {
            baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : "",
            apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : (creds.access ?? ""),
            serverName: typeof parsed.serverName === "string" ? parsed.serverName : "Lemonade",
        }
    } catch {
        return {baseUrl: "", apiKey: creds.access ?? "", serverName: "Lemonade"}
    }
}

// ─── URL helpers ──────────────────────────────────────────────────────────────

function buildBaseUrl(raw: string): string {
    let url = (raw ?? "").trim()
    if (!url) return ""
    url = url.replace(/\/+$/, "")
    if (!/^https?:\/\//i.test(url)) {
        url = `http://${url}`
    }
    // Strip any path the user (or the beacon) appended. Order matters — strip
    // the most specific prefix first.
    //   http://host:port/api/v1/  → http://host:port
    //   http://host:port/api/v0   → http://host:port
    //   http://host:port/v1       → http://host:port (user pasted from OpenAI URL)
    //   http://host:port/api      → http://host:port
    for (const re of [/\/api\/v\d+\/?$/i, /\/v\d+\/?$/i, /\/api\/?$/i]) {
        url = url.replace(re, "")
    }
    return url.replace(/\/+$/, "")
}

function authHeaders(apiKey?: string): Record<string, string> {
    const h: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
    }
    if (apiKey) h["Authorization"] = `Bearer ${apiKey}`
    return h
}

// ─── UDP beacon discovery ────────────────────────────────────────────────────

/**
 * Listen on UDP 13305 for Lemonade beacons.
 * Lemonade broadcasts {"service":"lemonade","hostname":"...","url":"http://.../api/v1/"}
 * roughly every second to loopback and every RFC1918 broadcast address.
 *
 * localOnly=true accepts only loopback senders (matches the lemonade CLI's
 * discover_local_server_port). false accepts any sender, for LAN-wide scans.
 */
function discoverViaBeacon(timeoutMs: number, localOnly: boolean): Promise<BeaconResult[]> {
    return new Promise((resolve) => {
        const found = new Map<string, BeaconResult>()
        let sock: ReturnType<typeof dgram.createSocket> | null = null
        let timer: ReturnType<typeof setTimeout> | null = null

        const finish = () => {
            if (timer) {
                clearTimeout(timer)
                timer = null
            }
            if (sock) {
                try {
                    sock.close()
                } catch {
                    // ignore
                }
                sock = null
            }
            resolve(Array.from(found.values()))
        }

        try {
            // reuseAddr → SO_REUSEADDR; reusePort → SO_REUSEPORT (Node 18+).
            // Both are required on macOS to co-bind with another listener (tray,
            // `lemonade scan`). The peer must also set them, so this only works
            // once the lemonade tray is patched to set SO_REUSEPORT before bind.
            sock = dgram.createSocket({
                type: "udp4",
                reuseAddr: true,
                reusePort: true,
            } as Parameters<typeof dgram.createSocket>[0])
            sock.on("error", finish)
            sock.on("message", (msg: Buffer, rinfo: { address: string }) => {
                if (localOnly && rinfo.address !== "127.0.0.1") return
                try {
                    const beacon = JSON.parse(msg.toString())
                    if (beacon?.service !== "lemonade") return
                    const url = String(beacon.url ?? "")
                    const hostname = String(beacon.hostname ?? "unknown")
                    if (!url) return
                    const baseUrl = buildBaseUrl(url)
                    if (baseUrl && !found.has(baseUrl)) {
                        found.set(baseUrl, {hostname, baseUrl})
                    }
                } catch {
                    // not JSON / not ours
                }
            })
            sock.bind(BEACON_PORT)
        } catch {
            finish()
            return
        }

        timer = setTimeout(finish, timeoutMs)
    })
}

async function discoverViaHttp(): Promise<BeaconResult[]> {
    const checks = await Promise.all(
        HTTP_FALLBACK_PORTS.map(async (port) => {
            const baseUrl = `http://localhost:${port}`
            const health = await checkHealth(baseUrl)
            return health ? {hostname: `localhost:${port}`, baseUrl} : null
        }),
    )
    return checks.filter((r): r is BeaconResult => r !== null)
}

async function discoverServers(timeoutMs = 2500): Promise<BeaconResult[]> {
    const beacons = await discoverViaBeacon(timeoutMs, /*localOnly=*/ false)
    if (beacons.length > 0) return beacons
    return await discoverViaHttp()
}

// ─── HTTP calls ───────────────────────────────────────────────────────────────

async function checkHealth(baseUrl: string, apiKey?: string): Promise<LemonadeHealth | null> {
    try {
        const res = await fetch(`${baseUrl}/api/v1/health`, {
            headers: authHeaders(apiKey),
            signal: AbortSignal.timeout(3000),
        })
        if (!res.ok) return null
        return (await res.json()) as LemonadeHealth
    } catch {
        return null
    }
}

interface ModelOpResponse {
    message?: string
    model_name?: string
    error?: string | { message?: string }
}

export type ModelOpResult =
    | { ok: true; message?: string; model_name?: string }
    | { ok: false; error: string }

async function postModelOp(
    baseUrl: string,
    endpoint: string,
    body: { model_name?: string },
    apiKey?: string,
): Promise<ModelOpResult> {
    try {
        const r = await fetch(`${baseUrl}/api/v1/${endpoint}`, {
            method: "POST",
            headers: authHeaders(apiKey),
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(60_000),
        })

        const data: ModelOpResponse = await r.json().catch(() => ({}))

        if (!r.ok) {
            const msg =
                typeof data.error === "object" && data.error !== null
                    ? data.error.message ?? r.statusText
                    : data.error ?? r.statusText
            return {ok: false, error: msg}
        }

        return {ok: true, message: data.message, model_name: data.model_name}
    } catch (e) {
        return {ok: false, error: e instanceof Error ? e.message : String(e)}
    }
}

export async function postLoad(
    baseUrl: string,
    modelId: string,
    apiKey?: string,
): Promise<ModelOpResult> {
    return postModelOp(baseUrl, "load", {model_name: modelId}, apiKey)
}

export async function postUnload(
    baseUrl: string,
    modelId?: string,
    apiKey?: string,
): Promise<ModelOpResult> {
    return postModelOp(baseUrl, "unload", modelId ? {model_name: modelId} : {}, apiKey)
}

export async function postPull(
    baseUrl: string,
    modelId: string,
    apiKey?: string,
): Promise<ModelOpResult> {
    return postModelOp(baseUrl, "pull", {model_name: modelId}, apiKey)
}

export async function postDelete(
    baseUrl: string,
    modelId: string,
    apiKey?: string,
): Promise<ModelOpResult> {
    return postModelOp(baseUrl, "delete", {model_name: modelId}, apiKey)
}

async function fetchModels(baseUrl: string, apiKey?: string): Promise<LemonadeModelInfo[]> {
    try {
        const res = await fetch(`${baseUrl}/api/v1/models`, {
            headers: authHeaders(apiKey),
            signal: AbortSignal.timeout(10000),
        })
        if (!res.ok) return []
        const data = (await res.json()) as { data?: LemonadeModelInfo[] }
        return Array.isArray(data?.data) ? data.data : []
    } catch {
        return []
    }
}

// ─── Provider model mapping ───────────────────────────────────────────────────

export interface ProviderModel {
    id: string;
    name: string;
    reasoning: boolean;
    input: ("text" | "image")[];
    cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
    contextWindow: number;
    maxTokens: number;
}

function isReasoningModel(m: LemonadeModelInfo): boolean {
    if (m.labels?.includes("reasoning")) return true
    const recipe = m.recipe?.toLowerCase()
    if (!recipe) return false
    return ["qwq", "deepseek-r1", "r1", "o1", "o3", "think"].some((t) => recipe.includes(t))
}

function mapToProviderModel(m: LemonadeModelInfo): ProviderModel {
    const input: ("text" | "image")[] = ["text"]
    if (m.labels?.includes("image")) {
        input.push("image")
    }
    const recipeCtx = typeof m.recipe_options?.ctx_size === "number" ? m.recipe_options.ctx_size : undefined
    const contextWindow = recipeCtx ?? m.max_context_window ?? 128000
    const maxTokens = 4096
    return {
        id: m.id,
        name: m.checkpoint || m.id,
        reasoning: isReasoningModel(m),
        input,
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0},
        contextWindow,
        maxTokens,
    }
}

export default {
    buildBaseUrl,
    checkHealth,
    decodeCreds,
    discoverServers,
    discoverViaBeacon,
    discoverViaHttp,
    encodeCreds,
    fetchModels,
    mapToProviderModel,
    postDelete,
    postLoad,
    postPull,
    postUnload,
}






