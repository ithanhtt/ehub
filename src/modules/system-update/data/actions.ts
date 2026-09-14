'use server'

import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import path from 'node:path'
import { revalidatePath } from 'next/cache'
import { assertSystemAdmin } from '@/core/auth/session'
import { db } from '@/core/db/client'
import { auditLogs } from '@/core/db/schema/audit'
import { createId } from '@/core/utils/id'
import { MAX_BUNDLE_BYTES, packBundle } from '../../../../scripts/update-bundle.mjs'
import { UPDATE_STEPS, type ConfirmOutcome, type SendFailure, type SendOutcome, type VersionSuggestion } from '../types'
import { bumpVersion, compareVersions, isVersion } from '../version'
import { isReceiver, senderTarget, signingKey } from './config'
import { receiverProblems } from './problems'
import { confirmationCode, sameCode, uploadSignature } from './signing'
import { MAX_ATTEMPTS, UPDATER_SCRIPT, discardPending, isApplying, readPending, updatePending, writeStatus } from './store'

/**
 * The System update page's two halves.
 *
 * On the development machine, sendUpdate packs this checkout, signs it and
 * sends it to the server, then shows the confirmation code. On the server,
 * confirmUpdate checks the code an administrator typed and hands the update
 * to the updater (scripts/apply-update.mjs). Both are for platform
 * Administrators only, and both are written to the audit trail.
 */

async function audit(actorId: string | null, action: string, targetId: string, detail: Record<string, unknown>) {
  await db.insert(auditLogs).values({ id: createId('aud'), projectId: null, actorId, action, targetType: 'system', targetId, detail })
}

const SEND_FAILURES: Record<string, SendFailure> = {
  signature: 'signature',
  stale: 'stale',
  replayed: 'signature',
  busy: 'busy',
  bundle: 'bundle',
  tooLarge: 'tooLarge',
  notReceiver: 'notReceiver',
}

async function localVersion(): Promise<string | null> {
  try {
    const pkg = JSON.parse(await readFile(path.join(/*turbopackIgnore: true*/ process.cwd(), 'package.json'), 'utf8')) as { version?: string }
    return pkg.version ?? null
  } catch {
    return null
  }
}

/** The server's version, from its health check (the release marker every install and update writes). */
async function serverVersion(url: URL): Promise<string | null> {
  try {
    const response = await fetch(new URL('/api/health', url), { cache: 'no-store', signal: AbortSignal.timeout(5_000) })
    const body = (await response.json()) as { version?: unknown }
    return typeof body.version === 'string' && isVersion(body.version) ? body.version : null
  } catch {
    return null
  }
}

/** The version the send dialog proposes: one patch above whichever is higher, the server's or this checkout's. */
export async function suggestVersion(): Promise<VersionSuggestion | null> {
  try {
    await assertSystemAdmin()
  } catch {
    return null
  }
  const target = senderTarget()
  const [server, local] = await Promise.all([target?.url ? serverVersion(target.url) : null, localVersion()])
  const base = compareVersions(server, local) >= 0 ? server : local
  return { server, local, suggested: bumpVersion(base) }
}

export async function sendUpdate(requested: string): Promise<SendOutcome> {
  let admin
  try {
    admin = await assertSystemAdmin()
  } catch {
    return { ok: false, reason: 'forbidden' }
  }
  const key = signingKey()
  const target = senderTarget()
  if (!key || !target?.url) return { ok: false, reason: 'notConfigured' }
  const version = typeof requested === 'string' ? requested.trim() : ''
  if (!isVersion(version)) return { ok: false, reason: 'version' }

  let bundle
  try {
    bundle = packBundle(process.cwd(), { version, label: `${version} · ${hostname()}` })
  } catch (error) {
    return { ok: false, reason: 'pack', detail: error instanceof Error ? error.message : String(error) }
  }
  if (bundle.buffer.length > MAX_BUNDLE_BYTES) return { ok: false, reason: 'tooLarge' }

  const timestamp = Date.now()
  const nonce = randomBytes(16).toString('hex')
  let response: Response
  try {
    response = await fetch(new URL('/api/system/updates', target.url), {
      method: 'POST',
      body: new Uint8Array(bundle.buffer),
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-AdsHub-Timestamp': String(timestamp),
        'X-AdsHub-Nonce': nonce,
        'X-AdsHub-Signature': uploadSignature(key, timestamp, nonce, bundle.sha256),
        'X-AdsHub-Source': hostname().slice(0, 60),
      },
      signal: AbortSignal.timeout(180_000),
    })
  } catch (error) {
    return { ok: false, reason: 'network', detail: error instanceof Error ? error.message : String(error) }
  }

  const body = (await response.json().catch(() => null)) as
    | { id?: string; expiresAt?: string; error?: string; detail?: string }
    | null
  if (!response.ok || !body?.id || !body.expiresAt) {
    const reason = (body?.error && SEND_FAILURES[body.error]) || 'server'
    return { ok: false, reason, detail: body?.detail ?? `HTTP ${response.status}` }
  }

  await audit(admin.id, 'system.update.send', body.id, {
    server: target.url.origin,
    version: bundle.version,
    files: bundle.files,
    bytes: bundle.buffer.length,
  })
  return {
    ok: true,
    id: body.id,
    code: confirmationCode(key, body.id, bundle.sha256),
    version: bundle.version,
    files: bundle.files,
    bytes: bundle.buffer.length,
    expiresAt: body.expiresAt,
    server: target.url.origin,
  }
}

export async function confirmUpdate(id: string, code: string): Promise<ConfirmOutcome> {
  let admin
  try {
    admin = await assertSystemAdmin()
  } catch {
    return { ok: false, reason: 'forbidden' }
  }
  const key = signingKey()
  if (!isReceiver() || !key) return { ok: false, reason: 'notReceiver' }
  if (receiverProblems().length > 0) return { ok: false, reason: 'problem' }
  if (await isApplying()) return { ok: false, reason: 'busy' }

  const pending = await readPending()
  if (!pending || pending.id !== id || pending.confirmedAt) return { ok: false, reason: 'notFound' }
  if (Date.parse(pending.expiresAt) <= Date.now()) {
    await discardPending()
    return { ok: false, reason: 'expired' }
  }

  if (!sameCode(code, confirmationCode(key, pending.id, pending.sha256))) {
    const attempts = pending.attempts + 1
    await audit(admin.id, 'system.update.wrong-code', pending.id, { attempts })
    if (attempts >= MAX_ATTEMPTS) {
      await discardPending()
      return { ok: false, reason: 'locked' }
    }
    await updatePending({ ...pending, attempts })
    return { ok: false, reason: 'wrongCode', remaining: MAX_ATTEMPTS - attempts }
  }

  const confirmedAt = new Date().toISOString()
  await updatePending({ ...pending, confirmedAt, confirmedBy: admin.email })
  await writeStatus({
    id: pending.id,
    version: pending.version,
    label: pending.label,
    state: 'queued',
    startedAt: confirmedAt,
    endedAt: null,
    steps: UPDATE_STEPS.map((step) => ({ key: step, state: 'pending' })),
    release: null,
    previous: null,
    backup: null,
    error: null,
    confirmedBy: admin.email,
  })
  // The updater hands itself off at once (--launch), so the app restarting later cannot stop it.
  spawn(process.execPath, [UPDATER_SCRIPT, '--launch', pending.id], {
    cwd: process.cwd(),
    detached: true,
    stdio: 'ignore',
    env: process.env,
  }).unref()

  await audit(admin.id, 'system.update.confirm', pending.id, { version: pending.version, sha256: pending.sha256 })
  revalidatePath('/admin/updates')
  return { ok: true }
}

export async function discardUpdate(id: string): Promise<{ ok: boolean }> {
  let admin
  try {
    admin = await assertSystemAdmin()
  } catch {
    return { ok: false }
  }
  const pending = await readPending()
  if (!pending || pending.id !== id || pending.confirmedAt) return { ok: false }
  await discardPending()
  await audit(admin.id, 'system.update.discard', id, { version: pending.version })
  revalidatePath('/admin/updates')
  return { ok: true }
}
