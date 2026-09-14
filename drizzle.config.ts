import type { Config } from 'drizzle-kit'

/**
 * `drizzle-kit generate` only reads the schema files, it never connects to a
 * database. The produced SQL lives in ./drizzle and is applied by
 * scripts/migrate.mjs against whichever driver is active (PGlite or Postgres).
 */
export default {
  schema: './src/core/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
} satisfies Config
