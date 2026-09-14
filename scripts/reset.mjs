import { existsSync, rmSync } from 'node:fs'
import {
  DATA_DIR,
  PGLITE_DIR,
  fail,
  loadEnv,
  ok,
  openDatabase,
  usesPostgresServer,
  warn,
} from './lib.mjs'

loadEnv()

const force = process.argv.includes('--force')

if (usesPostgresServer()) {
  fail('DATABASE_URL points at a real Postgres server. Refusing to drop data.')
  console.log('  Drop and recreate that database yourself, then run `npm run db:migrate`.')
  process.exit(1)
}

if (!existsSync(PGLITE_DIR)) {
  warn('Nothing to reset — no embedded database found.')
  process.exit(0)
}

/**
 * Refuse to wipe a database that somebody is actually using.
 *
 * This deletion is irreversible and takes every account, project, connection
 * and dataset with it. The failure mode is quiet and confusing: the next sign
 * of trouble is a correct password being rejected on an empty database, with
 * nothing to connect it back to a reset that happened earlier. So the check is
 * "does this look like a real installation" rather than a yes/no prompt, which
 * would not survive being run from a script.
 */
let accounts = null
let handle
try {
  handle = await openDatabase()
  const result = await handle.client.query('select count(*)::int as n from "user"')
  accounts = result.rows[0]?.n ?? 0
} catch {
  // No schema yet, or an unreadable directory: nothing worth protecting.
  accounts = null
} finally {
  if (handle) await handle.close()
}

if (accounts !== null && accounts > 0 && !force) {
  fail(`Refusing to delete: this database holds ${accounts} account(s).`)
  console.log('')
  console.log('  Everything in it — accounts, projects, API connections, datasets — would be')
  console.log('  lost, and there is no backup. If that is genuinely what you want:')
  console.log('')
  console.log('    npm run db:reset -- --force')
  console.log('')
  process.exit(1)
}

rmSync(DATA_DIR, { recursive: true, force: true })
ok(
  accounts
    ? `Embedded database deleted, including ${accounts} account(s).`
    : 'Embedded database deleted.',
)
console.log('  The next `npm run dev` will rebuild it from the migrations.')
