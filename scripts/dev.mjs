import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import {
  MIGRATIONS_DIR,
  ROOT,
  dim,
  acquireDevLock,
  ensureDataDir,
  ensureEnvFile,
  fail,
  loadEnv,
  log,
  ok,
  listSnapshots,
  openDatabase,
  runNodeBin,
  runningDevServer,
  writeSnapshot,
  usesPostgresServer,
  warn,
} from './lib.mjs'

/**
 * `npm run dev` — the whole stack in one command.
 *
 * The steps run in this order for a reason: the database must be migrated and
 * *closed* before Next starts. PGlite does not enforce single-writer access —
 * two instances on one directory both open happily and corrupt it — so the
 * ordering here, plus dev.lock, is what keeps exactly one writer alive.
 */

console.log('')
log('EHub — starting development environment')

if (ensureEnvFile()) {
  ok('Created .env.local with freshly generated secrets')
  dim('Keep this file private; it holds the key that decrypts stored API credentials.')
}
loadEnv()
ensureDataDir()

/*
 * One dev server per data directory.
 *
 * PGlite will happily open a directory a second time and give no warning; the
 * corruption only surfaces later as an unrecoverable abort. Nothing in the
 * library prevents it, so this does.
 */
const existing = runningDevServer()
if (existing !== null) {
  fail(`A dev server is already running for this project (pid ${existing}).`)
  dim('Stop it first, or use the one already running — a second writer would')
  dim('corrupt the database.')
  process.exit(1)
}
const releaseDevLock = acquireDevLock()

/* 1. Make sure SQL migrations exist ---------------------------------------- */

const hasMigrations =
  existsSync(MIGRATIONS_DIR) && readdirSync(MIGRATIONS_DIR).some((f) => f.endsWith('.sql'))

if (!hasMigrations) {
  log('No migrations yet — generating them from the schema')
  const code = await runNodeBin('node_modules/drizzle-kit/bin.cjs', ['generate'])
  if (code !== 0) {
    fail('drizzle-kit generate failed. Fix the schema and try again.')
    process.exit(code)
  }
}

/* 2. Apply them, then release the database lock ---------------------------- */

const target = usesPostgresServer() ? 'PostgreSQL server' : 'embedded PGlite (./.data/pgdata)'
log(`Preparing database — ${target}`)

let handle
try {
  handle = await openDatabase()
  await handle.migrate(MIGRATIONS_DIR)
  ok('Database ready')

  /*
   * Snapshot on a schedule, while the database is already open here.
   *
   * A corrupted PGlite directory cannot be repaired in place, and it holds
   * credentials the user typed by hand and can get from nowhere else. Six
   * hours bounds the cost — about a second and a few megabytes — against how
   * much work a restore would lose.
   */
  const newest = listSnapshots()[0]
  const ageHours = newest ? (Date.now() - newest.mtime.getTime()) / 3_600_000 : Infinity
  if (ageHours >= 6) {
    const snapshot = await writeSnapshot(handle)
    if (snapshot) {
      const mb = (snapshot.bytes / 1024 / 1024).toFixed(1)
      ok(`Snapshot taken (${mb} MB)`)
      dim('Roll back to it with `npm run db:restore`.')
    }
  }
} catch (error) {
  fail(`Could not prepare the database: ${error?.message ?? error}`)
  if (!usesPostgresServer()) {
    // The abort from a corrupted cluster is a bare WASM trace, so say what it
    // means and offer the recovery that does not throw the data away first.
    dim('The embedded database may be corrupted — that happens if it was opened')
    dim('by two processes at once, or killed mid-write.')
    dim('')
    dim('  npm run db:restore            roll back to the newest snapshot')
    dim('  npm run db:reset -- --force   start over, losing everything')
  }
  process.exit(1)
} finally {
  // Must happen before Next boots: it opens the same directory, and two
  // writers at once is what destroys it.
  if (handle) await handle.close()
}

/* 3. Hand over to Next ------------------------------------------------------ */

const nextBin = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next')
if (!existsSync(nextBin)) {
  fail('Next.js is not installed. Run `npm install` first.')
  process.exit(1)
}

log('Starting Next.js')
console.log('')

const child = spawn(process.execPath, [nextBin, 'dev'], {
  stdio: 'inherit',
  cwd: ROOT,
  // Tells src/core/db/client.ts that Next belongs to the dev.lock holder — the
  // one process allowed to open the embedded database while the lock is held.
  env: { ...process.env, ADSHUB_DEV_LOCK: String(process.pid) },
})

const forward = (signal) => () => {
  if (!child.killed) child.kill(signal)
  releaseDevLock()
}
process.on('SIGINT', forward('SIGINT'))
process.on('SIGTERM', forward('SIGTERM'))

child.on('exit', (code) => {
  releaseDevLock()
  if (code && code !== 0) warn(`Next.js exited with code ${code}`)
  process.exit(code ?? 0)
})
