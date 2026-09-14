import { NextResponse } from 'next/server'
import { z } from 'zod'
import { assertCapability } from '@/core/auth/session'
import { CustomRequestError, executeCustomRequest } from '@/core/plugins/execute-custom'
import { ALLOWED_METHODS, SAFE_METHODS } from '@/core/plugins/custom-path'

/**
 * Sends a request to a path the catalogue does not declare.
 *
 * Neither TikTok nor Sapo publishes a machine-readable API spec — verified by
 * probing the usual locations — so a hand-written catalogue can never cover a
 * whole provider. This is the escape hatch that means trying an endpoint from
 * the documentation costs a form, not a code change and a deploy.
 *
 * The permission depends on the method: reading an undeclared path is an
 * editor's job, writing to one is an admin's, because nothing has reviewed
 * what that path does.
 */
const bodySchema = z.object({
  projectId: z.string().min(1),
  connectionId: z.string().min(1),
  method: z.enum(ALLOWED_METHODS),
  path: z.string().min(1).max(500),
  query: z.record(z.string(), z.string()).default({}),
  body: z.string().max(100_000).optional(),
  resultPath: z.string().max(200).optional(),
})

export async function POST(request: Request) {
  let payload: z.infer<typeof bodySchema>
  try {
    payload = bodySchema.parse(await request.json())
  } catch {
    return NextResponse.json({ ok: false, error: 'INVALID_REQUEST' }, { status: 400 })
  }

  const writes = !SAFE_METHODS.has(payload.method)

  let actorId: string
  try {
    const ctx = await assertCapability(
      payload.projectId,
      writes ? 'hub:custom-write' : 'hub:custom',
    )
    actorId = ctx.user.id
  } catch {
    return NextResponse.json(
      { ok: false, error: writes ? 'FORBIDDEN_WRITE' : 'FORBIDDEN' },
      { status: 403 },
    )
  }

  try {
    const result = await executeCustomRequest({ ...payload, actorId })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof CustomRequestError) {
      // A rejected path is the caller's mistake, not a server fault, and the
      // reason is safe to return: it names the rule, never the resolved URL.
      const status = error.reason === 'CONNECTION_NOT_FOUND' ? 404 : 400
      return NextResponse.json({ ok: false, error: error.reason }, { status })
    }
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
