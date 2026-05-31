import {vol} from "memfs"

export const loggedInAuthJson =
    JSON.stringify({
        lemonade: {
            refresh: JSON.stringify({
                baseUrl: "http://localhost:13305",
                apiKey: "test-key",
                serverName: "Lemonade v0.5.0",
            }),
            access: "test-key",
            expires: Date.now() + 86400000,
        },
    })

export function mockAuthJson(json: string) {
    vol.fromJSON({"/home/testuser/.pi/agent/auth.json": json})
}
