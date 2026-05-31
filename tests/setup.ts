import {vi} from "vitest"
import {vol} from "memfs"

vi.mock("node:os", () => ({
    default: {
        homedir: () => "/home/testuser",
    },
}))

vi.mock("node:fs", () => ({
    promises: vol.promises,
}))

// Reset memfs between tests so one test's files don't leak into another
import {beforeEach} from "vitest"

beforeEach(() => {
    vol.reset()
})
