/**
 * Verifies a real TikTok connection end-to-end through the app's own code.
 *
 * Reads credentials from the environment so nothing sensitive is written into
 * the repository, creates a throwaway project, and deletes everything at the
 * end. Every secret is masked before it is printed.
 *
 *   TT_APP_ID=… TT_SECRET=… TT_ACCESS_TOKEN=… npm run verify:live
 *   TT_APP_ID=… TT_SECRET=… TT_AUTH_CODE=…    npm run verify:live
 *
 * Either input works, which is the point: the connection form accepts an
 * auth_code or a ready token, and this exercises whichever you supply through
 * the same save path the UI uses.
 *
 * This is the check that catches provider-contract mistakes an offline test
 * cannot see — a wrong field name, a renamed response key, a missing scope.
 */
import { eq } from 'drizzle-orm'
import { db } from '@/core/db/client'
import { user } from '@/core/db/schema/auth'
import { connections } from '@/core/db/schema/connections'
import { projectMembers, projects } from '@/core/db/schema/projects'
import { decryptJson, encryptJson } from '@/core/crypto/secrets'
import { createId, slugify } from '@/core/utils/id'
import { executeEndpoint, testConnection } from '@/core/plugins/execute'
import { runConnectorAction } from '@/core/plugins/run-action'
import { requirePlugin } from '@/core/plugins/registry'

const APP_ID = process.env.TT_APP_ID
const SECRET = process.env.TT_SECRET
const TOKEN = process.env.TT_ACCESS_TOKEN
const AUTH_CODE = process.env.TT_AUTH_CODE
const ADVERTISER = process.env.TT_ADVERTISER_ID

if (!APP_ID || !SECRET || !(TOKEN || AUTH_CODE)) {
  console.error('Set TT_APP_ID, TT_SECRET and one of TT_ACCESS_TOKEN / TT_AUTH_CODE.')
  process.exit(1)
}

const mask = (v?: string) => (!v ? '(empty)' : v.length <= 10 ? '••••' : `${v.slice(0, 4)}…${v.slice(-4)}`)

let bad = 0
const ok = (c: unknown, l: string, x?: unknown) => {
  if (c) console.log(`  \x1b[32m✓\x1b[0m ${l}`)
  else {
    bad++
    console.log(`  \x1b[31m✗\x1b[0m ${l}`, x ?? '')
  }
}

console.log(
  `\nUsing app ${APP_ID}, secret ${mask(SECRET)}, ` +
    (AUTH_CODE ? `auth_code ${mask(AUTH_CODE)}` : `token ${mask(TOKEN)}`),
)

const userId = createId('u')
await db
  .insert(user)
  .values({ id: userId, name: 'Live Verify', email: `live-${userId}@example.invalid`, emailVerified: true })
const projectId = createId('prj')
await db
  .insert(projects)
  .values({ id: projectId, slug: slugify(`live ${projectId}`), name: 'Live verify', ownerId: userId })
await db.insert(projectMembers).values({ id: createId('pm'), projectId, userId, role: 'owner' })

const connectionId = createId('con')

try {
  /* ------------------------------------------- the one-step save path --- */

  console.log('\n\x1b[36mSaving the connection (resolveCredentials)\x1b[0m')
  const plugin = requirePlugin('tiktok-ads')
  const resolution = await plugin.resolveCredentials!({
    credentials: {
      appId: APP_ID,
      appSecret: SECRET,
      ...(AUTH_CODE ? { authCode: AUTH_CODE } : {}),
      ...(TOKEN ? { accessToken: TOKEN } : {}),
      ...(ADVERTISER ? { advertiserId: ADVERTISER } : {}),
    },
    previous: {},
  })

  console.log(`  ${resolution.message ?? '(no note)'}`)
  ok(resolution.ok, 'the save was accepted', resolution.hint)
  if (!resolution.ok) {
    // A refusal here is a legitimate outcome — a spent auth_code, most often —
    // so say what to do instead of unwinding with a stack trace.
    console.log(
      '\n\x1b[33mNothing further to verify: the credentials were not accepted.\x1b[0m',
    )
    console.log(`  hint: ${resolution.hint ?? '(none)'}`)
    console.log('  Supply TT_ACCESS_TOKEN instead, or a freshly issued TT_AUTH_CODE.\n')
    await db.delete(user).where(eq(user.id, userId))
    process.exit(1)
  }

  ok(!('authCode' in resolution.credentials), 'the auth_code is not among the stored credentials')
  ok(Boolean(resolution.credentials.accessToken), 'an access token is present after resolution')

  await db.insert(connections).values({
    id: connectionId,
    projectId,
    pluginId: 'tiktok-ads',
    name: 'Live verify',
    authType: 'api_key',
    credentials: encryptJson(resolution.credentials),
    metadata: resolution.metadata ?? {},
    status: 'draft',
    createdById: userId,
  })

  const [row] = await db.select().from(connections).where(eq(connections.id, connectionId))
  const stored = decryptJson<Record<string, string>>(row.credentials!)
  ok(!('authCode' in stored), 'nothing single-use survived into the database')
  ok(!row.credentials!.includes(SECRET), 'the app secret is not plaintext in the column')

  /* --------------------------------------------------- connection test --- */

  console.log('\n\x1b[36mtestConnection\x1b[0m')
  const test = await testConnection(connectionId, projectId)
  console.log(`  ${test.message}`)
  ok(test.ok === true, 'connection reported as working', test.hint)
  const advertisers = (test.metadata?.advertisers ?? []) as Array<{ id: string; name: string }>
  ok(advertisers.length > 0, `advertiser accounts discovered (${advertisers.length})`)
  const advertiserId = (test.metadata?.advertiserId as string | undefined) ?? advertisers[0]?.id
  ok(Boolean(advertiserId), 'a default advertiser id was adopted', advertiserId)

  /* ------------------------------------------------------- diagnose ----- */

  console.log('\n\x1b[36mDiagnose action\x1b[0m')
  const diag = await runConnectorAction({
    projectId,
    connectionId,
    actionId: 'diagnose',
    input: {},
    actorId: userId,
  })
  for (const f of diag.findings ?? []) console.log(`    [${f.state}] ${f.label.en} — ${f.detail}`)
  ok(diag.ok === true, 'diagnosis passes with real credentials', diag.hint)
  ok(
    diag.findings?.find((f) => f.label.en.includes('App ID'))?.state === 'ok',
    'app credentials verified independently of the token',
  )
  ok(
    diag.findings?.find((f) => f.label.en === 'Access Token')?.state === 'ok',
    'the token-only probe accepts a valid token',
  )

  /* -------------------------------------------- real data endpoints ----- */

  console.log('\n\x1b[36mCatalogue endpoints, through executeEndpoint\x1b[0m')

  const info = await executeEndpoint({
    projectId,
    connectionId,
    endpointId: 'advertiser-info',
    params: { advertiser_ids: [advertiserId!] },
    actorId: userId,
  })
  ok(info.ok, 'advertiser-info succeeds with the corrected field list', info.error)
  const infoRow = (info.records?.[0] ?? {}) as Record<string, unknown>
  ok(typeof infoRow.name === 'string', 'the response carries `name`', Object.keys(infoRow).join(', '))

  const campaigns = await executeEndpoint({
    projectId,
    connectionId,
    endpointId: 'campaign-get',
    params: { advertiser_id: advertiserId, page: 1, page_size: 5 },
    actorId: userId,
  })
  ok(campaigns.ok, 'campaign-get succeeds', campaigns.error)
  ok((campaigns.recordCount ?? 0) > 0, `campaigns returned (${campaigns.recordCount})`)

  const authorized = await executeEndpoint({
    projectId,
    connectionId,
    endpointId: 'authorized-advertisers',
    params: {},
    actorId: userId,
  })
  ok(authorized.ok, 'authorized-advertisers succeeds with connection-filled app credentials', authorized.error)
  ok((authorized.recordCount ?? 0) > 0, `advertisers returned (${authorized.recordCount})`)

  const report = await executeEndpoint({
    projectId,
    connectionId,
    endpointId: 'report-integrated',
    params: {
      advertiser_id: advertiserId,
      report_type: 'BASIC',
      data_level: 'AUCTION_CAMPAIGN',
      dimensions: ['campaign_id', 'stat_time_day'],
      metrics: ['spend', 'impressions', 'clicks', 'ctr'],
      start_date: isoDaysAgo(7),
      end_date: isoDaysAgo(1),
      page: 1,
      page_size: 5,
    },
    actorId: userId,
  })
  console.log(`    report: ${report.ok ? `${report.recordCount} row(s)` : report.error}`)
  ok(report.ok, 'report-integrated succeeds', report.error)

  /* ------------------------------------------------------- redaction ---- */

  console.log('\n\x1b[36mRedaction on a real request\x1b[0m')
  const echo = JSON.stringify(campaigns.request)
  ok(!echo.includes(stored.accessToken), 'the access token is absent from the request echo')
  ok(!echo.includes(SECRET), 'the app secret is absent from the request echo')
  ok(echo.includes('••••'), 'the Access-Token header is masked')
} finally {
  await db.delete(user).where(eq(user.id, userId))
}

function isoDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 86_400_000)
  return d.toISOString().slice(0, 10)
}

console.log(bad === 0 ? '\n\x1b[32m✓ live verification passed\x1b[0m\n' : `\n\x1b[31m✗ ${bad} failed\x1b[0m\n`)
process.exit(bad === 0 ? 0 : 1)
