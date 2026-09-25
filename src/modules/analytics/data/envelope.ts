import 'server-only'

import type { ConnectionContext } from '@/core/plugins/types'
import { bucketOf, type ReportPeriod } from '../period'
import { REPORT_SOURCES, type Failure, type ReportEnvelope, type ReportSource, type SourceState } from '../types'
import { warnThrottled } from '@/core/utils/log'
import { reportContexts } from './connections'

/**
 * Builds one module's answer: the project's connections for the sources the
 * module reads, each source's state as the module reads it, and whatever the
 * module makes of them.
 *
 * A source that fails is marked and listed; the rest of the answer still
 * comes back. A module never throws for one source.
 *
 * Nor does it wait on a slow one: the whole answer has REPORT_BUDGET_MS,
 * counted from its start. A read still running past it — a first read of
 * months of GMV Max reports, a TikTok Shop backfill — is answered with its
 * fallback and its source marked as still loading (the page then asks again
 * every few seconds); the read carries on meanwhile, and what it fetches is
 * kept (the day stores, the memos), so the next ask finds it done.
 */
const REPORT_BUDGET_MS = 6_000
/** A source read slower than this is named in the server log, to tell which one holds a report up. */
const SLOW_READ_MS = 20_000
/** An answer slower than this is logged with each source's time: which read held it up. */
const SLOW_ANSWER_MS = 3_000
export type ReportTools = {
  /** The connections the sources are read through; the booking file needs none. */
  contexts: Partial<Record<ReportSource, ConnectionContext>>
  period: ReportPeriod
  /** Notes days still being read, and anything to say about what was read. */
  pending: (source: ReportSource, days: number) => void
  note: (source: ReportSource, key: string, values?: Record<string, string | number>) => void
  /** Records a failure of `source`; the answer carries on without it. */
  fail: (source: ReportSource, failures: Failure[] | unknown) => void
  /** Runs a source's read; a throw becomes that source's failure and `fallback` the result. */
  attempt: <R>(source: ReportSource, read: () => Promise<R>, fallback: R) => Promise<R>
}

/** What a read past the budget answers with, told apart from any value a read may give. */
const LATE = Symbol('late')

const SOURCE_LABEL: Record<ReportSource, string> = {
  booking: 'Dữ liệu booking',
  tiktokShop: 'TikTok Shop',
  tiktokAds: 'TikTok Ads',
  sapo: 'Sapo',
}

export async function buildReport<T>(
  moduleId: string,
  projectId: string,
  period: ReportPeriod,
  build: (tools: ReportTools) => Promise<T>,
): Promise<ReportEnvelope<T>> {
  const started = Date.now()
  const contexts = await reportContexts(projectId)
  // Each read's time within this answer (a source read twice keeps its longest), for the slow-answer log.
  const took: Partial<Record<ReportSource, { ms: number; late: boolean }>> = {}
  const clock = (source: ReportSource, ms: number, late: boolean) => {
    const known = took[source]
    if (!known || ms > known.ms || late) took[source] = { ms: Math.max(ms, known?.ms ?? 0), late: late || Boolean(known?.late) }
  }
  const sources = Object.fromEntries(
    REPORT_SOURCES.map((source): [ReportSource, SourceState] => [source, { connected: source === 'booking' || Boolean(contexts[source]), ok: source === 'booking' || Boolean(contexts[source]), pendingDays: 0 }]),
  ) as Record<ReportSource, SourceState>
  const failures: Failure[] = []

  const fail: ReportTools['fail'] = (source, reason) => {
    const list = Array.isArray(reason)
      ? (reason as Failure[])
      : [{ source: SOURCE_LABEL[source], message: reason instanceof Error ? reason.message : String(reason) }]
    if (list.length === 0) return
    sources[source].ok = false
    // Several reads of one source often fail for one reason: say it once.
    for (const failure of list) {
      if (!failures.some((known) => known.source === failure.source && known.message === failure.message)) failures.push(failure)
    }
  }

  const tools: ReportTools = {
    contexts,
    period,
    pending: (source, days) => {
      sources[source].pendingDays = Math.max(sources[source].pendingDays, days)
    },
    note: (source, key, values) => {
      sources[source].note = { key, values }
    },
    fail,
    attempt: async (source, read, fallback) => {
      const began = Date.now()
      const running = read()
      // Settled after the answer has gone: nothing waits on it, but its failure is still noted in the log.
      void running.then(
        () => {
          const took = Date.now() - began
          if (took > SLOW_READ_MS) warnThrottled(`report-slow:${moduleId}:${source}`, `[report] ${moduleId}: ${source} took ${Math.round(took / 1000)} s`)
        },
        () => {},
      )
      const left = Math.max(0, started + REPORT_BUDGET_MS - Date.now())
      let timer: ReturnType<typeof setTimeout> | undefined
      const late = new Promise<typeof LATE>((resolve) => {
        timer = setTimeout(() => resolve(LATE), left)
      })
      try {
        const result = await Promise.race([running, late])
        clock(source, Date.now() - began, result === LATE)
        if (result !== LATE) return result as Awaited<typeof running>
        // Still reading: shown as loading, the page asks again shortly.
        sources[source].pendingDays = Math.max(sources[source].pendingDays, period.days.length)
        return fallback
      } catch (error) {
        clock(source, Date.now() - began, false)
        fail(source, error)
        return fallback
      } finally {
        clearTimeout(timer)
      }
    },
  }

  const data = await build(tools)
  const total = Date.now() - started
  if (total > SLOW_ANSWER_MS) {
    const parts = Object.entries(took)
      .sort(([, a], [, b]) => b.ms - a.ms)
      .map(([source, t]) => `${source} ${(t.ms / 1000).toFixed(1)} s${t.late ? ' (still reading)' : ''}`)
    console.info(`[report] ${moduleId} ${period.range}: ${(total / 1000).toFixed(1)} s · ${parts.join(' · ')}`)
  }
  const { days: _days, ...shown } = period
  return { moduleId, period: shown, generatedAt: new Date().toISOString(), sources, failures, data }
}

/**
 * Sums a per-day figure into the period's buckets. A bucket none of whose
 * days has a figure is null — a gap, never a zero.
 */
export function perBucket(period: ReportPeriod, valueOf: (day: string) => number | null | undefined): Array<number | null> {
  const sums = new Map<string, number | null>(period.buckets.map((bucket) => [bucket, null]))
  for (const day of period.days) {
    const value = valueOf(day)
    if (value === null || value === undefined) continue
    const bucket = bucketOf(day, period.granularity)
    sums.set(bucket, (sums.get(bucket) ?? 0) + value)
  }
  return period.buckets.map((bucket) => sums.get(bucket) ?? null)
}

/** The distinct items of each bucket, counted — for videos seen on several days of one month. */
export function distinctPerBucket(period: ReportPeriod, itemsOf: (day: string) => Iterable<string> | null): Array<number | null> {
  const sets = new Map<string, Set<string> | null>(period.buckets.map((bucket) => [bucket, null]))
  for (const day of period.days) {
    const items = itemsOf(day)
    if (!items) continue
    const bucket = bucketOf(day, period.granularity)
    const set = sets.get(bucket) ?? new Set<string>()
    for (const item of items) set.add(item)
    sets.set(bucket, set)
  }
  return period.buckets.map((bucket) => sets.get(bucket)?.size ?? null)
}

export const sum = (values: Array<number | null | undefined>) => values.reduce<number>((total, value) => total + (value ?? 0), 0)
