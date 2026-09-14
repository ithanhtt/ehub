import { existsSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import {
  DATA_DIR,
  PGLITE_DIR,
  assertDatabaseAvailable,
  dim,
  fail,
  listSnapshots,
  loadEnv,
  log,
  ok,
  usesPostgresServer,
} from './lib.mjs'

loadEnv()

if (usesPostgresServer()) {
  fail('DATABASE_URL points at a real Postgres server. Restore it with its own tooling.')
  process.exit(1)
}

// Restoring replaces the live directory, so nothing else may be holding it.
assertDatabaseAvailable()

const snapshots = listSnapshots()
if (snapshots.length === 0) {
  fail('No snapshots found in ./.data/snapshots.')
  dim('Take one with `npm run db:snapshot` while the database is healthy.')
  process.exit(1)
}

const requested = process.argv[2]
const chosen = requested ? snapshots.find((s) => s.name === requested || s.name.startsWith(requested)) : snapshots[0]

if (!chosen) {
  fail(`No snapshot matching "${requested}".`)
  console.log('  Available:')
  for (const snap of snapshots) console.log(`    ${snap.name}`)
  process.exit(1)
}

log(`Restoring ${chosen.name} (${(chosen.bytes / 1024 / 1024).toFixed(2)} MB)`)

/*
 * The current directory is moved aside rather than deleted: if the snapshot
 * turns out to be the wrong one, throwing away the only other copy of the data
 * would make a bad situation permanent.
 */
const aside = path.join(DATA_DIR, `pgdata.before-restore-${Date.now()}`)
if (existsSync(PGLITE_DIR)) {
  const { renameSync } = await import('node:fs')
  renameSync(PGLITE_DIR, aside)
  dim(`Previous directory kept at ${aside.replace(process.cwd(), '.')}`)
}

try {
  const { PGlite } = await import('@electric-sql/pglite')
  const bytes = readFileSync(chosen.file)
  const client = new PGlite(PGLITE_DIR, {
    loadDataDir: new Blob([bytes], { type: 'application/x-gzip' }),
  })
  await client.waitReady

  const result = await client.query('select count(*)::int as n from "user"')
  await client.close()

  ok(`Restored. ${result.rows[0].n} account(s) in the restored database.`)
  console.log('  Start the app with `npm run dev`.')
} catch (error) {
  fail(`Restore failed: ${error?.message ?? error}`)
  if (existsSync(aside)) {
    rmSync(PGLITE_DIR, { recursive: true, force: true })
    const { renameSync } = await import('node:fs')
    renameSync(aside, PGLITE_DIR)
    dim('Rolled back to the directory that was there before.')
  }
  process.exitCode = 1
}
