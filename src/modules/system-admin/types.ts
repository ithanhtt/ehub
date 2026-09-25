/**
 * Shapes the System and Database pages share between the server and the
 * browser. Plain data only — every one of them crosses a server action or a
 * route handler as JSON.
 */

/* ---------------------------------------------------------------- system --- */

/** The part of the System page that moves: asked for every five seconds. */
export type LiveSample = {
  at: string
  cpu: {
    /** Whole machine, all cores, over a ~300 ms window; null when the OS reports no times. */
    percent: number | null
    /** This server process, as a share of the whole machine. */
    processPercent: number
    /** 1, 5 and 15 minutes; null where the OS has none (Windows reports zeros). */
    loadavg: [number, number, number] | null
  }
  memory: {
    total: number
    /** What programs hold: total minus what could be handed out now (Linux MemAvailable when readable). */
    used: number
    free: number
    process: { rss: number; heapUsed: number; heapTotal: number; external: number }
  }
  /** Bytes per second over every non-internal interface; null where /proc/net/dev does not exist. */
  network: { rxPerSec: number; txPerSec: number } | null
  uptime: { os: number; process: number }
}

export type HostInfo = {
  hostname: string
  osType: string
  osRelease: string
  platform: string
  arch: string
  nodeVersion: string
  appVersion: string | null
  release: string | null
  nodeEnv: string
  timezone: string
  cpuModel: string
  cores: number
  speedMhz: number
}

export type DiskInfo = { path: string; total: number; free: number; used: number; percent: number }

export type FolderInfo = {
  name: string
  bytes: number
  files: number
  /** The walk stopped at its entry or time cap: the real size is larger. */
  truncated: boolean
}

export type NetInterface = { name: string; family: string; address: string; cidr: string | null; internal: boolean; mac: string }

export type DbTableStat = { name: string; rows: number; exact: boolean; bytes: number }

export type DbInfo = {
  kind: 'embedded' | 'postgres'
  /** The embedded database's directory, or host:port/database — never a password. */
  location: string
  version: string | null
  bytes: number | null
  connections: number | null
  tables: DbTableStat[]
  error: string | null
}

export type SnapshotInfo = { name: string; bytes: number; at: string }

export type HousekeepingSummary = {
  callLogs: number
  auditLogs: number
  sessions: number
  cacheFiles: number
  cacheBytes: number
  freeBytes: number | null
}

export type JobsInfo = {
  backgroundSync: boolean
  bookingAutoSync: boolean
  housekeeping: { scheduled: boolean; running: boolean; lastAt: string | null; lastMs: number | null; report: HousekeepingSummary | null }
  memoEntries: number
}

/** Everything the System page shows; the heavy parts are cached for a minute on the server. */
export type SystemSnapshot = {
  collectedAt: string
  host: HostInfo
  dataDir: string
  disks: DiskInfo[]
  folders: FolderInfo[]
  interfaces: NetInterface[]
  database: DbInfo
  jobs: JobsInfo
  snapshots: SnapshotInfo[]
  /** False on a Postgres server: its backups are the updater's, not this page's. */
  canSnapshot: boolean
  live: LiveSample
}

export type Outcome<T> = { ok: true; data: T } | { ok: false; reason: 'forbidden' | 'unavailable' | 'failed' | 'invalid'; detail?: string }

/* -------------------------------------------------------------- database --- */

export type ColumnCategory = 'boolean' | 'number' | 'datetime' | 'json' | 'text' | 'other'

export type ColumnInfo = {
  name: string
  /** As Postgres prints it: text, timestamp with time zone, jsonb … */
  type: string
  category: ColumnCategory
  nullable: boolean
  hasDefault: boolean
  secret: boolean
  primary: boolean
}

export type TableSummary = {
  name: string
  rows: number
  exact: boolean
  bytes: number
  primaryKey: string[]
  /** Shown but never edited here: the audit trail. */
  readOnly: boolean
}

export type GridRow = {
  /** The primary key's values, as text; null for a table without one. */
  key: Record<string, string> | null
  /** One per column, as text; secrets arrive as the mask. Long values are cut (see `cut`). */
  cells: Array<string | null>
}

export type GridQuery = { page: number; sort: string | null; dir: 'asc' | 'desc'; q: string }

export type GridPage = {
  table: string
  columns: ColumnInfo[]
  rows: GridRow[]
  total: number
  page: number
  pageSize: number
  sort: string | null
  dir: 'asc' | 'desc'
  q: string
  editable: boolean
  /** Longest a cell comes in the grid; the edit dialog reads the whole row. */
  cut: number
}

export type FullRow = { columns: ColumnInfo[]; values: Record<string, string | null> }

/** A row edit or delete. `code` names why the request itself was refused (see RowFailure in db-inspect). */
export type RowOutcome =
  | { ok: true }
  | { ok: false; reason: 'forbidden' | 'notFound' | 'database' | 'invalid'; code?: string; column?: string; detail?: string }

export type ConsoleResult = {
  columns: string[]
  rows: Array<Array<string | null>>
  /** Rows the statement returned, up to the cap plus one. */
  rowCount: number
  truncated: boolean
  /** Rows written, for INSERT / UPDATE / DELETE. */
  affected: number | null
  ms: number
  wrote: boolean
  /** The snapshot taken (or reused) before a write on the embedded database. */
  snapshot: string | null
}

export type ConsoleFailure =
  | { reason: 'forbidden' }
  | { reason: 'guard'; code: string; detail?: string }
  | { reason: 'database'; detail: string }
  | { reason: 'snapshot'; detail: string }

export type ConsoleOutcome = ({ ok: true } & ConsoleResult) | ({ ok: false } & ConsoleFailure)
