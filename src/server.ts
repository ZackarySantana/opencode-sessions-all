import { Plugin } from "@opencode/plugin"
import { backfillProject, indexSession } from "./backfill.js"
import { SessionIndex, databasePath } from "./index-store.js"
import { opencodeStateDirectory } from "./state.js"

export default Plugin.define({
  id: "opencode-sessions-all",
  setup(ctx) {
    const index = new SessionIndex(databasePath(opencodeStateDirectory(), ctx.options.database))
    const context = { projectID: ctx.location.project.id, directory: ctx.location.directory }
    const controller = new AbortController()
    const backfill = backfillProject(ctx, index, context, controller.signal).catch((error) => {
      if (!controller.signal.aborted) console.warn("opencode-sessions-all: backfill failed; it will retry next startup", error)
    })

    const events = (async () => {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        if (!event.type.startsWith("session.") || !("sessionID" in event.data)) continue
        // The stream includes other locations. Index only this instance's directory.
        const directory = event.type === "session.created" || event.type === "session.moved"
          ? event.data.location.directory
          : event.location?.directory
        if (directory && directory !== context.directory) continue
        if (event.type === "session.deleted") {
          index.removeSession(event.data.sessionID)
          continue
        }
        if (![
          "session.created", "session.renamed", "session.moved", "session.inbox.delivered",
          "session.text.ended", "session.step.ended", "session.step.failed", "session.usage.updated",
          "session.execution.succeeded", "session.execution.failed", "session.execution.interrupted",
        ].includes(event.type)) continue
        try {
          if (typeof event.data.sessionID === "string") {
            await indexSession(ctx, index, event.data.sessionID, controller.signal, context.directory)
          }
        } catch (error) {
          if (!controller.signal.aborted) console.warn("opencode-sessions-all: session indexing failed", error)
        }
      }
    })().catch((error) => {
      if (!controller.signal.aborted) console.warn("opencode-sessions-all: event subscription failed", error)
    })

    return async () => {
      controller.abort()
      await Promise.allSettled([backfill, events])
      index.close()
    }
  },
})
