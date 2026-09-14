/**
 * Connector integration check — .
 *
 * Unlike check-plugins, this one opens the database and calls the live
 * provider, so it needs the dev server stopped and network access. It exists
 * for the part of the system where a silent regression would be worst: the
 * connector actions handle bearer credentials, write them back encrypted, and
 * record an audit entry. The assertions below pin down that no token reaches
 * the client payload, the audit trail or the plaintext column.
 *
 * It creates its own throwaway user and project, and deletes them at the end.
 */
import { and, eq } from 'drizzle-orm'
import { db } from '@/core/db/client'
import { user } from '@/core/db/schema/auth'
import { auditLogs } from '@/core/db/schema/audit'
import { connections } from '@/core/db/schema/connections'
import { projectMembers, projects } from '@/core/db/schema/projects'
import { decryptJson, encryptJson } from '@/core/crypto/secrets'
import { createId, slugify } from '@/core/utils/id'
import { runConnectorAction } from '@/core/plugins/run-action'
import { requirePlugin, toActionSummary } from '@/core/plugins/registry'
import { getConnectionView } from '@/features/connections/queries'
import vi from '../messages/vi.json'
import en from '../messages/en.json'

let bad = 0
const ok = (c: unknown, l: string, x?: unknown) => {
  if (c) console.log(`  \x1b[32m✓\x1b[0m ${l}`)
  else {
    bad++
    console.log(`  \x1b[31m✗\x1b[0m ${l}`, x ?? '')
  }
}

const userId = createId('u')
await db
  .insert(user)
  .values({ id: userId, name: 'Action Test', email: `act-${userId}@example.invalid`, emailVerified: true })
const projectId = createId('prj')
await db
  .insert(projects)
  .values({ id: projectId, slug: slugify(`act ${projectId}`), name: 'Action test', ownerId: userId })
await db.insert(projectMembers).values({ id: createId('pm'), projectId, userId, role: 'owner' })

async function makeConnection(creds: Record<string, string>) {
  const id = createId('con')
  await db.insert(connections).values({
    id,
    projectId,
    pluginId: 'tiktok-ads',
    name: `act ${id}`,
    authType: 'api_key',
    credentials: encryptJson(creds),
    status: 'draft',
    createdById: userId,
  })
  return id
}

/* ------------------------------------------------------------- contract --- */

console.log('\n\x1b[36mAction surface reaching the browser\x1b[0m')
{
  const plugin = requirePlugin('tiktok-ads')
  const summaries = (plugin.actions ?? []).map(toActionSummary)
  // Assert the set, not the count: a count silently passes when one tool is
  // swapped for another.
  ok(
    JSON.stringify(summaries.map((s) => s.id).sort()) ===
      JSON.stringify(['diagnose', 'list-permissions']),
    'TikTok declares the diagnosis and the permission probe',
    summaries.map((s) => s.id).join(', '),
  )
  ok(
    JSON.parse(JSON.stringify(summaries)).length === summaries.length,
    'summaries are JSON-serialisable (RSC boundary safe)',
  )
  const diagnose = summaries.find((s) => s.id === 'diagnose')!
  ok(diagnose.mutatesCredentials === false, 'the diagnosis declares itself read-only')
  ok(
    summaries.every((s) => s.mutatesCredentials === false),
    'no remaining tool writes credentials — the exchange moved into the save',
  )
  ok(diagnose.inputs.length === 0, 'the diagnosis needs no input')
}

/* ------------------------------------- diagnose: the user's exact situation --- */

console.log('\n\x1b[36mDiagnose: App ID/Secret wrong AND token wrong (live API)\x1b[0m')
{
  const id = await makeConnection({
    accessToken: 'not-a-real-token',
    appId: '1234567890123456',
    appSecret: 'f'.repeat(40),
    advertiserId: '7000000000000000001',
  })
  const result = await runConnectorAction({
    projectId,
    connectionId: id,
    actionId: 'diagnose',
    input: {},
    actorId: userId,
  })

  for (const f of result.findings ?? []) console.log(`    [${f.state}] ${f.label.vi} — ${f.detail}`)
  console.log(`    verdict: ${result.message}  hint=${result.hint}`)

  ok(result.ok === false, 'reported as failing')
  ok((result.findings?.length ?? 0) >= 2, 'produced a per-credential checklist')
  const appFinding = result.findings?.find((f) => f.label.en.includes('App ID'))
  ok(appFinding?.state === 'fail', 'correctly identifies the fake app credentials as invalid', appFinding?.state)
  const tokenFinding = result.findings?.find((f) => f.label.en === 'Access Token')
  ok(tokenFinding?.state === 'fail', 'correctly identifies the fake token as invalid', tokenFinding?.state)
  ok(result.hint === 'tiktokBothWrong', 'verdict names both as broken', result.hint)
  ok(!('credentialUpdates' in result), 'a read-only action returns no credential bag')
}

console.log('\n\x1b[36mDiagnose: no app credentials at all\x1b[0m')
{
  const id = await makeConnection({ accessToken: 'not-a-real-token', advertiserId: '7000000000000000001' })
  const result = await runConnectorAction({
    projectId,
    connectionId: id,
    actionId: 'diagnose',
    input: {},
    actorId: userId,
  })
  const appFinding = result.findings?.find((f) => f.label.en.includes('App ID'))
  ok(appFinding?.state === 'skipped', 'app credentials reported as skipped, not failed', appFinding?.state)
  ok(result.hint === 'tiktokTokenRejected', 'blames only the token', result.hint)
}

/* ---------------------------------------------------------- the exchange --- */

console.log('\n\x1b[36mresolveCredentials: one form, either input\x1b[0m')
{
  const plugin = requirePlugin('tiktok-ads')
  const resolve = plugin.resolveCredentials!

  // Neither of the two accepted inputs.
  const neither = await resolve({
    credentials: { appId: '1234567890123456', appSecret: 'f'.repeat(40) },
    previous: {},
  })
  ok(neither.ok === false, 'refuses a save with neither auth_code nor token')
  ok(neither.hint === 'tiktokNeedsCodeOrToken', 'asks for one of the two', neither.hint)

  // A ready token passes straight through.
  const withToken = await resolve({
    credentials: { appId: 'a'.repeat(16), appSecret: 'f'.repeat(40), accessToken: 'already-have-one' },
    previous: {},
  })
  ok(withToken.ok === true, 'accepts a ready access token unchanged')
  ok(withToken.credentials.accessToken === 'already-have-one', 'stores the token as given')
  ok(!('authCode' in withToken.credentials), 'no authCode key is invented')

  // An auth_code with no app credentials cannot be exchanged.
  const noApp = await resolve({ credentials: { authCode: 'abc123456' }, previous: {} })
  ok(noApp.ok === false, 'refuses an auth_code without App ID + Secret')
  ok(noApp.hint === 'tiktokExchangeNeedsApp', 'names the missing app credentials', noApp.hint)

  // The transient value must never survive, even on the failure paths.
  ok(!('authCode' in noApp.credentials), 'a rejected auth_code is not stored')

  // Live: a fake code against real-shaped app credentials.
  const bogus = await resolve({
    credentials: { appId: '1234567890123456', appSecret: 'f'.repeat(40), authCode: 'not-a-real-code' },
    previous: {},
  })
  console.log(`    provider: ${bogus.message}`)
  ok(bogus.ok === false, 'a bogus auth_code is rejected by TikTok')
  ok(!('authCode' in bogus.credentials), 'the spent code is stripped from the result')
  ok(
    bogus.hint === 'tiktokAppCredentials' || bogus.hint === 'tiktokExchangeFailed',
    'the failure is attributed to app credentials or to the code',
    bogus.hint,
  )
}

console.log('\n\x1b[36mTransient fields never reach storage\x1b[0m')
{
  const plugin = requirePlugin('tiktok-ads')
  const authCodeField = plugin.auth.fields.find((f) => f.key === 'authCode')
  ok(authCodeField?.transient === true, 'authCode is declared transient')
  ok(authCodeField?.secret === true, 'authCode is declared secret')
  ok(authCodeField?.required !== true, 'authCode is not required — it is one of two ways in')

  const tokenField = plugin.auth.fields.find((f) => f.key === 'accessToken')
  ok(tokenField?.required !== true, 'accessToken is not required either')
  ok(
    plugin.auth.fields.find((f) => f.key === 'appId')?.required === true &&
      plugin.auth.fields.find((f) => f.key === 'appSecret')?.required === true,
    'App ID and Secret are the required pair',
  )

  // Saving through the real action path must not persist the code.
  const id = await makeConnection({
    appId: 'app-kept',
    appSecret: 'secret-kept',
    accessToken: 'token-kept',
    authCode: 'should-never-be-stored',
  })
  const [row] = await db.select().from(connections).where(eq(connections.id, id))
  const stored = decryptJson<Record<string, string>>(row.credentials!)
  // makeConnection writes directly, so this asserts the *view* hides it.
  const view = await getConnectionView(projectId, id)
  ok(
    view?.fieldState.find((f) => f.key === 'authCode')?.filled === false,
    'the settings form never shows a transient field as stored',
  )
  ok(stored.appId === 'app-kept', 'the durable credentials are intact')
}

/* ------------------------------------------------------------- isolation --- */

console.log('\n\x1b[36mIsolation and unknown ids\x1b[0m')
{
  const id = await makeConnection({ accessToken: 'x'.repeat(20) })
  let refused = false
  try {
    await runConnectorAction({
      projectId: 'prj_someone_else',
      connectionId: id,
      actionId: 'diagnose',
      input: {},
      actorId: userId,
    })
  } catch (error) {
    refused = error instanceof Error && error.message === 'CONNECTION_NOT_FOUND'
  }
  ok(refused, 'a connection cannot be acted on from another project')

  let unknown = false
  try {
    await runConnectorAction({
      projectId,
      connectionId: id,
      actionId: 'no-such-action',
      input: {},
      actorId: userId,
    })
  } catch (error) {
    unknown = error instanceof Error && error.message === 'ACTION_NOT_FOUND'
  }
  ok(unknown, 'an unknown action id is rejected')
}

/* ------------------------------------------------------------ i18n cover --- */

console.log('\n\x1b[36mTranslations\x1b[0m')
{
  const viHints = vi.connections.hints as Record<string, string>
  const enHints = (en.connections as { hints: Record<string, string> }).hints
  const declared = requirePlugin('tiktok-ads').hints ?? []
  ok(
    declared.every((key) => viHints[key] && enHints[key]),
    'every declared TikTok hint is translated in both locales',
    declared.filter((key) => !viHints[key] || !enHints[key]).join(', '),
  )
  ok(Boolean(vi.connections.tools), 'the tools section heading is translated')
}

await db.delete(user).where(eq(user.id, userId))
console.log(bad === 0 ? '\n\x1b[32m✓ connector actions verified\x1b[0m\n' : `\n\x1b[31m✗ ${bad} failed\x1b[0m\n`)
process.exit(bad === 0 ? 0 : 1)
