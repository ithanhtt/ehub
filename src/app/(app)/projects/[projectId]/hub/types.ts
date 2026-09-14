import type { RequestEcho } from '@/core/plugins/redact'

/** Shape returned by POST /api/hub/execute, shared by the Hub and its panels. */
export type ExecuteResponse = {
  ok: boolean
  status: number
  durationMs: number
  bytes: number
  data: unknown
  error?: string
  records?: unknown[]
  recordCount?: number
  request: RequestEcho
}

export type Tab = 'response' | 'records' | 'schema' | 'request'

export const METHOD_COLOR: Record<string, 'success' | 'primary' | 'warning' | 'error'> = {
  GET: 'success',
  POST: 'primary',
  PUT: 'warning',
  DELETE: 'error',
}
