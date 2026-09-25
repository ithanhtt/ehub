import SavingsOutlined from '@mui/icons-material/SavingsOutlined'
import type { AppModule } from '..'
import type { ReportSource } from '@/modules/analytics/types'

/**
 * Cost & ROI — vouchers, GMV Max spend, creators' commission and booking fees
 * against GMV; the ROI target that delivers best per product; bad reviews
 * beside GMV and spend.
 *
 *   types.ts    the answer's shape
 *   report.ts   how the server builds it (TikTok Shop, GMV Max, booking)
 *   widgets/    the page's cards (see widgets/index.ts to add one)
 *   page.tsx    the page: the shared report frame with these widgets
 */
export const costRoiModule: AppModule = {
  id: 'cost-roi',
  nav: { key: 'costRoi', path: 'cost-roi', icon: SavingsOutlined },
}

export const COST_ROI_SOURCES: ReportSource[] = ['tiktokShop', 'tiktokAds', 'booking']
