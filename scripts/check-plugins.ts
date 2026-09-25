/**
 * Plugin contract check — `npm run check:plugins`.
 *
 * The point of the plugin architecture is that adding a provider cannot break
 * the others. That guarantee needs enforcing, not just documenting: this
 * script loads every registered plugin and asserts the parts of the contract
 * the type system cannot express — that ids are unique and URL-safe, that
 * required params are declared, that `buildRequest` produces an absolute URL
 * with authentication attached, and above all that no credential ever appears
 * in the redacted echo the UI and the logs display.
 *
 * It touches no database and makes no network calls, so it is safe to run in
 * CI and on every plugin change.
 */
import { encryptJson, decryptJson, maskSecret } from '@/core/crypto/secrets'
import { listPlugins, listCatalog, requireEndpoint, requirePlugin, toActionSummary } from '@/core/plugins/registry'
import { coerceParams, validateParams } from '@/core/plugins/params'
import { buildRequestEcho, secretValuesOf } from '@/core/plugins/redact'
import type { ConnectionContext, EndpointSpec } from '@/core/plugins/types'
import { LIST_PERMISSIONS_HINTS } from '@/core/plugins/list-permissions'
import { minimalProbeParams, summariseProbe } from '@/core/plugins/probe-catalog'
import type { EndpointProbe } from '@/core/plugins/probe-catalog'
import viMessages from '../messages/vi.json'
import enMessages from '../messages/en.json'

const VI_HINTS = viMessages.connections.hints as Record<string, string>
const EN_HINTS = enMessages.connections.hints as Record<string, string>

/** "tiktok-ads" -> "tiktok", the prefix its hint keys must carry. */
function camelPrefix(pluginId: string): string {
  return pluginId.split('-')[0]
}

let failures = 0
let checks = 0

function check(condition: unknown, label: string, detail?: string): void {
  checks += 1
  if (condition) {
    console.log(`  \x1b[32m✓\x1b[0m ${label}`)
    return
  }
  failures += 1
  console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? ` — ${detail}` : ''}`)
}

/* ------------------------------------------------------- crypto envelope --- */

console.log('\n\x1b[36mCredential encryption\x1b[0m')
{
  process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64')

  const secret = { accessToken: 'tok_live_abcdef123456', appSecret: 'sec_xyz' }
  const envelope = encryptJson(secret)

  check(envelope.startsWith('v1:'), 'envelope is versioned')
  check(!envelope.includes('tok_live'), 'plaintext is absent from the envelope')
  check(
    JSON.stringify(decryptJson(envelope)) === JSON.stringify(secret),
    'round-trips back to the original bag',
  )
  check(encryptJson(secret) !== envelope, 'same input yields a different ciphertext (fresh IV)')
  check(maskSecret('sk_live_abcd1234') === 'sk_l…1234', 'masking keeps only the outer characters')

  let tamperRejected = false
  try {
    // Flip a byte of the ciphertext; GCM must refuse it rather than return garbage.
    const parts = envelope.split(':')
    const buf = Buffer.from(parts[3], 'base64')
    buf[0] ^= 0xff
    parts[3] = buf.toString('base64')
    decryptJson(parts.join(':'))
  } catch {
    tamperRejected = true
  }
  check(tamperRejected, 'a tampered envelope is rejected')
}

/* ------------------------------------------------------------- registry --- */

console.log('\n\x1b[36mRegistry\x1b[0m')
const plugins = listPlugins()
check(plugins.length > 0, `at least one plugin is registered (${plugins.length})`)
check(
  new Set(plugins.map((p) => p.id)).size === plugins.length,
  'plugin ids are unique',
)
check(listCatalog().length > 0, `catalogue is non-empty (${listCatalog().length} endpoints)`)
check(
  JSON.stringify(Object.keys(VI_HINTS).sort()) === JSON.stringify(Object.keys(EN_HINTS).sort()),
  'the vi and en hint bundles declare the same keys',
)

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/

for (const plugin of plugins) {
  console.log(`\n\x1b[36m${plugin.name}\x1b[0m \x1b[2m(${plugin.id} v${plugin.version})\x1b[0m`)

  check(ID_PATTERN.test(plugin.id), 'id is lowercase and URL-safe')
  check(Boolean(plugin.description.vi && plugin.description.en), 'description is translated')
  check(plugin.auth.fields.length > 0, 'declares at least one auth field')
  check(
    plugin.auth.fields.some((f) => f.required),
    'declares at least one required auth field',
  )
  check(
    plugin.auth.fields
      .filter((f) => /token|secret|password|apikey/i.test(f.key))
      .every((f) => f.secret),
    'every credential-shaped field is marked secret',
  )
  check(
    plugin.auth.fields.filter((f) => f.type === 'password').every((f) => f.secret),
    'every password field is marked secret so it is encrypted and masked',
  )
  check(plugin.endpoints.length > 0, `declares endpoints (${plugin.endpoints.length})`)

  /*
   * A guide is read by someone half-way through a cloud console: a line
   * missing in their language, or a copy step naming a field the form does
   * not have, strands them there.
   */
  if (plugin.auth.guide) {
    const guide = plugin.auth.guide
    const texts: Array<{ vi: string; en: string }> = [
      ...guide.methods.flatMap((m) => [
        m.label,
        ...(m.badge ? [m.badge] : []),
        ...(m.summary ? [m.summary] : []),
        ...m.steps.flatMap((s) => [
          s.title,
          ...s.lines,
          ...(s.links ?? []).map((l) => l.label),
          ...(s.caution ? [s.caution] : []),
          ...(s.copy ? [s.copy.label, s.copy.pending] : []),
        ]),
      ]),
      ...(guide.references ?? []).flatMap((r) => [r.title, ...r.columns, ...r.rows.flat(), ...(r.note ? [r.note] : [])]),
      ...(guide.troubleshooting ?? []).flatMap((t) => [t.problem, t.fix]),
    ]
    check(texts.every((x) => x.vi.trim() && x.en.trim()), `every line of the connection guide is translated (${texts.length})`)
    check(
      guide.methods.flatMap((m) => m.steps).every((s) => !s.copy?.field || plugin.auth.fields.some((f) => f.key === s.copy!.field!.key)),
      'every guide step that copies from the form names a real field',
    )
    check(
      guide.methods.flatMap((m) => m.steps).flatMap((s) => s.links ?? []).every((l) => /^https:\/\//.test(l.href)),
      'every guide link is https',
    )
    check((guide.references ?? []).every((r) => r.rows.every((row) => row.length === r.columns.length)), 'every guide table row has one cell per column')
  }

  const endpointIds = plugin.endpoints.map((e) => e.id)
  check(new Set(endpointIds).size === endpointIds.length, 'endpoint ids are unique')
  check(endpointIds.every((id) => ID_PATTERN.test(id)), 'endpoint ids are URL-safe')
  check(
    plugin.endpoints.every((e) => e.name.vi && e.name.en),
    'every endpoint name is translated',
  )
  check(
    plugin.endpoints.every((e) => e.group.length > 0),
    'every endpoint declares a group',
  )
  check(
    plugin.endpoints.every((e) => e.path.startsWith('/')),
    'endpoint paths are relative to the provider base URL',
  )

  /*
   * Two entries for one path is not a harmless duplicate: the Hub and the
   * permission probe both take the first match, so a bulk-declared entry can
   * quietly shadow a curated one that had real params attached, and the
   * catalogue keeps claiming both exist.
   */
  const paths = plugin.endpoints.map((e) => `${e.method} ${e.path}`)
  const duplicatePaths = paths.filter((path, i) => paths.indexOf(path) !== i)
  check(
    duplicatePaths.length === 0,
    'no two endpoints declare the same method and path',
    [...new Set(duplicatePaths)].join(', '),
  )

  /*
   * The path names the operation, so the path is what the declaration is
   * checked against.
   *
   * This regex is deliberately a second, independent statement of the rule
   * that endpoints-declared.ts enforces at import time. Importing that
   * module's copy would make the check agree with the code by construction and
   * prove nothing; spelling it out again means relaxing the rule in one place
   * fails here.
   *
   * The cost of being wrong is one-sided. A write path declared GET is not a
   * broken form: it is a live call the permission probe makes against a real
   * ad account, unprompted, because the probe trusts `method` and `mutating`
   * to tell it what is safe.
   */
  const WRITE_VERB =
    /\/(create|update|delete|add|assign|unassign|bind|unbind|invite|disable|submit|appeal|share|authorize|authorization|subscribe|unsubscribe|review|attribute)\/$/
  const writeShapedReads = plugin.endpoints.filter(
    (e) => WRITE_VERB.test(e.path) && (e.method === 'GET' || !e.mutating),
  )
  check(
    writeShapedReads.length === 0,
    'every endpoint whose path names a write operation is non-GET and marked mutating',
    writeShapedReads.map((e) => `${e.method} ${e.path}`).join(', '),
  )

  /*
   * `unverified` is a claim about what is *not* known, so it must not sit next
   * to claims that require knowing. `pagination` says the Hub can walk the
   * collection; `idField` names the key it upserts on. Declaring either from a
   * path alone would make a dataset re-sync overwrite rows by position.
   */
  const overclaimed = plugin.endpoints.filter((e) => e.unverified && (e.pagination || e.idField))
  check(
    overclaimed.length === 0,
    'an unverified endpoint claims neither a pagination contract nor an id field',
    overclaimed.map((e) => e.id).join(', '),
  )
  check(
    // Snake case for TikTok and Sapo, camel case for Google (valueRenderOption) — the provider's own names.
    plugin.endpoints.every((e) => e.params.every((p) => ID_PATTERN.test(p.key) || /^[A-Za-z0-9_]+$/.test(p.key))),
    'param keys are provider-safe',
  )
  check(
    plugin.endpoints.every((e) =>
      e.params.filter((p) => p.type === 'enum').every((p) => (p.options?.length ?? 0) > 0),
    ),
    'enum params list their options',
  )
  check(
    plugin.endpoints
      .filter((e) => e.resultPath && e.pagination && !e.id.includes('report'))
      .every((e) => Boolean(e.idField)),
    'paginated collection endpoints declare an id field (reports excepted)',
  )

  /* ---------------------------------------------------- buildRequest ----- */

  // Recognisable dummies: if any of these strings reaches a redacted echo,
  // the assertion below catches it.
  const credentials: Record<string, string> = {}
  for (const field of plugin.auth.fields) {
    credentials[field.key] = field.key === 'storeDomain' ? 'demo.mysapo.net' : `LEAK-${field.key}`
  }

  const context: ConnectionContext = {
    credentials,
    metadata: {},
    connectionId: 'con_check',
    projectId: 'prj_check',
  }

  let built = 0
  let absoluteUrls = 0
  let authenticated = 0
  let leaked: string[] = []
  let placeholdersLeft: string[] = []

  for (const endpoint of plugin.endpoints) {
    // Fill every param with a plausible value so path templates resolve.
    const raw: Record<string, unknown> = {}
    for (const spec of endpoint.params) {
      raw[spec.key] =
        spec.defaultValue ??
        (spec.type === 'number'
          ? 1
          : spec.type === 'date'
            ? '2026-01-01'
            : spec.type === 'json'
              ? {}
              : spec.type === 'string[]'
                ? ['a']
                : spec.type === 'enum'
                  ? (spec.options?.[0]?.value ?? 'x')
                  : spec.type === 'boolean'
                    ? true
                    : '123')
    }

    const params = coerceParams(endpoint, raw)
    const issues = validateParams(endpoint, params)
    if (issues.length > 0) {
      failures += 1
      console.log(`  \x1b[31m✗\x1b[0m ${endpoint.id}: filled params still invalid — ${issues[0].message}`)
      continue
    }

    const request = plugin.buildRequest({ endpoint, params, context })
    built += 1

    if (/^https:\/\//.test(request.url)) absoluteUrls += 1
    if (
      Object.keys(request.headers).some((h) => /token|authorization|access/i.test(h)) ||
      /access_token|api_key/i.test(request.url)
    ) {
      authenticated += 1
    }
    if (/\{[a-z_]+\}/i.test(request.url)) placeholdersLeft.push(endpoint.id)

    // Assert on the echo the Hub renders and the call log stores. The raw
    // request legitimately carries the token; the displayed copy must not.
    const shown = buildRequestEcho(request, secretValuesOf(plugin.auth.fields, credentials))
    const echo = `${shown.url} ${JSON.stringify(shown.headers)} ${shown.body ?? ''}`

    for (const field of plugin.auth.fields) {
      const value = credentials[field.key]
      if (!field.secret || !value) continue
      if (echo.includes(value)) leaked.push(`${endpoint.id}:${field.key}`)
    }

    // Redaction must not go so far that the echo stops being reproducible.
    if (!shown.url.startsWith('https://')) leaked.push(`${endpoint.id}:url-mangled`)
  }

  check(built === plugin.endpoints.length, `buildRequest succeeded for all ${built} endpoints`)
  check(absoluteUrls === built, 'every request targets an absolute https URL')
  check(authenticated === built, 'every request carries authentication')
  check(placeholdersLeft.length === 0, 'no unresolved path placeholders', placeholdersLeft.join(', '))
  check(
    leaked.length === 0,
    'no secret survives into the displayed/logged request echo',
    leaked.join(', '),
  )

  /* ------------------------------------------------- transient inputs --- */

  const transientFields = plugin.auth.fields.filter((f) => f.transient)
  if (transientFields.length > 0) {
    // A transient value is a single-use secret by definition; a non-secret one
    // would be echoed back to the browser as if it were still usable.
    check(
      transientFields.every((f) => f.secret),
      'every transient auth field is marked secret',
      transientFields.filter((f) => !f.secret).map((f) => f.key).join(', '),
    )
    // Nothing stores a transient field, so without a resolver the value the
    // user typed would be silently discarded.
    check(
      typeof plugin.resolveCredentials === 'function',
      'declares resolveCredentials, since it has transient fields to consume',
    )
    check(
      transientFields.every((f) => !f.required),
      'a transient field is not marked required — it is one of several ways in',
      transientFields.filter((f) => f.required).map((f) => f.key).join(', '),
    )
  }

  /* ------------------------------------------------- diagnostic hints --- */

  /*
   * A hint is only useful if it renders. An untranslated key shows the user a
   * blank diagnosis at the exact moment they are stuck on a credential, so
   * both locales have to carry every key the connector can emit.
   */
  if (plugin.hints?.length) {
    const missingVi = plugin.hints.filter((key) => !(key in VI_HINTS))
    const missingEn = plugin.hints.filter((key) => !(key in EN_HINTS))
    check(missingVi.length === 0, 'every declared hint has a Vietnamese translation', missingVi.join(', '))
    check(missingEn.length === 0, 'every declared hint has an English translation', missingEn.join(', '))
    /*
     * Provider-specific hints carry the plugin prefix so two connectors cannot
     * collide. Hints that core owns are shared on purpose — the permission
     * probe is generic — so they are exempted by name rather than by pattern.
     */
    const shared = new Set<string>(LIST_PERMISSIONS_HINTS)
    const misnamed = plugin.hints.filter(
      (key) => !shared.has(key) && !key.startsWith(camelPrefix(plugin.id)),
    )
    check(
      misnamed.length === 0,
      'provider hint keys are namespaced by plugin id, so two connectors cannot collide',
      misnamed.join(', '),
    )
  }

  /* ------------------------------------------------ connector actions --- */

  if (plugin.actions?.length) {
    const actionIds = plugin.actions.map((a) => a.id)
    check(new Set(actionIds).size === actionIds.length, 'action ids are unique')
    check(actionIds.every((id) => ID_PATTERN.test(id)), 'action ids are URL-safe')
    check(
      plugin.actions.every((a) => a.label.vi && a.label.en),
      'every action label is translated',
    )
    check(
      plugin.actions.every((a) => (a.inputs ?? []).every((f) => f.label.vi && f.label.en)),
      'every action input label is translated',
    )
    // An input that carries a bearer secret must be marked so the UI masks it
    // and the runner keeps it out of the audit trail.
    check(
      plugin.actions
        .flatMap((a) => a.inputs ?? [])
        .filter((f) => /token|secret|code|password/i.test(f.key))
        .every((f) => f.secret),
      'credential-shaped action inputs are marked secret',
    )
    check(
      plugin.actions.every((a) => typeof a.run === 'function'),
      'every action implements run()',
    )
    // The summary is what crosses into the browser. A function there would
    // break the RSC boundary, and a stray credential would be worse.
    const summaries = plugin.actions.map(toActionSummary)
    check(
      summaries.every((summary) => Object.values(summary).every((v) => typeof v !== 'function')),
      'action summaries carry no functions into the client payload',
    )
    check(
      summaries.length === plugin.actions.length &&
        summaries.every((summary, i) => summary.id === plugin.actions![i].id),
      'every action survives serialisation',
    )
  }

  /* --------------------------------------------- connection-filled params --- */

  // A required param marked satisfiedByConnection is a promise to the UI: the
  // Send button stays enabled when it is blank. resolveParams must keep that
  // promise, or the request fails validation the user was told to skip.
  const deferrable = plugin.endpoints.filter((e) =>
    e.params.some((p) => p.required && p.satisfiedByConnection),
  )

  if (deferrable.length > 0) {
    const unresolved: string[] = []

    for (const endpoint of deferrable) {
      // Only the non-deferred params are supplied, mimicking a user who left
      // the connection-filled ones empty.
      const raw: Record<string, unknown> = {}
      for (const spec of endpoint.params) {
        if (spec.required && spec.satisfiedByConnection) continue
        if (spec.defaultValue !== undefined) raw[spec.key] = spec.defaultValue
        else if (spec.required) raw[spec.key] = spec.type === 'date' ? '2026-01-01' : '123'
      }

      const typed = coerceParams(endpoint, raw)
      const resolved = plugin.resolveParams
        ? plugin.resolveParams({ endpoint, params: typed, context })
        : typed

      if (validateParams(endpoint, resolved).length > 0) unresolved.push(endpoint.id)
    }

    check(
      typeof plugin.resolveParams === 'function',
      'declares resolveParams, since some params are marked satisfiedByConnection',
    )
    check(
      unresolved.length === 0,
      'every connection-filled param is actually resolved before validation',
      unresolved.join(', '),
    )
  }

  /* ------------------------------------------------------- parseError ---- */

  if (plugin.parseError) {
    check(plugin.parseError(200, { code: 0, message: 'OK' }) === null, 'parseError passes a success body')
    check(
      typeof plugin.parseError(200, { code: 40001, message: 'bad advertiser' }) === 'string' ||
        plugin.id !== 'tiktok-ads',
      'parseError catches an in-body error code',
    )
  }

  check(
    (() => {
      try {
        requireEndpoint(plugin.id, plugin.endpoints[0].id)
        return true
      } catch {
        return false
      }
    })(),
    'endpoints are reachable through the registry',
  )
}

/* ------------------------------------------------------- Sapo catalogue --- */

/*
 * Sapo writes carry the resource's own wrapping key — `{ "order": { … } }` —
 * so the pasted object must reach the provider exactly as pasted. And its
 * pager is `limit`, not `page_size`, which the probe has to recognise or it
 * pulls a real page of orders to learn one bit.
 */
console.log('\n\x1b[36mSapo catalogue\x1b[0m')
{
  const sapo = requirePlugin('sapo')
  const context: ConnectionContext = {
    credentials: { storeDomain: 'demo.mysapo.net', apiKey: 'key', apiSecret: 'secret' },
    metadata: {},
    connectionId: 'con_check',
    projectId: 'prj_check',
  }

  const write: EndpointSpec = {
    id: 'check-write',
    group: 'Order',
    name: { vi: 'x', en: 'x' },
    method: 'PUT',
    path: '/admin/orders/{id}.json',
    mutating: true,
    params: [
      { key: 'id', label: { vi: 'id', en: 'id' }, in: 'path', type: 'string', required: true },
      { key: 'body', label: { vi: 'Body', en: 'Body' }, in: 'body', type: 'json', required: true },
    ],
  }
  const request = sapo.buildRequest({
    endpoint: write,
    params: coerceParams(write, { id: '42', body: { order: { note: 'n' } } }),
    context,
  })
  const payload = JSON.parse(request.body ?? '{}') as Record<string, unknown>
  check((payload.order as { note?: string } | undefined)?.note === 'n', 'a pasted Sapo body is sent as pasted')
  check(!('body' in payload), 'no "body" wrapper key reaches Sapo')
  check(request.url.endsWith('/admin/orders/42.json'), 'the Sapo path id is filled in')

  const declared = sapo.endpoints.filter((e) => e.unverified)
  const list = declared.find((e) => e.method === 'GET' && e.params.some((p) => p.key === 'limit'))!
  check(minimalProbeParams(list).limit === 1, 'a probe of a declared Sapo read asks for a single row')
  check(
    declared.every((e) => e.method === 'GET' || e.method === 'DELETE' || e.params.some((p) => p.key === 'body')),
    'every declared Sapo POST/PUT takes a free-form JSON body',
  )
  // `{id}` and `{order_id}` name the same URL; compare with the names erased.
  check(
    new Set(sapo.endpoints.map((e) => `${e.method} ${e.path.replace(/\{\w+\}/g, '{}')}`)).size ===
      sapo.endpoints.length,
    'no Sapo method and URL is declared twice',
  )
}

/* ---------------------------------------------------- declared catalogue --- */

/*
 * The path-declared entries carry two behaviours no type can express, and both
 * are silent when broken: a body that arrives nested under "body" is rejected
 * by the provider with a message about a missing field, and a probe that
 * forgets page_size pulls a real page of live data to learn one bit.
 */
console.log('\n\x1b[36mDeclared catalogue\x1b[0m')
{
  const tiktok = requirePlugin('tiktok-ads')
  const declared = tiktok.endpoints.filter((e) => e.unverified)

  check(declared.length > 100, `TikTok declares the bulk API surface (${declared.length} paths)`)
  check(
    declared.every((e) => e.method === 'GET' || e.params.some((param) => param.key === 'body')),
    'every declared write endpoint takes a free-form JSON body',
  )

  const context: ConnectionContext = {
    credentials: { appId: 'app', appSecret: 'sec', accessToken: 'tok', advertiserId: '777' },
    metadata: {},
    connectionId: 'con_check',
    projectId: 'prj_check',
  }

  // A write endpoint: the pasted object must land at the top level.
  const write = declared.find((e) => e.method === 'POST' && e.params.some((param) => param.key === 'bc_id'))!
  const writeRequest = tiktok.buildRequest({
    endpoint: write,
    params: coerceParams(write, { bc_id: '123', body: { asset_group_name: 'A' } }),
    context,
  })
  const payload = JSON.parse(writeRequest.body ?? '{}') as Record<string, unknown>

  check(payload.asset_group_name === 'A', 'a pasted body object is spread at the top level')
  check(!('body' in payload), 'no "body" wrapper key reaches the provider')
  check(payload.bc_id === '123', 'the owning param is merged into the same payload')

  // The advertiser chosen on the form must beat a stale id inside the JSON.
  const stale = tiktok.buildRequest({
    endpoint: write,
    params: coerceParams(write, { bc_id: '123', body: { bc_id: '999', x: 1 } }),
    context,
  })
  check(
    (JSON.parse(stale.body ?? '{}') as Record<string, unknown>).bc_id === '123',
    'the declared param wins over a stale id left in the pasted JSON',
  )

  // A read endpoint: the probe must ask for one row, not a page.
  const read = declared.find((e) => e.method === 'GET' && e.params.some((param) => param.key === 'page_size'))!
  const probed = minimalProbeParams(read)
  check(probed.page_size === 1, 'a probe of a declared read endpoint asks for a single row')

  check(
    declared.every((e) => !e.pagination && !e.idField),
    'no declared entry claims a pagination contract or an id field',
  )

  /*
   * With a hundred and fifty endpoints, order is the difference between a
   * report and a wall of text: the refusals are the answer, and a run where
   * everything is permitted must not push them below a hundred "allowed"
   * lines. Counting is checked alongside, because a probe that errored for a
   * missing param says nothing about permission and must never inflate the
   * denied tally.
   */
  const fixture: EndpointProbe[] = [
    { endpointId: 'a', group: 'G', method: 'GET', path: '/a/', state: 'allowed', detail: 'HTTP 200' },
    { endpointId: 'b', group: 'G', method: 'POST', path: '/b/', state: 'skipped', detail: 'write' },
    { endpointId: 'c', group: 'G', method: 'GET', path: '/c/', state: 'denied', detail: '40001' },
    { endpointId: 'd', group: 'G', method: 'GET', path: '/d/', state: 'error', detail: '40002' },
    { endpointId: 'e', group: 'G', method: 'GET', path: '/e/', state: 'denied', detail: '40101' },
  ]
  const summary = summariseProbe(fixture)

  check(
    JSON.stringify(summary.findings.map((f) => f.state)) ===
      JSON.stringify(['fail', 'fail', 'warn', 'ok', 'skipped']),
    'the checklist leads with refusals and ends with what was never tried',
    summary.findings.map((f) => f.state).join(', '),
  )
  check(
    summary.findings[0].detail?.startsWith('c ') === true,
    'catalogue order is preserved inside each group',
    summary.findings[0].detail,
  )
  check(
    summary.allowed === 1 && summary.denied === 2 && summary.skipped === 2,
    'an errored probe counts as not-tried, never as denied',
    `allowed=${summary.allowed} denied=${summary.denied} skipped=${summary.skipped}`,
  )
}

/* ------------------------------------------------------ TikTok Shop sign --- */

/*
 * The signature is the one thing TikTok Shop checks before anything else, and
 * a wrong one reads as "bad credentials". The rule is restated here by hand
 * (Partner Center, "Sign your API request") rather than by calling the
 * plugin's helper twice, so a change to the helper cannot agree with itself.
 */
console.log('\n\x1b[36mTikTok Shop signing\x1b[0m')
{
  const { createHmac } = await import('node:crypto')
  const { signature } = await import('@/plugins/tiktok-shop/sign')
  const secret = 'app-secret'
  const query = { shop_cipher: 'ROW_x', app_key: 'k1', timestamp: '1700000000', sign: 'old', access_token: 'tok', page_size: '100' }
  const body = '{"create_time_ge":1}'
  const expected = createHmac('sha256', secret)
    .update(`${secret}/order/202309/orders/searchapp_keyk1page_size100shop_cipherROW_xtimestamp1700000000${body}${secret}`)
    .digest('hex')
  check(signature('/order/202309/orders/search', query, body, secret) === expected, 'path, sorted params and body are signed, sign and access_token left out')
  check(signature('/authorization/202309/shops', { app_key: 'k1', timestamp: '1' }, undefined, secret).length === 64, 'a GET without a body signs to a hex digest')

  const shop = requirePlugin('tiktok-shop')
  const orders = requireEndpoint('tiktok-shop', 'orders-search')
  const built = shop.buildRequest({
    endpoint: orders,
    params: coerceParams(orders, { shop_cipher: 'ROW_x', page_size: 50, create_time_ge: 1700000000 }),
    context: { credentials: { appKey: 'k1', appSecret: secret, accessToken: 'tok' }, metadata: {}, connectionId: 'con_check', projectId: 'prj_check' },
  })
  const url = new URL(built.url)
  const signed = Object.fromEntries(url.searchParams.entries())
  check(
    signed.sign === signature(url.pathname, signed, built.body, secret),
    'the URL carries the signature of exactly the query and body it sends',
  )
  check(!url.searchParams.has('access_token') && built.headers['x-tts-access-token'] === 'tok', 'the token travels in its header, never the URL')
  const shops = requireEndpoint('tiktok-shop', 'shops')
  const unscoped = new URL(shop.buildRequest({ endpoint: shops, params: { shop_cipher: 'ROW_x' }, context: { credentials: { appKey: 'k1', appSecret: secret, accessToken: 'tok' }, metadata: {}, connectionId: 'c', projectId: 'p' } }).url)
  check(!unscoped.searchParams.has('shop_cipher'), 'the authorization call is sent without shop_cipher')

  // The path-declared catalogue: free-form query and body, the typed params winning over pasted ones.
  const context = { credentials: { appKey: 'k1', appSecret: secret, accessToken: 'tok' }, metadata: { shopCipher: 'ROW_x' }, connectionId: 'c', projectId: 'p' }
  const declaredShop = shop.endpoints.filter((e) => e.unverified)
  check(declaredShop.length > 100, `TikTok Shop declares the wider Partner API (${declaredShop.length} paths)`)
  check(declaredShop.filter((e) => e.method !== 'GET' && !/\/(search|query|recommend|calculate|external_order_search)$/.test(e.path)).every((e) => e.mutating), 'every declared TikTok Shop write is marked mutating')
  const bestselling = requireEndpoint('tiktok-shop', 'analytics-202511-videos-bestselling')
  const bestsellingUrl = new URL(
    shop.buildRequest({ endpoint: bestselling, params: shop.resolveParams!({ endpoint: bestselling, params: coerceParams(bestselling, { query: { date: '2026-09-01', shop_cipher: 'STALE' } }), context }), context }).url,
  )
  check(bestsellingUrl.searchParams.get('date') === '2026-09-01', 'a pasted query object is spread into the query string')
  check(bestsellingUrl.searchParams.get('shop_cipher') === 'ROW_x', 'the connection’s shop wins over a cipher left in pasted JSON')
  const recommend = requireEndpoint('tiktok-shop', 'post-product-202309-categories-recommend')
  const recommendRequest = shop.buildRequest({ endpoint: recommend, params: coerceParams(recommend, { shop_cipher: 'ROW_x', body: { product_title: 'x' } }), context })
  check(JSON.parse(recommendRequest.body ?? '{}').product_title === 'x', 'a pasted body is sent at the top level, not under "body"')
  // Probed live: TikTok refuses a shop_cipher on global products/warehouses and compliance records.
  for (const id of ['product-202309-global-categories', 'logistics-202309-global-warehouses', 'post-product-202501-compliance-manufacturers-search']) {
    const endpoint = requireEndpoint('tiktok-shop', id)
    const url = new URL(shop.buildRequest({ endpoint, params: shop.resolveParams!({ endpoint, params: coerceParams(endpoint, {}), context }), context }).url)
    check(!url.searchParams.has('shop_cipher'), `${endpoint.path} is sent without shop_cipher`)
  }
  const sellerShops = requireEndpoint('tiktok-shop', 'seller-202309-shops')
  check(!sellerShops.params.some((p) => p.key === 'shop_cipher'), 'seller-level paths take no shop_cipher')
}

/* ------------------------------------------------- the booking file --- */

console.log('\n\x1b[36mThe booking file standard\x1b[0m')
{
  const { parseDate, parseMoney, normalizeBooking, columnsOf, TEMPLATE_HEADINGS, BOOKING_FIELDS } = await import('@/modules/bookings/fields')
  const { kocKey, videoKey, productKey } = await import('@/modules/analytics/shared/keys')

  const good = normalizeBooking({ koc: '@Linh.Beauty', bookedOn: '10/09/2026', airedOn: '12/09/2026', videoUrl: 'https://www.tiktok.com/@linh.beauty/video/7412345678901234567', cost: '1tr5' }, '2026-09-14')
  check(
    good.value?.kocHandle === 'linh.beauty' && good.value.videoId === '7412345678901234567' && good.value.cost === 1_500_000 && good.value.status === 'aired',
    'a typed booking becomes its standard form: bare handle, video id, fee, aired once it has an air date',
  )
  const fromLink = normalizeBooking({ videoUrl: 'https://www.tiktok.com/@an.an/video/7412345678901234567', airedOn: '2026-09-12', cost: 0 }, '2026-09-14')
  check(fromLink.value?.kocHandle === 'an.an' && fromLink.value.bookedOn === '2026-09-12', 'the KOC is read from the video link, the booking date defaults to the air date')
  const bad = normalizeBooking({ koc: 'x', bookedOn: '20/09/2026', airedOn: '12/09/2026', videoUrl: 'not a link', cost: 'free' }, '2026-09-14')
  const codes = new Set(bad.issues.map((issue) => `${issue.field}:${issue.code}`))
  check(
    bad.value === null && codes.has('airedOn:airBeforeBook') && codes.has('videoUrl:invalidVideo') && codes.has('cost:invalidMoney'),
    'a row that would put wrong figures in a report is refused, with each reason',
    [...codes].join(', '),
  )
  check(normalizeBooking({ koc: 'x', bookedOn: '2026-09-01', cost: 1, status: 'Đã air' }).issues.some((i) => i.code === 'airedNeedsDate'), 'aired without an air date is refused')
  check(normalizeBooking({ koc: 'x', bookedOn: '2026-09-01', cost: 1, status: 'Huỷ' }).value?.status === 'cancelled', 'a status is read as people write it')
  const exported = columnsOf(BOOKING_FIELDS.map((field) => TEMPLATE_HEADINGS[field]))
  check(BOOKING_FIELDS.every((field, i) => exported[field] === i), 'the template headings read back as their own fields (export → import round-trips)')
  const legacy = columnsOf(['STT', 'Tên KOC', 'Link kênh', 'Ngày lên video', 'Link air', 'Cast', 'Phí ship'])
  check(legacy.kocName === 1 && legacy.koc === 2 && legacy.airedOn === 3 && legacy.videoUrl === 4 && legacy.cost === 5, 'an existing sheet’s own headings are recognised')

  // A video id carries the time it was posted (its top 32 bits): 1725821215 = 2024-09-09 01:46 in Vietnam.
  const { postedOnOfVideo, withCampaignDefaults } = await import('@/modules/bookings/fields')
  check(postedOnOfVideo('7412345678901234567', '2026-09-25') === '2024-09-09', 'a video’s post day is read from its id, in Vietnam time')
  check(postedOnOfVideo('1234567890123', '2026-09-25') === null && postedOnOfVideo('9999999999999999999', '2026-09-25') === null, 'an id that carries no plausible time gives no day')
  const aired = normalizeBooking({ videoUrl: 'https://www.tiktok.com/@an.an/video/7412345678901234567', cost: '1tr' }, '2026-09-25')
  check(aired.value?.airedOn === '2024-09-09' && aired.value.bookedOn === '2024-09-09' && aired.value.status === 'aired', 'a video link alone makes an aired booking: KOC, air date and booking date from the video')
  const rights = normalizeBooking({ koc: 'a', bookedOn: '2026-09-01', videoUrl: '7412345678901234567', cost: 1 }, '2026-09-25')
  check(rights.value?.airedOn === '2024-09-09', 'a video booked after it was posted (its rights bought) is accepted with its real air date')
  const filled = normalizeBooking(withCampaignDefaults({ koc: 'a', bookedOn: '2026-09-01', campaign: 'Serum 9.9' }, { product: '1729503179457070324', defaultCost: 1_500_000 }))
  check(filled.value?.product === '1729503179457070324' && filled.value.cost === 1_500_000 && filled.value.campaign === 'Serum 9.9', 'a campaign fills the product and fee a row leaves out')
  check(normalizeBooking(withCampaignDefaults({ koc: 'a', bookedOn: '2026-09-01', cost: '800k' }, { product: null, defaultCost: 1_500_000 })).value?.cost === 800_000, 'a fee typed on the row wins over the campaign’s')

  const { parseQuickLines, repeatedVideos } = await import('@/modules/bookings/quick-entry')
  const quick = parseQuickLines('https://www.tiktok.com/@linh.beauty/video/7412345678901234567  1tr5\n\n@An.An 800k\n7412345678901234567\n@b\t1.500.000')
  check(
    quick.length === 4 &&
      quick[0].raw.koc === 'linh.beauty' && quick[0].raw.cost === '1tr5' &&
      quick[1].raw.koc === 'an.an' && quick[1].raw.cost === '800k' &&
      quick[2].raw.videoUrl === '7412345678901234567' && quick[2].raw.cost === undefined &&
      quick[3].raw.cost === '1.500.000',
    'the quick list reads a link, a KOC or a video id per line, with an optional fee',
  )
  check([...repeatedVideos(quick)].join() === '4', 'a video listed twice is flagged on its second line')

  const { normalizeCampaign, campaignKey } = await import('@/modules/bookings/campaigns')
  const campaign = normalizeCampaign({ name: '  Ra mắt   serum ', startOn: '01/09/2026', endOn: '30/09/2026', budget: '50tr', defaultCost: '1tr5', targetVideos: '40' })
  check(
    campaign.value?.name === 'Ra mắt serum' && campaign.value.budget === 50_000_000 && campaign.value.defaultCost === 1_500_000 && campaign.value.targetVideos === 40 && campaign.value.startOn === '2026-09-01',
    'a campaign form becomes its standard form',
  )
  check(normalizeCampaign({ name: 'x', startOn: '2026-09-10', endOn: '2026-09-01' }).issues.some((i) => i.code === 'endBeforeStart'), 'a campaign ending before it starts is refused')
  check(campaignKey('Ra mắt Serum') === campaignKey('ra mat serum'), 'campaign names match whatever their accents or case')

  // The embedded database has one connection: a query on `db` inside a transaction waits for the
  // transaction, which waits for the query. Saving a booking hung that way; nothing may do it again.
  {
    const { readFileSync, readdirSync } = await import('node:fs')
    const offenders: string[] = []
    for (const feature of readdirSync('src/features')) {
      let source: string
      try {
        source = readFileSync(`src/features/${feature}/actions.ts`, 'utf8')
      } catch {
        continue
      }
      for (let at = source.indexOf('db.transaction('); at >= 0; at = source.indexOf('db.transaction(', at + 1)) {
        // The callback's body: from the transaction's opening parenthesis to its matching close.
        let depth = 0
        let end = at + 'db.transaction'.length
        for (; end < source.length; end++) {
          if (source[end] === '(') depth++
          else if (source[end] === ')' && --depth === 0) break
        }
        const body = source.slice(at + 'db.transaction('.length, end)
        if (/\bdb\.(select|insert|update|delete|execute)\b|\baudit\(/.test(body)) offenders.push(`features/${feature}/actions.ts`)
      }
    }
    check(offenders.length === 0, 'no action queries `db` (or writes the audit trail) inside a transaction', offenders.join(', '))
  }

  // A read the app has no scope for (TikTok Shop 105005) is left out of reports, not reported as the source failing.
  const { isScopeDenied } = await import('@/modules/analytics/data/tiktok-shop')
  check(
    isScopeDenied('TikTok Shop 105005: Access denied. This app has not been granted any access scope required by this endpoint.') &&
      !isScopeDenied('TikTok Shop 36009002: Too many requests') &&
      !isScopeDenied(null),
    'a missing TikTok Shop scope is told apart from a real failure',
  )

  const { attentionOf, tally, LATE_AFTER_DAYS } = await import('@/modules/bookings/triage')
  const day = '2026-09-25'
  check(attentionOf({ status: 'pending', bookedOn: '2026-09-18', videoId: null }, day) === 'late' && LATE_AFTER_DAYS === 7, 'a booking a week old and not aired needs chasing')
  check(attentionOf({ status: 'pending', bookedOn: '2026-09-20', videoId: null }, day) === null, 'a recent pending booking needs nothing yet')
  check(attentionOf({ status: 'aired', bookedOn: '2026-09-01', videoId: null }, day) === 'noVideo', 'an aired booking without its video needs the link')
  check(attentionOf({ status: 'cancelled', bookedOn: '2026-01-01', videoId: null }, day) === null, 'a cancelled booking needs nothing')
  const sums = tally(
    [
      { status: 'aired', bookedOn: day, videoId: '1', cost: 1_000_000 },
      { status: 'pending', bookedOn: '2026-09-01', videoId: null, cost: 500_000 },
      { status: 'cancelled', bookedOn: day, videoId: null, cost: 9_000_000 },
    ],
    day,
  )
  check(sums.bookings === 2 && sums.aired === 1 && sums.pending === 1 && sums.cancelled === 1 && sums.attention === 1 && sums.spent === 1_500_000, 'the summary leaves cancelled bookings out of every sum')

  // The fields added for the list: code, planned air date, KOC tier, results.
  {
    const { EXPORT_COLUMNS, parseTier, parseCount, codeKey, bookingCode, codeNumber, monthOf } = await import('@/modules/bookings/fields')
    const full = normalizeBooking(
      { code: ' bk-0042 ', koc: 'a', bookedOn: '01/09/2026', plannedAirOn: '05/09/2026', cost: '1tr', kocTier: 'koc micro', resultOrders: '1.200', resultRevenue: '3,5tr' },
      '2026-09-25',
    )
    check(
      full.value?.code === 'BK-0042' && full.value.plannedAirOn === '2026-09-05' && full.value.kocTier === 'Micro' && full.value.resultOrders === 1200 && full.value.resultRevenue === 3_500_000,
      'a code, a planned air date, a tier and typed results are read into their standard form',
    )
    check(normalizeBooking({ koc: 'a', bookedOn: '2026-09-10', plannedAirOn: '2026-09-01', cost: 1 }).issues.some((i) => i.field === 'plannedAirOn' && i.code === 'airBeforeBook'), 'a planned air date before the booking is refused')
    check(normalizeBooking({ koc: 'a', bookedOn: '2026-09-10', cost: 1, resultOrders: '2.5' }).issues.some((i) => i.code === 'invalidNumber'), 'orders that are not a whole number are refused')
    const blank = normalizeBooking({ koc: 'a', bookedOn: '2026-09-10', cost: 1, resultOrders: '', resultRevenue: ' ' }).value
    check(blank?.resultOrders === null && blank.resultRevenue === null && blank.code === null, 'blank results and code are left to the sync and the numbering')
    check(parseTier('Nhóm VIP') === 'Nhóm VIP' && parseTier('MEGA') === 'Mega' && parseTier('') === null, 'a tier is a preset whatever its case, else kept as typed')
    check(parseCount(12) === 12 && parseCount('1 200') === 1200 && parseCount('-1') === null, 'counts are read as people type them')
    check(codeKey('bk - 7') === 'BK-7' && bookingCode(7) === 'BK-0007' && bookingCode(12345) === 'BK-12345' && codeNumber('BK-0042') === 42 && codeNumber('KOC-1') === null, 'booking codes are numbered BK-0001 on, wider past 9999')
    check(monthOf('2026-09-12') === '09/2026', 'a booking’s month reads MM/YYYY')
    const exportedFile = columnsOf(EXPORT_COLUMNS.map((column) => TEMPLATE_HEADINGS[column]))
    check(
      EXPORT_COLUMNS.every((column, i) => (column === 'month' || column === 'airStanding' ? !Object.values(exportedFile).includes(i) : exportedFile[column] === i)),
      'an exported file imports back: every field in its column, the derived Tháng and Trạng thái air matching none',
    )
    const vietnamese = columnsOf(['Mã', 'Ngày book', 'Sản phẩm', 'KOC (@handle)', 'Chi phí booking', 'Ngày air dự kiến', 'Ngày air thực tế', 'Trạng thái air', 'Số đơn ra', 'Doanh thu quy KOC', 'Phân loại KOC', 'Link video', 'Ghi chú'])
    check(
      vietnamese.code === 0 && vietnamese.bookedOn === 1 && vietnamese.product === 2 && vietnamese.cost === 4 && vietnamese.plannedAirOn === 5 && vietnamese.airedOn === 6 && vietnamese.resultOrders === 8 && vietnamese.resultRevenue === 9 && vietnamese.kocTier === 10 && vietnamese.videoUrl === 11 && vietnamese.note === 12,
      'the list’s own Vietnamese headings are recognised',
      JSON.stringify(vietnamese),
    )
    const english = columnsOf(['Code', 'Booking date', 'Planned air date', 'Air date', 'Orders', 'Revenue', 'KOC tier', 'KOC'])
    check(english.code === 0 && english.bookedOn === 1 && english.plannedAirOn === 2 && english.airedOn === 3 && english.resultOrders === 4 && english.resultRevenue === 5 && english.kocTier === 6 && english.koc === 7, 'English headings are recognised too', JSON.stringify(english))
  }

  // Where a booking's airing stands, worked out against the day (Vietnam's).
  {
    const { airStandingOf } = await import('@/modules/bookings/triage')
    const on = '2026-09-25'
    const s = (plannedAirOn: string | null, airedOn: string | null, status: 'pending' | 'aired' | 'cancelled' = airedOn ? 'aired' : 'pending') => airStandingOf({ status, plannedAirOn, airedOn }, on)
    check(s('2026-09-20', null).state === 'overdue' && s('2026-09-20', null).days === 5, 'not aired past the day agreed is overdue, by so many days')
    check(s('2026-09-25', null).state === 'today' && s('2026-09-28', null).state === 'waiting' && s('2026-09-28', null).days === 3 && s(null, null).state === 'unscheduled', 'not aired yet: due today, waiting so many days, or no day agreed')
    check(s('2026-09-20', '2026-09-22').state === 'airedLate' && s('2026-09-20', '2026-09-22').days === 2 && s('2026-09-20', '2026-09-19').state === 'aired' && s(null, '2026-09-19').state === 'aired', 'aired after the day agreed is late, on or before it is on time')
    check(s('2026-09-20', null, 'cancelled').state === 'cancelled', 'a cancelled booking is cancelled, whatever its dates')
    check(
      attentionOf({ status: 'pending', bookedOn: '2026-09-24', plannedAirOn: '2026-09-24', videoId: null }, on) === 'overdue' &&
        attentionOf({ status: 'pending', bookedOn: '2026-09-01', plannedAirOn: '2026-09-30', videoId: null }, on) === null,
      'an overdue booking needs a hand; one booked long ago but due later does not',
    )
  }

  // The booking list: prepared once, filtered, sorted, summed.
  {
    const { prepare, sortRows, matches, needleOf, summarise, NO_FILTERS, rememberFilters, acceptFilterMemory } = await import('@/modules/bookings/list')
    const base = { campaignId: null, kocName: null, kocContact: null, kocTier: null, plannedAirOn: null, airedOn: null, videoUrl: null, videoId: null, product: null, note: null, resultOrders: null, resultRevenue: null, resultSource: null, resultSyncedAt: null, resultNote: null, updatedBy: null, updatedAt: '' }
    const listRows = [
      { ...base, id: '1', code: 'BK-0001', kocHandle: 'linh', kocName: 'Linh Sữa Rửa Mặt', bookedOn: '2026-08-30', cost: 1_000_000, status: 'aired' as const, airedOn: '2026-09-01', resultOrders: 10, resultRevenue: 3_000_000, resultSource: 'tiktok' as const, kocTier: 'Micro' },
      { ...base, id: '2', code: 'BK-0002', kocHandle: 'an', bookedOn: '2026-09-10', cost: 500_000, status: 'pending' as const, plannedAirOn: '2026-09-20' },
      { ...base, id: '3', code: 'BK-0010', kocHandle: 'binh', bookedOn: '2026-09-12', cost: 2_000_000, status: 'cancelled' as const },
    ]
    const items = prepare(listRows, '2026-09-25', new Map())
    check(sortRows(items, { column: 'bookedOn', desc: true }).map((i) => i.row.id).join() === '3,2,1', 'the list sorts newest booking first by default')
    check(sortRows(items, { column: 'revenue', desc: false }).map((i) => i.row.id)[0] === '1' && sortRows(items, { column: 'revenue', desc: true }).map((i) => i.row.id)[0] === '1', 'rows without the value sort last either way')
    check(sortRows(items, { column: 'code', desc: true })[0].row.code === 'BK-0010', 'codes sort by their number')
    check(items.filter((i) => matches(i, NO_FILTERS, needleOf('sua rua'))).map((i) => i.row.id).join() === '1', 'the search ignores accents and case')
    check(items.filter((i) => matches(i, { ...NO_FILTERS, months: ['2026-09'], air: ['overdue'] }, '')).map((i) => i.row.id).join() === '2', 'filters by month and air state combine')
    check(items.filter((i) => matches(i, { ...NO_FILTERS, tiers: ['—'], from: '2026-09-11' }, '')).map((i) => i.row.id).join() === '3', 'filters by tier (none) and booking date combine')
    const sums = summarise(items)
    check(sums.bookings === 2 && sums.cost === 1_500_000 && sums.aired === 1 && sums.overdue === 1 && sums.orders === 10 && sums.revenue === 3_000_000 && sums.roi === 2, 'the summary of the rows shown leaves cancelled ones out; ROI is revenue over cost')
    let memory = {}
    for (const project of ['a', 'b', 'c', 'd', 'e', 'f']) memory = rememberFilters(memory, project, { ...NO_FILTERS, months: ['2026-09'] })
    memory = rememberFilters(memory, 'f', NO_FILTERS)
    const kept = acceptFilterMemory(memory)
    check(kept !== null && Object.keys(kept).join() === 'b,c,d,e', 'filters are remembered for the last few projects; cleared ones are forgotten')
  }

  // Syncing results from TikTok Shop, against a fake connector.
  {
    const { readResults, resultTargets } = await import('@/modules/bookings/results')
    const on = '2026-09-25'
    const video = (id: string, orders: number, gmv: number) => ({ id, sku_orders: orders, gmv: { amount: `${gmv}.00`, currency: 'VND' } })
    type Page = { videos: unknown[]; next?: string }
    const fake = (pages: Record<string, Page[]>, options: { maxDays?: number; denied?: boolean } = {}) => {
      const calls: Array<{ endpoint: string; params: Record<string, unknown> }> = []
      const call = async (endpoint: string, params: Record<string, unknown>) => {
        calls.push({ endpoint, params })
        if (options.denied) throw new Error('TikTok Shop 105005: Access denied. This app has not been granted any access scope required by this endpoint.')
        const days = (Date.parse(String(params.end_date_lt)) - Date.parse(String(params.start_date_ge))) / 86_400_000
        if (options.maxDays && days > options.maxDays) throw new Error('TikTok Shop 36009004: The date range between start_date_ge and end_date_lt exceeds the limit')
        if (endpoint === 'analytics-video') return { performance: { intervals: [{ start_date: params.start_date_ge, sales: { overall: { gmv: { amount: '12345.00' }, items_sold: 3 } } }] } }
        const list = pages[String(params.start_date_ge)] ?? [{ videos: [] }]
        const page = list[params.page_token ? Number(String(params.page_token).slice(1)) : 0]
        return { videos: page.videos, next_page_token: page.next ?? '' }
      }
      return { calls, call }
    }
    const pages: Record<string, Page[]> = {
      '2026-09-01': [
        { videos: [video('111', 3, 300_000), video('999', 9, 900_000)], next: 'p1' },
        { videos: [video('222', 1, 50_000)], next: 'p2' },
        { videos: [video('333', 0, 0)] },
      ],
      '2026-09-10': [{ videos: [video('444', 2, 200_000)] }],
    }
    const targets = [
      { id: 'a1', videoId: '111', startOn: '2026-09-01' },
      { id: 'a2', videoId: '222', startOn: '2026-09-01' },
      { id: 'b1', videoId: '444', startOn: '2026-09-10' },
      { id: 'b2', videoId: '555', startOn: '2026-09-10' },
    ]
    const one = fake(pages)
    const read = await readResults(targets, one.call, on)
    const listCalls = one.calls.filter((c) => c.endpoint === 'analytics-shop-videos')
    check(
      listCalls.filter((c) => c.params.start_date_ge === '2026-09-01').length === 2 && listCalls.filter((c) => c.params.start_date_ge === '2026-09-10').length === 1 && listCalls.every((c) => c.params.end_date_lt === '2026-09-26'),
      'bookings are grouped by their start day, each read over [start, tomorrow), and paging stops once every booked video is found',
    )
    check(
      read.figures.get('a1')?.orders === 3 && read.figures.get('a1')?.revenue === 300_000 && read.figures.get('a2')?.orders === 1 && read.figures.get('b1')?.revenue === 200_000,
      'a video found in the list takes its SKU orders and GMV',
    )
    check(read.figures.get('b2')?.orders === 0 && read.figures.get('b2')?.revenue === 0 && read.figures.get('b2')?.note === null, 'a video missing from a list that ended sold nothing: a real 0')
    const capped = fake(pages)
    const cut = await readResults(targets.slice(0, 2), capped.call, on, { pageCap: 1 })
    check(
      cut.figures.get('a1')?.orders === 3 && cut.figures.get('a2')?.orders === null && cut.figures.get('a2')?.revenue === 12_345 && cut.figures.get('a2')?.note === 'not_found' &&
        capped.calls.some((c) => c.endpoint === 'analytics-video' && c.params.video_id === '222' && c.params.granularity === 'ALL'),
      'a video not reached within the page cap has its revenue read on its own, its orders left unknown',
    )
    const long = fake({ '2026-07-01': [{ videos: [video('777', 1, 1_000)] }], '2026-07-31': [{ videos: [video('777', 2, 2_000)] }], '2026-08-30': [{ videos: [video('777', 4, 4_000)] }] }, { maxDays: 30 })
    const summed = await readResults([{ id: 'l1', videoId: '777', startOn: '2026-07-01' }], long.call, on)
    check(summed.figures.get('l1')?.orders === 7 && summed.figures.get('l1')?.revenue === 7_000, 'a range TikTok refuses whole is read in 30-day windows and summed', JSON.stringify([...summed.figures]))
    const denied = fake(pages, { denied: true })
    const none = await readResults(targets, denied.call, on)
    check([...none.figures.values()].every((f) => f.note === 'no_scope' && f.keep) && none.failure === null, 'without the analytics scope the figures are kept and noted, not reported as a failure')
    const rows = [
      { id: 'm', status: 'aired' as const, videoId: '1', bookedOn: '2026-09-01', airedOn: '2026-09-02', resultSource: 'manual' as const, resultSyncedAt: null },
      { id: 'c', status: 'cancelled' as const, videoId: '2', bookedOn: '2026-09-01', airedOn: '2026-09-02', resultSource: null, resultSyncedAt: null },
      { id: 'n', status: 'pending' as const, videoId: null, bookedOn: '2026-09-01', airedOn: null, resultSource: null, resultSyncedAt: null },
      { id: 'old', status: 'aired' as const, videoId: '3', bookedOn: '2026-01-01', airedOn: '2026-01-02', resultSource: 'tiktok' as const, resultSyncedAt: '2026-03-01T00:00:00Z' },
      { id: 'fresh', status: 'aired' as const, videoId: '4', bookedOn: '2026-09-20', airedOn: '2026-09-21', resultSource: 'tiktok' as const, resultSyncedAt: '2026-09-25T02:50:00Z' },
      { id: 'due', status: 'aired' as const, videoId: '5', bookedOn: '2026-09-20', airedOn: '2026-09-21', resultSource: 'tiktok' as const, resultSyncedAt: '2026-09-25T01:00:00Z' },
      { id: 'new', status: 'pending' as const, videoId: '6', bookedOn: '2026-09-22', airedOn: null, resultSource: null, resultSyncedAt: null },
    ]
    const now = Date.parse('2026-09-25T03:00:00Z')
    check(resultTargets(rows, on, now).map((r) => r.id).join() === 'new,due', 'a sync leaves typed, cancelled, videoless, settled and freshly synced bookings alone, the never-synced first')
    check(resultTargets(rows, on, now, true).map((r) => r.id).join() === 'new,due,fresh' && resultTargets(rows, on, now)[0].startOn === '2026-09-22', 'asked for, it reads the fresh ones too; a booking not aired starts from its booking date')
  }

  check(parseDate('12/09/2026') === '2026-09-12', 'dd/mm/yyyy is read the Vietnamese way')
  check(parseDate('3-9-26') === '2026-09-03', 'short years and dashes are read')
  check(parseDate(46277) === '2026-09-12', 'a date serial from an unformatted cell is read')
  check(parseDate('12/09', '2026-09-14') === '2026-09-12', 'a date without a year is the most recent such date')
  check(parseDate('31/02/2026') === null, 'an impossible date is refused')
  check(parseMoney('1.500.000đ') === 1_500_000 && parseMoney('1,5tr') === 1_500_000 && parseMoney('1tr5') === 1_500_000 && parseMoney('500k') === 500_000, 'costs are read as people type them')
  check(parseMoney('1tr500') === 1_500_000 && parseMoney('1tr25') === 1_250_000 && parseMoney('1,500k') === 1_500_000, 'costs with spoken decimals or grouped thousands are read')

  // GMV Max windows: fixed 30-day windows from 2024-01-01, never one that starts after today.
  const { windowsOf } = await import('@/modules/analytics/data/gmv-max')
  const onBoundary = windowsOf('2026-08-18', '2026-09-16', '2026-09-16')
  check(onBoundary.length === 1 && onBoundary[0].from === '2026-08-18' && onBoundary[0].to === '2026-09-16', 'a period ending on a window’s last day reads that window only')
  const across = windowsOf('2026-09-16', '2026-09-20', '2026-09-20')
  check(across.length === 2 && across[0].to === '2026-09-16' && across[1].from === '2026-09-17', 'a period starting on a window’s last day includes that window')
  check(windowsOf('2026-06-01', '2026-09-14', '2026-09-14').every((w) => w.from <= w.to), 'no window ends before it starts')
  check(kocKey('https://www.tiktok.com/@Linh.Beauty?lang=vi') === 'linh.beauty' && kocKey('@Linh.Beauty') === 'linh.beauty', 'a KOC is the same handle from a link or an @name')
  check(videoKey('https://www.tiktok.com/@a/video/7412345678901234567') === '7412345678901234567', 'a video link gives its id')
  check(productKey('https://shop.tiktok.com/view/product/1729503179457070324?region=VN') === '1729503179457070324', 'a product link gives its id')
}

/* ------------------------------------------------------- admin database --- */

// The Database page and its SQL console: what is masked, what is refused. The queries
// themselves need a database; these are the rules they rest on.
console.log('\n\x1b[36mAdmin database\x1b[0m')
{
  const { MASK, isSecretColumn, maskValue } = await import('@/modules/system-admin/secrets')
  const { guardStatement } = await import('@/modules/system-admin/sql-guard')

  check(
    isSecretColumn('connections', 'credentials_enc') &&
      ['password', 'access_token', 'refresh_token', 'id_token'].every((c) => isSecretColumn('account', c)) &&
      isSecretColumn('session', 'token') &&
      isSecretColumn('verification', 'value') &&
      isSecretColumn('project_invitations', 'token'),
    'the known secret columns are masked',
  )
  check(
    ['api_key', 'apikey', 'client_secret', 'private_key', 'webhook_token', 'x_enc', 'credential'].every((c) => isSecretColumn(null, c)) &&
      !isSecretColumn(null, 'name') &&
      !isSecretColumn(null, 'value') &&
      !isSecretColumn('user', 'email'),
    'a column named like a secret is masked, others are not',
  )
  const masked = maskValue({ advertiserId: '1', accessToken: 'tok', nested: [{ app_secret: 's' }] }) as Record<string, unknown>
  check(masked.advertiserId === '1' && masked.accessToken === MASK && JSON.stringify(masked).includes(MASK) && !JSON.stringify(masked).includes('"s"'), 'JSON keys named like secrets are masked, deep')
  check(maskValue('v1:aaaaaaaaaaaa:bbbbbbbbbbbb:cccccccccccc') === MASK, 'a credential envelope is masked by its shape')
  check(!String(maskValue(`(u1,${'a'.repeat(32)}:${'b'.repeat(128)},x)`)).includes('bbbb'), 'a password hash inside a longer text is masked')

  const secrets = ['password', 'token', 'credentials_enc', 'access_token']
  const code = (text: string) => {
    const result = guardStatement(text, secrets)
    return result.ok ? 'ok' : result.failure.code === 'denied' ? `denied:${result.failure.rule}` : result.failure.code
  }
  check(code('select 1; select 2') === 'multiple' && code('select 1;\n delete from session') === 'multiple', 'only one statement at a time')
  check(code("select ';' as a; ") === 'ok' && code('select $x$;$x$ -- ;\n') === 'ok' && code("select E'\\';' /* ; */") === 'ok', 'semicolons in strings, dollar quotes and comments are not statement ends')
  check(code("select 'open") === 'unterminated' && code('   ;') === 'empty', 'unterminated and empty statements are refused')
  check(['begin', 'commit', 'set search_path = x', 'reset all', 'discard all'].every((s) => code(s) === 'control'), 'transaction and session control are refused')
  check(code('vacuum full') === 'vacuum' && code('copy "user" to stdout') === 'copy', 'VACUUM and COPY are refused')
  check(['select pg_sleep(5)', "select pg_read_file('/etc/passwd')", "select set_config('a','b',false)", 'select pg_terminate_backend(1)'].every((s) => code(s) === 'function'), 'functions reaching outside or holding the connection are refused')
  check(code('select password as p from account') === 'secret' && code("select to_jsonb(a)->>'password' from account a") === 'secret', 'a statement naming a secret column is refused')
  check(code('select * from connections') === 'ok' && code('select * from "user"') === 'ok' && code("select * from pg_tables where tablename = 'user'") === 'ok', 'ordinary reads pass')
  check(
    code('select s::text from session s') === 'secretTable' &&
      code('select value as v from verification') === 'secretTable' &&
      code('select * from public.account') === 'secretTable' &&
      code('select * from "project_invitations"') === 'secretTable',
    'the tables whose secrets cannot be masked by name are not read from the console',
  )
  check(code("do $$begin perform set_config('search_path','x',false); end$$") === 'control' && code('call some_procedure()') === 'control', 'DO and CALL (code in a string) are refused')
  check(code('drop database app') === 'denied:dropDatabase' && code('DROP SCHEMA public CASCADE') === 'denied:dropSchema' && code('drop owned by me') === 'denied:dropSchema', 'dropping the database or a schema is denied')
  check(code('truncate "user" cascade') === 'denied:authTable' && code('drop table public."user"') === 'denied:authTable' && code('delete from "user"') === 'denied:authTable' && code("update \"user\" set role = 'user'") === 'denied:authTable' && code('drop table public.session') === 'secretTable', 'emptying or rewriting a sign-in table is denied')
  check(code("update \"user\" set name = 'x' where id = 'u1'") === 'ok' && code("delete from session where user_id = 'u1'") === 'secretTable', 'targeted writes to the user table pass; the token tables stay out of the console')
  check(code("delete from audit_logs where id = 'x'") === 'denied:auditTrail' && code('delete from drizzle.__drizzle_migrations') === 'denied:migrations', 'the audit trail and the migration journal are not written')
  check(code('alter system set work_mem = 1') === 'denied:alterSystem' && code('create role evil') === 'denied:roles', 'server configuration and roles are denied')

  // The embedded database has one connection: nothing in the admin pages may query `db` inside a transaction.
  const { readFileSync, readdirSync } = await import('node:fs')
  const offenders: string[] = []
  for (const name of readdirSync('src/modules/system-admin/data')) {
    const source = readFileSync(`src/modules/system-admin/data/${name}`, 'utf8')
    for (let at = source.indexOf('.transaction('); at >= 0; at = source.indexOf('.transaction(', at + 1)) {
      let depth = 0
      let end = at + '.transaction'.length
      for (; end < source.length; end++) {
        if (source[end] === '(') depth++
        else if (source[end] === ')' && --depth === 0) break
      }
      if (/\b(db|database)\.(select|insert|update|delete|execute)\b|\baudit\(/.test(source.slice(at, end))) offenders.push(name)
    }
  }
  check(offenders.length === 0, 'the admin pages never query the outer database inside a transaction', offenders.join(', '))
}

/* ------------------------------------------------------- param coercion --- */

console.log('\n\x1b[36mParam coercion\x1b[0m')
{
  const endpoint = requireEndpoint('tiktok-ads', 'report-integrated')
  const coerced = coerceParams(endpoint, {
    advertiser_id: '  7123456  ',
    metrics: 'spend, impressions\nclicks',
    dimensions: ['campaign_id'],
    page: '2',
    start_date: '2026-01-01',
    end_date: '2026-01-31',
    report_type: 'BASIC',
    data_level: 'AUCTION_CAMPAIGN',
  })

  check(coerced.advertiser_id === '7123456', 'strings are trimmed')
  check(
    Array.isArray(coerced.metrics) && (coerced.metrics as string[]).length === 3,
    'comma and newline separated lists become arrays',
  )
  check(coerced.page === 2, 'numbers are parsed')
  check(validateParams(endpoint, coerced).length === 0, 'a complete param set validates')

  const missing = coerceParams(endpoint, { metrics: 'spend' })
  check(validateParams(endpoint, missing).length > 0, 'missing required params are reported')

  const badJson = coerceParams(requireEndpoint('tiktok-ads', 'campaign-get'), {
    advertiser_id: '1',
    filtering: '{not json',
  })
  check(
    validateParams(requireEndpoint('tiktok-ads', 'campaign-get'), badJson).some((i) => i.code === 'json'),
    'malformed JSON params are reported',
  )
}

/* -------------------------------------------------------------- verdict --- */

console.log(
  failures === 0
    ? `\n\x1b[32m✓ ${checks} checks passed\x1b[0m\n`
    : `\n\x1b[31m✗ ${failures} of ${checks} checks failed\x1b[0m\n`,
)
process.exit(failures === 0 ? 0 : 1)
