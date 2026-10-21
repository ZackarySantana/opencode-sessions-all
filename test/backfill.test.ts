import { expect, test } from "bun:test"
import { backfillProject, indexSession, type IndexClient } from "../src/backfill.js"
import { SessionIndex } from "../src/index-store.js"
import { assistant, session, user } from "./fixtures.js"

function client(): IndexClient {
  return {
    session: {
      list: async () => ({ data: [session()], cursor: {} }),
      get: async ({ sessionID }) => session(sessionID),
      context: async () => [user(), assistant()],
    },
  }
}

test("backfills V2 context and upserts repeated messages and metrics", async () => {
  using index = disposableIndex()
  await backfillProject(client(), index.value, { projectID: "p1", directory: "/work/alpha" })
  await backfillProject(client(), index.value, { projectID: "p1", directory: "/work/alpha" })
  expect(index.value.search("JWT")).toMatchObject([{ id: "s1", messageCount: 2, cost: 0.2, input: 100 }])
  expect(index.value.isBackfilled("p1")).toBe(true)
})

test("follows session and full-history message cursors, including pre-compaction text", async () => {
  using index = disposableIndex()
  const api = client()
  const sessionCursors: Array<string | undefined> = []
  const messageCursors: Array<string | undefined> = []
  api.session.list = async (input) => {
    sessionCursors.push(input?.cursor)
    return input?.cursor
      ? { data: [session("s2")], cursor: {} }
      : { data: [session()], cursor: { next: "sessions-next" } }
  }
  api.session.context = async () => { throw new Error("Full history must not use the compacted context") }
  api.message = {
    list: async (input) => {
      messageCursors.push(input.cursor)
      if (input.cursor) {
        expect(input.order).toBeUndefined()
        return { data: [assistant()], cursor: {} }
      }
      expect(input.order).toBe("asc")
      return { data: [user(`${input.sessionID}-old`, "before compaction")], cursor: { next: "messages-next" } }
    },
  }
  await backfillProject(api, index.value, { directory: "/work/alpha" })
  expect(sessionCursors).toEqual([undefined, "sessions-next"])
  expect(messageCursors).toEqual([undefined, "messages-next", undefined, "messages-next"])
  expect(index.value.search("before compaction").map((row) => row.id)).toEqual(["s1", "s2"])
  expect(index.value.isBackfilled("p1")).toBe(true)
  expect(index.value.isBackfilled("")).toBe(false)
})

test("failed or cancelled backfills do not mark completion", async () => {
  using index = disposableIndex()
  const api = client()
  api.session.context = async () => { throw new Error("unavailable") }
  await expect(backfillProject(api, index.value, { projectID: "p1", directory: "/work/alpha" })).rejects.toThrow("unavailable")
  expect(index.value.isBackfilled("p1")).toBe(false)

  const controller = new AbortController()
  api.session.get = async () => { controller.abort(); return session() }
  await expect(indexSession(api, index.value, "s1", controller.signal)).rejects.toThrow()
  expect(index.value.isBackfilled("p1")).toBe(false)
})

test("live indexing checks the session's own location", async () => {
  using index = disposableIndex()
  await indexSession(client(), index.value, "s1", undefined, "/work/other")
  expect(index.value.search()).toEqual([])
})

function disposableIndex() {
  const value = new SessionIndex(":memory:")
  return { value, [Symbol.dispose]() { value.close() } }
}
