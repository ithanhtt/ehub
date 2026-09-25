import 'server-only'

import type { PreparedRequest } from './types'

export interface HttpResult {
  ok: boolean
  status: number
  durationMs: number
  bytes: number
  /** Parsed JSON when the response was JSON, otherwise the raw text. */
  data: unknown
  contentType: string | null
  error?: string
}

const DEFAULT_TIMEOUT_MS = 30_000
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])

export interface SendOptions {
  timeoutMs?: number
  maxRetries?: number
  /**
   * Whether sending the request twice is harmless. A dropped connection
   * (reset, refused, DNS hiccup) is retried only then: the provider may have
   * acted on the first copy. Defaults to true for GET and HEAD; a POST that
   * only reads (a search) says so.
   */
  idempotent?: boolean
}

/** Node's codes for a connection that failed on the way, not a request the provider refused. */
const TRANSIENT_NETWORK = new Set(['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT'])

const causeCode = (error: unknown) => (error as { cause?: { code?: string } } | null)?.cause?.code

/**
 * Secrets never leave in an error: a token, key, secret or signature in a URL
 * or a message is masked before the text reaches a log, the database or the page.
 */
export function redactSecrets(text: string): string {
  return text.replace(/(\b(?:access_?token|refresh_?token|app_?secret|client_?secret|secret|api_?key|password|sign|signature|auth_?code)=)[^&\s"']+/gi, '$1***')
}

/**
 * One place where every outbound provider call happens.
 *
 * Centralising it buys three things the connectors would otherwise each
 * reimplement: a hard timeout (a hung ad platform must not hold a Next server
 * worker open), backoff on the throttling statuses every ad API uses, and a
 * uniform result shape so the Hub renders failures the same way regardless of
 * provider.
 */
export async function sendRequest(request: PreparedRequest, options: SendOptions = {}): Promise<HttpResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxRetries = options.maxRetries ?? 2
  const method = (request.method ?? 'GET').toUpperCase()
  const idempotent = options.idempotent ?? (method === 'GET' || method === 'HEAD')
  const started = Date.now()

  let attempt = 0
  let lastError: string | undefined

  while (attempt <= maxRetries) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        signal: controller.signal,
        cache: 'no-store',
      })

      const contentType = response.headers.get('content-type')
      const text = await response.text()
      const bytes = Buffer.byteLength(text, 'utf8')

      let data: unknown = text
      if (contentType?.includes('json') || looksLikeJson(text)) {
        try {
          data = JSON.parse(text)
        } catch {
          /* keep the raw text; a malformed body is itself the diagnostic */
        }
      }

      if (RETRYABLE_STATUS.has(response.status) && attempt < maxRetries) {
        clearTimeout(timer)
        await backoff(attempt, response.headers.get('retry-after'))
        attempt += 1
        continue
      }

      clearTimeout(timer)
      return {
        ok: response.ok,
        status: response.status,
        durationMs: Date.now() - started,
        bytes,
        data,
        contentType,
        error: response.ok ? undefined : `HTTP ${response.status} ${response.statusText}`.trim(),
      }
    } catch (error) {
      clearTimeout(timer)
      const aborted = error instanceof Error && error.name === 'AbortError'
      lastError = aborted ? `Request timed out after ${timeoutMs}ms` : redactSecrets(describeError(error))

      // A timeout usually means the provider is degraded, not that the request
      // is wrong, so it is worth one more try — but never more than the budget.
      // A dropped connection too, when sending again cannot act twice.
      const dropped = idempotent && TRANSIENT_NETWORK.has(causeCode(error) ?? '')
      if (attempt < maxRetries && (aborted || dropped)) {
        await backoff(attempt, null)
        attempt += 1
        continue
      }
      break
    }
  }

  return {
    ok: false,
    status: 0,
    durationMs: Date.now() - started,
    bytes: 0,
    data: null,
    contentType: null,
    error: lastError ?? 'Request failed',
  }
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trimStart()
  return trimmed.startsWith('{') || trimmed.startsWith('[')
}

async function backoff(attempt: number, retryAfter: string | null): Promise<void> {
  // Honour Retry-After when the provider sends one; ad APIs return it on 429.
  const headerDelay = retryAfter ? Number(retryAfter) * 1000 : NaN
  const delay = Number.isFinite(headerDelay)
    ? Math.min(headerDelay, 10_000)
    : Math.min(2 ** attempt * 500 + Math.random() * 250, 8_000)
  await new Promise((resolve) => setTimeout(resolve, delay))
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    // Node wraps DNS/TLS failures in a generic message; the cause carries the detail.
    const cause = (error as { cause?: { code?: string; message?: string } }).cause
    if (cause?.code) return `${error.message} (${cause.code})`
    return error.message
  }
  return String(error)
}

/* ------------------------------------------------------------- utilities --- */

/** Reads "data.list" out of a nested response without a lodash dependency. */
export function readPath(source: unknown, path?: string): unknown {
  if (!path) return source
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key]
    }
    return undefined
  }, source)
}

export function buildQueryString(params: Record<string, unknown>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    // Ad platforms differ on array encoding; JSON is the form TikTok and
    // Sapo both accept, and connectors override when a provider needs repeats.
    search.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value))
  }
  const qs = search.toString()
  return qs ? `?${qs}` : ''
}
