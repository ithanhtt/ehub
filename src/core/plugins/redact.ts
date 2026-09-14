import type { AuthField, ConnectionContext, PreparedRequest } from './types'

/**
 * Builds the copy of an outbound request that is safe to show and to store.
 *
 * Two layers, because either one alone leaks:
 *
 *  1. Name-based masking catches the usual carriers (`Authorization`,
 *     `Access-Token`, an `api_key` query param) even when the value did not
 *     come from the credential bag — a plugin might derive a signature.
 *  2. Value-based scrubbing removes the actual stored credentials wherever
 *     they appear, including places layer 1 cannot reason about: a request
 *     body, a token embedded in a path, a provider that names its header
 *     something unguessable.
 *
 * The result is what the Hub renders in its Request tab and what
 * api_call_logs.url keeps, so a leak here would be persistent.
 */
const SENSITIVE_NAME = /authorization|token|secret|key|cookie|signature|password|passwd|credential/i
const MASK = '••••••••'

/** Credential values too short or too common to scrub without mangling the echo. */
const MIN_SCRUB_LENGTH = 6

export type RequestEcho = {
  method: string
  url: string
  headers: Record<string, string>
  body?: string
}

/**
 * Collects the values worth scrubbing: only fields the plugin declared secret.
 *
 * Scrubbing every credential would corrupt the echo — Sapo's store domain is
 * a credential but it *is* the URL, and masking it would make the displayed
 * request unreadable and unreproducible.
 */
export function secretValuesOf(
  fields: AuthField[],
  credentials: ConnectionContext['credentials'],
): string[] {
  return fields
    .filter((field) => field.secret)
    .map((field) => credentials[field.key])
    .filter((value): value is string => typeof value === 'string' && value.length >= MIN_SCRUB_LENGTH)
}

export function buildRequestEcho(request: PreparedRequest, secrets: string[] = []): RequestEcho {

  return {
    method: request.method,
    url: scrubSecrets(request.redactedUrl ?? redactUrl(request.url), secrets),
    headers: scrubHeaderValues(redactHeaders(request.headers), secrets),
    body: request.body ? scrubSecrets(request.body, secrets) : undefined,
  }
}

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    out[key] = SENSITIVE_NAME.test(key) ? MASK : value
  }
  return out
}

/** Some providers accept the token in the query string; strip it from echoes and logs. */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url)
    for (const key of [...parsed.searchParams.keys()]) {
      if (SENSITIVE_NAME.test(key)) parsed.searchParams.set(key, MASK)
    }
    return parsed.toString()
  } catch {
    return url
  }
}

export function scrubSecrets(text: string, secrets: string[]): string {
  let out = text
  for (const secret of secrets) {
    if (!secret) continue
    out = out.split(secret).join(MASK)
    // A credential placed in a URL arrives percent-encoded, so the raw split
    // above would miss it.
    const encoded = encodeURIComponent(secret)
    if (encoded !== secret) out = out.split(encoded).join(MASK)
  }
  return out
}

function scrubHeaderValues(
  headers: Record<string, string>,
  secrets: string[],
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    out[key] = scrubSecrets(value, secrets)
  }
  return out
}
