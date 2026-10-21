import type { SessionInfo, SessionMessageAssistant, SessionMessageUser } from "@opencode/client"

export function session(id = "s1", directory = "/work/alpha"): SessionInfo {
  return {
    id, projectID: "p1", title: "Fix authentication", location: { directory },
    time: { created: 10, updated: 100 }, cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }
}

export function user(id = "m1", text = "Investigate JWT refresh tokens"): SessionMessageUser {
  return { id, type: "user", time: { created: 20 }, text }
}

export function assistant(): SessionMessageAssistant {
  return {
    id: "m2", type: "assistant", agent: "build", time: { created: 30 },
    model: { providerID: "openai", id: "gpt" },
    content: [{ type: "text", text: "JWT rotation completed" }], cost: 0.2,
    tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 10, write: 2 } },
  }
}
