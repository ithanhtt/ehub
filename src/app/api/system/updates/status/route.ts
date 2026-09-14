import { assertSystemAdmin } from '@/core/auth/session'
import { updateOverview } from '@/modules/system-update/data/overview'

/** The System update page's live view: what waits, what runs, how it went. Administrators only. */

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await assertSystemAdmin()
  } catch {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  return Response.json(await updateOverview(), { headers: { 'Cache-Control': 'no-store' } })
}
