import { readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'

/**
 * The provider caches' share of housekeeping (housekeeping.ts), apart so it
 * can be tried on a scratch directory: plain file rules, no database.
 */

const CACHE_STALE_DAYS = 90
const TEMP_STALE_MS = 60 * 60_000
const CORRUPT_KEEP = 3
const CORRUPT_DAYS = 14
const DAY_MS = 24 * 3600_000

/** Every cache file names its connection (createId('con') → con_…). */
const CONNECTION_ID = /con_[A-Za-z0-9]+/
/**
 * Kept however old while their connection exists: the ROI-target history
 * TikTok keeps nowhere else, and the Sapo store whose returns before its
 * ledger began cannot be read again.
 */
const IRREPLACEABLE = /^(gmv-targets|sapo-days)-/

/**
 * What goes from the cache directory, by the rules above. Exported for tests:
 * `known` is the set of connection ids that exist; nothing is removed for
 * lack of a connection when that set could not be read (the caller skips the
 * sweep on a database error).
 */
export async function sweepCache(dir: string, known: Set<string>, now: number): Promise<{ files: number; bytes: number }> {
  const names = await readdir(dir).catch(() => [] as string[])
  const out = { files: 0, bytes: 0 }
  const remove = async (name: string, size: number) => {
    await rm(path.join(dir, name), { force: true })
    out.files += 1
    out.bytes += size
  }

  const corrupt: Array<{ name: string; mtime: number; size: number }> = []
  for (const name of names) {
    const info = await stat(path.join(dir, name)).catch(() => null)
    if (!info?.isFile()) continue
    const age = now - info.mtimeMs
    if (name.includes('.corrupt-')) {
      corrupt.push({ name, mtime: info.mtimeMs, size: info.size })
      continue
    }
    if (name.endsWith('.tmp')) {
      // A writer renames its temporary file within moments; one this old was left by a crash.
      if (age > TEMP_STALE_MS) await remove(name, info.size)
      continue
    }
    if (!name.endsWith('.json')) continue
    const id = CONNECTION_ID.exec(name)?.[0]
    const stale = age > CACHE_STALE_DAYS * DAY_MS && !IRREPLACEABLE.test(name)
    if ((id && !known.has(id)) || stale) await remove(name, info.size)
  }

  // Set aside to be looked at, not kept for ever: the newest few, for a fortnight.
  corrupt.sort((a, b) => b.mtime - a.mtime)
  for (const [i, file] of corrupt.entries()) {
    if (i >= CORRUPT_KEEP || now - file.mtime > CORRUPT_DAYS * DAY_MS) await remove(file.name, file.size)
  }
  return out
}
