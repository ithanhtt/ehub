import 'server-only'

import { randomBytes } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { PendingUpdate, UpdateRecord, UpdateStatus } from '../types'

/**
 * Where updates wait and report, under .data/updates — the server's shared
 * data, the same for every release:
 *
 *   pending/<id>.bundle, .json   the one update waiting for its code
 *   status.json                  the run going on, or the last one (written by the updater)
 *   history.json                 past runs, newest first
 *   logs/<id>.log                each run's full log
 *   apply.lock                   the updater's pid while it runs
 */

// Read at run time only. The comment keeps `next build` from following .data — on the server a symlink
// out of the release, which Turbopack refuses ("points out of the filesystem root") and fails the build.
const UPDATES = path.join(/*turbopackIgnore: true*/ process.cwd(), '.data', 'updates')
const PENDING = path.join(UPDATES, 'pending')
const LOCK = path.join(UPDATES, 'apply.lock')

/** How long an update waits for its code, and how many wrong codes it survives. */
export const CONFIRM_TTL_MS = 30 * 60_000
export const MAX_ATTEMPTS = 5

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T
  } catch {
    return null
  }
}

async function writeJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  await writeFile(temp, JSON.stringify(value, null, 2), 'utf8')
  await rename(temp, file)
}

const pendingFiles = (id: string) => ({
  meta: path.join(PENDING, `${id}.json`),
  bundle: path.join(PENDING, `${id}.bundle`),
})

/** The update waiting for its code, if any (there is only ever one). */
export async function readPending(): Promise<PendingUpdate | null> {
  const names = await readdir(PENDING).catch(() => [] as string[])
  const meta = names.find((name) => name.endsWith('.json'))
  return meta ? readJson<PendingUpdate>(path.join(PENDING, meta)) : null
}

/** Keeps a received update until it is confirmed, discarded or expires; any earlier one gives way to it. */
export async function savePending(
  bundle: Buffer,
  about: Pick<PendingUpdate, 'version' | 'label' | 'sha256' | 'files' | 'source'>,
): Promise<PendingUpdate> {
  await rm(PENDING, { recursive: true, force: true })
  await mkdir(PENDING, { recursive: true })
  const now = Date.now()
  const pending: PendingUpdate = {
    ...about,
    id: `${now.toString(36)}-${randomBytes(6).toString('hex')}`,
    bytes: bundle.length,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + CONFIRM_TTL_MS).toISOString(),
    attempts: 0,
    confirmedAt: null,
    confirmedBy: null,
  }
  const files = pendingFiles(pending.id)
  await writeFile(files.bundle, bundle)
  await writeJson(files.meta, pending)
  return pending
}

export async function updatePending(pending: PendingUpdate): Promise<void> {
  await writeJson(pendingFiles(pending.id).meta, pending)
}

export async function discardPending(): Promise<void> {
  await rm(PENDING, { recursive: true, force: true })
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

async function updaterAlive(status: UpdateStatus): Promise<boolean> {
  const pid = Number((await readFile(LOCK, 'utf8').catch(() => '')).trim())
  if (Number.isInteger(pid) && pid > 0 && isAlive(pid)) return true
  // Handed to the updater a moment ago; it has not taken the lock yet.
  return status.state === 'queued' && Date.now() - Date.parse(status.startedAt) < 60_000
}

/**
 * The run going on, or the last one. A run that says it is still going but
 * whose updater is gone is reported as interrupted.
 */
export async function readStatus(): Promise<UpdateStatus | null> {
  const status = await readJson<UpdateStatus>(path.join(UPDATES, 'status.json'))
  if (!status) return null
  if ((status.state === 'queued' || status.state === 'running') && !(await updaterAlive(status))) {
    return { ...status, state: 'interrupted' }
  }
  return status
}

export async function writeStatus(status: UpdateStatus): Promise<void> {
  await writeJson(path.join(UPDATES, 'status.json'), status)
}

/** Whether an update is being applied right now. */
export async function isApplying(): Promise<boolean> {
  const status = await readStatus()
  return status?.state === 'queued' || status?.state === 'running'
}

export async function readHistory(): Promise<UpdateRecord[]> {
  return (await readJson<UpdateRecord[]>(path.join(UPDATES, 'history.json'))) ?? []
}

/** The last lines of an update's log. */
export async function readLogTail(id: string, lines = 200): Promise<string[]> {
  if (!/^[a-z0-9-]{8,64}$/.test(id)) return []
  const text = await readFile(path.join(UPDATES, 'logs', `${id}.log`), 'utf8').catch(() => '')
  return text.split('\n').filter(Boolean).slice(-lines)
}

/** Where the updater lives, in the release that is live now. */
export const UPDATER_SCRIPT = path.join(/*turbopackIgnore: true*/ process.cwd(), 'scripts', 'apply-update.mjs')
