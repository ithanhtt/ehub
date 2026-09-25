/**
 * Which database columns the admin pages never show, never export and never
 * let anyone edit.
 *
 * Two rules, either one enough:
 *
 *   - the column is on the explicit list below — the places this app is known
 *     to keep something secret, including ones whose names say nothing
 *     (verification.value holds sign-in codes);
 *   - its name looks like a secret: password, secret, token, credential, a
 *     trailing _enc (an encrypted envelope), api key, private.
 *
 * The name rule is deliberately broad — access_token_expires_at is masked too,
 * a timestamp nobody needs to read here — because a column added next year
 * with "token" in its name should be hidden before anyone thinks about it.
 *
 * Masking by name cannot see through an alias in the SQL console
 * (`select password as p`), so the console also refuses statements that name
 * a secret column at all (sql-guard.ts), masks JSON keys and values that look
 * like secrets, and masks the table-specific columns whenever their table is
 * named. That is a guard against a secret landing on a screen or in a
 * screenshot by accident, not a wall against a platform Administrator — who
 * holds the server anyway.
 *
 * Pure and DB-free: the pages, the actions and `npm run check:plugins` share it.
 */

export const MASK = '••••••'

export const SECRET_NAME = /(password|secret|token|credential|_enc$|api_?key|private)/i

/** Known secret columns, by table (SQL names, public schema). */
export const SECRET_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  connections: ['credentials_enc'],
  account: ['password', 'access_token', 'refresh_token', 'id_token'],
  session: ['token'],
  verification: ['value'],
  project_invitations: ['token'],
}

export function isSecretColumn(table: string | null, column: string): boolean {
  if (SECRET_NAME.test(column)) return true
  if (!table) return false
  return SECRET_COLUMNS[table]?.includes(column) ?? false
}

/**
 * The envelope core/crypto/secrets.ts writes (v1:<iv>:<tag>:<ciphertext>) and
 * better-auth's scrypt password hash (<salt hex>:<key hex>): the two shapes a
 * secret keeps even when a query renames its column.
 */
const ENVELOPE = /^v\d+:[A-Za-z0-9+/=]{8,}:[A-Za-z0-9+/=]{8,}:[A-Za-z0-9+/=]{8,}$/
const SCRYPT_HASH = /^[0-9a-f]{32}:[0-9a-f]{128}$/i

export function looksLikeSecretValue(value: string): boolean {
  const text = value.trim()
  return ENVELOPE.test(text) || SCRYPT_HASH.test(text)
}

/** The same two shapes anywhere inside a longer text — a whole row cast to text, say. */
const EMBEDDED = /\bv\d+:[A-Za-z0-9+/=]{8,}:[A-Za-z0-9+/=]{8,}:[A-Za-z0-9+/=]{8,}|\b[0-9a-f]{32}:[0-9a-f]{128}\b/gi

/**
 * A value with its secrets masked: objects and arrays walked for secret keys,
 * strings that look like a secret replaced, and a string holding JSON (a
 * `jsonb::text` column) masked inside and written back. Depth-capped — a
 * cell, not a document store.
 */
export function maskValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') {
    if (looksLikeSecretValue(value)) return MASK
    const scrubbed = value.replace(EMBEDDED, MASK)
    if (scrubbed !== value) return scrubbed
    const head = value.trimStart()[0]
    if ((head === '{' || head === '[') && depth === 0 && value.length < 1_000_000) {
      try {
        const parsed = JSON.parse(value) as unknown
        const masked = maskValue(parsed, depth + 1)
        return JSON.stringify(masked) === JSON.stringify(parsed) ? value : JSON.stringify(masked)
      } catch {
        return value
      }
    }
    return value
  }
  if (depth > 8 || typeof value !== 'object') return value
  if (value instanceof Date || value instanceof Uint8Array) return value
  if (Array.isArray(value)) return value.map((item) => maskValue(item, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_NAME.test(key) && item !== null && item !== '' ? MASK : maskValue(item, depth + 1)
  }
  return out
}
