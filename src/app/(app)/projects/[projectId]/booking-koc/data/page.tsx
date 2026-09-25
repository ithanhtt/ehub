import { can } from '@/core/auth/rbac'
import { requireCapability } from '@/core/auth/session'
import { titled } from '@/core/metadata'
import { listBookings, listCampaigns } from '@/features/bookings/queries'
import { hasShopConnection, syncResultsIfDue } from '@/features/bookings/sync'
import { BookingsPage } from '@/modules/bookings/page'

export const generateMetadata = titled('nav', 'bookings')

/**
 * The booking data and its campaigns (see src/modules/bookings). Opening it
 * starts a sync of the bookings' results from TikTok Shop when the last one
 * is old (features/bookings/sync.ts) — started, not waited for: the page
 * follows it and reloads the list once it is done.
 */
export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const { role } = await requireCapability(projectId, 'booking:view')
  const [rows, campaigns, shop] = await Promise.all([listBookings(projectId), listCampaigns(projectId), hasShopConnection(projectId)])
  const running = shop ? syncResultsIfDue(projectId, rows) : false
  return <BookingsPage key={projectId} projectId={projectId} rows={rows} campaigns={campaigns} canEdit={can(role, 'booking:edit')} sync={{ enabled: shop, running }} />
}
