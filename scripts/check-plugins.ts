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
    plugin.endpoints.every((e) => e.params.every((p) => ID_PATTERN.test(p.key) || /^[a-z0-9_]+$/.test(p.key))),
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
