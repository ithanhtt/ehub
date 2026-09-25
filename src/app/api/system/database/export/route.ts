import { assertSystemAdmin } from '@/core/auth/session'
import { db } from '@/core/db/client'
import { auditLogs } from '@/core/db/schema/audit'
import { createId } from '@/core/utils/id'
import { describeTable, readAllRows } from '@/modules/system-admin/data/db-inspect'

/**
 * One table (or the rows matching the Database page's search) as CSV,
 * administrators only. Secret columns come out as the mask, exactly as in the
 * grid — the query never reads them. Capped, so a runaway log table cannot
 * hold the server; the last line says when the cap cut it.
 *
 * Exports are written to the audit trail: unlike browsing, the data leaves
 * the server.
 */

export const dynamic = 'force-dynamic'

const EXPORT_CAP = 50_000

/** A cell as CSV: quoted when it must be, and a leading = + - @ defused so a spreadsheet does not run it. */
function csvCell(value: string | null): string {
  if (value === null) return ''
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export async function GET(request: Request) {
  let user
  try {
    user = await assertSystemAdmin()
  } catch {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  const params = new URL(request.url).searchParams
  const meta = await describeTable(db, params.get('table') ?? '')
  if (!meta) return Response.json({ error: 'table' }, { status: 404 })
  const q = params.get('q') ?? ''

  const { header, rows, capped } = await readAllRows(db, meta, q, EXPORT_CAP)
  const lines = [header.map(csvCell).join(','), ...rows.map((row) => row.map(csvCell).join(','))]
  if (capped) lines.push(csvCell(`… cut at ${EXPORT_CAP} rows`))

  await db
    .insert(auditLogs)
    .values({ id: createId('aud'), projectId: null, actorId: user.id, action: 'system.db.export', targetType: 'table', targetId: meta.name, detail: { table: meta.name, q, rows: rows.length, capped } })
    .catch(() => undefined)

  const stamp = new Date().toISOString().slice(0, 10)
  // The byte-order mark makes Excel read the file as UTF-8 (Vietnamese names intact).
  return new Response(`﻿${lines.join('\r\n')}\r\n`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${meta.name.replace(/[^\w.-]/g, '_')}-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
