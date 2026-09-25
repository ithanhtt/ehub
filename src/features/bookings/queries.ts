import 'server-only'

import { desc, eq } from 'drizzle-orm'
import { db } from '@/core/db/client'
import { user } from '@/core/db/schema/auth'
import { bookingCampaigns, bookings, type BookingResultNote, type BookingResultSource, type BookingStatus, type CampaignStatus } from '@/core/db/schema/bookings'

/** One booking as the booking page shows it. */
export type BookingListRow = {
  id: string
  code: string
  campaignId: string | null
  kocHandle: string
  kocName: string | null
  kocContact: string | null
  kocTier: string | null
  bookedOn: string
  plannedAirOn: string | null
  airedOn: string | null
  videoUrl: string | null
  videoId: string | null
  product: string | null
  cost: number
  status: BookingStatus
  note: string | null
  /** What the video brought in (see the schema): orders and revenue, where they came from, when synced (ISO) and why a sync gave nothing. */
  resultOrders: number | null
  resultRevenue: number | null
  resultSource: BookingResultSource | null
  resultSyncedAt: string | null
  resultNote: BookingResultNote | null
  /** Who last touched the row, and when (ISO). */
  updatedBy: string | null
  updatedAt: string
}

export async function listBookings(projectId: string): Promise<BookingListRow[]> {
  const rows = await db
    .select({ booking: bookings, updatedBy: user.name })
    .from(bookings)
    .leftJoin(user, eq(user.id, bookings.updatedById))
    .where(eq(bookings.projectId, projectId))
    .orderBy(desc(bookings.bookedOn), desc(bookings.createdAt))
  return rows.map(({ booking, updatedBy }) => ({
    id: booking.id,
    code: booking.code,
    campaignId: booking.campaignId,
    kocHandle: booking.kocHandle,
    kocName: booking.kocName,
    kocContact: booking.kocContact,
    kocTier: booking.kocTier,
    bookedOn: booking.bookedOn,
    plannedAirOn: booking.plannedAirOn,
    airedOn: booking.airedOn,
    videoUrl: booking.videoUrl,
    videoId: booking.videoId,
    product: booking.product,
    cost: booking.cost,
    status: booking.status,
    note: booking.note,
    resultOrders: booking.resultOrders,
    resultRevenue: booking.resultRevenue,
    resultSource: booking.resultSource,
    resultSyncedAt: booking.resultSyncedAt?.toISOString() ?? null,
    resultNote: booking.resultNote,
    updatedBy: updatedBy ?? null,
    updatedAt: booking.updatedAt.toISOString(),
  }))
}

/** A campaign as the booking page shows it; its figures are worked out there from the bookings. */
export type CampaignListRow = {
  id: string
  name: string
  product: string | null
  defaultCost: number | null
  startOn: string
  endOn: string | null
  budget: number | null
  targetVideos: number | null
  status: CampaignStatus
  note: string | null
}

export async function listCampaigns(projectId: string): Promise<CampaignListRow[]> {
  const rows = await db
    .select()
    .from(bookingCampaigns)
    .where(eq(bookingCampaigns.projectId, projectId))
    .orderBy(desc(bookingCampaigns.startOn), desc(bookingCampaigns.createdAt))
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    product: row.product,
    defaultCost: row.defaultCost,
    startOn: row.startOn,
    endOn: row.endOn,
    budget: row.budget,
    targetVideos: row.targetVideos,
    status: row.status,
    note: row.note,
  }))
}
