import type { SvgIconComponent } from '@mui/icons-material'
import { bookingKocModule } from './booking-koc/module'
import { costRoiModule } from './cost-roi/module'
import { orderCancelModule } from './order-cancel/module'
import { overviewModule } from './overview/module'
import { videoGmvModule } from './video-gmv/module'

/**
 * The app's feature modules — each a self-contained part of a project's
 * pages, in its own folder here: its page, its parts and its data. Connector
 * plugins (src/plugins) bring data in; modules show it and work with it.
 *
 * A module declares its entry in the project menu; its page is a thin route
 * file under src/app that renders the module. To add one: give it a folder
 * with a manifest (see overview/module.ts), list it below, and add its route.
 */
export interface AppModule {
  id: string
  /** Its entry in the project menu: the label's key in the "nav" messages, its path under the project, its icon. */
  nav: { key: string; path: string; exact?: boolean; icon: SvgIconComponent }
}

/**
 * Every module, in menu order: the overview, then the four reports —
 * booking & KOC, video & product GMV, cost & ROI, orders & cancellations.
 * The booking file the bookers keep is Booking & KOC's second part
 * (src/modules/bookings, at booking-koc/data), not an entry of its own. The
 * reports share one frame (src/modules/analytics); each report module is its
 * answer, its server builder (listed in reports.ts) and its widgets.
 */
export const APP_MODULES: AppModule[] = [overviewModule, bookingKocModule, videoGmvModule, costRoiModule, orderCancelModule]
