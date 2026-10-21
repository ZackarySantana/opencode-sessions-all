import { expect, test } from "bun:test"
import { messageInput, sessionInput } from "../src/indexer.js"
import { assistant, session, user } from "./fixtures.js"

test("maps V2 session locations, hierarchy, and optional titles", () => {
  expect(sessionInput({ ...session(), parentID: "parent", title: undefined })).toEqual({
    id: "s1", projectID: "p1", directory: "/work/alpha", title: "Untitled session",
    parentID: "parent", createdAt: 10, updatedAt: 100,
  })
})

test("indexes only user/assistant text, without attachments, tools, or reasoning", () => {
  const message = assistant()
  message.content.push(
    { type: "reasoning", text: "private reasoning" },
    { type: "tool", id: "tool1", name: "read", time: { created: 30 }, state: {
      status: "completed", input: { path: ".env" }, content: [{ type: "text", text: "SECRET" }],
    } },
  )
  expect(messageInput("s1", message)).toEqual({
    id: "m2", sessionID: "s1", role: "assistant", createdAt: 30, text: "JWT rotation completed",
    providerID: "openai", modelID: "gpt", cost: 0.2,
    input: 100, output: 20, reasoning: 5, cacheRead: 10, cacheWrite: 2,
  })
  expect(messageInput("s1", user())).toMatchObject({ role: "user", text: "Investigate JWT refresh tokens" })
  expect(messageInput("s1", { id: "synthetic", type: "synthetic", time: { created: 20 }, text: "hidden" })).toBeUndefined()
})

test("handles in-progress assistant messages without metrics", () => {
  const message = { ...assistant(), tokens: undefined, cost: undefined }
  expect(messageInput("s1", message)).toMatchObject({ role: "assistant", text: "JWT rotation completed", input: undefined })
})
