import { expect, test } from "bun:test"
import type { OpenCodeEvent } from "@opencode/client"
import type { Plugin } from "@opencode/plugin"
import type { Context, Route } from "@opencode/plugin/tui/context"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import server from "../src/server.js"
import tui from "../src/tui.js"
import { SessionIndex, type SessionSearchResult } from "../src/index-store.js"
import { assistant, session, user } from "./fixtures.js"

test("V2 server subscribes, indexes event data, isolates locations, deletes, and cleans up", async () => {
  const directory = await mkdtemp("/tmp/opencode/sessions-all-test-")
  const path = join(directory, "index.sqlite")
  const finished = Promise.withResolvers<void>()
  const snapshots: SessionSearchResult[][] = []
  let aborted = false
  let title = "Initial"
  let reader: SessionIndex | undefined
  const api = {
    options: { database: path },
    location: { directory: "/work/alpha", project: { id: "p1" } },
    session: {
      list: async () => ({ data: [], cursor: {} }),
      get: async ({ sessionID }: { sessionID: string }) => ({ ...session(sessionID), title }),
      context: async () => [user(), assistant()],
    },
    event: {
      async *subscribe({ signal }: { signal: AbortSignal }) {
        reader = new SessionIndex(path)
        yield event("session.created", { sessionID: "s1", location: { directory: "/work/alpha" } })
        snapshots.push(reader.search())
        title = "Renamed"
        yield event("session.renamed", { sessionID: "s1" }) // Location may be omitted in the envelope.
        snapshots.push(reader.search())
        title = "Must not be indexed"
        yield event("session.renamed", { sessionID: "s1" }, "/work/other")
        snapshots.push(reader.search())
        yield event("session.deleted", { sessionID: "s1" }, "/work/alpha")
        snapshots.push(reader.search())
        finished.resolve()
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => { aborted = true; resolve() }, { once: true })
        })
      },
    },
  } as unknown as Plugin.Context
  const cleanup = await server.setup(api)
  try {
    await finished.promise
    expect(snapshots[0]).toMatchObject([{ id: "s1", title: "Initial", messageCount: 2, cost: 0.2 }])
    expect(snapshots[1]?.[0]?.title).toBe("Renamed")
    expect(snapshots[2]?.[0]?.title).toBe("Renamed")
    expect(snapshots[3]).toEqual([])
  } finally {
    await cleanup?.()
    reader?.close()
    await rm(directory, { recursive: true, force: true })
  }
  expect(aborted).toBe(true)
})

test("V2 TUI unload aborts backfill and unregisters its route", async () => {
  let aborted = false
  let unregistered = false
  let route: Route = { type: "plugin", id: "opencode-sessions-all", name: "opencode-sessions-all.browser" }
  const api = {
    options: { database: ":memory:" },
    location: { directory: "/work/alpha" },
    keymap: { layer() {} },
    ui: { router: {
      register: () => () => { unregistered = true },
      current: () => route,
      navigate: (next: Route) => { route = next },
    } },
    client: { session: {
      list: (_input: unknown, options: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          aborted = true
          reject(options.signal.reason)
        }, { once: true })
      }),
    } },
  } as unknown as Context
  const cleanup = await tui.setup(api)
  await cleanup?.()
  expect(aborted).toBe(true)
  expect(unregistered).toBe(true)
  expect<Route>(route).toEqual({ type: "home" })
})

function event(type: string, data: Record<string, unknown>, directory?: string): OpenCodeEvent {
  return { type, data, ...(directory ? { location: { directory } } : {}) } as OpenCodeEvent
}
