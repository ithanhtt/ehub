import 'server-only'

import { eq } from 'drizzle-orm'
import { db } from '@/core/db/client'
import { apiCallLogs, connections } from '@/core/db/schema/connections'
import { decryptJson } from '@/core/crypto/secrets'
import { createId } from '@/core/utils/id'
import { readPath, sendRequest, type HttpResult } from './http'
import { coerceParams, validateParams, type ParamValues } from './params'
import { buildRequestEcho, secretValuesOf, type RequestEcho } from './redact'
import { requireEndpoint, requirePlugin } from './registry'
import type { ConnectionContext, EndpointSpec } from './types'

export interface ExecuteArgs {
  connectionId: string
  projectId: string
  endpointId: string
  params: ParamValues
  actorId: string
  /** Skip persisting a log row — used by connection tests, which log separately. */
  skipLog?: boolean
}

export interface ExecuteResult {
  ok: boolean
  status: number
  durationMs: number
  bytes: number
  data: unknown
  error?: string
  /** Records extracted via EndpointSpec.resultPath, when the endpoint declares one. */
  records?: unknown[]
  recordCount?: number
  /** The outbound request with credentials removed, for the "Request" tab. */
  request: RequestEcho
  logId?: string
}

const PREVIEW_MAX_BYTES = 8_000

/**
 * The single path from "user pressed Send" to "provider responded".
 *
 * Credentials are decrypted here and nowhere else, and the decrypted bag never
 * leaves this function: the returned request echo is redacted before it goes
 * back to the client. Every call is logged with timing and status so quota
 * problems and provider outages are visible after the fact.
 */
export async function executeEndpoint(args: ExecuteArgs): Promise<ExecuteResult> {
  const [connection] = await db
    .select()
    .from(connections)
    .where(eq(connections.id, args.connectionId))
    .limit(1)

  if (!connection || connection.projectId !== args.projectId) {
    throw new Error('CONNECTION_NOT_FOUND')
  }

  const plugin = requirePlugin(connection.pluginId)
  const endpoint = requireEndpoint(connection.pluginId, args.endpointId)

  const context: ConnectionContext = {
    credentials: connection.credentials ? decryptJson(connection.credentials) : {},
    metadata: connection.metadata ?? {},
    connectionId: connection.id,
    projectId: connection.projectId,
  }

  // Order matters: the connector first supplies whatever the connection can
  // provide, and only then is the complete param set validated. Validating
  // first would reject a request that was in fact about to be complete.
  const typed = coerceParams(endpoint, args.params)
  const values = plugin.resolveParams
    ? plugin.resolveParams({ endpoint, params: typed, context })
    : typed

  const issues = validateParams(endpoint, values)
  if (issues.length > 0) {
    return {
      ok: false,
      status: 0,
      durationMs: 0,
      bytes: 0,
      data: null,
      error: issues.map((i) => i.message).join(' '),
      request: { method: endpoint.method, url: endpoint.path, headers: {} },
    }
  }

  // A connector may gather one answer from several requests (runEndpoint);
  // everything after this point — errors, records, the log — treats it as one.
  const gathered = (await plugin.runEndpoint?.({ endpoint, params: values, context })) ?? null
  const prepared = gathered?.prepared ?? plugin.buildRequest({ endpoint, params: values, context })
  const result = gathered?.result ?? (await sendRequest(prepared))

  // Providers such as TikTok Ads answer 200 with a non-zero code in the body;
  // without this the Hub would show a green result for a failed call.
  const bodyError = plugin.parseError?.(result.status, result.data) ?? null
  const ok = result.ok && !bodyError
  const error = bodyError ?? result.error

  const { records, recordCount } = extractRecords(endpoint, result)

  const redactedRequest = buildRequestEcho(
    prepared,
    secretValuesOf(plugin.auth.fields, context.credentials),
  )

  let logId: string | undefined
  if (!args.skipLog) {
    logId = await writeLog({
      connection,
      endpoint,
      values,
      result,
      ok,
      error,
      url: redactedRequest.url,
      actorId: args.actorId,
    })
  }

  return {
    ok,
    status: result.status,
    durationMs: result.durationMs,
    bytes: result.bytes,
    data: result.data,
    error,
    records,
    recordCount,
    request: redactedRequest,
    logId,
  }
}

function extractRecords(endpoint: EndpointSpec, result: HttpResult) {
  if (!endpoint.resultPath || !result.ok) return { records: undefined, recordCount: undefined }
  const extracted = readPath(result.data, endpoint.resultPath)
  if (!Array.isArray(extracted)) return { records: undefined, recordCount: undefined }
  return { records: extracted, recordCount: extracted.length }
}

async function writeLog(input: {
  connection: typeof connections.$inferSelect
  endpoint: EndpointSpec
  values: ParamValues
  result: HttpResult
  ok: boolean
  error?: string
  url: string
  actorId: string
}): Promise<string> {
  const id = createId('log')
  await db.insert(apiCallLogs).values({
    id,
    projectId: input.connection.projectId,
    connectionId: input.connection.id,
    pluginId: input.connection.pluginId,
    endpointId: input.endpoint.id,
    method: input.endpoint.method,
    url: input.url,
    params: input.values as Record<string, unknown>,
    ok: input.ok ? 'true' : 'false',
    statusCode: input.result.status || null,
    durationMs: input.result.durationMs,
    responseBytes: input.result.bytes,
    responsePreview: truncatePreview(input.result.data),
    errorMessage: input.error ?? null,
    createdById: input.actorId,
  })
  return id
}

/** Keeps log rows small: a huge report response would bloat the table fast. */
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

/** Shared by the connections screen; keeps decryption in this module only. */
export async function testConnection(connectionId: string, projectId: string) {
  const [connection] = await db
    .select()
    .from(connections)
    .where(eq(connections.id, connectionId))
    .limit(1)

  if (!connection || connection.projectId !== projectId) throw new Error('CONNECTION_NOT_FOUND')

  const plugin = requirePlugin(connection.pluginId)
  const context: ConnectionContext = {
    credentials: connection.credentials ? decryptJson(connection.credentials) : {},
    metadata: connection.metadata ?? {},
    connectionId: connection.id,
    projectId: connection.projectId,
  }

  let outcome
  try {
    outcome = await plugin.testConnection(context)
  } catch (error) {
    outcome = { ok: false, message: error instanceof Error ? error.message : String(error) }
  }

  await db
    .update(connections)
    .set({
      status: outcome.ok ? 'connected' : 'error',
      lastTestedAt: new Date(),
      lastTestStatus: outcome.ok ? 'ok' : 'failed',
      lastTestMessage: outcome.message.slice(0, 500),
      lastTestHint: outcome.hint ?? null,
      metadata: outcome.metadata ? { ...context.metadata, ...outcome.metadata } : context.metadata,
      updatedAt: new Date(),
    })
    .where(eq(connections.id, connection.id))

  return outcome
}
