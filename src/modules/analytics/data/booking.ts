import 'server-only'

import { and, eq, ne } from 'drizzle-orm'
import { db } from '@/core/db/client'
import { bookings } from '@/core/db/schema/bookings'
import type { Failure } from '../types'

/**
 * The project's booking file, as the reports read it.
 *
 * The file is kept in the app (src/modules/bookings), already in its standard
 * form — handles and video ids normalised when a row is saved — so the reports
 * take its rows as they are. Cancelled bookings are left out: they neither
 * aired nor cost anything.
 */

export type BookingRow = {
  id: string
  koc: string
  kocName: string
  bookedOn: string | null
  airedOn: string | null
  videoId: string
  product: string
  cost: number
}

export type BookingData = {
  rows: BookingRow[]
  fetchedAt: string
  failures: Failure[]
}

export async function readBookings(projectId: string): Promise<BookingData> {
  const rows = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.projectId, projectId), ne(bookings.status, 'cancelled')))
  return {
    rows: rows.map((row) => ({
      id: row.id,
      koc: row.kocHandle,
      kocName: row.kocName ?? '',
      bookedOn: row.bookedOn,
      airedOn: row.airedOn,
      videoId: row.videoId ?? '',
      product: row.product ?? '',
      cost: row.cost,
    })),
    fetchedAt: new Date().toISOString(),
    failures: [],
  }
}
