import {beforeEach, describe, expect, it, vi} from "vitest";
import lemonadeProvider from "../extensions/index";

// ─── Mock ExtensionAPI ──────────────────────────────────────────────────────

interface Call {
    args: unknown[];
}

function createMockPi() {
    const calls: Record<string, Call[]> = {
        registerProvider: [],
        unregisterProvider: [],
        registerCommand: [],
    };

    const pi = {
        registerProvider: vi.fn((id: string, config: Record<string, unknown>) => {
            calls.registerProvider.push({args: [id, config]});
        }),
        unregisterProvider: vi.fn((id: string) => {
            calls.unregisterProvider.push({args: [id]});
        }),
        registerCommand: vi.fn((name: string, options: { description?: string; handler: Function }) => {
            calls.registerCommand.push({args: [name, options]});
        }),
    };

    return {pi, calls};
}

describe("extension registration", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it("registers the Lemonade provider on startup", async () => {
        const {pi, calls} = createMockPi();

        await lemonadeProvider(pi);

        // registerProvider should be called at least once (stub registration)
        expect(calls.registerProvider.length).toBeGreaterThanOrEqual(1);

        const firstCall = calls.registerProvider[0];
        expect(firstCall.args[0]).toBe("lemonade");

        const config = firstCall.args[1] as Record<string, unknown>;
        expect(config.name).toBe("Lemonade");
        expect(config.baseUrl).toBe("http://localhost:8000/v1");
        expect(config.api).toBe("openai-completions");
        expect(Array.isArray(config.models)).toBe(true);
        const models = config.models as unknown[];
        expect(models.length).toBe(0); // stub has no models
        expect(config.oauth).toBeDefined();
    });

    it("registers the admin command", async () => {
        const {pi, calls} = createMockPi();

        await lemonadeProvider(pi);

        expect(calls.registerCommand.length).toBeGreaterThanOrEqual(1);

        const cmdCall = calls.registerCommand[0];
        expect(cmdCall.args[0]).toBe("lemonade");

        const options = cmdCall.args[1] as { description?: string; handler: Function };
        expect(options.description).toBeDefined();
        expect(typeof options.handler).toBe("function");
    });

    it("the oauth block exposes login, refreshToken, and getApiKey", async () => {
        const {pi, calls} = createMockPi();

        await lemonadeProvider(pi);

        const config = calls.registerProvider[0].args[1] as Record<string, unknown>;
        const oauth = config.oauth as Record<string, unknown>;

        expect(oauth.name).toBe("Lemonade");
        expect(typeof oauth.login).toBe("function");
        expect(typeof oauth.refreshToken).toBe("function");
        expect(typeof oauth.getApiKey).toBe("function");
    });

});
