import 'server-only'

import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Envelope encryption for connector credentials.
 *
 * Connector credentials are long-lived bearer secrets: a leaked TikTok Ads
 * access token spends real money. They are therefore never stored in
 * plaintext, and are decrypted only inside the request that actually calls the
 * provider — never on the way to a client component.
 *
 * Format: v1:<iv b64>:<authTag b64>:<ciphertext b64>
 * The version prefix leaves room to rotate the algorithm without a data migration.
 */

const ALGORITHM = 'aes-256-gcm'
const VERSION = 'v1'
const IV_BYTES = 12

let cachedKey: Buffer | null = null

function encryptionKey(): Buffer {
  if (cachedKey) return cachedKey

  const raw = process.env.APP_ENCRYPTION_KEY
  if (!raw) {
    throw new Error(
      'APP_ENCRYPTION_KEY is missing. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    )
  }

  // Accept a 32-byte base64/hex key directly; otherwise derive one so a
  // hand-typed passphrase still yields a valid AES-256 key.
  let key: Buffer
  const asBase64 = Buffer.from(raw, 'base64')
  const asHex = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : null

  if (asHex?.length === 32) key = asHex
  else if (asBase64.length === 32) key = asBase64
  else key = createHash('sha256').update(raw, 'utf8').digest()

  cachedKey = key
  return key
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [VERSION, iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(':')
}

export function decryptSecret(envelope: string): string {
  const [version, ivB64, tagB64, dataB64] = envelope.split(':')
  if (version !== VERSION || !ivB64 || !tagB64 || !dataB64) {
    throw new Error('Credential envelope is malformed or was written with a different key version.')
  }

  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8')
}

/** Store a credential bag as one encrypted blob rather than column-per-field. */
export function encryptJson(value: unknown): string {
  return encryptSecret(JSON.stringify(value))
}

export function decryptJson<T = Record<string, string>>(envelope: string): T {
  return JSON.parse(decryptSecret(envelope)) as T
}

/** `sk_live_abcd1234` -> `sk_l…1234`, for showing a credential without revealing it. */
export function maskSecret(value: string): string {
  if (!value) return ''
  if (value.length <= 8) return '••••'
  return `${value.slice(0, 4)}…${value.slice(-4)}`
}

export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}
