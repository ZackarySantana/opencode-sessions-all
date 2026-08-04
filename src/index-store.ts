import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { basename, dirname, isAbsolute, join, resolve } from "node:path"

export type SessionInput = {
  id: string
  projectID: string
  directory: string
  title: string
  parentID?: string
  createdAt: number
  updatedAt: number
}

export type MessageInput = {
  id: string
  sessionID: string
  role: "user" | "assistant"
  createdAt: number
  text: string
  providerID?: string
  modelID?: string
  cost?: number
  input?: number
  output?: number
  reasoning?: number
  cacheRead?: number
  cacheWrite?: number
}

export type SessionSearchResult = SessionInput & {
  project: string
  snippet: string
  messageCount: number
  providerID?: string
  modelID?: string
  modelCount: number
  cost: number
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  parentTitle?: string
}

const schema = `
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    directory TEXT NOT NULL,
    title TEXT NOT NULL,
    parent_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    indexed_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS sessions_project ON sessions(project_id);
  CREATE INDEX IF NOT EXISTS sessions_updated ON sessions(updated_at DESC);

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    text TEXT NOT NULL,
    provider_id TEXT,
    model_id TEXT,
    cost REAL NOT NULL DEFAULT 0,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    reasoning_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens INTEGER NOT NULL DEFAULT 0,
    cache_write_tokens INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(session_id) REFERENCES sessions(id)
  );

  CREATE INDEX IF NOT EXISTS messages_session ON messages(session_id);

  CREATE TABLE IF NOT EXISTS backfill (
    project_id TEXT PRIMARY KEY,
    directory TEXT NOT NULL,
    completed_at INTEGER NOT NULL
  );
`

export function databasePath(stateDirectory: string, configured?: unknown) {
  if (typeof configured === "string" && configured.trim()) {
    const value = configured.trim()
    if (value === ":memory:") return value
    return isAbsolute(value) ? value : resolve(stateDirectory, value)
  }
  return join(stateDirectory, "opencode-sessions-all", "sessions.sqlite")
}

export class SessionIndex {
  readonly db: Database

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true })
    this.db = new Database(path, { create: true, readwrite: true, strict: true })
    this.db.run("PRAGMA journal_mode = WAL")
    this.db.run("PRAGMA busy_timeout = 5000")
    this.db.run("PRAGMA foreign_keys = ON")
    this.db.run(schema)
    this.migrate()
  }

  close() {
    this.db.close(false)
  }

  upsertSession(input: SessionInput) {
    this.db.query<unknown, Record<string, string | number | null>>(`
      INSERT INTO sessions (id, project_id, directory, title, parent_id, created_at, updated_at, indexed_at)
      VALUES ($id, $projectID, $directory, $title, $parentID, $createdAt, $updatedAt, $indexedAt)
      ON CONFLICT(id) DO UPDATE SET
        project_id = excluded.project_id,
        directory = excluded.directory,
        title = excluded.title,
        parent_id = excluded.parent_id,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        indexed_at = excluded.indexed_at
    `).run({ ...input, parentID: input.parentID ?? null, indexedAt: Date.now() })
  }

  upsertMessage(input: MessageInput) {
    this.db.query<unknown, Record<string, string | number | null>>(`
      INSERT INTO messages (
        id, session_id, role, created_at, text, provider_id, model_id, cost,
        input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_tokens
      ) VALUES (
        $id, $sessionID, $role, $createdAt, $text, $providerID, $modelID, $cost,
        $input, $output, $reasoning, $cacheRead, $cacheWrite
      )
      ON CONFLICT(id) DO UPDATE SET
        session_id = excluded.session_id,
        role = excluded.role,
        created_at = excluded.created_at,
        text = excluded.text,
        provider_id = excluded.provider_id,
        model_id = excluded.model_id,
        cost = excluded.cost,
        input_tokens = excluded.input_tokens,
        output_tokens = excluded.output_tokens,
        reasoning_tokens = excluded.reasoning_tokens,
        cache_read_tokens = excluded.cache_read_tokens,
        cache_write_tokens = excluded.cache_write_tokens
    `).run({
      ...input,
      providerID: input.providerID ?? null,
      modelID: input.modelID ?? null,
      cost: input.cost ?? 0,
      input: input.input ?? 0,
      output: input.output ?? 0,
      reasoning: input.reasoning ?? 0,
      cacheRead: input.cacheRead ?? 0,
      cacheWrite: input.cacheWrite ?? 0,
    })
  }

  isBackfilled(projectID: string) {
    return Boolean(this.db.query<{ found: number }, { projectID: string }>(
      "SELECT 1 AS found FROM backfill WHERE project_id = $projectID",
    ).get({ projectID }))
  }

  markBackfilled(projectID: string, directory: string) {
    this.db.query<unknown, { projectID: string; directory: string; completedAt: number }>(`
      INSERT INTO backfill (project_id, directory, completed_at)
      VALUES ($projectID, $directory, $completedAt)
      ON CONFLICT(project_id) DO UPDATE SET
        directory = excluded.directory,
        completed_at = excluded.completed_at
    `).run({ projectID, directory, completedAt: Date.now() })
  }

  projects() {
    return this.db.query<{ id: string; directory: string }, []>(`
      SELECT project_id AS id, directory
      FROM sessions
      GROUP BY project_id
      ORDER BY MAX(updated_at) DESC
    `).all().map((item) => ({ ...item, label: basename(item.directory) || item.directory }))
  }

  search(query = ".*", projectID?: string, limit = 100): SessionSearchResult[] {
    const expression = compileQuery(query)
    const rows = this.db.query<{
      id: string
      projectID: string
      directory: string
      title: string
      parentID: string | null
      createdAt: number
      updatedAt: number
      snippet: string | null
      messageCount: number
      providerID: string | null
      modelID: string | null
      modelCount: number
      cost: number
      input: number
      output: number
      reasoning: number
      cacheRead: number
      cacheWrite: number
      parentTitle: string | null
    }, { projectID: string }>(`
      SELECT
        s.id,
        s.project_id AS projectID,
        s.directory,
        s.title,
        s.parent_id AS parentID,
        s.created_at AS createdAt,
        s.updated_at AS updatedAt,
        '' AS snippet,
        COUNT(m.id) AS messageCount,
        (SELECT latest.provider_id FROM messages latest WHERE latest.session_id = s.id AND latest.model_id IS NOT NULL ORDER BY latest.created_at DESC LIMIT 1) AS providerID,
        (SELECT latest.model_id FROM messages latest WHERE latest.session_id = s.id AND latest.model_id IS NOT NULL ORDER BY latest.created_at DESC LIMIT 1) AS modelID,
        COUNT(DISTINCT CASE WHEN m.model_id IS NOT NULL THEN m.provider_id || '/' || m.model_id END) AS modelCount,
        COALESCE(SUM(m.cost), 0) AS cost,
        COALESCE(SUM(m.input_tokens), 0) AS input,
        COALESCE(SUM(m.output_tokens), 0) AS output,
        COALESCE(SUM(m.reasoning_tokens), 0) AS reasoning,
        COALESCE(SUM(m.cache_read_tokens), 0) AS cacheRead,
        COALESCE(SUM(m.cache_write_tokens), 0) AS cacheWrite,
        (SELECT parent.title FROM sessions parent WHERE parent.id = s.parent_id) AS parentTitle
      FROM sessions s
      LEFT JOIN messages m ON m.session_id = s.id
      WHERE ($projectID = '' OR s.project_id = $projectID)
      GROUP BY s.id
      ORDER BY s.updated_at DESC
    `).all({ projectID: projectID ?? "" })

    return rows.flatMap((row) => {
      const messages = this.db.query<{ text: string }, { sessionID: string }>(
        "SELECT text FROM messages WHERE session_id = $sessionID ORDER BY created_at DESC",
      ).all({ sessionID: row.id })
      const snippet = messages.find((message) => expression.test(message.text))?.text ?? ""
      expression.lastIndex = 0
      const matches = expression.test(`${row.title}\n${row.directory}`) || Boolean(snippet)
      expression.lastIndex = 0
      if (!matches) return []
      return [{
        ...row,
        parentID: row.parentID ?? undefined,
        providerID: row.providerID ?? undefined,
        modelID: row.modelID ?? undefined,
        parentTitle: row.parentTitle ?? undefined,
        project: basename(row.directory) || row.directory,
        snippet,
      }]
    }).slice(0, limit)
  }

  private migrate() {
    const columns = new Set(this.db.query<{ name: string }, []>("PRAGMA table_info(messages)").all().map((column) => column.name))
    const additions = [
      ["provider_id", "TEXT"], ["model_id", "TEXT"], ["cost", "REAL NOT NULL DEFAULT 0"],
      ["input_tokens", "INTEGER NOT NULL DEFAULT 0"], ["output_tokens", "INTEGER NOT NULL DEFAULT 0"],
      ["reasoning_tokens", "INTEGER NOT NULL DEFAULT 0"], ["cache_read_tokens", "INTEGER NOT NULL DEFAULT 0"],
      ["cache_write_tokens", "INTEGER NOT NULL DEFAULT 0"],
    ] as const
    for (const [name, definition] of additions) {
      if (!columns.has(name)) this.db.run(`ALTER TABLE messages ADD COLUMN ${name} ${definition}`)
    }
  }
}

export function compileQuery(query: string) {
  return new RegExp(query.trim() || ".*", "i")
}
