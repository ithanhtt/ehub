import { NextResponse, type NextRequest } from 'next/server'
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
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
