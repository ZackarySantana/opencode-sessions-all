import type { OpenCodeClient } from "@opencode/client"
import { messageInput, sessionInput } from "./indexer.js"
import type { SessionIndex } from "./index-store.js"

export type IndexClient = {
  session: Pick<OpenCodeClient["session"], "list" | "get" | "context">
  message?: OpenCodeClient["message"]
}

export async function indexSession(client: IndexClient, index: SessionIndex, sessionID: string, signal?: AbortSignal, directory?: string) {
  const session = await client.session.get({ sessionID }, { signal })
  signal?.throwIfAborted()
  if (directory && session.location.directory !== directory) return
  index.upsertSession(sessionInput(session))

  if (!client.message) {
    const messages = await client.session.context({ sessionID }, { signal })
    signal?.throwIfAborted()
    for (const message of messages) {
      const input = messageInput(sessionID, message)
      if (input) index.upsertMessage(input)
    }
    return
  }

  let cursor: string | undefined
  do {
    const page = await client.message.list({ sessionID, limit: 100, ...(cursor ? { cursor } : { order: "asc" }) }, { signal })
    signal?.throwIfAborted()
    for (const message of page.data) {
      const input = messageInput(sessionID, message)
      if (input) index.upsertMessage(input)
    }
    cursor = page.cursor.next ?? undefined
  } while (cursor)
}

export async function backfillProject(
  client: IndexClient,
  index: SessionIndex,
  context: { projectID?: string; directory: string },
  signal?: AbortSignal,
) {
  let cursor: string | undefined
  const projectIDs = new Set(context.projectID ? [context.projectID] : [])
  do {
    const page = await client.session.list(cursor ? { cursor, limit: 100 } : { directory: context.directory, limit: 100 }, { signal })
    for (const session of page.data) {
      signal?.throwIfAborted()
      projectIDs.add(session.projectID)
      await indexSession(client, index, session.id, signal)
    }
    cursor = page.cursor.next ?? undefined
  } while (cursor)

  signal?.throwIfAborted()
  for (const projectID of projectIDs) index.markBackfilled(projectID, context.directory)
}
