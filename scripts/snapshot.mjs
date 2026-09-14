import { fail, listSnapshots, loadEnv, ok, openDatabase, usesPostgresServer, warn, writeSnapshot } from './lib.mjs'

loadEnv()

if (usesPostgresServer()) {
  warn('DATABASE_URL points at a real Postgres server — use its own backup tooling.')
  process.exit(0)
}

let handle
try {
  handle = await openDatabase()
  const result = await writeSnapshot(handle)
  if (!result) {
    fail('Nothing to snapshot.')
    process.exitCode = 1
  } else {
    ok(`Snapshot written: ${result.file.replace(process.cwd(), '.')} (${(result.bytes / 1024 / 1024).toFixed(2)} MB)`)
    const kept = listSnapshots()
    console.log(`  ${kept.length} snapshot(s) kept, newest first:`)
    for (const snap of kept) {
      console.log(`    ${snap.name}  ${(snap.bytes / 1024 / 1024).toFixed(2)} MB`)
    }
  }
} catch (error) {
  fail(`Snapshot failed: ${error?.message ?? error}`)
  process.exitCode = 1
} finally {
  if (handle) await handle.close()
}
