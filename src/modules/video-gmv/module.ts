import OndemandVideoOutlined from '@mui/icons-material/OndemandVideoOutlined'
import type { AppModule } from '..'
import type { ReportSource } from '@/modules/analytics/types'

/**
 * Video & product GMV — booked videos aired, new videos posted with each
 * product, and the product's GMV, with how the three move together.
 *
 *   types.ts    the answer's shape
 *   report.ts   how the server builds it (booking sheet, TikTok Shop)
 *   widgets/    the page's cards (see widgets/index.ts to add one)
 *   page.tsx    the page: the shared report frame with these widgets
 */
export const videoGmvModule: AppModule = {
  id: 'video-gmv',
  nav: { key: 'videoGmv', path: 'video-gmv', icon: OndemandVideoOutlined },
}

export const VIDEO_GMV_SOURCES: ReportSource[] = ['booking', 'tiktokShop']
