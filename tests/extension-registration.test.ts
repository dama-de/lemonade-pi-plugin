import {beforeEach, describe, expect, it, vi} from "vitest"
import {DeepMockProxy, mockDeep} from "vitest-mock-extended"
import type {ExtensionAPI} from "@earendil-works/pi-coding-agent"

import lemonadeProvider from "../extensions/index"
import modelsSampleResponse from "./models-sample-response.json"
import nock from "nock"
import {loggedInAuthJson, mockAuthJson} from "./fixtures"

describe("extension registration", () => {
    let pi: DeepMockProxy<ExtensionAPI>

    beforeEach(() => {
        vi.restoreAllMocks()
        nock.cleanAll()

        pi = mockDeep<ExtensionAPI>()
    })

    it("registers the Lemonade provider on startup without saved credentials", async () => {
        await lemonadeProvider(pi)

        expect(pi.registerProvider).toHaveBeenCalledTimes(1)

        const [id, config] = vi.mocked(pi.registerProvider).mock.calls[0]!
        expect(id).toBe("lemonade")
        expect(config.name).toBe("Lemonade")
        expect(config.baseUrl).toBe("http://localhost:8000/v1")
        expect(config.api).toBe("openai-completions")
        expect(Array.isArray(config.models)).toBe(true)
        expect(config.models).toHaveLength(0)
        expect(config.oauth).toBeDefined()
    })

    it("registers the /lemonade command", async () => {
        await lemonadeProvider(pi)

        const [name, options] = vi.mocked(pi.registerCommand).mock.calls[0]!
        expect(name).toBe("lemonade")
        expect(options.description).toBeDefined()
        expect(typeof options.handler).toBe("function")
    })

    it("the oauth block exposes login, refreshToken, and getApiKey", async () => {
        await lemonadeProvider(pi)

        const [, config] = vi.mocked(pi.registerProvider).mock.calls[0]!
        const oauth = config.oauth as Record<string, unknown>

        expect(oauth.name).toBe("Lemonade")
        expect(typeof oauth.login).toBe("function")
        expect(typeof oauth.refreshToken).toBe("function")
        expect(typeof oauth.getApiKey).toBe("function")
    })

    it("auto-registers models on startup when credentials are saved", async () => {
        nock("http://localhost:13305")
            .get("/api/v1/models")
            .reply(200, modelsSampleResponse)

        mockAuthJson(loggedInAuthJson)
        await lemonadeProvider(pi)

        // First call is the stub, second is the eager re-registration
        expect(pi.registerProvider).toHaveBeenCalledTimes(2)

        const [, config] = vi.mocked(pi.registerProvider).mock.calls[1]!
        expect(config.models).toHaveLength(4)

        const find = (id: string) => config.models!.find((m) => m.id === id)!

        // ctx_size takes priority over max_context_window
        expect(find("Qwen3.5-0.8B-GGUF").contextWindow).toBe(32000)
        // No ctx_size or max_context_window → falls back to default
        expect(find("Qwen3.6-27B-MTP-GGUF").contextWindow).toBe(128000)
        // ctx_size takes priority over max_context_window
        expect(find("Qwen3.6-35B-A3B-MTP-GGUF-UD-Q6_K_XL").contextWindow).toBe(128000)
        // ctx_size takes priority over max_context_window
        expect(find("gemma-4-26B-A4B-it-GGUF-UD-Q5_K_XL").contextWindow).toBe(64000)
    })
})
