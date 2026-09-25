import 'server-only'

import { mkdir } from 'node:fs/promises'
import { readJsonFile, writeFileAtomic } from '@/core/utils/atomic-write'
import path from 'node:path'
import type { ConnectionContext } from '@/core/plugins/types'
import { shiftDay, vnDate } from '../period'

/**
 * A provider's figures kept day by day on disk, per connection — so a report
 * over three months reads each day from the provider once, and afterwards
 * only the days that can still change.
 *
 * What a day holds, how it is read and when it has to be read again belong to
 * the source (DayStoreSpec); keeping, queueing and writing are here. A read
 * answers at once with the days in hand — a day due for a re-read is served
 * as it was until the new figures land — and fills in the rest behind the
 * response, most recent first, a few at a time. `pendingDays` says how many
 * of the asked days are still on their way, which is what a page shows as
 * "syncing" and polls on.
 *
 * A day whose read failed is not pending: it is counted in `failedDays`, its
 * error is reported, and it is not tried again for RETRY_MS — a missing scope
 * or an outage must not turn every refresh of the page into a burst of calls
 * that fail the same way, nor keep the page "syncing" forever.
 *
 * Workers read with the latest context any read or warm-up handed in, so a
 * renewed token or an edited connection reaches a backfill already under way.
 *
 * The same pattern the overview's Sapo store follows (overview/data/sapo.ts),
 * without its ledger: these sources can re-read a day cheaply enough.
 */

export interface DayStoreSpec<T> {
  /** File name prefix under .data/cache, and the in-memory key. */
  name: string
  /** Bumped when T changes shape: days kept under another version are read again. */
  version: number
  /** Days older than this are dropped from the file. */
  keepDays: number
  /** Whether a day read at `computedAt` (holding `value`) still stands, or should be read again. */
  isFresh(day: string, computedAt: number, today: string, value: T): boolean
  compute(context: ConnectionContext, day: string): Promise<T>
  /** Days read at once. Providers limit per app, so keep it small. */
  workers?: number
  /**
   * What within a connection the figures belong to, when that can change
   * without the connection changing (the shop a TikTok Shop connection reads):
   * days of one scope are never served for another.
   */
  scopeOf?(context: ConnectionContext): string
}

type Kept<T> = { value: T; at: number }

type State<T> = {
  days: Record<string, Kept<T>>
  loaded: Promise<void> | null
  queue: Set<string>
  reading: Map<string, Promise<void>>
  failed: Map<string, { at: number; message: string }>
  workers: number
  persistedAt: number
  writing: Promise<void> | null
  dirty: boolean
  /** The latest context handed in: what workers read with. */
  context: ConnectionContext
}

const CACHE_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), '.data', 'cache')
const SAFE_ID = /^[A-Za-z0-9_-]+$/
const PERSIST_MS = 15_000
/** A day whose read failed waits this long before it is tried again. */
const RETRY_MS = 15 * 60_000

const registry = ((globalThis as unknown as { __adshubDayStores?: Map<string, State<unknown>> }).__adshubDayStores ??= new Map())

export type DayRead<T> = {
  values: Record<string, T>
  /** Asked days still on their way. */
  pendingDays: number
  /** Asked days whose last read failed (tried again later). */
  failedDays: number
  /** The latest failure among the asked days. */
  error: string | null
}

export function dayStore<T>(spec: DayStoreSpec<T>) {
  const workersMax = spec.workers ?? 2

  const idOf = (context: ConnectionContext) => {
    const scope = spec.scopeOf?.(context).replace(/[^A-Za-z0-9_-]/g, '') ?? ''
    return scope ? `${context.connectionId}-${scope}` : context.connectionId
  }

  function fileFor(id: string) {
    if (!SAFE_ID.test(id) || !SAFE_ID.test(spec.name)) throw new Error('Unexpected store id')
    return path.join(CACHE_DIR, `${spec.name}-${id}.json`)
  }

  async function stateFor(context: ConnectionContext): Promise<State<T>> {
    const id = idOf(context)
    const key = `${spec.name}:${spec.version}:${id}`
    let state = registry.get(key) as State<T> | undefined
    if (!state) {
      state = {
        days: {},
        loaded: null,
        queue: new Set(),
        reading: new Map(),
        failed: new Map(),
        workers: 0,
        persistedAt: 0,
        writing: null,
        dirty: false,
        context,
      }
      registry.set(key, state as State<unknown>)
    }
    state.context = context
    const current = state
    current.loaded ??= readJsonFile<{ version?: number; days?: Record<string, Kept<T>> }>(fileFor(id))
      .then((parsed) => {
        if (parsed && parsed.version === spec.version && parsed.days && typeof parsed.days === 'object') {
          current.days = { ...parsed.days, ...current.days }
        }
      })
      .catch(() => {
        /* nothing kept yet, or unreadable: start empty */
      })
    await current.loaded
    return current
  }

  async function write(state: State<T>) {
    const oldest = shiftDay(vnDate(new Date()), -spec.keepDays)
    for (const day of Object.keys(state.days)) if (day < oldest) delete state.days[day]
    await mkdir(CACHE_DIR, { recursive: true })
    const file = fileFor(idOf(state.context))
    state.persistedAt = Date.now()
    await writeFileAtomic(file, JSON.stringify({ version: spec.version, days: state.days }))
  }

  /** One write at a time; a change made during one goes in the next. */
  function persist(state: State<T>): Promise<void> {
    state.dirty = true
    state.writing ??= (async () => {
      try {
        while (state.dirty) {
          state.dirty = false
          await write(state)
        }
      } finally {
        state.writing = null
      }
    })()
    return state.writing
  }

  const recentlyFailed = (state: State<T>, day: string) => {
    const failure = state.failed.get(day)
    return failure !== undefined && Date.now() - failure.at < RETRY_MS
  }

  function readDay(state: State<T>, day: string): Promise<void> {
    const running = state.reading.get(day)
    if (running) return running
    const reading = spec
      .compute(state.context, day)
      .then(async (value) => {
        state.days[day] = { value, at: Date.now() }
        state.failed.delete(day)
        // The day was read: a save that fails does not make it a failed read (the next save carries it).
        if (Date.now() - state.persistedAt > PERSIST_MS) await persist(state).catch((error) => console.warn(`[day-store] save failed: ${error instanceof Error ? error.message : error}`))
      })
      .catch((error) => {
        state.failed.set(day, { at: Date.now(), message: error instanceof Error ? error.message : String(error) })
      })
      .finally(() => state.reading.delete(day))
    state.reading.set(day, reading)
    return reading
  }

  function enqueue(state: State<T>, days: string[]) {
    for (const day of days) if (!state.reading.has(day) && !recentlyFailed(state, day)) state.queue.add(day)
    while (state.workers < Math.min(workersMax, state.queue.size)) {
      state.workers += 1
      void (async () => {
        try {
          while (state.queue.size > 0) {
            const day = [...state.queue].sort().at(-1)!
            state.queue.delete(day)
            await readDay(state, day)
          }
        } finally {
          state.workers -= 1
          if (state.workers === 0) await persist(state).catch(() => {})
        }
      })()
    }
  }

  const due = (state: State<T>, days: string[], today: string) =>
    days.filter((day) => {
      const kept = state.days[day]
      return !kept || !spec.isFresh(day, kept.at, today, kept.value)
    })

  return {
    /**
     * The kept figures for `days`; missing and outdated ones are read behind
     * the response. `wait` lists days worth waiting for (today, usually) when
     * none is kept yet, for at most `waitMs`.
     */
    async read(context: ConnectionContext, days: string[], options: { wait?: string[]; waitMs?: number } = {}): Promise<DayRead<T>> {
      const state = await stateFor(context)
      const today = vnDate(new Date())
      const stale = due(state, days, today)

      const waitFor = (options.wait ?? []).filter((day) => days.includes(day) && !state.days[day] && !recentlyFailed(state, day))
      if (waitFor.length > 0) {
        // Read beside the workers, so saved here: a worker's final save may already have run.
        const all = Promise.all(waitFor.map((day) => readDay(state, day))).then(() => persist(state).catch(() => {}))
        await Promise.race([all, new Promise((resolve) => setTimeout(resolve, options.waitMs ?? 20_000))])
      }
      const rest = stale.filter((day) => !waitFor.includes(day))
      if (rest.length > 0) enqueue(state, rest)

      const values: Record<string, T> = {}
      let pendingDays = 0
      let failedDays = 0
      let error: { at: number; message: string } | null = null
      for (const day of days) {
        if (state.days[day]) values[day] = state.days[day].value
        const failure = state.failed.get(day)
        if (failure && !state.reading.has(day) && !state.queue.has(day)) {
          if (!state.days[day]) failedDays += 1
          if (!error || failure.at > error.at) error = failure
        } else if (!state.days[day]) pendingDays += 1
      }
      return { values, pendingDays, failedDays, error: error?.message ?? null }
    },

    /** Reads what is due among `days`, without answering — the background's warm-up. */
    async warm(context: ConnectionContext, days: string[]): Promise<void> {
      const state = await stateFor(context)
      const stale = due(state, days, vnDate(new Date()))
      if (stale.length > 0) enqueue(state, stale)
    },
  }
}

/**
 * The usual rule for order data: today is read again after `todayMs`, the last
 * `settleDays` days (still changing — cancellations, settled commissions)
 * after `recentMs`, and anything older never again.
 */
export function settlingFreshness(options: { todayMs: number; recentMs: number; settleDays: number }) {
  return (day: string, computedAt: number, today: string) => {
    const age = Date.now() - computedAt
    if (day === today) return age < options.todayMs
    // A day read while it was still today is not whole.
    if (computedAt < Date.parse(`${shiftDay(day, 1)}T00:00:00+07:00`)) return false
    if (day >= shiftDay(today, -options.settleDays)) return age < options.recentMs
    // Read once after it settled, then kept.
    return computedAt >= Date.parse(`${shiftDay(day, options.settleDays + 1)}T00:00:00+07:00`) || age < options.recentMs
  }
}
