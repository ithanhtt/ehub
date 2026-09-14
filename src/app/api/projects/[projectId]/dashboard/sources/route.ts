import { NextResponse, type NextRequest } from 'next/server'
import { assertCapability } from '@/core/auth/session'
import { dashboardSources } from '@/modules/overview/data/overview'

/**
 * The shops and sales channels the dashboard can count, and the current
 * choice — what the "choose data sources" dialog lists. Any member may look;
 * saving goes through a server action that needs the connection-edit right.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  try {
    await assertCapability(projectId, 'connection:view')
  } catch {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }

  try {
    return NextResponse.json(await dashboardSources(projectId), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
