import { assertSystemAdmin } from '@/core/auth/session'
import { sampleLive, systemSnapshot } from '@/modules/system-admin/data/system-info'

/**
 * The System page's live view, administrators only. Every five seconds the
 * page asks for the moving part (CPU, memory, network); once a minute, with
 * ?full=1, for everything — whose heavy part the server keeps for a minute
 * anyway, however many pages ask.
 *
 * A route handler rather than a server action: actions from one page are
 * dispatched one after another, and a poll must not queue behind a VACUUM the
 * administrator just started.
 */

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    await assertSystemAdmin()
  } catch {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  const full = new URL(request.url).searchParams.get('full') === '1'
  const body = full ? await systemSnapshot() : await sampleLive()
  return Response.json(body, { headers: { 'Cache-Control': 'no-store' } })
}
