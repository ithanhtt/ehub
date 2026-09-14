import 'server-only'

import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * The two proofs an update carries, both keyed with UPDATE_SIGNING_KEY.
 *
 * The upload signature proves a bundle comes from a machine holding the key,
 * untouched on the way, and recently: it covers the moment, a one-off nonce
 * and the bundle's SHA-256, and the server accepts it for five minutes, once.
 *
 * The confirmation code proves the person confirming on the server saw the
 * sending machine's screen: eight characters derived from the update and the
 * key, shown there and never sent along with the bundle.
 */

/** How far apart the two machines' clocks may be, and how long a signed upload stays good. */
export const SIGNATURE_WINDOW_MS = 5 * 60_000

/** Crockford's base32: no I, L, O or U, the letters easily misread. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

const hmac = (key: Buffer, text: string) => createHmac('sha256', key).update(text).digest()

export function uploadSignature(key: Buffer, timestamp: number, nonce: string, sha256: string): string {
  return hmac(key, `adshub-update\n${timestamp}\n${nonce}\n${sha256}`).toString('hex')
}

export function checkUploadSignature(
  key: Buffer,
  upload: { timestamp: number; nonce: string; signature: string; sha256: string },
  now = Date.now(),
): 'ok' | 'stale' | 'invalid' {
  if (!Number.isFinite(upload.timestamp) || Math.abs(now - upload.timestamp) > SIGNATURE_WINDOW_MS) return 'stale'
  if (!/^[0-9a-f]{64}$/.test(upload.signature)) return 'invalid'
  const expected = Buffer.from(uploadSignature(key, upload.timestamp, upload.nonce, upload.sha256), 'hex')
  const given = Buffer.from(upload.signature, 'hex')
  return given.length === expected.length && timingSafeEqual(given, expected) ? 'ok' : 'invalid'
}

/** "K7Q2-9XMP": forty bits of the keyed hash, in base32. */
export function confirmationCode(key: Buffer, updateId: string, sha256: string): string {
  let bits = BigInt(`0x${hmac(key, `adshub-confirm\n${updateId}\n${sha256}`).subarray(0, 5).toString('hex')}`)
  let code = ''
  for (let i = 0; i < 8; i++) {
    code = ALPHABET[Number(bits & 31n)] + code
    bits >>= 5n
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`
}

/** What was typed, forgiving of case, spacing and the letters base32 leaves out. */
export function normalizeCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/U/g, 'V')
}

export function sameCode(given: string, expected: string): boolean {
  const a = Buffer.from(normalizeCode(given))
  const b = Buffer.from(normalizeCode(expected))
  return a.length === b.length && timingSafeEqual(a, b)
}
