/** @jsxImportSource @opentui/solid */

import type { RGBA } from "@opentui/core"
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, onCleanup } from "solid-js"
import { formatCost, formatTokens, relativeTime, shorten } from "./format.js"
import { SessionIndex, compileQuery, databasePath, type SessionSearchResult } from "./index-store.js"

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
}

type Color = RGBA | string
type BackRoute = { name: string; params?: Record<string, unknown> }
export type BrowserState = { query: string; projectID?: string; selected: number; back: BackRoute }
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
  error: Color
}

function skin(api: TuiPluginApi): Skin {
  const theme = api.theme.current
  return {
    background: theme.background,
    panel: theme.backgroundPanel,
    border: theme.border,
    text: theme.text,
    muted: theme.textMuted,
    primary: theme.primary,
    selected: theme.selectedListItemText,
    secondary: theme.secondary,
    error: theme.error,
  }
}

export function clampSelection(selected: number, count: number) {
  if (count <= 0) return 0
  return Math.max(0, Math.min(selected, count - 1))
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

export function modelContext(api: TuiPluginApi, row?: SessionSearchResult) {
  if (!row?.providerID || !row.modelID) return undefined
  return api.state.provider.find((provider) => provider.id === row.providerID)?.models[row.modelID]?.limit.context
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

function Browser(props: { api: TuiPluginApi; index: SessionIndex; state: StateStore }) {
  const dimensions = useTerminalDimensions()
  const colors = skin(props.api)
  const state = props.state.get
  const [revision, setRevision] = createSignal(0)
  const rows = createMemo(() => {
    revision()
    try {
      return props.index.search(state().query, state().projectID, 100)
    } catch {
      return []
    }
  })
  const queryError = createMemo(() => {
    try { compileQuery(state().query); return "" } catch (error) { return error instanceof Error ? error.message : "Invalid regular expression" }
  })
  const selected = createMemo(() => clampSelection(state().selected, rows().length))
  const project = () => props.index.projects().find((item) => item.id === state().projectID)?.label ?? "all projects"
  const timer = setInterval(() => setRevision((value) => value + 1), 5_000)
  const popMode = props.api.mode.push(MODE)
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
              <SessionRow row={row} active={index === selected()} colors={colors} width={dimensions().width} />
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

function SessionRow(props: { row: SessionSearchResult; active: boolean; colors: Skin; width: number }) {
  const subagent = () => Boolean(props.row.parentID)
  return (
    <box
      flexDirection="row"
      justifyContent="space-between"
      backgroundColor={props.active ? props.colors.primary : undefined}
      paddingLeft={1}
      paddingRight={1}
    >
      <text fg={props.active ? props.colors.selected : subagent() ? props.colors.secondary : props.colors.text}>
        {props.active ? ">" : " "} {subagent() ? "subagent " : ""}{shorten(props.row.title, Math.max(20, props.width - 56))}
      </text>
      <text fg={props.active ? props.colors.selected : props.colors.muted}>
        {shorten(props.row.project, 18)}  {relativeTime(props.row.updatedAt)}
      </text>
    </box>
  )
}

function Preview(props: { api: TuiPluginApi; row?: SessionSearchResult; colors: Skin; width: number }) {
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

function registerCommands(api: TuiPluginApi, index: SessionIndex, state: StateStore) {
  const update = (next: BrowserState) => state.set({ ...next, selected: clampSelection(next.selected, index.search(next.query, next.projectID).length) })

  api.keymap.registerLayer({
    commands: [{
      name: commands.open,
      title: "All sessions",
      desc: "Search sessions across every indexed OpenCode project",
      category: "Session",
      namespace: "palette",
      slashName: "sessions-all",
      slashAliases: ["all-sessions"],
      run() {
        const current = api.route.current
        state.set({ query: "", selected: 0, back: { name: current.name, params: "params" in current ? current.params : undefined } })
        api.route.navigate(ROUTE)
      },
    }],
  })

  api.keymap.registerLayer({
    mode: MODE,
    commands: [
      { name: commands.close, title: "Close", hidden: true, run() { const value = state.get(); api.route.navigate(value.back.name, value.back.params) } },
      { name: commands.up, title: "Previous", hidden: true, run() { const value = state.get(); update({ ...value, selected: value.selected - 1 }) } },
      { name: commands.down, title: "Next", hidden: true, run() { const value = state.get(); update({ ...value, selected: value.selected + 1 }) } },
      { name: commands.clear, title: "Clear filters", hidden: true, run() { const value = state.get(); update({ ...value, query: "", projectID: undefined, selected: 0 }) } },
      { name: commands.refresh, title: "Refresh", hidden: true, run() { state.set({ ...state.get() }) } },
      {
        name: commands.select,
        title: "Open session",
        hidden: true,
        run() {
          const value = state.get()
          const row = index.search(value.query, value.projectID)[clampSelection(value.selected, index.search(value.query, value.projectID).length)]
          if (!row) return
          if (row.directory === api.state.path.directory) {
            api.route.navigate("session", { sessionID: row.id })
            return
          }
          const command = resumeCommand(row.directory, row.id)
          api.ui.dialog.setSize("medium")
          api.ui.dialog.replace(() => (
            <api.ui.DialogConfirm
              title="Copy session start to clipboard?"
              message="Cross-project sessions must be a new instance."
              onConfirm={() => {
                api.ui.dialog.clear()
                const copied = api.renderer.copyToClipboardOSC52(command)
                api.ui.toast({
                  variant: copied ? "success" : "error",
                  title: copied ? "Copied" : "Copy failed",
                  message: copied ? "Session start command copied to clipboard." : "Your terminal does not support clipboard copying.",
                })
              }}
              onCancel={() => api.ui.dialog.clear()}
            />
          ))
        },
      },
      {
        name: commands.search,
        title: "Search sessions",
        hidden: true,
        run() {
          const value = state.get()
          api.ui.dialog.setSize("large")
          api.ui.dialog.replace(() => (
            <api.ui.DialogPrompt
              title="Search all sessions"
              value={value.query}
              placeholder="title, project, or message text"
              onConfirm={(query) => { api.ui.dialog.clear(); update({ ...value, query, selected: 0 }) }}
              onCancel={() => api.ui.dialog.clear()}
            />
          ))
        },
      },
      {
        name: commands.project,
        title: "Filter projects",
        hidden: true,
        run() {
          const value = state.get()
          api.ui.dialog.setSize("large")
          api.ui.dialog.replace(() => (
            <api.ui.DialogSelect
              title="Project"
              current={value.projectID ?? ""}
              options={[{ title: "All projects", value: "" }, ...index.projects().map((item) => ({ title: item.label, value: item.id, description: item.directory }))]}
              onSelect={(option) => { api.ui.dialog.clear(); update({ ...value, projectID: option.value || undefined, selected: 0 }) }}
            />
          ))
        },
      },
    ],
    bindings: [
      { key: "escape", cmd: commands.close, desc: "Back" },
      { key: "/", cmd: commands.search, desc: "Search" },
      { key: "p", cmd: commands.project, desc: "Project" },
      { key: "x", cmd: commands.clear, desc: "Clear filters" },
      { key: "r", cmd: commands.refresh, desc: "Refresh" },
      { key: "up,k", cmd: commands.up, desc: "Previous" },
      { key: "down,j", cmd: commands.down, desc: "Next" },
      { key: "enter,return", cmd: commands.select, desc: "Open" },
    ],
  })
}

const tui: TuiPlugin = async (api, options) => {
  const index = new SessionIndex(databasePath(api.state.path.state, options?.database))
  const [value, setValue] = createSignal<BrowserState>({ query: "", selected: 0, back: { name: "home" } })
  const state: StateStore = { get: value, set: setValue }
  api.lifecycle.onDispose(() => {
    if (api.route.current.name === ROUTE) api.route.navigate("home")
    index.close()
  })
  api.route.register([{ name: ROUTE, render: () => <Browser api={api} index={index} state={state} /> }])
  registerCommands(api, index, state)
}

const plugin: TuiPluginModule & { id: string } = { id: "opencode-sessions-all", tui }
export default plugin
