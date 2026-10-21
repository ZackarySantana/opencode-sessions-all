import { expect, test } from "bun:test"
import type { Context, Destination, KeymapLayer, Route, ToastOptions } from "@opencode/plugin/tui/context"
import { SessionIndex } from "../src/index-store.js"
import { registerCommands, type BrowserState } from "../src/tui.js"

function browser() {
  const index = new SessionIndex(":memory:")
  index.upsertSession({ id: "s1", projectID: "p1", directory: "/work/alpha", title: "Alpha", createdAt: 10, updatedAt: 100 })
  index.upsertSession({ id: "s2", projectID: "p2", directory: "/work/beta", title: "Beta", createdAt: 10, updatedAt: 50 })
  index.upsertSession({ id: "child", projectID: "p1", directory: "/work/alpha", title: "Child", parentID: "s1", createdAt: 10, updatedAt: 20 })
  let state: BrowserState = { query: "", showSubagents: false, selected: 0, back: { type: "home" } }
  let route: Route = { type: "session", sessionID: "s1" }
  const layers: KeymapLayer[] = []
  const copied: string[] = []
  const toasts: ToastOptions[] = []
  const replies = { query: undefined as string | undefined, project: undefined as string | undefined, confirm: true, copy: true }
  const api = {
    location: { directory: "/work/alpha" },
    keymap: { layer: (factory: () => KeymapLayer) => layers.push(factory()) },
    renderer: { copyToClipboardOSC52: (text: string) => { copied.push(text); return replies.copy } },
    ui: {
      router: {
        current: () => route,
        navigate: (destination: Destination) => { route = destination.type === "plugin" ? { id: "opencode-sessions-all", ...destination } : destination },
      },
      dialog: { prompt: async () => replies.query, select: async () => replies.project, confirm: async () => replies.confirm },
      toast: { show: (toast: ToastOptions) => toasts.push(toast) },
    },
  } as unknown as Context
  registerCommands(api, index, { get: () => state, set: (value) => { state = value } })
  return {
    index, layers, replies, copied, toasts, state: () => state, route: () => route,
    run: async (name: string) => {
      const command = layers.flatMap((layer) => layer.commands ?? []).find((command) => command.id === `opencode-sessions-all.${name}`)
      if (!command) throw new Error(`Missing command ${name}`)
      await command.run()
    },
    [Symbol.dispose]() { index.close() },
  }
}

test("V2 slash command and keyboard layers preserve navigation and back route", async () => {
  using ui = browser()
  expect(ui.layers[0]?.mode).toBe("global")
  expect(ui.layers[0]?.commands?.[0]).toMatchObject({ palette: true, slash: { name: "sessions-all", aliases: ["all-sessions"] } })
  expect(ui.layers[1]?.commands?.map((command) => command.bind)).toEqual(["escape", "up,k", "down,j", "x", "r", "s", "enter,return", "/", "p"])
  await ui.run("open")
  expect(ui.route()).toMatchObject({ type: "plugin", name: "opencode-sessions-all.browser" })
  await ui.run("open") // Do not replace the original back route with the browser itself.
  await ui.run("down")
  expect(ui.state().selected).toBe(1)
  await ui.run("close")
  expect(ui.route()).toEqual({ type: "session", sessionID: "s1" })
})

test("V2 dialogs preserve search, project filters, cancellation, and subagents", async () => {
  using ui = browser()
  await ui.run("open")
  ui.replies.query = "Alpha"
  await ui.run("search")
  expect(ui.state().query).toBe("Alpha")
  ui.replies.query = undefined
  await ui.run("search")
  expect(ui.state().query).toBe("Alpha")
  ui.replies.project = "p1"
  await ui.run("project")
  expect(ui.state().projectID).toBe("p1")
  await ui.run("subagents")
  expect(ui.state().showSubagents).toBe(true)
  ui.replies.query = "["
  await ui.run("search")
  await ui.run("down") // An invalid regex must remain editable rather than throw.
  await ui.run("clear")
  expect(ui.state()).toMatchObject({ query: "", projectID: undefined, selected: 0 })
})

test("opens local sessions and retains confirmed shell-safe copying for other projects", async () => {
  using ui = browser()
  await ui.run("open")
  await ui.run("select")
  expect(ui.route()).toEqual({ type: "session", sessionID: "s1" })
  await ui.run("open")
  await ui.run("down")
  ui.replies.confirm = false
  await ui.run("select")
  expect(ui.copied).toEqual([])
  ui.replies.confirm = true
  await ui.run("select")
  expect(ui.copied).toEqual(["opencode '/work/beta' --session 's2'"])
  expect(ui.toasts[0]?.variant).toBe("success")
  ui.replies.copy = false
  await ui.run("select")
  expect(ui.toasts[1]?.variant).toBe("error")
})
