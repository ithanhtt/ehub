import type { SvgIconComponent } from '@mui/icons-material'
import { overviewModule } from './overview/module'

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

/** Every module, in menu order. */
export const APP_MODULES: AppModule[] = [overviewModule]
