import { BookingKocTabs } from '@/modules/booking-koc/section-tabs'

/**
 * Booking & KOC: the report (this folder's page) and the booking data it is
 * read from (./data), under one bar of tabs that stays while either loads.
 */
export default async function Layout({ children, params }: { children: React.ReactNode; params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  return (
    <>
      <BookingKocTabs projectId={projectId} />
      {children}
    </>
  )
}
