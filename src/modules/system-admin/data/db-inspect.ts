import 'server-only'

import { sql, type SQL } from 'drizzle-orm'
import type { Database } from '@/core/db/client'
import { MASK, SECRET_COLUMNS, SECRET_NAME, isSecretColumn, maskValue } from '../secrets'
import { guardStatement } from '../sql-guard'
import type { ColumnCategory, ColumnInfo, ConsoleOutcome, FullRow, GridPage, GridQuery, TableSummary } from '../types'

/**
 * The Database page's reads and writes, and the SQL console's runner.
 *
 * Every function takes the database it works on, so a test can hand it an
 * in-memory PGlite; the actions (actions.ts) hand it the app's own, after
 * checking the caller is a platform Administrator.
 *
 * Identifiers are never taken from the browser as SQL. A table name is looked
 * up among the public schema's tables in the catalog, a column name among
 * that table's columns, and only the catalog's own spelling is then quoted
 * into the statement (sql.identifier). Values always travel as parameters,
 * as text, cast by Postgres to the column's type — so "42", "true", an ISO
 * time or a JSON document all arrive exactly as typed and Postgres alone
 * decides whether they fit.
 *
 * Secret columns (secrets.ts) are never read into the app at all by the grid
 * or the edit dialog — the query asks only whether they hold something — and
 * can be neither searched, sorted on nor written.
 *
 * On the embedded database there is one connection: nothing here awaits the
 * outer database inside a transaction.
 */

export const PAGE_SIZE = 50
export const CELL_CUT = 2_000
export const CONSOLE_ROW_CAP = 500
const CONSOLE_CELL_CUT = 10_000
const STATEMENT_TIMEOUT_MS = 15_000
/** Tables up to this many rows (by the planner's estimate) are counted exactly. */
const EXACT_COUNT_BELOW = 50_000

/** Shown, never edited from here: the trail of who changed what. */
const READ_ONLY_TABLES = new Set(['audit_logs'])

type Rows = Array<Record<string, unknown>>

async function rowsOf(database: Pick<Database, 'execute'>, query: SQL): Promise<Rows> {
  const result = (await database.execute(query)) as unknown as { rows: Rows }
  return result.rows
}

/* ---------------------------------------------------------------- tables --- */

export async function listTables(database: Database): Promise<TableSummary[]> {
  const rows = await rowsOf(
    database,
    sql`select c.relname::text as name,
               c.reltuples::float8 as estimate,
               pg_total_relation_size(c.oid)::float8 as bytes,
               coalesce((select json_agg(a.attname::text order by array_position(i.indkey::int2[], a.attnum))
                           from pg_index i
                           join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
                          where i.indrelid = c.oid and i.indisprimary), '[]'::json) as pk
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind in ('r', 'p')
         order by c.relname`,
  )
  const out: TableSummary[] = []
  for (const row of rows) {
    const name = String(row.name)
    const estimate = Number(row.estimate)
    let rowsCount = Math.max(0, Math.round(estimate))
    let exact = false
    // reltuples is -1 (or 0) until the table is first analysed; small tables are cheap to count.
    if (estimate < EXACT_COUNT_BELOW) {
      const [counted] = await rowsOf(database, sql`select count(*)::float8 as n from ${sql.identifier(name)}`)
      rowsCount = Number(counted?.n ?? 0)
      exact = true
    }
    const pk = parseJson<string[]>(row.pk) ?? []
    out.push({ name, rows: rowsCount, exact, bytes: Number(row.bytes), primaryKey: pk, readOnly: READ_ONLY_TABLES.has(name) })
  }
  return out
}

/** A column as the page sees it, plus the type to cast a value into, as the catalog spells it. */
export type ColumnMeta = ColumnInfo & { cast: string }
export type TableMeta = { name: string; columns: ColumnMeta[]; primaryKey: string[]; readOnly: boolean }

/** Only what format_type prints: letters, digits, spaces, quotes, dots, brackets, parentheses, commas. */
const SAFE_TYPE = /^[A-Za-z0-9_ ."(),[\]]+$/

/** The table's columns and key from the catalog, or null when `table` is not a table of the public schema. */
export async function describeTable(database: Database, table: string): Promise<TableMeta | null> {
  if (typeof table !== 'string' || table.length === 0 || table.length > 128) return null
  const rows = await rowsOf(
    database,
    sql`select a.attname::text as name,
               format_type(a.atttypid, a.atttypmod) as type,
               t.typname::text as typname,
               t.typcategory::text as category,
               not a.attnotnull as nullable,
               a.atthasdef as has_default,
               coalesce(a.attnum = any(i.indkey), false) as primary_key
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
          join pg_type t on t.oid = a.atttypid
          left join pg_index i on i.indrelid = c.oid and i.indisprimary
         where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname = ${table}
         order by a.attnum`,
  )
  if (rows.length === 0) return null
  const columns: ColumnMeta[] = rows.map((row) => {
    const name = String(row.name)
    const type = String(row.type)
    return {
      name,
      type,
      cast: SAFE_TYPE.test(type) ? type : 'text',
      category: categoryOf(String(row.category), String(row.typname)),
      nullable: row.nullable === true,
      hasDefault: row.has_default === true,
      secret: isSecretColumn(table, name),
      primary: row.primary_key === true,
    }
  })
  // Key order as the index declares it; attnum order is the same for every key this app has.
  const primaryKey = columns.filter((column) => column.primary).map((column) => column.name)
  return { name: table, columns, primaryKey, readOnly: READ_ONLY_TABLES.has(table) }
}

function categoryOf(category: string, typname: string): ColumnCategory {
  if (typname === 'json' || typname === 'jsonb') return 'json'
  if (category === 'B') return 'boolean'
  if (category === 'N') return 'number'
  if (category === 'D') return 'datetime'
  if (category === 'S') return 'text'
  return 'other'
}

const publicColumn = ({ cast: _cast, ...column }: ColumnMeta): ColumnInfo => column

/** Every column name in the public schema that the name rule calls secret — what the console refuses to see named. */
export async function secretColumnNames(database: Database): Promise<string[]> {
  const rows = await rowsOf(
    database,
    sql`select distinct a.attname::text as name
          from pg_attribute a
          join pg_class c on c.oid = a.attrelid
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped`,
  )
  const names = new Set(rows.map((row) => String(row.name)).filter((name) => SECRET_NAME.test(name)))
  for (const columns of Object.values(SECRET_COLUMNS)) for (const name of columns) if (SECRET_NAME.test(name)) names.add(name)
  return [...names]
}

/* ------------------------------------------------------------------ grid --- */

export function normaliseQuery(query: Partial<GridQuery> | undefined): GridQuery {
  const page = Number.isInteger(query?.page) && (query?.page ?? 0) > 0 ? Math.min(query!.page!, 1_000_000) : 1
  return {
    page,
    sort: typeof query?.sort === 'string' ? query.sort : null,
    dir: query?.dir === 'desc' ? 'desc' : 'asc',
    q: typeof query?.q === 'string' ? query.q.trim().slice(0, 200) : '',
  }
}

/** The WHERE of a search: every non-secret text column, ILIKE the words typed, % and _ taken literally. */
function searchClause(meta: TableMeta, q: string): SQL | null {
  if (!q) return null
  const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  const targets = meta.columns.filter((column) => !column.secret && (column.category === 'text' || column.category === 'other'))
  if (targets.length === 0) return sql`false`
  return sql.join(
    targets.map((column) => sql`${sql.identifier(column.name)}::text ilike ${pattern}`),
    sql` or `,
  )
}

export async function readGrid(database: Database, meta: TableMeta, input: Partial<GridQuery>): Promise<GridPage> {
  const query = normaliseQuery(input)
  const sortColumn = meta.columns.find((column) => column.name === query.sort && !column.secret) ?? null
  const where = searchClause(meta, query.q)
  const from = sql`from ${sql.identifier(meta.name)}${where ? sql` where ${where}` : sql``}`

  const selectList = sql.join(
    [
      ...meta.columns.map((column, i) =>
        column.secret
          ? sql`(${sql.identifier(column.name)} is not null) as ${sql.identifier(`c${i}`)}`
          : sql`left(${sql.identifier(column.name)}::text, ${CELL_CUT + 1}) as ${sql.identifier(`c${i}`)}`,
      ),
      ...meta.primaryKey.map((name, j) => sql`${sql.identifier(name)}::text as ${sql.identifier(`k${j}`)}`),
    ],
    sql`, `,
  )
  const order = sortColumn
    ? sql` order by ${sql.identifier(sortColumn.name)} ${query.dir === 'desc' ? sql`desc` : sql`asc`} nulls last`
    : meta.primaryKey.length > 0
      ? sql` order by ${sql.join(meta.primaryKey.map((name) => sql.identifier(name)), sql`, `)}`
      : sql``

  const [counted] = await rowsOf(database, sql`select count(*)::float8 as n ${from}`)
  const total = Number(counted?.n ?? 0)
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const page = Math.min(query.page, lastPage)
  const rows = await rowsOf(database, sql`select ${selectList} ${from}${order} limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`)

  return {
    table: meta.name,
    columns: meta.columns.map(publicColumn),
    rows: rows.map((row) => ({
      key: meta.primaryKey.length > 0 ? Object.fromEntries(meta.primaryKey.map((name, j) => [name, String(row[`k${j}`])])) : null,
      cells: meta.columns.map((column, i) => {
        const value = row[`c${i}`]
        if (column.secret) return value === true ? MASK : null
        if (value === null || value === undefined) return null
        const text = String(value)
        return text.length > CELL_CUT ? `${text.slice(0, CELL_CUT)}…` : text
      }),
    })),
    total,
    page,
    pageSize: PAGE_SIZE,
    sort: sortColumn?.name ?? null,
    dir: query.dir,
    q: query.q,
    editable: meta.primaryKey.length > 0 && !meta.readOnly,
    cut: CELL_CUT,
  }
}

/** Every row of a table (or of a search), masked, for the CSV export — capped. */
export async function readAllRows(database: Database, meta: TableMeta, q: string, cap: number): Promise<{ header: string[]; rows: Array<Array<string | null>>; capped: boolean }> {
  const where = searchClause(meta, q.trim().slice(0, 200))
  const selectList = sql.join(
    meta.columns.map((column, i) =>
      column.secret
        ? sql`(${sql.identifier(column.name)} is not null) as ${sql.identifier(`c${i}`)}`
        : sql`${sql.identifier(column.name)}::text as ${sql.identifier(`c${i}`)}`,
    ),
    sql`, `,
  )
  const order = meta.primaryKey.length > 0 ? sql` order by ${sql.join(meta.primaryKey.map((name) => sql.identifier(name)), sql`, `)}` : sql``
  const rows = await rowsOf(
    database,
    sql`select ${selectList} from ${sql.identifier(meta.name)}${where ? sql` where ${where}` : sql``}${order} limit ${cap + 1}`,
  )
  return {
    header: meta.columns.map((column) => column.name),
    rows: rows.slice(0, cap).map((row) =>
      meta.columns.map((column, i) => {
        const value = row[`c${i}`]
        if (column.secret) return value === true ? MASK : null
        return value === null || value === undefined ? null : String(value)
      }),
    ),
    capped: rows.length > cap,
  }
}

/* ------------------------------------------------------------- one row --- */

export type RowFailure =
  | { code: 'noKey' }
  | { code: 'readOnly' }
  | { code: 'key' }
  | { code: 'empty' }
  | { code: 'unknownColumn'; column: string }
  | { code: 'secretColumn'; column: string }
  | { code: 'primaryColumn'; column: string }
  | { code: 'notNull'; column: string }
  | { code: 'value'; column: string }

type Built = { ok: true; query: SQL; columns: string[] } | { ok: false; failure: RowFailure }

/** `"pk" = cast($n::text as <type>)` for each key column; the key must name exactly the table's key. */
function keyClause(meta: TableMeta, key: unknown): SQL | RowFailure {
  if (meta.primaryKey.length === 0) return { code: 'noKey' }
  if (!key || typeof key !== 'object' || Array.isArray(key)) return { code: 'key' }
  const given = key as Record<string, unknown>
  const names = Object.keys(given)
  if (names.length !== meta.primaryKey.length || !meta.primaryKey.every((name) => typeof given[name] === 'string')) return { code: 'key' }
  return sql.join(
    meta.primaryKey.map((name) => {
      const column = meta.columns.find((c) => c.name === name)!
      return sql`${sql.identifier(name)} = cast(${given[name] as string}::text as ${sql.raw(column.cast)})`
    }),
    sql` and `,
  )
}

const isFailure = (value: SQL | RowFailure): value is RowFailure => typeof (value as RowFailure).code === 'string'

const NUMBER = /^\s*[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?\s*$/

/**
 * UPDATE one row by its key. Refuses a column the table does not have, a
 * secret one, a key column, NULL where the column forbids it, and values that
 * are plainly not of the column's kind (a boolean that is not true/false, a
 * number that is not one, JSON that does not parse); Postgres checks the rest
 * when it casts.
 */
export function buildUpdate(meta: TableMeta, key: unknown, changes: unknown): Built {
  if (meta.readOnly) return { ok: false, failure: { code: 'readOnly' } }
  const where = keyClause(meta, key)
  if (isFailure(where)) return { ok: false, failure: where }
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return { ok: false, failure: { code: 'empty' } }
  const entries = Object.entries(changes as Record<string, unknown>)
  if (entries.length === 0) return { ok: false, failure: { code: 'empty' } }

  const sets: SQL[] = []
  for (const [name, value] of entries) {
    const column = meta.columns.find((c) => c.name === name)
    if (!column) return { ok: false, failure: { code: 'unknownColumn', column: name } }
    if (column.secret) return { ok: false, failure: { code: 'secretColumn', column: name } }
    if (column.primary) return { ok: false, failure: { code: 'primaryColumn', column: name } }
    if (value === null) {
      if (!column.nullable) return { ok: false, failure: { code: 'notNull', column: name } }
      sets.push(sql`${sql.identifier(name)} = null`)
      continue
    }
    if (typeof value !== 'string' || !valueFits(column, value)) return { ok: false, failure: { code: 'value', column: name } }
    sets.push(sql`${sql.identifier(name)} = cast(${value}::text as ${sql.raw(column.cast)})`)
  }
  const keyList = sql.join(meta.primaryKey.map((name) => sql.identifier(name)), sql`, `)
  return {
    ok: true,
    query: sql`update ${sql.identifier(meta.name)} set ${sql.join(sets, sql`, `)} where ${where} returning ${keyList}`,
    columns: entries.map(([name]) => name),
  }
}

export function buildDelete(meta: TableMeta, key: unknown): Built {
  if (meta.readOnly) return { ok: false, failure: { code: 'readOnly' } }
  const where = keyClause(meta, key)
  if (isFailure(where)) return { ok: false, failure: where }
  const keyList = sql.join(meta.primaryKey.map((name) => sql.identifier(name)), sql`, `)
  return { ok: true, query: sql`delete from ${sql.identifier(meta.name)} where ${where} returning ${keyList}`, columns: [] }
}

function valueFits(column: ColumnMeta, value: string): boolean {
  if (value.length > 5_000_000) return false
  if (column.category === 'boolean') return /^(true|false)$/i.test(value.trim())
  if (column.category === 'number') return NUMBER.test(value)
  if (column.category === 'json') {
    try {
      JSON.parse(value)
      return true
    } catch {
      return false
    }
  }
  return true
}

/** Runs a built UPDATE / DELETE; how many rows it touched (0 or 1 — the key is the primary key). */
export async function runBuilt(database: Database, built: Extract<Built, { ok: true }>): Promise<number> {
  return (await rowsOf(database, built.query)).length
}

/** One whole row for the edit dialog, secrets withheld. */
export async function readRow(database: Database, meta: TableMeta, key: unknown): Promise<FullRow | null> {
  const where = keyClause(meta, key)
  if (isFailure(where)) return null
  const selectList = sql.join(
    meta.columns.map((column, i) =>
      column.secret
        ? sql`(${sql.identifier(column.name)} is not null) as ${sql.identifier(`c${i}`)}`
        : sql`${sql.identifier(column.name)}::text as ${sql.identifier(`c${i}`)}`,
    ),
    sql`, `,
  )
  const [row] = await rowsOf(database, sql`select ${selectList} from ${sql.identifier(meta.name)} where ${where} limit 1`)
  if (!row) return null
  return {
    columns: meta.columns.map(publicColumn),
    values: Object.fromEntries(
      meta.columns.map((column, i) => {
        const value = row[`c${i}`]
        if (column.secret) return [column.name, value === true ? MASK : null]
        return [column.name, value === null || value === undefined ? null : String(value)]
      }),
    ),
  }
}

/* --------------------------------------------------------------- console --- */

export type ConsoleInput = {
  text: string
  write: boolean
  /** A Postgres server: the statement also gets a time limit. */
  postgres: boolean
  secretColumns: Iterable<string>
  /** Called before a statement that may write, outside any transaction; returns the snapshot's name. */
  beforeWrite?: () => Promise<string | null>
}

/**
 * One statement, in a transaction of its own: READ ONLY unless writes are on,
 * with a time limit on a Postgres server. A plain query is wrapped so no more
 * than the cap plus one row is ever fetched; should the wrapping not suit it,
 * it runs as written (inside a savepoint, so the failed attempt costs nothing).
 * The result's columns are masked by the same rule as the grid, and by the
 * table-specific list whenever the statement names that table.
 */
export async function runConsole(database: Database, input: ConsoleInput): Promise<ConsoleOutcome> {
  const guard = guardStatement(typeof input.text === 'string' ? input.text : '', input.secretColumns)
  if (!guard.ok) {
    const { code, ...rest } = guard.failure
    const detail = Object.values(rest)[0]
    return { ok: false, reason: 'guard', code, detail: typeof detail === 'string' ? detail : undefined }
  }
  const mayWrite = input.write && !guard.readLike && guard.leading !== 'show'

  let snapshot: string | null = null
  if (mayWrite && input.beforeWrite) {
    try {
      snapshot = await input.beforeWrite()
    } catch (error) {
      return { ok: false, reason: 'snapshot', detail: databaseError(error) }
    }
  }

  const started = Date.now()
  let result: { rows?: Rows; fields?: Array<{ name: string }>; affectedRows?: number; rowCount?: number | null }
  try {
    result = await database.transaction(async (tx) => {
      if (!input.write) await tx.execute(sql`set transaction read only`)
      if (input.postgres) await tx.execute(sql.raw(`set local statement_timeout = ${STATEMENT_TIMEOUT_MS}`))
      if (guard.readLike) {
        await tx.execute(sql`savepoint console_cap`)
        try {
          const capped = await tx.execute(sql.raw(`select * from (\n${guard.statement}\n) as console_result limit ${CONSOLE_ROW_CAP + 1}`))
          await tx.execute(sql`release savepoint console_cap`)
          return capped as unknown as typeof result
        } catch {
          await tx.execute(sql`rollback to savepoint console_cap`)
        }
      }
      return (await tx.execute(sql.raw(guard.statement))) as unknown as typeof result
    })
  } catch (error) {
    return { ok: false, reason: 'database', detail: databaseError(error) }
  }

  const named = new Set<string>()
  for (const [table, columns] of Object.entries(SECRET_COLUMNS)) if (guard.words.has(table)) for (const column of columns) named.add(column)

  const columns = [...new Set((result.fields ?? []).map((field) => field.name))]
  const rows = result.rows ?? []
  const secret = columns.map((name) => isSecretColumn(null, name) || named.has(name))
  const writes = ['insert', 'update', 'delete', 'merge'].includes(guard.leading) || (guard.leading === 'with' && !guard.readLike)
  return {
    ok: true,
    columns,
    rows: rows.slice(0, CONSOLE_ROW_CAP).map((row) =>
      columns.map((name, i) => (secret[i] ? (row[name] === null || row[name] === undefined ? null : MASK) : cellText(maskValue(row[name])))),
    ),
    rowCount: rows.length,
    truncated: rows.length > CONSOLE_ROW_CAP,
    affected: writes ? (result.affectedRows ?? result.rowCount ?? null) : null,
    ms: Date.now() - started,
    wrote: mayWrite,
    snapshot,
  }
}

/**
 * What Postgres said. drizzle wraps a failed query in an error of its own
 * ("Failed query: <the SQL> params: …") with the database's error as its
 * cause; the cause is the part worth showing — and the wrapper would repeat
 * the statement, parameters included, into wherever the message goes.
 */
export function databaseError(error: unknown): string {
  let current: unknown = error
  for (let depth = 0; depth < 4 && current instanceof Error && current.cause instanceof Error; depth++) current = current.cause
  const message = current instanceof Error ? current.message : String(current)
  return message.startsWith('Failed query:') ? 'Query failed' : message.slice(0, 2_000)
}

/** Any value a driver returns, as the text a table cell shows. */
export function cellText(value: unknown): string | null {
  if (value === null || value === undefined) return null
  let text: string
  if (typeof value === 'string') text = value
  else if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') text = String(value)
  else if (value instanceof Date) text = Number.isNaN(value.getTime()) ? String(value) : value.toISOString()
  else if (value instanceof Uint8Array) text = `\\x${Buffer.from(value.subarray(0, CONSOLE_CELL_CUT / 2)).toString('hex')}`
  else text = JSON.stringify(value, (_key, item: unknown) => (typeof item === 'bigint' ? String(item) : item))
  return text.length > CONSOLE_CELL_CUT ? `${text.slice(0, CONSOLE_CELL_CUT)}…` : text
}

/* ------------------------------------------------------------- the whole --- */

export async function databaseFacts(database: Database, postgres: boolean): Promise<{ version: string | null; bytes: number | null; connections: number | null }> {
  const [versionRow] = await rowsOf(database, sql`select current_setting('server_version') as v`).catch(() => [] as Rows)
  const [sizeRow] = await rowsOf(database, sql`select pg_database_size(current_database())::float8 as bytes`).catch(() => [] as Rows)
  const [connRow] = postgres
    ? await rowsOf(database, sql`select count(*)::float8 as n from pg_stat_activity where datname = current_database()`).catch(() => [] as Rows)
    : []
  return {
    version: versionRow?.v ? String(versionRow.v) : null,
    bytes: sizeRow?.bytes !== undefined ? Number(sizeRow.bytes) : null,
    connections: connRow?.n !== undefined ? Number(connRow.n) : null,
  }
}

function parseJson<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') return value as T
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}
