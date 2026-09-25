import 'server-only'

import { and, eq } from 'drizzle-orm'
import { db } from '@/core/db/client'
import { apiCallLogs, connections } from '@/core/db/schema/connections'
import { createId } from '@/core/utils/id'
import { freshContext } from './fresh-credentials'
import { buildQueryString, readPath, sendRequest } from './http'
import { buildRequestEcho, secretValuesOf, type RequestEcho } from './redact'
import { requirePlugin } from './registry'
import { isAllowedMethod, resolveCustomPath, SAFE_METHODS, type CustomMethod } from './custom-path'
import type { ConnectionContext } from './types'

export interface CustomRequestInput {
  projectId: string
  connectionId: string
  method: string
  /** Relative to the connector's base URL. Absolute URLs are refused. */
  path: string
  query?: Record<string, string>
  /** Raw JSON body text, for non-GET methods. */
  body?: string
  /** Dotted path to the array of records, when the caller knows it. */
  resultPath?: string
  actorId: string
}

export interface CustomRequestResult {
  ok: boolean
  status: number
  durationMs: number
  bytes: number
  data: unknown
  error?: string
  records?: unknown[]
  recordCount?: number
  request: RequestEcho
  logId?: string
}

export type CustomRequestRejection =
  | 'CONNECTION_NOT_FOUND'
  | 'BAD_METHOD'
  | 'BAD_BODY'
  | `PATH_${Uppercase<string>}`

export class CustomRequestError extends Error {
  constructor(public readonly reason: string) {
    super(reason)
    this.name = 'CustomRequestError'
  }
}

const PREVIEW_MAX_BYTES = 8_000

/**
 * Sends a request the catalogue does not describe.
 *
 * This is what makes the Hub usable against a provider's whole API without a
 * code change for every endpoint — neither TikTok nor Sapo publishes a machine
 * readable spec, so a hand-written catalogue can never be complete.
 *
 * It reuses the declared-endpoint pipeline deliberately: same credential
 * decryption, same redaction of the echoed request, same call log. An ad-hoc
 * call is not a side door — it is auditable on exactly the same terms.
 *
 * The path is resolved against the connector's own base URL and verified to
 * stay inside it (see custom-path.ts). Without that, letting a user shape a
 * URL that carries the connection's credentials would be an SSRF primitive.
 */
export async function executeCustomRequest(
  input: CustomRequestInput,
): Promise<CustomRequestResult> {
  const method = input.method.toUpperCase()
  if (!isAllowedMethod(method)) throw new CustomRequestError('BAD_METHOD')

  const [connection] = await db
    .select()
    .from(connections)
    .where(and(eq(connections.id, input.connectionId), eq(connections.projectId, input.projectId)))
    .limit(1)
  if (!connection) throw new CustomRequestError('CONNECTION_NOT_FOUND')

  const plugin = requirePlugin(connection.pluginId)

  const context: ConnectionContext = await freshContext(connection)

  let baseUrl: string
  try {
    baseUrl = plugin.resolveBaseUrl(context)
  } catch (error) {
    throw new CustomRequestError(error instanceof Error ? error.message : 'BAD_BASE_URL')
  }

  const resolved = resolveCustomPath(baseUrl, input.path)
  if (!resolved.ok) throw new CustomRequestError(`PATH_${resolved.reason.toUpperCase()}`)

  let body: string | undefined
  if (!SAFE_METHODS.has(method) && input.body?.trim()) {
    try {
      // Re-serialise so a malformed body fails here rather than at the provider.
      body = JSON.stringify(JSON.parse(input.body))
    } catch {
      throw new CustomRequestError('BAD_BODY')
    }
  }

  const query = input.query ?? {}
  const headers = plugin.customHeaders
    ? plugin.customHeaders(context)
    : { 'Content-Type': 'application/json' }

  const unsigned = {
    url: `${resolved.url}${buildQueryString(query)}`,
    method,
    headers,
    body,
  }
  // A connector that signs each request (over its path, query and body) signs this one too.
  const prepared = (await plugin.prepareCustomRequest?.(unsigned, context)) ?? unsigned
  // The checked boundary holds whatever the connector did: same origin, same path.
  const before = new URL(unsigned.url)
  const after = new URL(prepared.url)
  if (after.origin !== before.origin || after.pathname !== before.pathname) {
    throw new CustomRequestError('PATH_ESCAPES-BASE')
  }

  const result = await sendRequest(prepared)
  const bodyError = plugin.parseError?.(result.status, result.data) ?? null
  const ok = result.ok && !bodyError
  const error = bodyError ?? result.error

  let records: unknown[] | undefined
  if (ok && input.resultPath) {
    const extracted = readPath(result.data, input.resultPath)
    if (Array.isArray(extracted)) records = extracted
  }

  const echo = buildRequestEcho(prepared, secretValuesOf(plugin.auth.fields, context.credentials))

  const logId = createId('log')
  await db.insert(apiCallLogs).values({
    id: logId,
    projectId: connection.projectId,
    connectionId: connection.id,
    pluginId: connection.pluginId,
    // Marked so the log makes it obvious this was not a catalogue endpoint.
    endpointId: `custom:${method} ${input.path}`.slice(0, 200),
    method,
    url: echo.url,
    params: query,
    ok: ok ? 'true' : 'false',
    statusCode: result.status || null,
    durationMs: result.durationMs,
    responseBytes: result.bytes,
    responsePreview: truncatePreview(result.data),
    errorMessage: error ?? null,
    createdById: input.actorId,
  })

  return {
    ok,
    status: result.status,
    durationMs: result.durationMs,
    bytes: result.bytes,
    data: result.data,
    error,
    records,
    recordCount: records?.length,
    request: echo,
    logId,
  }
}

function truncatePreview(data: unknown): unknown {
  try {
    const json = JSON.stringify(data)
    if (json === undefined) return null
    if (json.length <= PREVIEW_MAX_BYTES) return data
    return { __truncated: true, bytes: json.length, preview: json.slice(0, PREVIEW_MAX_BYTES) }
  } catch {
    return { __unserialisable: true }
  }
}

export { SAFE_METHODS, type CustomMethod }
