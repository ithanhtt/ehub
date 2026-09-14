import { pingDatabase } from '@/core/db/client'
import { currentRelease } from '@/modules/system-update/data/overview'

/**
 * Liveness, for the updater and for any monitor: which release is answering,
 * and whether its database answers too. Nothing else is said.
 *
 * The updater waits on `release` after a restart — the only way to know the
 * app came back on the new code rather than the old.
 */

export const dynamic = 'force-dynamic'

export async function GET() {
  const [release, database] = await Promise.all([currentRelease(), pingDatabase()])
  return Response.json(
    { ok: database, release: release?.id ?? 'dev', version: release?.version ?? null },
    { status: database ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  )
}
