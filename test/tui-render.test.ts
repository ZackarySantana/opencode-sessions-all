import { expect, test } from "bun:test"
import type { Context, KeymapLayer, Page } from "@opencode/plugin/tui/context"
import { testRender } from "@opentui/solid"
import { mkdtemp, rm } from "node:fs/promises"
import { join, resolve } from "node:path"
import { SessionIndex } from "../src/index-store.js"

test("built V2 browser renders and reactively updates search and responsive layout", async () => {
  const directory = await mkdtemp("/tmp/opencode/sessions-all-render-")
  const path = join(directory, "index.sqlite")
  const index = new SessionIndex(path)
  index.upsertSession({ id: "s1", projectID: "p1", directory: "/work/alpha", title: "Fix authentication", createdAt: 10, updatedAt: 100 })
  index.upsertSession({ id: "s2", projectID: "p2", directory: "/work/beta", title: "Build dashboard", createdAt: 10, updatedAt: 50 })
  index.upsertMessage({ id: "m1", sessionID: "s1", role: "user", text: "Investigate JWT refresh tokens", createdAt: 20 })
  index.close()

  let page: Page | undefined
  const layers: KeymapLayer[] = []
  const api = {
    options: { database: path }, location: { directory: "/work/alpha" },
    theme: {
      background: { base: "#101010", raised: { base: "#202020" }, action: { primary: { selected: "#0055cc" } } },
      border: { base: "#555555" },
      text: {
        base: "#ffffff", muted: "#aaaaaa",
        action: { primary: { selected: "#ffffff" }, secondary: { base: "#aaaaee" } },
        feedback: { success: { base: "#00ff00" }, error: { base: "#ff0000" } },
      },
    },
    keymap: { layer: (factory: () => KeymapLayer) => layers.push(factory()), mode: { push: () => () => {} } },
    ui: {
      router: { register: (value: Page) => { page = value; return () => {} }, current: () => ({ type: "home" }) },
      dialog: { prompt: async () => "JWT" },
    },
    client: { session: { list: async () => ({ data: [], cursor: {} }) } },
  } as unknown as Context
  const tui = (await import(resolve("dist/tui.js"))).default as { setup: (api: Context) => () => Promise<void> }
  const cleanup = tui.setup(api)
  const view = await testRender(() => page!.render({}), { width: 120, height: 24 })
  try {
    await view.renderOnce()
    const frame = view.captureCharFrame()
    expect(frame).toContain("All sessions")
    expect(frame).toContain("Fix authentication")
    expect(frame).toContain("Build dashboard")
    expect(frame).toContain("indexed messages")

    const search = layers.flatMap((layer) => layer.commands ?? []).find((command) => command.id === "opencode-sessions-all.search")!
    await search.run()
    await view.renderOnce()
    expect(view.captureCharFrame()).toContain("query: JWT")
    expect(view.captureCharFrame()).not.toContain("Build dashboard")

    view.resize(90, 24)
    await view.renderOnce()
    expect(view.captureCharFrame()).toContain("Fix authentication")
    expect(view.captureCharFrame()).not.toContain("indexed messages")
  } finally {
    await view.dispose()
    await cleanup()
    await rm(directory, { recursive: true, force: true })
  }
})
