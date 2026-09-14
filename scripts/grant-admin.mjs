import { sql } from 'drizzle-orm'
import { fail, loadEnv, ok, openDatabase } from './lib.mjs'

/**
 * `npm run admin:grant -- someone@example.com` — makes an account a platform
 * Administrator (the one role that sees System update).
 *
 * The first account to register gets the role on its own; this is for when
 * someone else should have it too, or the first account was not the right one.
 */
loadEnv()

const email = process.argv[2]?.trim()
if (!email || !email.includes('@')) {
  fail('Usage: npm run admin:grant -- someone@example.com')
  process.exit(1)
}

const handle = await openDatabase()
try {
  const result = await handle.db.execute(
    sql`update "user" set role = 'admin', updated_at = now() where lower(email) = lower(${email}) returning email`,
  )
  const rows = result.rows ?? result
  if (!rows.length) {
    fail(`No account with the email ${email}. Register it first, then run this again.`)
    process.exitCode = 1
  } else {
    ok(`${rows[0].email} is now an Administrator.`)
  }
} finally {
  await handle.close()
}
