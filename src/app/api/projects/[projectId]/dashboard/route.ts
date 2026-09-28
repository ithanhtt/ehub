import { NextResponse, type NextRequest } from 'next/server'
import { redactSecrets } from '@/core/plugins/http'
import { assertCapability } from '@/core/auth/session'
import { dashboardData } from '@/modules/overview/data/overview'
import { customRangeProblem, periodOf } from '@/modules/overview/data/period'
import { DASHBOARD_RANGES, type DashboardRange } from '@/modules/overview/data/types'
import { closedForMaintenance } from '@/modules/site-settings/data/gate'

/**
 * Data for the overview dashboard, polled by the page every fifteen seconds.
 *
 * `?range=today|7d|30d`, or `?range=custom&from=YYYY-MM-DD&to=YYYY-MM-DD` —
 * checked with the same rules the page's date picker applies (see
 * customRangeProblem), so an out-of-reach range never reaches the providers.
 *
 * A GET route handler rather than a server action: the page refreshes on a
 * timer and a plain JSON read keeps that out of the RSC stream. Uncached at
 * this layer (route handlers are not cached by default); the provider reads
 * behind it are memoised in modules/overview/data, which is what keeps several
 * open tabs from multiplying the calls.
 *
 * Any project member may look: the dashboard only reads.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  // Closed for maintenance: nothing is read or sent for anyone but an Administrator.
  const closed = await closedForMaintenance()
  if (closed) return closed
  const { projectId } = await params
  const search = request.nextUrl.searchParams
  const range = search.get('range') ?? 'today'
  const custom = range === 'custom' ? { from: search.get('from') ?? '', to: search.get('to') ?? '' } : undefined
  const known = range === 'custom' || DASHBOARD_RANGES.includes(range as DashboardRange)
  if (!known || (custom && customRangeProblem(custom) !== null)) {
    return NextResponse.json({ error: 'INVALID_RANGE' }, { status: 400 })
  }

  try {
    await assertCapability(projectId, 'connection:view')
  } catch {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }

  try {
    const data = await dashboardData(projectId, periodOf(range as DashboardRange, custom))
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    // The detail stays in the server log (secrets masked); the page gets a code, not a provider's raw message.
    console.error('[api/dashboard]', redactSecrets(error instanceof Error ? (error.stack ?? error.message) : String(error)))
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 })
  }
}
