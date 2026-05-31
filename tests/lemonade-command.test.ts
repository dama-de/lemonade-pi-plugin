import {beforeEach, describe, expect, it, vi} from "vitest"
import {mockDeep} from "vitest-mock-extended"
import {vol} from "memfs"
import nock from "nock"
import type {ExtensionAPI, ExtensionCommandContext} from "@earendil-works/pi-coding-agent"

import lemonadeProvider from "../extensions/index"

describe("/lemonade command", () => {
    let contextMock: ReturnType<typeof mockDeep<ExtensionCommandContext>>

    beforeEach(async () => {
        vi.restoreAllMocks()
        nock.cleanAll()

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

    describe("no subcommand (help)", () => {
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
    })

    describe("status", () => {
        it("displays server health info when the server is reachable", async () => {
            nock("http://localhost:13305")
                .persist()
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
                .persist()
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
                .persist()
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

    describe("models", () => {
        it("displays models with details when the server returns a list", async () => {
            nock("http://localhost:13305")
                .persist()
                .get("/api/v1/models")
                .reply(200, {
                    data: [
                        {
                            id: "Qwen2.5-7B-Instruct",
                            name: "Qwen2.5-7B-Instruct",
                            loaded: true,
                            size: 14858844160,
                            recipe: "qwen2.5",
                            backend: "llama.cpp",
                        },
                        {
                            id: "Llama-3.1-8B-Instruct",
                            name: "Llama-3.1-8B-Instruct",
                            loaded: false,
                            size: 15000000000,
                            recipe: "llama3.1",
                            backend: "llama.cpp",
                        },
                    ],
                })

            mockAuthJson()
            const handler = await getHandler()
            await handler("models", contextMock)

            expect(contextMock.ui.notify).toHaveBeenCalledTimes(1)
            const [message, level] = contextMock.ui.notify.mock.calls[0]!
            expect(level).toBe("info")
            expect(message).toContain("2 model(s)")
            expect(message).toContain("● Qwen2.5-7B-Instruct (13.8 GB)")
            expect(message).toContain("○ Llama-3.1-8B-Instruct (14 GB)")
            expect(message).toContain("recipe: qwen2.5, backend: llama.cpp")
        })

        it("shows a warning when no models are found", async () => {
            nock("http://localhost:13305")
                .persist()
                .get("/api/v1/models")
                .reply(200, {data: []})

            mockAuthJson()
            const handler = await getHandler()
            await handler("models", contextMock)

            expect(contextMock.ui.notify).toHaveBeenCalledTimes(1)
            const [message, level] = contextMock.ui.notify.mock.calls[0]!
            expect(level).toBe("warning")
            expect(message).toBe("No models found.")
        })

        it("shows an error when the server is unreachable", async () => {
            nock("http://localhost:13305")
                .persist()
                .get("/api/v1/models")
                .reply(503, {error: "Server starting up"})

            mockAuthJson()
            const handler = await getHandler()
            await handler("models", contextMock)

            expect(contextMock.ui.notify).toHaveBeenCalledTimes(1)
            const [message, level] = contextMock.ui.notify.mock.calls[0]!
            expect(level).toBe("warning")
            expect(message).toBe("No models found.")
        })
    })
})
