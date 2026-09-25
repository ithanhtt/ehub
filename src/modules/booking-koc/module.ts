import VideoCameraFrontOutlined from '@mui/icons-material/VideoCameraFrontOutlined'
import type { AppModule } from '..'
import type { ReportSource } from '@/modules/analytics/types'

/**
 * Booking & KOC — booked videos aired per product per day, against all the
 * videos working for the shop and the GMV creators bring.
 *
 *   types.ts    the answer's shape
 *   report.ts   how the server builds it (booking sheet, TikTok Shop, GMV Max)
 *   widgets/    the page's cards (see widgets/index.ts to add one)
 *   page.tsx    the page: the shared report frame with these widgets
 *   section-tabs.tsx  the section's two parts — this report and the booking data
 *                     it reads (src/modules/bookings, at booking-koc/data)
 */
export const bookingKocModule: AppModule = {
  id: 'booking-koc',
  nav: { key: 'bookingKoc', path: 'booking-koc', icon: VideoCameraFrontOutlined },
}

export const BOOKING_KOC_SOURCES: ReportSource[] = ['booking', 'tiktokShop', 'tiktokAds']
