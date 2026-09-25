import { and, eq, sql, type SQL } from 'drizzle-orm'
import { bookings } from '@/core/db/schema/bookings'
import type { ResultFigures } from '@/modules/bookings/results'

/**
 * The SQL the booking file's bookkeeping needs beyond plain inserts and
 * updates — the next booking code, and a sync's results written in bulk. Kept
 * apart from the database client (it only builds statements), so the
 * statements can be run against a throwaway database in a check.
 */

/** The codes the numbering counts (see codeNumber in modules/bookings/fields.ts): BK- and 1 to 6 digits. */
const CODE_PATTERN_SQL = '^BK-[0-9]{1,6}$'

/** The number of the project's last app-given code (BK-n) — the next booking takes the one after; 0 when there is none. */
export function lastCodeNumberQuery(projectId: string) {
  return sql<{ n: string | number | null }>`select max((substring(${bookings.code} from 4))::integer) as n from ${bookings} where ${and(eq(bookings.projectId, projectId), sql`${bookings.code} ~ ${CODE_PATTERN_SQL}`)}`
}

/** A row of the query above, as a number. */
export const lastCodeNumberOf = (rows: ReadonlyArray<{ n: string | number | null }>) => Number(rows[0]?.n ?? 0) || 0

/** Whether a write failed only because another booking of the project took the same code first. */
export function isCodeTaken(error: unknown): boolean {
  // A campaign created by name by two imports at once clashes the same way; the retry finds the other's.
  const RETRYABLE = ['bookings_project_code_unique', 'booking_campaigns_name_unique']
  for (let current: unknown = error, depth = 0; current && depth < 4; depth++) {
    const e = current as { message?: unknown; constraint?: unknown; cause?: unknown }
    if (RETRYABLE.some((name) => e.constraint === name || String(e.message ?? '').includes(name))) return true
    current = e.cause
  }
  return false
}

/** How many rows one results statement writes. */
export const RESULT_CHUNK = 200

/**
 * One statement writing a sync's results to up to RESULT_CHUNK bookings:
 * the figures (unless `keep`), the note and the time. A booking whose figures
 * a booker typed meanwhile (`result_source` 'manual') is left alone, whatever
 * the sync read — and so is one whose video or air date changed while the
 * sync was reading (a read can take minutes): the figures read belong to the
 * video and the days it was asked about (`videoId`, `startOn`), and are
 * written only where the booking still has both.
 */
export function resultUpdateStatement(
  projectId: string,
  rows: ReadonlyArray<{ id: string; videoId: string; startOn: string } & ResultFigures>,
  at: Date,
): SQL {
  const values = sql.join(
    rows.map(
      (row) =>
        sql`(${row.id}::text, ${row.orders}::integer, ${row.revenue}::bigint, ${row.note}::text, ${row.keep}::boolean, ${row.videoId}::text, ${row.startOn}::date)`,
    ),
    sql`, `,
  )
  return sql`update "bookings" as "b" set
      "result_orders" = case when "v"."keep" then "b"."result_orders" else "v"."orders" end,
      "result_revenue" = case when "v"."keep" then "b"."result_revenue" else "v"."revenue" end,
      "result_source" = case when "v"."keep" then "b"."result_source" else 'tiktok' end,
      "result_note" = "v"."note",
      "result_synced_at" = ${at.toISOString()}::timestamptz
    from (values ${values}) as "v"("id", "orders", "revenue", "note", "keep", "video_id", "start_on")
    where "b"."id" = "v"."id" and "b"."project_id" = ${projectId}
      and ("b"."result_source" is null or "b"."result_source" <> 'manual')
      and "b"."video_id" = "v"."video_id"
      and coalesce("b"."aired_on", "b"."booked_on") = "v"."start_on"`
}
