import type { BookingListRow } from '@/features/bookings/queries'
import { fold } from '@/modules/overview/shared/fold'
import { tierRank } from './fields'
import { AIR_STATES, airStandingOf, type AirStanding, type AirState } from './triage'

/**
 * The booking list's columns, filters, sorting and figures — everything the
 * page works out from the rows, kept apart from how it draws them. Nothing
 * here renders; the page runs it inside useMemo, so a list of thousands is
 * prepared once per change of the rows, and filtering and sorting only walk
 * what was prepared.
 */

/** The list's columns, in the order the team reads a booking. */
export type ColumnId = 'code' | 'bookedOn' | 'month' | 'product' | 'koc' | 'cost' | 'plannedAirOn' | 'airedOn' | 'airStatus' | 'orders' | 'revenue' | 'tier' | 'video' | 'note'

export const COLUMNS: readonly ColumnId[] = ['code', 'bookedOn', 'month', 'product', 'koc', 'cost', 'plannedAirOn', 'airedOn', 'airStatus', 'orders', 'revenue', 'tier', 'video', 'note']

/** Always shown: the code is how a row is named, and the column the list is pinned by. */
export const FIXED_COLUMNS: ReadonlySet<ColumnId> = new Set(['code', 'koc'])

/** Right-aligned, in figures of the same width. */
export const NUMERIC_COLUMNS: ReadonlySet<ColumnId> = new Set(['cost', 'orders', 'revenue'])

export type SortState = { column: ColumnId; desc: boolean }

export const SORT_DEFAULT: SortState = { column: 'bookedOn', desc: true }

const isColumn = (value: unknown): value is ColumnId => typeof value === 'string' && (COLUMNS as readonly string[]).includes(value)

export function acceptSort(value: unknown): SortState | null {
  const v = value as Partial<SortState> | null
  return v && isColumn(v.column) && typeof v.desc === 'boolean' ? { column: v.column, desc: v.desc } : null
}

export function acceptHidden(value: unknown): ColumnId[] | null {
  return Array.isArray(value) ? value.filter(isColumn).filter((column) => !FIXED_COLUMNS.has(column)) : null
}

/** The list's filters, beside the campaign tabs and the quick views. Empty means "any". */
export type ListFilters = {
  /** Searched, accents and case aside, in the code, KOC, product, note, video id, contact and campaign. */
  q: string
  /** YYYY-MM, of the booking date. */
  months: string[]
  air: AirState[]
  /** Tiers as stored; NO_TIER for bookings without one. */
  tiers: string[]
  /** Booking dates, YYYY-MM-DD or ''. */
  from: string
  to: string
}

export const NO_TIER = '—'

export const NO_FILTERS: ListFilters = { q: '', months: [], air: [], tiers: [], from: '', to: '' }

export const hasFilters = (filters: ListFilters) =>
  Boolean(filters.q.trim() || filters.months.length || filters.air.length || filters.tiers.length || filters.from || filters.to)

const DAY = /^\d{4}-\d{2}-\d{2}$/
const strings = (value: unknown, max: number) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.length <= max).slice(0, 60) : [])

function acceptFilters(value: unknown): ListFilters | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  return {
    q: typeof v.q === 'string' ? v.q.slice(0, SEARCH_MAX) : '',
    months: strings(v.months, 7).filter((m) => /^\d{4}-\d{2}$/.test(m)),
    air: strings(v.air, 20).filter((s): s is AirState => (AIR_STATES as readonly string[]).includes(s)),
    tiers: strings(v.tiers, 60),
    from: typeof v.from === 'string' && DAY.test(v.from) ? v.from : '',
    to: typeof v.to === 'string' && DAY.test(v.to) ? v.to : '',
  }
}

/** The longest search remembered — the choices travel in a small cookie. */
export const SEARCH_MAX = 60

/** Projects whose filters are remembered, the most recently filtered kept. */
const REMEMBERED_PROJECTS = 5

/** The remembered filters, by project. */
export type FilterMemory = Record<string, ListFilters>

export function acceptFilterMemory(value: unknown): FilterMemory | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const out: FilterMemory = {}
  for (const [project, filters] of Object.entries(value as Record<string, unknown>).slice(-REMEMBERED_PROJECTS)) {
    const accepted = acceptFilters(filters)
    if (accepted) out[project] = accepted
  }
  return out
}

/** The memory with one project's filters set (moved to the most recent), no more than REMEMBERED_PROJECTS kept; cleared filters are forgotten. */
export function rememberFilters(memory: FilterMemory, projectId: string, filters: ListFilters): FilterMemory {
  const { [projectId]: _previous, ...others } = memory
  const kept = Object.entries(others).slice(-(REMEMBERED_PROJECTS - 1))
  return Object.fromEntries(hasFilters(filters) ? [...kept, [projectId, { ...filters, q: filters.q.slice(0, SEARCH_MAX) }]] : kept)
}

/** A row with what the list works out from it, once. */
export type Prepared = {
  row: BookingListRow
  standing: AirStanding
  /** YYYY-MM of the booking date. */
  month: string
  /** The searchable text, folded. */
  text: string
}

export function prepare(rows: readonly BookingListRow[], today: string, campaignName: ReadonlyMap<string, string>): Prepared[] {
  return rows.map((row) => ({
    row,
    standing: airStandingOf(row, today),
    month: row.bookedOn.slice(0, 7),
    text: fold(
      [row.code, row.kocHandle, `@${row.kocHandle}`, row.kocName, row.kocContact, row.product, row.note, row.videoId, row.campaignId ? campaignName.get(row.campaignId) : '']
        .filter(Boolean)
        .join(' '),
    ),
  }))
}

export function matches(item: Prepared, filters: ListFilters, needle: string): boolean {
  const { row } = item
  if (needle && !item.text.includes(needle)) return false
  if (filters.months.length && !filters.months.includes(item.month)) return false
  if (filters.air.length && !filters.air.includes(item.standing.state)) return false
  if (filters.tiers.length && !filters.tiers.includes(row.kocTier ?? NO_TIER)) return false
  if (filters.from && row.bookedOn < filters.from) return false
  if (filters.to && row.bookedOn > filters.to) return false
  return true
}

/** The search as matched: folded, trimmed, a leading @ dropped. */
export const needleOf = (q: string) => fold(q.trim()).replace(/^@/, '')

/** Air states in the order a booker cares about them: what is late first. */
const AIR_ORDER: Record<AirState, number> = Object.fromEntries(AIR_STATES.map((state, i) => [state, i])) as Record<AirState, number>

type Key = string | number | null

const collator = new Intl.Collator('vi', { numeric: true, sensitivity: 'base' })

function keyOf(item: Prepared, column: ColumnId): Key {
  const { row, standing } = item
  switch (column) {
    case 'code':
      return row.code
    case 'bookedOn':
    case 'month':
      return row.bookedOn
    case 'product':
      return row.product
    case 'koc':
      return row.kocName || row.kocHandle
    case 'cost':
      return row.cost
    case 'plannedAirOn':
      return row.plannedAirOn
    case 'airedOn':
      return row.airedOn
    case 'airStatus':
      // Within a state, the most days (late, overdue, waiting) first.
      return AIR_ORDER[standing.state] * 100_000 - standing.days
    case 'orders':
      return row.resultOrders
    case 'revenue':
      return row.resultRevenue
    case 'tier':
      return row.kocTier ? tierRank(row.kocTier) * 1000 : null
    case 'video':
      return row.videoId ? 1 : null
    case 'note':
      return row.note
  }
}

/**
 * The rows in the order asked for; a row without the value (no air date, no
 * results) goes last either way, and ties keep the newest booking first.
 */
export function sortRows(items: readonly Prepared[], sort: SortState): Prepared[] {
  const direction = sort.desc ? -1 : 1
  const keyed = items.map((item) => ({ item, key: keyOf(item, sort.column) }))
  keyed.sort((a, b) => {
    if (a.key === null || a.key === '') return b.key === null || b.key === '' ? tie(a.item, b.item) : 1
    if (b.key === null || b.key === '') return -1
    const order = typeof a.key === 'number' && typeof b.key === 'number' ? a.key - b.key : collator.compare(String(a.key), String(b.key))
    return order !== 0 ? order * direction : tie(a.item, b.item)
  })
  return keyed.map(({ item }) => item)
}

const tie = (a: Prepared, b: Prepared) => (a.row.bookedOn === b.row.bookedOn ? collator.compare(b.row.code, a.row.code) : a.row.bookedOn < b.row.bookedOn ? 1 : -1)

/** The figures of the rows shown; cancelled bookings are counted apart and left out of every sum. */
export type ListSummary = {
  bookings: number
  cancelled: number
  cost: number
  aired: number
  overdue: number
  orders: number
  revenue: number
  /** Bookings whose results are known (synced or typed). */
  withResults: number
  /** Revenue per đồng booked; null without cost. */
  roi: number | null
}

export function summarise(items: readonly Prepared[]): ListSummary {
  const out: ListSummary = { bookings: 0, cancelled: 0, cost: 0, aired: 0, overdue: 0, orders: 0, revenue: 0, withResults: 0, roi: null }
  for (const { row, standing } of items) {
    if (row.status === 'cancelled') {
      out.cancelled += 1
      continue
    }
    out.bookings += 1
    out.cost += row.cost
    if (row.airedOn) out.aired += 1
    if (standing.state === 'overdue') out.overdue += 1
    if (row.resultOrders !== null || row.resultRevenue !== null) out.withResults += 1
    out.orders += row.resultOrders ?? 0
    out.revenue += row.resultRevenue ?? 0
  }
  out.roi = out.cost > 0 ? out.revenue / out.cost : null
  return out
}

/** The months, tiers and air states present in the rows — what the filter menus offer. */
export function filterOptions(items: readonly Prepared[]) {
  const months = new Set<string>()
  const tiers = new Set<string>()
  const air = new Set<AirState>()
  for (const { row, month, standing } of items) {
    months.add(month)
    tiers.add(row.kocTier ?? NO_TIER)
    air.add(standing.state)
  }
  return {
    months: [...months].sort().reverse(),
    tiers: [...tiers].sort((a, b) => (a === NO_TIER ? 1 : b === NO_TIER ? -1 : tierRank(a) - tierRank(b) || collator.compare(a, b))),
    air: AIR_STATES.filter((state) => air.has(state)),
  }
}
