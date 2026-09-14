import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const ENV_FILE = path.join(ROOT, '.env.local')
export const DATA_DIR = path.join(ROOT, '.data')
export const PGLITE_DIR = path.join(DATA_DIR, 'pgdata')
export const MIGRATIONS_DIR = path.join(ROOT, 'drizzle')

/** Our own lock: the real OS pid of the running `npm run dev`. */
export const DEV_LOCK = path.join(DATA_DIR, 'dev.lock')

const colors = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
}

export function log(message) {
  console.log(`${colors.cyan}▸${colors.reset} ${message}`)
}
export function ok(message) {
  console.log(`${colors.green}✓${colors.reset} ${message}`)
}
export function warn(message) {
  console.log(`${colors.yellow}!${colors.reset} ${message}`)
}
export function fail(message) {
  console.error(`${colors.red}✗${colors.reset} ${message}`)
}
export function dim(message) {
  console.log(`${colors.dim}  ${message}${colors.reset}`)
}

/**
 * Creates .env.local on first run with freshly generated secrets.
 *
 * Generating them here rather than shipping placeholder values means a clone
 * of this repo is immediately runnable *and* never shares an encryption key
 * with another checkout — the credential envelopes in one .data directory
 * cannot be opened by another machine.
 */
export function ensureEnvFile() {
  if (existsSync(ENV_FILE)) return false

  const contents = [
    '# Generated on first run. Keep this file out of version control.',
    '',
    '# Leave DATABASE_URL empty to use the embedded PGlite database in ./.data.',
    '# Set it to a postgres:// URL to point the same schema at a real server.',
    'DATABASE_URL=',
    '',
    `BETTER_AUTH_SECRET=${randomBytes(32).toString('base64')}`,
    'BETTER_AUTH_URL=http://localhost:3000',
    '',
    '# AES-256-GCM key protecting stored connector credentials.',
    '# Changing it makes every saved credential unreadable.',
    `APP_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`,
    '',
  ].join('\n')

  writeFileSync(ENV_FILE, contents, 'utf8')
  return true
}

export function loadEnv() {
  if (!existsSync(ENV_FILE)) return
  const contents = readFileSync(ENV_FILE, 'utf8')
  for (const line of contents.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}

export function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
}

export function usesPostgresServer() {
  const url = process.env.DATABASE_URL
  return Boolean(url && /^postgres(ql)?:\/\//.test(url))
}

/* ------------------------------------------------------------- locking --- */

function isAlive(pid) {
  try {
    // Signal 0 tests for existence without touching the process.
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM means it exists but belongs to someone else — still alive.
    return error?.code === 'EPERM'
  }
}

/** The pid of a running dev server, or null when nothing holds the lock. */
export function runningDevServer() {
  if (!existsSync(DEV_LOCK)) return null
  const pid = Number(readFileSync(DEV_LOCK, 'utf8').trim())
  if (!Number.isInteger(pid) || pid <= 0) return null
  return isAlive(pid) ? pid : null
}

export function acquireDevLock() {
  ensureDataDir()
  writeFileSync(DEV_LOCK, String(process.pid), 'utf8')

  let released = false
  const release = () => {
    if (released) return
    released = true
    try {
      rmSync(DEV_LOCK, { force: true })
    } catch {
      /* the directory may already be gone */
    }
  }

  process.on('exit', release)
  return release
}

/**
 * Refuses to open the embedded database while a dev server has it.
 *
 * This is the one guard that matters, and it is advisory because PGlite offers
 * nothing better. Measured behaviour of the library:
 *
 *   · It writes a sentinel pid (-42) into postmaster.pid, so that file can
 *     never say whether anything is running.
 *   · A leftover postmaster.pid does *not* prevent the next open — PGlite
 *     tolerates its own stale lock.
 *   · Two instances on one directory both open **without any complaint**.
 *
 * That last point is the hazard: concurrent writers silently corrupt the
 * cluster, and the damage only shows up later as an unrecoverable
 * "RuntimeError: Aborted()" inside initdb. Since the library will not stop it,
 * this check does — dev.mjs holds dev.lock for as long as Next is running, so
 * any script that opens the database meanwhile is caught here instead of
 * quietly destroying the data.
 */
export function assertDatabaseAvailable() {
  const owner = runningDevServer()
  if (owner === null || owner === process.pid) return

  fail(`The dev server (pid ${owner}) currently has the embedded database open.`)
  console.log('')
  console.log('  PGlite allows only one writer, and it does not enforce that itself —')
  console.log('  opening it twice corrupts the cluster with no warning at the time.')
  console.log('')
  console.log('  Stop the dev server first, then run this again.')
  console.log('')
  process.exit(1)
}

/** Opens the same database the app will use, with the same driver rules. */
export async function openDatabase() {
  if (usesPostgresServer()) {
    const { drizzle } = await import('drizzle-orm/node-postgres')
    const pgModule = await import('pg')
    const Pool = pgModule.default?.Pool ?? pgModule.Pool
    const pool = new Pool({ connectionString: process.env.DATABASE_URL })
    return {
      db: drizzle(pool),
      kind: 'postgres',
      async migrate(folder) {
        const { migrate } = await import('drizzle-orm/node-postgres/migrator')
        await migrate(this.db, { migrationsFolder: folder })
      },
      async close() {
        await pool.end()
      },
    }
  }

  ensureDataDir()
  // Concurrent writers are what corrupts a PGlite directory, and the library
  // will not stop them. This is the only thing that does.
  assertDatabaseAvailable()
  const { PGlite } = await import('@electric-sql/pglite')
  const { drizzle } = await import('drizzle-orm/pglite')
  const client = new PGlite(process.env.PGLITE_DATA_DIR ?? PGLITE_DIR)
  await client.waitReady
  return {
    db: drizzle(client),
    client,
    kind: 'pglite',
    async migrate(folder) {
      const { migrate } = await import('drizzle-orm/pglite/migrator')
      await migrate(this.db, { migrationsFolder: folder })
    },
    async close() {
      // Flush and shut down cleanly. PGlite does *not* hold an enforced lock,
      // so this is about finishing writes rather than releasing anything —
      // which is precisely why the dev.lock check above has to exist.
      await client.close()
    },
  }
}

/* ----------------------------------------------------------- snapshots --- */

export const SNAPSHOT_DIR = path.join(DATA_DIR, 'snapshots')
const SNAPSHOT_KEEP = 5

export function listSnapshots() {
  if (!existsSync(SNAPSHOT_DIR)) return []
  return readdirSync(SNAPSHOT_DIR)
    .filter((name) => name.endsWith('.tar.gz'))
    .sort()
    .reverse()
    .map((name) => ({
      name,
      file: path.join(SNAPSHOT_DIR, name),
      mtime: statSync(path.join(SNAPSHOT_DIR, name)).mtime,
      bytes: statSync(path.join(SNAPSHOT_DIR, name)).size,
    }))
}

/**
 * Writes a compressed copy of the whole cluster.
 *
 * The embedded database holds things the user typed by hand and cannot get
 * back from anywhere else — API credentials above all. A corrupted directory
 * is unrecoverable in place, so the only real protection is a copy taken while
 * it was healthy. Measured at roughly 1s and 4MB for a small project, which is
 * cheap enough to do on a schedule.
 */
export async function writeSnapshot(handle) {
  if (handle.kind !== 'pglite') return null
  if (!existsSync(SNAPSHOT_DIR)) mkdirSync(SNAPSHOT_DIR, { recursive: true })

  const blob = await handle.client.dumpDataDir('gzip')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const file = path.join(SNAPSHOT_DIR, `${stamp}.tar.gz`)
  writeFileSync(file, Buffer.from(await blob.arrayBuffer()))

  // Keep a bounded history: enough to step back past a bad change, not enough
  // to quietly fill the disk.
  for (const stale of listSnapshots().slice(SNAPSHOT_KEEP)) {
    rmSync(stale.file, { force: true })
  }

  return { file, bytes: statSync(file).size }
}

export function runNodeBin(relativeBin, args, options = {}) {
  return new Promise((resolve, reject) => {
    import('node:child_process').then(({ spawn }) => {
      const child = spawn(process.execPath, [path.join(ROOT, relativeBin), ...args], {
        stdio: 'inherit',
        cwd: ROOT,
        env: process.env,
        ...options,
      })
      child.on('error', reject)
      child.on('exit', (code) => resolve(code ?? 0))
    })
  })
}
