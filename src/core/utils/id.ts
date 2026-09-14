import { randomBytes, randomUUID } from 'node:crypto'

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

/**
 * Prefixed, sortable-ish identifiers (`prj_m2k8x1a4b7`).
 *
 * The prefix makes IDs self-describing in logs and URLs, and the leading
 * base36 timestamp keeps rows roughly insertion-ordered without exposing an
 * incrementing counter.
 */
export function createId(prefix: string): string {
  const time = Date.now().toString(36)
  const bytes = randomBytes(6)
  let random = ''
  for (const byte of bytes) random += ALPHABET[byte % ALPHABET.length]
  return `${prefix}_${time}${random}`
}

export function createToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

export { randomUUID }

/** URL-safe slug that keeps Vietnamese words readable by stripping diacritics. */
export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}
