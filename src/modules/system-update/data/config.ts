import 'server-only'

import { existsSync, realpathSync } from 'node:fs'
import path from 'node:path'

/**
 * How this machine takes part in updates, from its environment:
 *
 *   UPDATE_SIGNING_KEY   the same secret on both machines (openssl rand -base64 32):
 *                        signs every bundle and yields every confirmation code
 *   UPDATE_SERVER_URL    on the development machine: the server to send updates to
 *   UPDATE_RECEIVER=1    on the server: accept updates (deploy/install.sh sets it)
 */

/** At least 32 bytes of key, written as base64. */
export function signingKey(): Buffer | null {
  const raw = process.env.UPDATE_SIGNING_KEY?.trim()
  if (!raw) return null
  const key = Buffer.from(raw, 'base64')
  return key.length >= 32 ? key : null
}

/**
 * The server this machine sends updates to. HTTPS only — a bundle is the
 * whole source — except to the machine itself, for trying the flow locally.
 */
export function senderTarget(): { raw: string; url: URL | null } | null {
  const raw = process.env.UPDATE_SERVER_URL?.trim()
  if (!raw) return null
  try {
    const url = new URL(raw)
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
    return { raw, url: url.protocol === 'https:' || local ? url : null }
  } catch {
    return { raw, url: null }
  }
}

export function isReceiver(): boolean {
  return /^(1|true|yes)$/i.test(process.env.UPDATE_RECEIVER?.trim() ?? '')
}

/**
 * The server's release layout (see deploy/install.sh), found from where this
 * app runs: …/releases/<id>, beside …/current and …/shared. Null when the app
 * runs anywhere else — then it cannot update itself.
 */
export function releaseLayout(): { home: string; release: string } | null {
  try {
    const release = realpathSync(process.cwd())
    const releases = path.dirname(release)
    if (path.basename(releases) !== 'releases') return null
    const home = path.dirname(releases)
    if (!existsSync(path.join(home, 'current')) || !existsSync(path.join(home, 'shared'))) return null
    return { home, release }
  } catch {
    return null
  }
}
