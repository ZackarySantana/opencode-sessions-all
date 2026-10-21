/** @jsxImportSource @opentui/solid */

import type { RGBA } from "@opentui/core"
import { Plugin } from "@opencode/plugin/tui"
import type { Context, Route } from "@opencode/plugin/tui/context"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, onCleanup } from "solid-js"
import { formatCost, formatTokens, relativeTime, shorten } from "./format.js"
import { SessionIndex, compileQuery, databasePath, type SessionSearchResult } from "./index-store.js"
import { backfillProject } from "./backfill.js"
import { opencodeStateDirectory } from "./state.js"

const ROUTE = "opencode-sessions-all.browser"
const MODE = "opencode-sessions-all.browser"

const commands = {
  open: "opencode-sessions-all.open",
  close: "opencode-sessions-all.close",
  search: "opencode-sessions-all.search",
  project: "opencode-sessions-all.project",
  clear: "opencode-sessions-all.clear",
  up: "opencode-sessions-all.up",
  down: "opencode-sessions-all.down",
  select: "opencode-sessions-all.select",
  refresh: "opencode-sessions-all.refresh",
  subagents: "opencode-sessions-all.subagents",
}

type Color = RGBA | string
type BackRoute = Route
export type BrowserState = { query: string; projectID?: string; showSubagents: boolean; selected: number; back: BackRoute }
type StateStore = { get: () => BrowserState; set: (state: BrowserState) => void }

type Skin = {
  background: Color
  panel: Color
  border: Color
  text: Color
  muted: Color
  primary: Color
  selected: Color
  secondary: Color
  success: Color
  error: Color
}

function skin(api: Context): Skin {
  const theme = api.theme
  return {
    get background() { return theme.background.base },
    get panel() { return theme.background.raised.base },
    get border() { return theme.border.base },
    get text() { return theme.text.base },
    get muted() { return theme.text.muted },
    get primary() { return theme.background.action.primary.selected },
    get selected() { return theme.text.action.primary.selected },
    get secondary() { return theme.text.action.secondary.base },
    get success() { return theme.text.feedback.success.base },
    get error() { return theme.text.feedback.error.base },
  }
}

export function clampSelection(selected: number, count: number) {
  if (count <= 0) return 0
  return Math.max(0, Math.min(selected, count - 1))
}

export function filterSubagents(rows: SessionSearchResult[], showSubagents: boolean) {
  return showSubagents ? rows : rows.filter((row) => !row.parentID)
}

export function resumeCommand(directory: string, sessionID: string) {
  return `opencode ${shellQuote(directory)} --session ${shellQuote(sessionID)}`
}

export function previewWidth(terminalWidth: number) {
  return Math.max(34, Math.floor(terminalWidth * 0.34))
}

export function showExtendedHints(terminalWidth: number) {
  return terminalWidth >= 110
}

export function sessionTokens(row: SessionSearchResult) {
  return row.input + row.output + row.reasoning + row.cacheRead + row.cacheWrite
}

export function contextPercent(tokens: number, context?: number) {
  if (!context) return "--"
  return `${Math.round(tokens / context * 100)}%`
}

export function modelContext(api: Context, row?: SessionSearchResult) {
  if (!row?.providerID || !row.modelID) return undefined
  return api.data.location.model.list(api.location)?.find((model) => model.providerID === row.providerID && model.id === row.modelID)?.limit.context
}

export function currentSessionID(back: BackRoute) {
  return back.type === "session" ? back.sessionID : undefined
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

function Browser(props: { api: Context; index: SessionIndex; state: StateStore }) {
  const dimensions = useTerminalDimensions()
  const colors = skin(props.api)
  const state = props.state.get
  const [revision, setRevision] = createSignal(0)
  const rows = createMemo(() => {
    revision()
    try {
      return filterSubagents(props.index.search(state().query, state().projectID, 100), state().showSubagents)
    } catch {
      return []
    }
  })
  const queryError = createMemo(() => {
    try { compileQuery(state().query); return "" } catch (error) { return error instanceof Error ? error.message : "Invalid regular expression" }
  })
  const selected = createMemo(() => clampSelection(state().selected, rows().length))
  const current = () => currentSessionID(state().back)
  const project = () => props.index.projects().find((item) => item.id === state().projectID)?.label ?? "all projects"
  const timer = setInterval(() => setRevision((value) => value + 1), 5_000)
  const popMode = props.api.keymap.mode.push(MODE)
  onCleanup(() => {
    clearInterval(timer)
    popMode()
  })

  return (
    <box
      width={dimensions().width}
      height={dimensions().height}
      flexDirection="column"
      backgroundColor={colors.background}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
    >
      <box flexDirection="row" justifyContent="space-between" paddingBottom={1}>
        <text fg={colors.text}><b>All sessions</b> <span style={{ fg: colors.muted }}>across OpenCode projects</span></text>
        <box flexDirection="row" gap={2}>
          <Hint keyText="/" action="search" colors={colors} />
          <Hint keyText="p" action="project" colors={colors} />
          <Hint keyText="s" action="subagents" colors={colors} />
          {showExtendedHints(dimensions().width) ? <Hint keyText="j/k" action="move" colors={colors} /> : null}
          {showExtendedHints(dimensions().width) ? <Hint keyText="enter" action="open" colors={colors} /> : null}
          {showExtendedHints(dimensions().width) ? <Hint keyText="esc" action="back" colors={colors} /> : null}
        </box>
      </box>

      <box flexDirection="row" gap={1} paddingBottom={1} alignItems="center">
        <box border borderColor={colors.border} paddingLeft={1} paddingRight={1}>
          <text fg={colors.muted}>query: <span style={{ fg: queryError() ? colors.error : colors.text }}>{state().query || ".*"}</span></text>
        </box>
        <box border borderColor={colors.border} paddingLeft={1} paddingRight={1}>
          <text fg={colors.muted}>project: <span style={{ fg: colors.text }}>{project()}</span></text>
        </box>
        <box border borderColor={colors.border} paddingLeft={1} paddingRight={1}>
          <text fg={colors.muted}>subagents: <span style={{ fg: colors.text }}>{state().showSubagents ? "shown" : "hidden"}</span></text>
        </box>
        <box paddingLeft={1} paddingRight={1}>
          <text fg={colors.muted}>{rows().length} sessions</text>
        </box>
        {queryError() ? <text fg={colors.error}>{shorten(queryError(), 52)}</text> : null}
      </box>

      {rows().length === 0 ? (
        <box flexGrow={1} border borderColor={colors.border} alignItems="center" justifyContent="center">
          <box flexDirection="column" alignItems="center" gap={1}>
            <text fg={queryError() ? colors.error : colors.text}><b>{queryError() ? "Invalid regular expression" : "No matching sessions"}</b></text>
            <text fg={colors.muted}>{queryError() ? "Fix the query to search indexed sessions." : "Clear filters or open projects to add them to the index."}</text>
          </box>
        </box>
      ) : (
        <box flexGrow={1} flexDirection="row" gap={1}>
          <box flexGrow={2} border borderColor={colors.border} backgroundColor={colors.panel} flexDirection="column">
            {rows().slice(0, Math.max(1, dimensions().height - 9)).map((row, index) => (
              <SessionRow row={row} active={index === selected()} current={row.id === current()} colors={colors} width={dimensions().width} />
            ))}
          </box>
          {dimensions().width >= 100 ? (
            <Preview api={props.api} row={rows()[selected()]} colors={colors} width={previewWidth(dimensions().width)} />
          ) : null}
        </box>
      )}

      <box paddingTop={1} flexDirection="row" justifyContent="space-between">
        <text fg={colors.muted}>Search indexes session titles, project paths, and message text.</text>
        <text fg={colors.primary}>{rows()[selected()]?.project ?? ""}</text>
      </box>
    </box>
  )
}

function SessionRow(props: { row: SessionSearchResult; active: boolean; current: boolean; colors: Skin; width: number }) {
  const subagent = () => Boolean(props.row.parentID)
  const marker = () => props.current ? "[current] " : subagent() ? "[subagent] " : ""
  const markerColor = () => props.current ? props.colors.success : props.colors.secondary
  return (
    <box
      flexDirection="row"
      justifyContent="space-between"
      backgroundColor={props.active ? props.colors.primary : undefined}
      paddingLeft={1}
      paddingRight={1}
    >
      <text fg={props.active ? props.colors.selected : props.colors.text}>
        {props.active ? ">" : " "} <span style={{ fg: props.active ? props.colors.selected : markerColor() }}>{marker()}</span>{shorten(props.row.title, Math.max(20, props.width - 58))}
      </text>
      <text fg={props.active ? props.colors.selected : props.colors.muted}>
        {shorten(props.row.project, 18)}  {relativeTime(props.row.updatedAt)}
      </text>
    </box>
  )
}

function Preview(props: { api: Context; row?: SessionSearchResult; colors: Skin; width: number }) {
  const model = () => props.row?.providerID && props.row.modelID ? `${props.row.providerID}/${props.row.modelID}` : "unknown model"
  const tokens = () => props.row ? sessionTokens(props.row) : 0
  return (
    <box width={props.width} flexShrink={0} border borderColor={props.colors.border} backgroundColor={props.colors.panel} padding={1} flexDirection="column" gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={props.colors.primary}>{shorten(model(), Math.max(12, props.width - 28))}{(props.row?.modelCount ?? 0) > 1 ? ` +${(props.row?.modelCount ?? 1) - 1}` : ""}</text>
        <text fg={props.colors.text}>{formatTokens(tokens())}  {formatCost(props.row?.cost ?? 0)}  {contextPercent(tokens(), modelContext(props.api, props.row))}</text>
      </box>
      <text fg={props.colors.text}><b>{shorten(props.row?.title ?? "Session", props.width - 4)}</b></text>
      <text fg={props.colors.primary}>{shorten(props.row?.project ?? "", props.width - 4)}</text>
      <text fg={props.colors.muted}>{shorten(props.row?.directory ?? "", props.width - 4)}</text>
      <text fg={props.colors.muted}>{props.row?.messageCount ?? 0} indexed messages</text>
      <box paddingTop={1}>
        <text fg={props.colors.text}>{shorten(props.row?.snippet || "No message preview available.", (props.width - 4) * 5)}</text>
      </box>
    </box>
  )
}

function Hint(props: { keyText: string; action: string; colors: Skin }) {
  return <text fg={props.colors.muted}><span style={{ fg: props.colors.text }}>{props.keyText}</span> {props.action}</text>
}

export function registerCommands(api: Context, index: SessionIndex, state: StateStore) {
  const search = (value: BrowserState) => {
    try { return filterSubagents(index.search(value.query, value.projectID), value.showSubagents) } catch { return [] }
  }
  const update = (next: BrowserState) => state.set({ ...next, selected: clampSelection(next.selected, search(next).length) })

  api.keymap.layer(() => ({
    mode: "global",
    commands: [{
      id: commands.open,
      title: "All sessions",
      description: "Search sessions across every indexed OpenCode project",
      group: "Session",
      palette: true,
      slash: { name: "sessions-all", aliases: ["all-sessions"] },
      run() {
        const current = api.ui.router.current()
        if (current.type === "plugin" && current.name === ROUTE) return
        state.set({ query: "", showSubagents: false, selected: 0, back: current })
        api.ui.router.navigate({ type: "plugin", name: ROUTE })
      },
    }],
  }))

  api.keymap.layer(() => ({
    mode: MODE,
    commands: [
      { id: commands.close, bind: "escape", title: "Close", run() { api.ui.router.navigate(state.get().back) } },
      { id: commands.up, bind: "up,k", title: "Previous", run() { const value = state.get(); update({ ...value, selected: value.selected - 1 }) } },
      { id: commands.down, bind: "down,j", title: "Next", run() { const value = state.get(); update({ ...value, selected: value.selected + 1 }) } },
      { id: commands.clear, bind: "x", title: "Clear filters", run() { const value = state.get(); update({ ...value, query: "", projectID: undefined, selected: 0 }) } },
      { id: commands.refresh, bind: "r", title: "Refresh", run() { state.set({ ...state.get() }) } },
      { id: commands.subagents, bind: "s", title: "Toggle subagents", run() { const value = state.get(); update({ ...value, showSubagents: !value.showSubagents, selected: 0 }) } },
      {
        id: commands.select,
        bind: "enter,return",
        title: "Open session",
        async run() {
          const value = state.get()
          const rows = search(value)
          const row = rows[clampSelection(value.selected, rows.length)]
          if (!row) return
          if (row.directory === (api.location ?? api.data.location.default()).directory) {
            api.ui.router.navigate({ type: "session", sessionID: row.id })
            return
          }
          const command = resumeCommand(row.directory, row.id)
          const confirmed = await api.ui.dialog.confirm({
            title: "Copy session start to clipboard?",
            message: "Open this cross-project session in a new terminal.",
          })
          if (!confirmed) return
          const copied = api.renderer.copyToClipboardOSC52(command)
          api.ui.toast.show({
            variant: copied ? "success" : "error",
            title: copied ? "Copied" : "Copy failed",
            message: copied ? "Session start command copied to clipboard." : "Your terminal does not support clipboard copying.",
          })
        },
      },
      {
        id: commands.search,
        bind: "/",
        title: "Search sessions",
        async run() {
          const value = state.get()
          const query = await api.ui.dialog.prompt({
            title: "Search all sessions",
            value: value.query,
            placeholder: "title, project, or message text",
          })
          if (query !== undefined) update({ ...value, query, selected: 0 })
        },
      },
      {
        id: commands.project,
        bind: "p",
        title: "Filter projects",
        async run() {
          const value = state.get()
          const projectID = await api.ui.dialog.select({
            title: "Project",
            current: value.projectID ?? "",
            options: [{ title: "All projects", value: "" }, ...index.projects().map((item) => ({ title: item.label, value: item.id, description: item.directory }))],
          })
          if (projectID !== undefined) update({ ...value, projectID: projectID || undefined, selected: 0 })
        },
      },
    ],
  }))
}

export default Plugin.define({
  id: "opencode-sessions-all",
  setup(api) {
    const index = new SessionIndex(databasePath(opencodeStateDirectory(), api.options.database))
    const [value, setValue] = createSignal<BrowserState>({ query: "", showSubagents: false, selected: 0, back: { type: "home" } })
    const state: StateStore = { get: value, set: setValue }
    const unregister = api.ui.router.register({ name: ROUTE, render: () => <Browser api={api} index={index} state={state} /> })
    registerCommands(api, index, state)

    // The full paginated history is available on the client, unlike server context.
    const controller = new AbortController()
    const location = api.location ?? api.data.location.default()
    const directories = new Map(index.projects().map((project) => [project.directory, project.id]))
    directories.set(location.directory, "")
    const backfill = (async () => {
      for (const [directory, projectID] of directories) {
        try {
          await backfillProject(api.client, index, { directory, projectID }, controller.signal)
        } catch (error) {
          if (controller.signal.aborted) return
          console.warn("opencode-sessions-all: full-history backfill failed", error)
        }
      }
    })()

    return async () => {
      controller.abort()
      const current = api.ui.router.current()
      if (current.type === "plugin" && current.name === ROUTE) api.ui.router.navigate({ type: "home" })
      unregister()
      await backfill
      index.close()
    }
  },
})
