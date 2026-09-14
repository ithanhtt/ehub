import type { EndpointSpec, ParamSpec } from './types'

/**
 * Param handling shared by the browser form and the server executor.
 *
 * Deliberately isomorphic: the Hub form gives instant feedback with the same
 * rules the server enforces, so a request can never look valid in the UI and
 * be rejected on submit for a different reason.
 */

export type ParamValues = Record<string, unknown>

export interface ValidationIssue {
  key: string
  code: 'required' | 'type' | 'enum' | 'json'
  message: string
}

/** Turns raw form strings into the types the connector expects. */
export function coerceParam(spec: ParamSpec, raw: unknown): unknown {
  if (raw === undefined || raw === null || raw === '') return undefined

  switch (spec.type) {
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).trim())
      return Number.isFinite(n) ? n : Number.NaN
    }
    case 'boolean':
      if (typeof raw === 'boolean') return raw
      return ['true', '1', 'yes', 'on'].includes(String(raw).toLowerCase())
    case 'string[]':
      if (Array.isArray(raw)) return raw.map(String).filter(Boolean)
      return String(raw)
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean)
    case 'json':
      if (typeof raw === 'object') return raw
      try {
        return JSON.parse(String(raw))
      } catch {
        return { __invalidJson: String(raw) }
      }
    case 'date':
    case 'enum':
    case 'string':
    default:
      return typeof raw === 'string' ? raw.trim() : raw
  }
}

export function coerceParams(endpoint: EndpointSpec, raw: ParamValues): ParamValues {
  const out: ParamValues = {}
  for (const spec of endpoint.params) {
    const value = coerceParam(spec, raw[spec.key] ?? spec.defaultValue)
    if (value !== undefined) out[spec.key] = value
  }
  return out
}

export interface ValidateOptions {
  /**
   * Set by the browser, which cannot see the connection's credentials: skips
   * the required check on params the connector fills in server-side, so the
   * form does not block on a value the request will actually have.
   */
  trustConnection?: boolean
}

export function validateParams(
  endpoint: EndpointSpec,
  values: ParamValues,
  options: ValidateOptions = {},
): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  for (const spec of endpoint.params) {
    const value = values[spec.key]
    const isEmpty = value === undefined || value === '' || (Array.isArray(value) && value.length === 0)
    const deferred = options.trustConnection && spec.satisfiedByConnection

    if (spec.required && isEmpty && !deferred) {
      issues.push({ key: spec.key, code: 'required', message: `"${spec.label.en}" is required.` })
      continue
    }
    if (value === undefined) continue

    if (spec.type === 'number' && Number.isNaN(value)) {
      issues.push({ key: spec.key, code: 'type', message: `"${spec.label.en}" must be a number.` })
    }
    if (spec.type === 'json' && typeof value === 'object' && value !== null && '__invalidJson' in value) {
      issues.push({ key: spec.key, code: 'json', message: `"${spec.label.en}" is not valid JSON.` })
    }
    if (spec.type === 'enum' && spec.options && !spec.options.some((o) => o.value === value)) {
      issues.push({ key: spec.key, code: 'enum', message: `"${spec.label.en}" must be one of the listed values.` })
    }
  }

  return issues
}

/** Splits coerced values by where the connector must place them. */
export function partitionParams(endpoint: EndpointSpec, values: ParamValues) {
  const query: ParamValues = {}
  const body: ParamValues = {}
  const path: ParamValues = {}
  const header: Record<string, string> = {}

  for (const spec of endpoint.params) {
    const value = values[spec.key]
    if (value === undefined) continue
    if (spec.in === 'query') query[spec.key] = value
    else if (spec.in === 'body') body[spec.key] = value
    else if (spec.in === 'path') path[spec.key] = value
    else header[spec.key] = String(value)
  }

  return { query, body, path, header }
}

/** Replaces `/orders/{id}.json` style placeholders. */
export function applyPathParams(template: string, path: ParamValues): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = path[key]
    return value === undefined ? match : encodeURIComponent(String(value))
  })
}

export function defaultValuesFor(endpoint: EndpointSpec): ParamValues {
  const out: ParamValues = {}
  for (const spec of endpoint.params) {
    if (spec.defaultValue !== undefined) out[spec.key] = spec.defaultValue
  }
  return out
}
