import { db } from '@/core/db/client'
import { auditLogs } from '@/core/db/schema/audit'
import { createId } from '@/core/utils/id'
import { MAX_BUNDLE_BYTES, readBundle, sha256Hex } from '../../../../../scripts/update-bundle.mjs'
import { isReceiver, signingKey } from '@/modules/system-update/data/config'
import { checkUploadSignature, SIGNATURE_WINDOW_MS } from '@/modules/system-update/data/signing'
import { isApplying, savePending } from '@/modules/system-update/data/store'

/**
 * Where a development machine sends an update (see the System update page).
 *
 * No session here — the sender is another machine — so the request proves
 * itself instead: an HMAC over the moment, a nonce and the bundle's SHA-256,
 * keyed with UPDATE_SIGNING_KEY, good for five minutes and only once. A
 * bundle that passes is only kept: nothing is applied until an Administrator
 * types the confirmation code on this server.
 */

export const dynamic = 'force-dynamic'

// Nonces seen within the signature window, and recent uploads, for replay and rate limits.
const memory = globalThis as unknown as { __adshubUpdateNonces?: Map<string, number>; __adshubUpdateHits?: number[] }
const nonces = (memory.__adshubUpdateNonces ??= new Map())
const hits = (memory.__adshubUpdateHits ??= [])
const RATE_WINDOW_MS = 10 * 60_000
const RATE_MAX = 10

const refuse = (status: number, error: string, detail?: string) => Response.json({ error, detail }, { status })

export async function POST(request: Request) {
  const key = signingKey()
  // A server not taking updates answers as if the address did not exist.
  if (!isReceiver() || !key) return refuse(404, 'notReceiver')

  const now = Date.now()
  while (hits.length > 0 && now - hits[0] > RATE_WINDOW_MS) hits.shift()
  if (hits.length >= RATE_MAX) return refuse(429, 'busy', 'too many uploads, try again in a few minutes')
  hits.push(now)

  const declared = Number(request.headers.get('content-length') ?? 0)
  if (declared > MAX_BUNDLE_BYTES) return refuse(413, 'tooLarge')

  const timestamp = Number(request.headers.get('x-adshub-timestamp'))
  const nonce = request.headers.get('x-adshub-nonce') ?? ''
  const signature = request.headers.get('x-adshub-signature') ?? ''
  const source = (request.headers.get('x-adshub-source') ?? 'unknown').replace(/[^\w.\- ]/g, '').slice(0, 60) || 'unknown'
  if (!/^[0-9a-f]{32}$/.test(nonce)) return refuse(401, 'signature')

  const body = Buffer.from(await request.arrayBuffer())
  if (body.length === 0 || body.length > MAX_BUNDLE_BYTES) return refuse(413, 'tooLarge')

  const sha256 = sha256Hex(body)
  const verdict = checkUploadSignature(key, { timestamp, nonce, signature, sha256 }, now)
  if (verdict !== 'ok') return refuse(401, verdict === 'stale' ? 'stale' : 'signature')

  for (const [seen, at] of nonces) if (now - at > SIGNATURE_WINDOW_MS * 2) nonces.delete(seen)
  if (nonces.has(nonce)) return refuse(409, 'replayed')
  nonces.set(nonce, now)

  if (await isApplying()) return refuse(409, 'busy')

  let bundle
  try {
    bundle = readBundle(body)
  } catch (error) {
    return refuse(400, 'bundle', error instanceof Error ? error.message : String(error))
  }

  const pending = await savePending(body, {
    version: bundle.version,
    label: bundle.label,
    sha256,
    files: bundle.files.length,
    source,
  })
  await db.insert(auditLogs).values({
    id: createId('aud'),
    projectId: null,
    actorId: null,
    action: 'system.update.receive',
    targetType: 'system',
    targetId: pending.id,
    detail: { version: pending.version, files: pending.files, bytes: pending.bytes, source },
  })

  return Response.json({ id: pending.id, expiresAt: pending.expiresAt, version: pending.version, files: pending.files })
}
