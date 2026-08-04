import type { PluginInput } from "@opencode-ai/plugin"
import { messageInput, sessionInput } from "./indexer.js"
import type { SessionIndex } from "./index-store.js"

type Client = PluginInput["client"]

export async function backfillProject(
  client: Client,
  index: SessionIndex,
  context: { projectID: string; directory: string },
  signal?: AbortSignal,
) {
  const sessions = await client.session.list({ query: { directory: context.directory }, signal })
  if (sessions.error) throw new Error("Unable to list sessions for indexing")

  for (const session of sessions.data ?? []) {
    signal?.throwIfAborted()
    index.upsertSession(sessionInput(session))
    const messages = await client.session.messages({
      path: { id: session.id },
      query: { directory: session.directory },
      signal,
    })
    if (messages.error) throw new Error(`Unable to read session ${session.id} for indexing`)
    for (const item of messages.data ?? []) index.upsertMessage(messageInput(item.info, item.parts))
  }

  signal?.throwIfAborted()
  index.markBackfilled(context.projectID, context.directory)
}
