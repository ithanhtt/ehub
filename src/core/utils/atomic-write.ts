import 'server-only'

import { randomBytes } from 'node:crypto'
import { open, readFile, rename, rm } from 'node:fs/promises'

/**
 * Writes a file so that a reader sees the old content or the new, never half
 * of either: to a temporary file of its own beside it (a fixed `.tmp` name is
 * shared by two writers — a hot reload leaves one behind), flushed to disk,
 * then renamed over the target.
 *
 * On Windows the rename is refused (EPERM / EBUSY / EACCES) while another
 * program holds the target open — OneDrive syncing it, an antivirus scan —
 * for a moment; it is tried again a few times before giving up, and the
 * temporary file is removed either way.
 */
const LOCKED = new Set(['EPERM', 'EBUSY', 'EACCES'])
const ATTEMPTS = 6

export async function writeFileAtomic(file: string, content: string): Promise<void> {
  const temp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  try {
    const handle = await open(temp, 'w')
    try {
      await handle.writeFile(content, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    for (let attempt = 1; ; attempt++) {
      try {
        await rename(temp, file)
        return
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code ?? ''
        if (!LOCKED.has(code) || attempt >= ATTEMPTS) throw error
        await new Promise((resolve) => setTimeout(resolve, 100 * attempt))
      }
    }
  } finally {
    await rm(temp, { force: true }).catch(() => {})
  }
}

/**
 * A kept JSON file's content, or null when there is none. One that no longer
 * parses (a crash mid-write before files were written atomically, a disk
 * fault) is set aside as `<file>.corrupt-<time>` rather than silently
 * written over by the next save, so what it held can still be looked at.
 */
export async function readJsonFile<T>(file: string): Promise<T | null> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch {
    return null
  }
  try {
    return JSON.parse(text) as T
  } catch {
    const aside = `${file}.corrupt-${Date.now()}`
    await rename(file, aside).catch(() => {})
    console.warn(`[cache] ${file} could not be read; kept as ${aside}, starting empty`)
    return null
  }
}
