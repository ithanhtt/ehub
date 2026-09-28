import { NextResponse } from 'next/server'
import { z } from 'zod'
import { assertCapability } from '@/core/auth/session'
import { executeEndpoint } from '@/core/plugins/execute'
import { closedForMaintenance } from '@/modules/site-settings/data/gate'

/**
 * The Hub's execute endpoint.
 *
 * A route handler rather than a server action: responses here are arbitrary
 * provider payloads that can reach several megabytes, and a plain JSON POST
 * keeps them out of the RSC stream while letting the client render a spinner,
 * timings and errors from one predictable shape.
 */
const bodySchema = z.object({
  projectId: z.string().min(1),
  connectionId: z.string().min(1),
  endpointId: z.string().min(1),
  params: z.record(z.string(), z.unknown()).default({}),
})

export async function POST(request: Request) {
  // Closed for maintenance: nothing is read or sent for anyone but an Administrator.
  const closed = await closedForMaintenance()
  if (closed) return closed
  let payload: z.infer<typeof bodySchema>
  try {
    payload = bodySchema.parse(await request.json())
  } catch {
    return NextResponse.json({ ok: false, error: 'INVALID_REQUEST' }, { status: 400 })
  }

  let actorId: string
  try {
    // Viewers may browse the catalogue but not spend provider quota.
    const ctx = await assertCapability(payload.projectId, 'hub:execute')
    actorId = ctx.user.id
  } catch {
    return NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 })
  }

  try {
    const result = await executeEndpoint({
      projectId: payload.projectId,
      connectionId: payload.connectionId,
      endpointId: payload.endpointId,
      params: payload.params,
      actorId,
    })
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const status = message === 'CONNECTION_NOT_FOUND' ? 404 : 500
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}
