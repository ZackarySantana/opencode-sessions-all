import type { SessionInfo, SessionMessageInfo } from "@opencode/client"
import type { MessageInput, SessionInput } from "./index-store.js"

export function sessionInput(session: SessionInfo): SessionInput {
  return {
    id: session.id,
    projectID: session.projectID,
    directory: session.location.directory,
    title: session.title ?? "Untitled session",
    parentID: session.parentID,
    createdAt: session.time.created,
    updatedAt: session.time.updated,
  }
}

export function messageInput(sessionID: string, message: SessionMessageInfo): MessageInput | undefined {
  if (message.type !== "user" && message.type !== "assistant") return undefined
  const metrics = message.type === "assistant" ? {
    providerID: message.model.providerID,
    modelID: message.model.id,
    cost: message.cost,
    input: message.tokens?.input,
    output: message.tokens?.output,
    reasoning: message.tokens?.reasoning,
    cacheRead: message.tokens?.cache.read,
    cacheWrite: message.tokens?.cache.write,
  } : {}
  return {
    id: message.id,
    sessionID,
    role: message.type,
    createdAt: message.time.created,
    text: message.type === "user" ? message.text.trim() : searchableText(message.content),
    ...metrics,
  }
}

export function searchableText(parts: Extract<SessionMessageInfo, { type: "assistant" }>["content"]) {
  return parts
    .flatMap((part) => part.type === "text" ? [part.text] : [])
    .join("\n")
    .trim()
}

export type IndexableMessage = Extract<SessionMessageInfo, { type: "user" | "assistant" }>
