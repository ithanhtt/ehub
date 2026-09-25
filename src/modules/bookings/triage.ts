import type { BookingStatus } from '@/core/db/schema/bookings'

/**
 * What in the booking data needs someone's hand, so the page can lead with
 * it instead of leaving the booker to scan the list:
 *
 *   overdue  its planned air date has passed and it has not aired — chase the KOC
 *   late     no air date was agreed, it was booked a week or more ago and
 *            still has not aired — chase the KOC
 *   noVideo  marked aired but without its video — the reports cannot tie
 *            orders to it until the link is added
 *
 * Cancelled bookings need nothing.
 */

/** A pending booking this many days old is late, when no air date was agreed. */
export const LATE_AFTER_DAYS = 7

export type Attention = 'overdue' | 'late' | 'noVideo'

type Triaged = { status: BookingStatus; bookedOn: string; plannedAirOn?: string | null; airedOn?: string | null; videoId: string | null; cost: number }

/** Whole days from one YYYY-MM-DD to another. */
export const ageInDays = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000)

export function attentionOf(row: Omit<Triaged, 'cost'>, today: string): Attention | null {
  if (row.status === 'pending') {
    if (row.plannedAirOn) return row.plannedAirOn < today ? 'overdue' : null
    return ageInDays(row.bookedOn, today) >= LATE_AFTER_DAYS ? 'late' : null
  }
  if (row.status === 'aired' && !row.videoId) return 'noVideo'
  return null
}

/**
 * Where a booking's airing stands, as the list's "Trạng thái air" says it —
 * worked out, never stored, so it is right whichever day the page is opened:
 *
 *   cancelled    called off
 *   aired        aired, on or before the day agreed (or none was)
 *   airedLate    aired `days` after the day agreed
 *   overdue      not aired, `days` past the day agreed
 *   today        not aired, due today
 *   waiting      not aired, due in `days`
 *   unscheduled  not aired, no day agreed
 *
 * "Today" is Vietnam's (vnDate), like every date the booking file holds.
 */
export type AirState = 'cancelled' | 'aired' | 'airedLate' | 'overdue' | 'today' | 'waiting' | 'unscheduled'

export const AIR_STATES: readonly AirState[] = ['overdue', 'today', 'waiting', 'unscheduled', 'airedLate', 'aired', 'cancelled']

export type AirStanding = { state: AirState; days: number }

export function airStandingOf(row: { status: BookingStatus; plannedAirOn: string | null; airedOn: string | null }, today: string): AirStanding {
  if (row.status === 'cancelled') return { state: 'cancelled', days: 0 }
  if (row.airedOn) {
    const late = row.plannedAirOn ? ageInDays(row.plannedAirOn, row.airedOn) : 0
    return late > 0 ? { state: 'airedLate', days: late } : { state: 'aired', days: 0 }
  }
  if (!row.plannedAirOn) return { state: 'unscheduled', days: 0 }
  const left = ageInDays(today, row.plannedAirOn)
  if (left < 0) return { state: 'overdue', days: -left }
  return left === 0 ? { state: 'today', days: 0 } : { state: 'waiting', days: left }
}

/** The figures of a set of bookings; cancelled ones are counted apart and left out of every sum. */
export type Tally = { bookings: number; aired: number; pending: number; cancelled: number; attention: number; spent: number }

export function tally(rows: readonly Triaged[], today: string): Tally {
  const out: Tally = { bookings: 0, aired: 0, pending: 0, cancelled: 0, attention: 0, spent: 0 }
  for (const row of rows) {
    if (row.status === 'cancelled') {
      out.cancelled += 1
      continue
    }
    out.bookings += 1
    out.spent += row.cost
    if (row.status === 'aired') out.aired += 1
    else out.pending += 1
    if (attentionOf(row, today)) out.attention += 1
  }
  return out
}
