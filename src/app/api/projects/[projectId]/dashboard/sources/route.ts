import { NextResponse, type NextRequest } from 'next/server'
import { redactSecrets } from '@/core/plugins/http'
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
    // The detail stays in the server log (secrets masked); the page gets a code, not a provider's raw message.
    console.error('[api/dashboard/sources]', redactSecrets(error instanceof Error ? (error.stack ?? error.message) : String(error)))
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 })
  }
}
