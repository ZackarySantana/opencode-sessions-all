# opencode-sessions-all

[![npm](https://img.shields.io/npm/v/opencode-sessions-all)](https://www.npmjs.com/package/opencode-sessions-all)

Cross-project session search and navigation with a native OpenCode TUI.

`/sessions-all` opens a keyboard-first browser over sessions indexed from every project you use after installing the plugin. Search session titles, project paths, and message text without leaving OpenCode.

![opencode-sessions-all dashboard showing cross-project sessions, subagents, search filters, and session details](https://raw.githubusercontent.com/ZackarySantana/opencode-sessions-all/main/assets/oc-sessions-all-demo.png)

## Install

Install globally so every opened project contributes to the shared index:

```sh
opencode plugin --global opencode-sessions-all
```

Quit and restart OpenCode, then run:

```text
/sessions-all
```

## Controls

- `/`: search titles, paths, and messages
- `p`: filter by project
- `j` / `k` or arrow keys: move selection
- `enter`: open the selected session
- `x`: clear search and project filters
- `r`: refresh
- `esc`: return to the previous screen

## Indexing

The server plugin backfills existing sessions the first time each project is opened and then updates the index from session/message events. Projects not opened after installation are indexed when you next open them.

The SQLite index is stored at:

```text
<opencode-state>/opencode-sessions-all/sessions.sqlite
```

The index stores session metadata and searchable text. It does not store tool payloads, credentials, file contents, or attachments.

Sessions in the current project open immediately. OpenCode does not yet expose an in-process directory switch API, so selecting another project's session shows a shell-safe `opencode <directory> --session <id>` command to run in another terminal.

## Development

```sh
bun install
bun run build
bun test
bun run typecheck
```

The package exposes separate `./server` and `./tui` entrypoints. Its TUI build uses OpenTUI's Solid compiler so filters and search results remain reactive.
