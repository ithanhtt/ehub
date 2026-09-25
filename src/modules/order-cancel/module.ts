import AssignmentReturnOutlined from '@mui/icons-material/AssignmentReturnOutlined'
import type { AppModule } from '..'
import type { ReportSource } from '@/modules/analytics/types'

/**
 * Orders & cancellations — Sapo's orders created and cancelled per product
 * and hour, beside the orders GMV Max ads brought each product.
 *
 *   types.ts    the answer's shape
 *   report.ts   how the server builds it (Sapo, GMV Max, TikTok Shop SKUs)
 *   widgets/    the page's cards (see widgets/index.ts to add one)
 *   page.tsx    the page: the shared report frame with these widgets
 */
export const orderCancelModule: AppModule = {
  id: 'order-cancel',
  nav: { key: 'orderCancel', path: 'order-cancel', icon: AssignmentReturnOutlined },
}

/** What it reads: Sapo first; GMV Max and TikTok Shop (to match products by SKU) when connected. */
export const ORDER_CANCEL_SOURCES: ReportSource[] = ['sapo', 'tiktokAds', 'tiktokShop']
