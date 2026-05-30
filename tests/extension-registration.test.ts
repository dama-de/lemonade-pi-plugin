import {beforeEach, describe, expect, it, vi} from "vitest";
import type {PiClient} from "../extensions";
import lemonadeProvider from "../extensions/index";

function createMockPi(): PiClient {
    return {
        registerProvider: vi.fn(),
        unregisterProvider: vi.fn(),
        registerCommand: vi.fn(),
    };
}

describe("extension registration", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it("registers the Lemonade provider on startup", async () => {
        const pi = createMockPi();

        await lemonadeProvider(pi);

        expect(pi.registerProvider).toHaveBeenCalledTimes(1);

        const [id, config] = vi.mocked(pi.registerProvider).mock.calls[0]!;
        expect(id).toBe("lemonade");
        expect(config.name).toBe("Lemonade");
        expect(config.baseUrl).toBe("http://localhost:8000/v1");
        expect(config.api).toBe("openai-completions");
        expect(Array.isArray(config.models)).toBe(true);
        expect(config.models).toHaveLength(0);
        expect(config.oauth).toBeDefined();
    });

    it("registers the /lemonade command", async () => {
        const pi = createMockPi();

        await lemonadeProvider(pi);

        expect(pi.registerCommand).toHaveBeenCalledTimes(1);

        const [name, options] = vi.mocked(pi.registerCommand).mock.calls[0]!;
        expect(name).toBe("lemonade");
        expect(options.description).toBeDefined();
        expect(typeof options.handler).toBe("function");
    });

    it("the oauth block exposes login, refreshToken, and getApiKey", async () => {
        const pi = createMockPi();

        await lemonadeProvider(pi);

        const [, config] = vi.mocked(pi.registerProvider).mock.calls[0]!;
        const oauth = config.oauth as Record<string, unknown>;

        expect(oauth.name).toBe("Lemonade");
        expect(typeof oauth.login).toBe("function");
        expect(typeof oauth.refreshToken).toBe("function");
        expect(typeof oauth.getApiKey).toBe("function");
    });

});
