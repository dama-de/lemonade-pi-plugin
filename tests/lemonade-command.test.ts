import {beforeEach, describe, expect, it, vi} from "vitest"
import {mockDeep} from "vitest-mock-extended"
import {vol} from "memfs"
import nock from "nock"
import type {ExtensionAPI, ExtensionCommandContext} from "@earendil-works/pi-coding-agent"

import lemonadeProvider from "../extensions/index"

// Mock both os and fs at module scope so they're hoisted before the extension loads
vi.mock("node:os", () => ({
    default: {
        homedir: () => "/home/testuser",
    },
}))

vi.mock("node:fs", () => ({
    promises: vol.promises,
}))

describe("/lemonade command", () => {
    let contextMock: ReturnType<typeof mockDeep<ExtensionCommandContext>>

    beforeEach(async () => {
        vi.restoreAllMocks()
        nock.cleanAll()
        vol.reset()

        contextMock = mockDeep<ExtensionCommandContext>()
    })

    async function getHandler() {
        const pi = mockDeep<ExtensionAPI>()
        await lemonadeProvider(pi)

        const [name, options] = vi.mocked(pi.registerCommand).mock.calls[0]!
        expect(name).toBe("lemonade")
        return options.handler as (
            args: string,
            ctx: ExtensionCommandContext,
        ) => Promise<void>
    }

    const mockAuthJson = () => {
        vol.fromJSON({
            "/home/testuser/.pi/agent/auth.json": JSON.stringify({
                lemonade: {
                    refresh: JSON.stringify({
                        baseUrl: "http://localhost:13305",
                        apiKey: "test-key",
                        serverName: "Lemonade v0.5.0",
                    }),
                    access: "test-key",
                    expires: Date.now() + 86400000,
                },
            }),
        })
    }

    it("shows help when called with no arguments", async () => {
        const handler = await getHandler()
        await handler("", contextMock)

        expect(contextMock.ui.notify).toHaveBeenCalledTimes(1)
        const [message, level] = contextMock.ui.notify.mock.calls[0]!
        expect(level).toBe("info")
        expect(message).toContain("/lemonade <command>")
        expect(message).toContain("status")
        expect(message).toContain("models")
        expect(message).toContain("load")
        expect(message).toContain("unload")
        expect(message).toContain("pull")
        expect(message).toContain("delete")
        expect(message).toContain("refresh")
        expect(message).toContain("discover")
    })

    it("displays server health info when the server is reachable", async () => {
        nock("http://localhost:13305")
            .get("/api/v1/health")
            .reply(200, {
                status: "ok",
                version: "0.5.0",
                model_loaded: "Qwen2.5-7B-Instruct",
                all_models_loaded: ["Qwen2.5-7B-Instruct"],
                websocket_port: 13306,
            })

        mockAuthJson()
        const handler = await getHandler()
        await handler("status", contextMock)

        expect(contextMock.ui.notify).toHaveBeenCalledTimes(1)
        const [message, level] = contextMock.ui.notify.mock.calls[0]!
        expect(level).toBe("info")
        expect(message).toContain("Lemonade v0.5.0")
        expect(message).toContain("http://localhost:13305")
        expect(message).toContain("Status: ok")
        expect(message).toContain("Loaded: Qwen2.5-7B-Instruct")
        expect(message).toContain("All loaded: Qwen2.5-7B-Instruct")
        expect(message).toContain("WebSocket port: 13306")
    })

    it("shows an error when the server is unreachable", async () => {
        nock("http://localhost:13305")
            .get("/api/v1/health")
            .reply(503, {error: "Server starting up"})

        mockAuthJson()
        const handler = await getHandler()
        await handler("status", contextMock)

        expect(contextMock.ui.notify).toHaveBeenCalledTimes(1)
        const [message, level] = contextMock.ui.notify.mock.calls[0]!
        expect(level).toBe("error")
        expect(message).toContain("Cannot reach")
    })

    it("shows an error when the server returns a non-200 status", async () => {
        nock("http://localhost:13305")
            .get("/api/v1/health")
            .reply(500, {error: "Internal error"})

        mockAuthJson()
        const handler = await getHandler()
        await handler("status", contextMock)

        expect(contextMock.ui.notify).toHaveBeenCalledTimes(1)
        const [message, level] = contextMock.ui.notify.mock.calls[0]!
        expect(level).toBe("error")
        expect(message).toContain("Cannot reach")
    })
})
