import { NextResponse, type NextRequest } from 'next/server'
import { redactSecrets } from '@/core/plugins/http'
import { assertCapability } from '@/core/auth/session'
import { dashboardCatalog } from '@/modules/overview/data/overview'

/**
 * The store's product catalog, each product with its latest order — for the
 * "all products" view of the overview's quiet-products list. Kept apart from
 * the dashboard's own read so the fifteen-second refresh does not carry the
 * whole catalog; the page asks for it only while that view is chosen.
 *
 * Any project member may look: it only reads.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  try {
    await assertCapability(projectId, 'connection:view')
  } catch {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }

  try {
    const data = await dashboardCatalog(projectId)
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    // The detail stays in the server log (secrets masked); the page gets a code, not a provider's raw message.
    console.error('[api/dashboard/catalog]', redactSecrets(error instanceof Error ? (error.stack ?? error.message) : String(error)))
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 })
  }
}
