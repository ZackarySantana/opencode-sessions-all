import type { AssistantMessage, Message, Part, Session, UserMessage } from "@opencode-ai/sdk"
import type { MessageInput, SessionInput } from "./index-store.js"

export function sessionInput(session: Session): SessionInput {
  return {
    id: session.id,
    projectID: session.projectID,
    directory: session.directory,
    title: session.title,
    parentID: session.parentID,
    createdAt: session.time.created,
    updatedAt: session.time.updated,
  }
}

export function messageInput(message: Message, parts: Part[]): MessageInput {
  const metrics = message.role === "assistant" ? {
    providerID: message.providerID,
    modelID: message.modelID,
    cost: message.cost,
    input: message.tokens.input,
    output: message.tokens.output,
    reasoning: message.tokens.reasoning,
    cacheRead: message.tokens.cache.read,
    cacheWrite: message.tokens.cache.write,
  } : {}
  return {
    id: message.id,
    sessionID: message.sessionID,
    role: message.role,
    createdAt: message.time.created,
    text: searchableText(parts),
    ...metrics,
  }
}

export function searchableText(parts: Part[]) {
  return parts
    .flatMap((part) => part.type === "text" && !part.synthetic ? [part.text] : [])
    .join("\n")
    .trim()
}

export type IndexableMessage = UserMessage | AssistantMessage
