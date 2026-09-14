import 'server-only'

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { UpdateOverview } from '../types'
import { isReceiver, senderTarget, signingKey } from './config'
import { receiverProblems } from './problems'
import { MAX_ATTEMPTS, readHistory, readLogTail, readPending, readStatus } from './store'

/** The release this app runs, from the marker every install and update writes into its directory. */
export async function currentRelease(): Promise<{ id: string; version: string | null } | null> {
  try {
    const marker = JSON.parse(await readFile(path.join(/*turbopackIgnore: true*/ process.cwd(), '.release.json'), 'utf8')) as {
      id?: string
      version?: string
    }
    return marker.id ? { id: marker.id, version: marker.version ?? null } : null
  } catch {
    return null
  }
}

/** Everything the System update page shows, for this machine's part in updates. */
export async function updateOverview(): Promise<UpdateOverview> {
  const key = signingKey()
  const target = senderTarget()
  const receiving = isReceiver()

  const problems = receiving ? receiverProblems() : []

  const [release, pending, status, history] = await Promise.all([
    currentRelease(),
    receiving ? readPending() : null,
    receiving ? readStatus() : null,
    receiving ? readHistory() : [],
  ])

  return {
    release,
    sender: target
      ? { server: target.url?.origin ?? target.raw, problem: !target.url ? 'url' : !key ? 'key' : null }
      : null,
    receiver: receiving ? { problems, attemptsAllowed: MAX_ATTEMPTS } : null,
    pending: pending && Date.parse(pending.expiresAt) > Date.now() ? pending : null,
    status,
    history,
    log: status ? await readLogTail(status.id) : [],
  }
}
