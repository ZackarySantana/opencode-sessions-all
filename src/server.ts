import type { Plugin, PluginModule } from "@opencode-ai/plugin"
import type { Session } from "@opencode-ai/sdk"
import { backfillProject } from "./backfill.js"
import { SessionIndex, databasePath } from "./index-store.js"
import { messageInput, sessionInput } from "./indexer.js"
import { opencodeStateDirectory } from "./state.js"

const server: Plugin = async (input, options) => {
  const index = new SessionIndex(databasePath(opencodeStateDirectory(), options?.database))
  const context = { projectID: input.project.id, directory: input.directory }
  const controller = new AbortController()
  const backfill = backfillProject(input.client, index, context, controller.signal).catch((error) => {
    if (controller.signal.aborted) return
    console.warn("opencode-sessions-all: backfill failed; it will retry next startup", error)
  })

  return {
    event: async ({ event }) => {
      if (event.type === "session.created" || event.type === "session.updated" || event.type === "session.deleted") {
        index.upsertSession(sessionInput(event.properties.info as Session))
        return
      }

      if (event.type !== "message.part.updated" || event.properties.part.type !== "text") return
      const part = event.properties.part
      const message = await input.client.session.message({
        path: { id: part.sessionID, messageID: part.messageID },
        query: { directory: input.directory },
      })
      if (message.data) index.upsertMessage(messageInput(message.data.info, message.data.parts))
    },
    dispose: async () => {
      controller.abort()
      void backfill.finally(() => index.close())
    },
  }
}

const plugin: PluginModule & { id: string } = {
  id: "opencode-sessions-all",
  server,
}

export default plugin
