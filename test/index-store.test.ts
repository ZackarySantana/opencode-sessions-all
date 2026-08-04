import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { SessionIndex, compileQuery } from "../src/index-store.js"

function seed(index: SessionIndex) {
  index.upsertSession({ id: "s1", projectID: "p1", directory: "/work/alpha", title: "Fix authentication", createdAt: 10, updatedAt: 100 })
  index.upsertSession({ id: "s2", projectID: "p2", directory: "/work/beta", title: "Build dashboard", createdAt: 20, updatedAt: 200 })
  index.upsertMessage({ id: "m1", sessionID: "s1", role: "user", createdAt: 30, text: "Investigate expired JWT refresh tokens" })
  index.upsertMessage({ id: "m2", sessionID: "s2", role: "assistant", createdAt: 40, text: "Implemented responsive charts" })
}

describe("SessionIndex", () => {
  test("searches titles, project paths, and message content", () => {
    const index = new SessionIndex(":memory:")
    seed(index)
    expect(index.search().map((row) => row.id)).toEqual(["s2", "s1"])
    expect(index.search("jwt").map((row) => row.id)).toEqual(["s1"])
    expect(index.search("dashboard").map((row) => row.id)).toEqual(["s2"])
    expect(index.search("alpha").map((row) => row.id)).toEqual(["s1"])
    index.close()
  })

  test("filters projects and upserts revisions", () => {
    const index = new SessionIndex(":memory:")
    seed(index)
    index.upsertSession({ id: "s1", projectID: "p1", directory: "/work/alpha", title: "Fix auth completely", createdAt: 10, updatedAt: 300 })
    expect(index.search("auth", "p1")).toMatchObject([{ id: "s1", title: "Fix auth completely", messageCount: 1 }])
    expect(index.search("auth", "p2")).toEqual([])
    index.close()
  })

  test("tracks project backfill completion", () => {
    const index = new SessionIndex(":memory:")
    expect(index.isBackfilled("p1")).toBe(false)
    index.markBackfilled("p1", "/work/alpha")
    expect(index.isBackfilled("p1")).toBe(true)
    index.close()
  })

  test("aggregates assistant metrics and remembers the latest model", () => {
    const index = new SessionIndex(":memory:")
    index.upsertSession({ id: "s1", projectID: "p1", directory: "/work/alpha", title: "Mixed models", createdAt: 1, updatedAt: 2 })
    index.upsertMessage({ id: "m1", sessionID: "s1", role: "assistant", createdAt: 10, text: "first", providerID: "anthropic", modelID: "sonnet", cost: 0.2, input: 100, output: 20, reasoning: 5, cacheRead: 10, cacheWrite: 2 })
    index.upsertMessage({ id: "m2", sessionID: "s1", role: "assistant", createdAt: 20, text: "second", providerID: "openai", modelID: "gpt", cost: 0.3, input: 200, output: 30, reasoning: 7, cacheRead: 20, cacheWrite: 3 })
    expect(index.search(".*")[0]).toMatchObject({ providerID: "openai", modelID: "gpt", modelCount: 2, cost: 0.5, input: 300, output: 50, reasoning: 12, cacheRead: 30, cacheWrite: 5 })
    index.close()
  })

  test("uses regular expressions and the newest matching message as snippet", () => {
    const index = new SessionIndex(":memory:")
    seed(index)
    index.upsertMessage({ id: "m3", sessionID: "s1", role: "assistant", createdAt: 50, text: "JWT rotation completed" })
    expect(index.search("jwt.*(refresh|rotation)")[0]?.snippet).toBe("JWT rotation completed")
    expect(() => compileQuery("[")).toThrow()
    index.close()
  })
})

test("migrates legacy message indexes", () => {
  const path = `/tmp/opencode-sessions-all-migration-${crypto.randomUUID()}.sqlite`
  const legacy = new Database(path)
  legacy.run("CREATE TABLE messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL, created_at INTEGER NOT NULL, text TEXT NOT NULL)")
  legacy.close()
  const index = new SessionIndex(path)
  const columns = index.db.query<{ name: string }, []>("PRAGMA table_info(messages)").all().map((column) => column.name)
  expect(columns).toContain("model_id")
  expect(columns).toContain("cache_write_tokens")
  index.close()
  Bun.file(path).delete()
})
