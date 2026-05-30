import {beforeEach, describe, expect, it, vi} from "vitest";
import {mockDeep} from "vitest-mock-extended";
import type {ExtensionAPI, ExtensionCommandContext} from "@earendil-works/pi-coding-agent";

import lemonadeProvider from "../extensions/index";

describe("/lemonade command", () => {
    let pi: ReturnType<typeof mockDeep<ExtensionAPI>>;
    let handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
    let contextMock: ReturnType<typeof mockDeep<ExtensionCommandContext>>;

    beforeEach(async () => {
        vi.restoreAllMocks();
        pi = mockDeep<ExtensionAPI>();
        await lemonadeProvider(pi);

        const [name, options] = vi.mocked(pi.registerCommand).mock.calls[0]!;
        expect(name).toBe("lemonade");
        handler = options.handler as (args: string, ctx: ExtensionCommandContext) => Promise<void>;
        contextMock = mockDeep<ExtensionCommandContext>();
    });

    it("shows help when called with no arguments", async () => {
        await handler("", contextMock);

        expect(contextMock.ui.notify).toHaveBeenCalledTimes(1);
        const [message, level] = contextMock.ui.notify.mock.calls[0]!;
        expect(level).toBe("info");
        expect(message).toContain("/lemonade <command>");
        expect(message).toContain("status");
        expect(message).toContain("models");
        expect(message).toContain("load");
        expect(message).toContain("unload");
        expect(message).toContain("pull");
        expect(message).toContain("delete");
        expect(message).toContain("refresh");
        expect(message).toContain("discover");
    });

    it("shows warning when called with a subcommand but not connected", async () => {
        await handler("status", contextMock);

        expect(contextMock.ui.notify).toHaveBeenCalledTimes(1);
        const [message, level] = contextMock.ui.notify.mock.calls[0]!;
        expect(level).toBe("warning");
        expect(message).toBe("Not connected to Lemonade. Run /login and pick Lemonade.");
    });
});
