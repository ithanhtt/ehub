import 'server-only'

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite'
import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { sql } from 'drizzle-orm'
import * as schema from './schema'

/**
 * Two drivers, one schema.
 *
 * Development runs PGlite: a real Postgres 16 compiled to WASM that lives in
 * this Node process and persists to ./.data/pgdata. That is what lets
 * `npm run dev` bring the database up with no Docker, no service, no install.
 *
 * Production sets DATABASE_URL and gets an ordinary node-postgres pool.
 * Because both speak the postgresql dialect, the schema and the SQL in
 * ./drizzle are identical across the two — switching is a config change,
 * never a rewrite.
 *
 * The exported type is pinned to NodePgDatabase so application code has one
 * stable type to program against; both drivers expose the same query API.
 */
export type Database = NodePgDatabase<typeof schema>

export const DEFAULT_PGLITE_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), '.data', 'pgdata')

function usesPostgresServer(): boolean {
  const url = process.env.DATABASE_URL
  return Boolean(url && /^postgres(ql)?:\/\//.test(url))
}

export const isEmbeddedDatabase = !usesPostgresServer()

/**
 * A PGlite handle that opens the database on first query, not on import.
 *
 * `next build` evaluates the server module graph in several worker processes.
 * If the connection opened at import time, each of them would open the same
 * data directory — which PGlite permits without complaint and which corrupts
 * the cluster. In the build it surfaced as a bare `RuntimeError: unreachable`
 * from the WASM module, with nothing pointing at the cause.
 *
 * Deferring the *drizzle instance* instead does not work: better-auth's
 * drizzle adapter reads `db._` while it is being constructed, which would
 * force the connection open again. Only the client can be deferred, and
 * drizzle's own `drizzle(client, …)` never touches it beyond one
 * `constructor.name` read — which the trap below answers from a stub.
 */
const CONFIG_KEYS = new Set(['logger', 'schema', 'casing', 'mode', 'connection', 'client'])

/** Same file as DEV_LOCK in scripts/lib.mjs: the pid of the running `npm run dev`. */
const DEV_LOCK = path.join(/*turbopackIgnore: true*/ process.cwd(), '.data', 'dev.lock')

function liveDevLockOwner(): number | null {
  let pid: number
  try {
    pid = Number(readFileSync(DEV_LOCK, 'utf8').trim())
  } catch {
    return null
  }
  if (!Number.isInteger(pid) || pid <= 0) return null
  try {
    // Signal 0 tests for existence without touching the process.
    process.kill(pid, 0)
    return pid
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM' ? pid : null
  }
}

/**
 * Refuses to open the embedded database while `npm run dev` has it.
 *
 * scripts/lib.mjs guards the maintenance scripts, but anything importing this
 * module directly — check:connectors, verify:live — used to open the directory
 * next to the running server. PGlite allows that without a word; the second
 * instance's checkpoint overwrites the server's commit log, so everything the
 * app wrote since it started is gone at the next restart, or the cluster
 * aborts outright. dev.mjs passes its pid to the Next process it spawns, which
 * is how the one legitimate writer is told apart.
 */
function assertNoOtherWriter() {
  const owner = liveDevLockOwner()
  if (owner === null || owner === process.pid || String(owner) === process.env.ADSHUB_DEV_LOCK) return
  throw new Error(
    `The dev server (pid ${owner}) has the embedded database open. Stop it first — ` +
      'a second PGlite on the same directory silently destroys its data.',
  )
}

function createLazyClient(dataDir: string): PGlite {
  let instance: PGlite | null = null
  const open = () => {
    if (!instance) {
      assertNoOtherWriter()
      instance = new PGlite(dataDir)
    }
    return instance
  }

  // Must not be named "Object": drizzle uses that to tell a client apart from
  // a config object, and an "Object" answer would make it open its own PGlite.
  const stubConstructor = { name: 'PGlite' }

  return new Proxy({} as PGlite, {
    get(_target, property) {
      if (property === 'constructor') return stubConstructor
      const real = open() as unknown as Record<string | symbol, unknown>
      const value = real[property]
      return typeof value === 'function' ? value.bind(real) : value
    },
    has(_target, property) {
      if (typeof property === 'string' && CONFIG_KEYS.has(property)) return false
      return property in (open() as object)
    },
  })
}

/**
 * The Next dev server re-evaluates modules on every hot reload. Caching on
 * globalThis keeps exactly one Postgres alive across reloads instead of
 * failing the next one with a lock error.
 */
const globalForDb = globalThis as unknown as { __adshubDb?: Database }

function createDatabase(): Database {
  if (!isEmbeddedDatabase) {
    // A pg Pool connects lazily on first query, so this is safe at import time.
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    })
    return drizzlePg(pool, { schema })
  }

  const dataDir = process.env.PGLITE_DATA_DIR ?? DEFAULT_PGLITE_DIR
  return drizzlePglite(createLazyClient(dataDir), { schema }) as unknown as Database
}

export const db: Database = globalForDb.__adshubDb ?? createDatabase()

if (process.env.NODE_ENV !== 'production') {
  globalForDb.__adshubDb = db
}

export async function pingDatabase(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`)
    return true
  } catch {
    return false
  }
}

export { schema }
