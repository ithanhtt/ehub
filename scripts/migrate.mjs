import { existsSync, readdirSync } from 'node:fs'
import { MIGRATIONS_DIR, ensureEnvFile, fail, loadEnv, log, ok, openDatabase, usesPostgresServer } from './lib.mjs'

ensureEnvFile()
loadEnv()

const hasMigrations =
  existsSync(MIGRATIONS_DIR) && readdirSync(MIGRATIONS_DIR).some((f) => f.endsWith('.sql'))

if (!hasMigrations) {
  fail('No migrations found in ./drizzle. Run `npm run db:generate` first.')
  process.exit(1)
}

const handle = await openDatabase()
log(`Applying migrations (${handle.kind}${usesPostgresServer() ? '' : ' → ./.data/pgdata'})`)

try {
  await handle.migrate(MIGRATIONS_DIR)
  ok('Database schema is up to date.')
} catch (error) {
  fail(`Migration failed: ${error?.message ?? error}`)
  process.exitCode = 1
} finally {
  await handle.close()
}
