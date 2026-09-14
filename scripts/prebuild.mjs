import { existsSync, readdirSync } from 'node:fs'
import {
  MIGRATIONS_DIR,
  ensureEnvFile,
  fail,
  loadEnv,
  log,
  ok,
  openDatabase,
  usesPostgresServer,
  warn,
} from './lib.mjs'

/**
 * Runs before `next build`.
 *
 * A production build against a real Postgres should not silently start with a
 * stale schema, so migrations are applied here too. With the embedded database
 * this also guarantees `npm run build && npm start` works on a fresh clone.
 */
ensureEnvFile()
loadEnv()

if (!process.env.BETTER_AUTH_SECRET) {
  fail('BETTER_AUTH_SECRET is not set. Sessions cannot be signed without it.')
  process.exit(1)
}
if (!process.env.APP_ENCRYPTION_KEY) {
  fail('APP_ENCRYPTION_KEY is not set. Stored API credentials cannot be decrypted without it.')
  process.exit(1)
}

const hasMigrations =
  existsSync(MIGRATIONS_DIR) && readdirSync(MIGRATIONS_DIR).some((f) => f.endsWith('.sql'))

if (!hasMigrations) {
  warn('No migrations found; skipping the pre-build migration step.')
  process.exit(0)
}

log(`Applying migrations before build (${usesPostgresServer() ? 'postgres' : 'pglite'})`)

let handle
try {
  handle = await openDatabase()
  await handle.migrate(MIGRATIONS_DIR)
  ok('Database schema is up to date.')
} catch (error) {
  fail(`Pre-build migration failed: ${error?.message ?? error}`)
  process.exit(1)
} finally {
  if (handle) await handle.close()
}
