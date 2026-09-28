import { NextResponse, type NextRequest } from 'next/server'
import { redactSecrets } from '@/core/plugins/http'
import { assertCapability } from '@/core/auth/session'
import { GRANULARITIES, REPORT_RANGES, reportPeriodOf, reportRangeProblem, type Granularity, type ReportRange } from '@/modules/analytics/period'
import { REPORT_BUILDERS } from '@/modules/reports'
import { closedForMaintenance } from '@/modules/site-settings/data/gate'

/**
 * One report module's answer: `?range=7d|30d|90d&granularity=day|month`, or
 * `?range=custom&from=YYYY-MM-DD&to=YYYY-MM-DD` — checked with the rules the
 * page's date picker applies, so an out-of-reach range never reaches a provider.
 *
 * A GET the page polls, like the overview's: the reads behind it are kept per
 * day and memoised (modules/analytics/data), so a refresh costs little. Any
 * project member may look — the reports only read.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ projectId: string; reportId: string }> }) {
  // Closed for maintenance: nothing is read or sent for anyone but an Administrator.
  const closed = await closedForMaintenance()
  if (closed) return closed
  const { projectId, reportId } = await params
  const build = Object.hasOwn(REPORT_BUILDERS, reportId) ? REPORT_BUILDERS[reportId] : undefined
  if (!build) return NextResponse.json({ error: 'UNKNOWN_REPORT' }, { status: 404 })

  const search = request.nextUrl.searchParams
  const range = search.get('range') ?? '30d'
  const granularity = search.get('granularity') ?? 'day'
  const custom = range === 'custom' ? { from: search.get('from') ?? '', to: search.get('to') ?? '' } : undefined
  const known =
    (range === 'custom' || REPORT_RANGES.includes(range as ReportRange)) && GRANULARITIES.includes(granularity as Granularity)
  if (!known || (custom && reportRangeProblem(custom) !== null)) {
    return NextResponse.json({ error: 'INVALID_RANGE' }, { status: 400 })
  }

  try {
    await assertCapability(projectId, 'connection:view')
  } catch {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }

  try {
    const report = await build(projectId, reportPeriodOf(range as ReportRange, granularity as Granularity, custom))
    return NextResponse.json(report, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    // The detail stays in the server log (secrets masked); the page gets a code, not a provider's raw message.
    console.error('[api/reports]', redactSecrets(error instanceof Error ? (error.stack ?? error.message) : String(error)))
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 })
  }
}
