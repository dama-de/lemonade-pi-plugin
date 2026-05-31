/**
 * @lemonade/lemonade-provider
 *
 * Pi.dev extension for Lemonade local LLM server.
 *
 * All Lemonade API logic (discovery, HTTP, credentials, model mapping) lives
 * in `lemonade.ts`. This file is the Pi extension entry point — it handles
 * Pi-specific wiring: credential storage, provider registration, OAuth flow,
 * and command dispatch.
 */

import {promises as fs} from "node:fs"
import os from "node:os"
import path from "node:path"
import type {ExtensionAPI, ExtensionCommandContext, ProviderConfig} from "@earendil-works/pi-coding-agent"
import type {OAuthCredentials, OAuthLoginCallbacks, OAuthProviderInterface} from "@earendil-works/pi-ai"

import lemonade, {type CredsPayload, type ModelOpResult, type ProviderModel} from "./lemonade"

const PROVIDER_ID = "lemonade"
const PROVIDER_LABEL = "Lemonade"


function buildProviderConfig(
    baseUrl: string,
    serverName: string | undefined,
    apiKey: string | undefined,
    models: ProviderModel[],
    oauthBlock: Omit<OAuthProviderInterface, "id">,
): ProviderConfig {
  return {
    name: serverName ? `Lemonade (${serverName})` : "Lemonade",
    baseUrl: baseUrl ? `${baseUrl}/v1` : "http://localhost:8000/v1",
    api: "openai-completions",
    models,
    oauth: oauthBlock,
    ...(apiKey ? {headers: {Authorization: `Bearer ${apiKey}`}} : {}),
  }
}

// ─── Pi provider registration ─────────────────────────────────────────────────

async function registerProvider(pi: ExtensionAPI, config: ProviderConfig): Promise<void> {
  try {
    pi.unregisterProvider(PROVIDER_ID)
  } catch {
    // not previously registered; ignore
  }
  pi.registerProvider(PROVIDER_ID, config)
}

// ─── OAuth login flow (runs when user picks "Lemonade" in /login) ─────────────

async function oauthLogin(
    pi: ExtensionAPI,
  callbacks: OAuthLoginCallbacks,
    oauthBlock: Omit<OAuthProviderInterface, "id">,
): Promise<OAuthCredentials> {
  const discovered = await lemonade.discoverServers(2500)

  let baseUrl: string
  let serverName = "Lemonade"

  if (discovered.length === 0) {
    const input = await callbacks.onPrompt({
      message:
        "No Lemonade server found via UDP beacon (port 13305) or local port scan.\n" +
        "Enter Lemonade server URL (press Enter for http://localhost:8000):",
    })
    const trimmed = input.trim()
    baseUrl = trimmed ? lemonade.buildBaseUrl(trimmed) : "http://localhost:8000"
  } else if (discovered.length === 1) {
    const only = discovered[0]
    const confirm = await callbacks.onPrompt({
      message:
        `Found Lemonade server: ${only.hostname} at ${only.baseUrl}\n` +
        `Press Enter to use this, or type a different URL:`,
    })
    const trimmed = confirm.trim()
    if (trimmed) {
      baseUrl = lemonade.buildBaseUrl(trimmed)
      serverName = "Lemonade"
    } else {
      baseUrl = only.baseUrl
      serverName = only.hostname
    }
  } else {
    let menu = `Found ${discovered.length} Lemonade servers:\n`
    discovered.forEach((d, i) => {
      menu += `  [${i + 1}] ${d.hostname} — ${d.baseUrl}\n`
    })
    menu += "Enter number to select, or type a custom URL:"
    const choice = (await callbacks.onPrompt({message: menu})).trim()
    const num = parseInt(choice, 10)
    if (!isNaN(num) && num >= 1 && num <= discovered.length) {
      baseUrl = discovered[num - 1].baseUrl
      serverName = discovered[num - 1].hostname
    } else if (choice) {
      baseUrl = lemonade.buildBaseUrl(choice)
      serverName = "Lemonade"
    } else {
      baseUrl = discovered[0].baseUrl
      serverName = discovered[0].hostname
    }
  }

  const apiKeyInput = await callbacks.onPrompt({
    message:
      "Enter API key (optional — press Enter to skip if your server doesn't require one):",
  })
  const apiKey = apiKeyInput.trim()

  const health = await lemonade.checkHealth(baseUrl, apiKey || undefined)
  if (!health) {
    throw new Error(
      `Cannot reach Lemonade at ${baseUrl}. Check that the server is running` +
        (apiKey ? " and that the API key is correct." : "") +
        ".",
    )
  }

  const payload: CredsPayload = {
    baseUrl,
    apiKey,
    serverName: `${serverName} v${health.version}`,
  }
  const rawModels = await lemonade.fetchModels(baseUrl, apiKey)
  const config = buildProviderConfig(baseUrl, payload.serverName, apiKey, rawModels.map(lemonade.mapToProviderModel), oauthBlock)
  await registerProvider(pi, config)

  return lemonade.encodeCreds(payload) as OAuthCredentials
}

// ─── Pi command handling ──────────────────────────────────────────────────────

function formatSizeGB(gb: number | undefined): string {
  if (!gb || gb <= 0) return "—"
  if (gb < 1) {
    const mb = Math.round(gb * 1024)
    return `${mb} MB`
  }
  return `${parseFloat(gb.toFixed(1))} GB`
}

// ─── Pi credential storage ───────────────────────────────────────────────────

/**
 * Best-effort: read Pi's persisted OAuth credentials so the admin command
 * works without making a network call to the OAuth flow. The on-disk format
 * is undocumented; we try a couple of reasonable shapes.
 */
async function readStoredPayload(): Promise<CredsPayload | null> {
  try {
    const authPath = path.join(os.homedir(), ".pi", "agent", "auth.json")
    const raw = await fs.readFile(authPath, "utf8")
    const data = JSON.parse(raw)
    const candidates: unknown[] = [
      data?.[PROVIDER_ID],
      data?.providers?.[PROVIDER_ID],
      data?.oauth?.[PROVIDER_ID],
    ]
    for (const c of candidates) {
      if (
        c &&
        typeof c === "object" &&
        typeof (c as OAuthCredentials).refresh === "string"
      ) {
        return lemonade.decodeCreds(c as OAuthCredentials)
      }
    }
  } catch {
    // no auth.json yet, or unreadable
  }
  return null
}

function lemonadeCommand(pi: ExtensionAPI, oauthBlock: Omit<OAuthProviderInterface, "id">) {
  return {
    description: "Lemonade server administration (status, models, load/pull/delete)",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const parts = args.trim().split(/\s+/).filter(Boolean)
      const cmd = (parts[0] ?? "").toLowerCase()
      const rest = parts.slice(1)

      if (cmd === "" || cmd === "help") {
        ctx.ui.notify(
            "/lemonade <command>\n" +
            "  status             — server health\n" +
            "  models             — list models\n" +
            "  load <id>          — load a model into memory\n" +
            "  unload [id]        — unload a model (or all if no id)\n" +
            "  pull <id>          — download a model\n" +
            "  delete <id>        — remove a model from disk\n" +
            "  refresh            — re-fetch model list and re-register provider\n" +
            "  discover           — UDP beacon + HTTP port scan",
            "info",
        )
        return
      }

      if (cmd === "discover") {
        ctx.ui.notify("Scanning UDP beacons (3s) + local port fallback…", "info")
        const beacons = await lemonade.discoverViaBeacon(3000, /*localOnly=*/ false)
        const http = beacons.length === 0 ? await lemonade.discoverViaHttp() : []
        const all = [...beacons, ...http]
        if (all.length === 0) {
          ctx.ui.notify("No Lemonade servers found.", "warning")
          return
        }
        let msg = `Found ${all.length} server(s):\n`
        for (const s of all) msg += `  • ${s.hostname} — ${s.baseUrl}\n`
        ctx.ui.notify(msg, "info")
        return
      }

      const payload = await readStoredPayload()
      if (!payload?.baseUrl) {
        ctx.ui.notify(
            "Not connected to Lemonade. Run /login and pick Lemonade.",
            "warning",
        )
        return
      }
      const baseUrl = payload.baseUrl
      const apiKey = payload.apiKey || undefined

      switch (cmd) {
        case "status": {
          const h = await lemonade.checkHealth(baseUrl, apiKey)
          if (!h) {
            ctx.ui.notify(`Cannot reach ${baseUrl}`, "error")
            return
          }
          ctx.ui.notify(
              `Lemonade v${h.version} @ ${baseUrl}\n` +
              `Status: ${h.status}\n` +
              `Loaded: ${h.model_loaded ?? "(none)"}\n` +
              `All loaded: ${(h.all_models_loaded ?? []).map((m) => m.model_name).join(", ") || "(none)"}` +
              (h.websocket_port ? `\nWebSocket port: ${h.websocket_port}` : ""),
              "info",
          )
          return
        }

        case "models":
        case "list": {
          const models = await lemonade.fetchModels(baseUrl, apiKey)
          if (models.length === 0) {
            ctx.ui.notify("No models found.", "warning")
            return
          }
          let out = `${models.length} model(s):\n`
          for (const m of models) {
            const status = m.downloaded ? "●" : "○"
            const size = m.size ? ` (${formatSizeGB(m.size)})` : ""
            out += `  ${status} ${m.checkpoint || m.id}${size}\n`
            if (m.labels && m.labels.length > 0) {
              out += `      labels: ${m.labels.join(", ")}\n`
            }
            if (m.recipe) {
              out += `      recipe: ${m.recipe}\n`
            }
          }
          ctx.ui.notify(out, "info")
          return
        }

        case "load": {
          const id = rest[0]
          if (!id) {
            ctx.ui.notify("Usage: /lemonade load <model_id>", "warning")
            return
          }
          ctx.ui.notify(`Loading ${id}…`, "info")
          const loadResult = await lemonade.postLoad(baseUrl, id, apiKey)
          notifyModelOpResult(ctx, "load", loadResult)
          return
        }

        case "unload": {
          const id = rest[0]
          ctx.ui.notify(id ? `Unloading ${id}…` : "Unloading all models…", "info")
          const unloadResult = await lemonade.postUnload(baseUrl, id, apiKey)
          notifyModelOpResult(ctx, "unload", unloadResult)
          return
        }

        case "pull": {
          const id = rest[0]
          if (!id) {
            ctx.ui.notify("Usage: /lemonade pull <model_id>", "warning")
            return
          }
          ctx.ui.notify(`Pulling ${id} (this may take a while)…`, "info")
          const pullResult = await lemonade.postPull(baseUrl, id, apiKey)
          notifyModelOpResult(ctx, "pull", pullResult)
          return
        }

        case "delete": {
          const id = rest[0]
          if (!id) {
            ctx.ui.notify("Usage: /lemonade delete <model_id>", "warning")
            return
          }
          ctx.ui.notify(`Deleting ${id} from disk…`, "info")
          const deleteResult = await lemonade.postDelete(baseUrl, id, apiKey)
          notifyModelOpResult(ctx, "delete", deleteResult)
          return
        }

        case "refresh": {
          const rawModels = await lemonade.fetchModels(baseUrl, apiKey)
          const mapped = rawModels.map(lemonade.mapToProviderModel)
          const config = buildProviderConfig(baseUrl, payload.serverName, apiKey, mapped, oauthBlock)
          await registerProvider(pi, config)
          ctx.ui.notify(`Re-synced: ${mapped.length} models registered.`, "info")
          return
        }

        default:
          ctx.ui.notify(`Unknown command: /lemonade ${cmd}\nType /lemonade help`, "warning")
      }
    },
  }
}

function notifyModelOpResult(
    ctx: ExtensionCommandContext,
  label: string,
    result: ModelOpResult,
): void {
  if (result.ok) {
    const msg = result.message ?? `${label} succeeded${result.model_name ? `: ${result.model_name}` : ""}`
    ctx.ui.notify(msg, "info")
  } else {
    ctx.ui.notify(`${label} failed: ${result.error}`, "error")
  }
}

// ─── Extension factory ────────────────────────────────────────────────────────

export default async function lemonadeProvider(pi: ExtensionAPI) {
  // Build the OAuth block inline to handle the self-referential refreshToken
  const oauthBlock: Omit<OAuthProviderInterface, "id"> = {
    name: PROVIDER_LABEL,
    login: (callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> => oauthLogin(pi, callbacks, oauthBlock) as Promise<OAuthCredentials>,
    refreshToken: async (creds: OAuthCredentials): Promise<OAuthCredentials> => {
      const payload = lemonade.decodeCreds(creds)
      if (payload.baseUrl) {
        try {
          const rawModels = await lemonade.fetchModels(payload.baseUrl, payload.apiKey)
          const config = buildProviderConfig(payload.baseUrl, payload.serverName, payload.apiKey, rawModels.map(lemonade.mapToProviderModel), oauthBlock)
          await registerProvider(pi, config)
        } catch {
          // network blip — keep creds, retry on next refresh
        }
      }
      return lemonade.encodeCreds(payload) as OAuthCredentials
    },
    getApiKey: (creds: OAuthCredentials): string => {
      const payload = lemonade.decodeCreds(creds)
      return payload.apiKey || ""
    },
  }

  // Initial stub registration so "Lemonade" appears in Pi's /login selector
  // even before the user has connected.
  pi.registerProvider(PROVIDER_ID, {
    name: PROVIDER_LABEL,
    baseUrl: "http://localhost:8000/v1",
    api: "openai-completions",
    models: [],
    oauth: oauthBlock,
  })

  // Best-effort: if Pi already has saved creds for us, re-register eagerly so
  // the model picker is populated without waiting for the next refresh tick.
  const stored = await readStoredPayload()
  if (stored?.baseUrl) {
    try {
      const rawModels = await lemonade.fetchModels(stored.baseUrl, stored.apiKey)
      const config = buildProviderConfig(stored.baseUrl, stored.serverName, stored.apiKey, rawModels.map(lemonade.mapToProviderModel), oauthBlock)
      await registerProvider(pi, config)
    } catch {
      // ignore — refreshToken will retry
    }
  }

  pi.registerCommand("lemonade", lemonadeCommand(pi, oauthBlock))
}
