import DashboardOutlined from '@mui/icons-material/DashboardOutlined'
import type { AppModule } from '..'

/**
 * The overview: a project's live, at-a-glance page.
 *
 *   shell/    the page's frame — the period filter, the "live" status, the
 *             source picker, and the grid the widgets sit in
 *   widgets/  the sections, each self-contained (see widgets/index.ts to add one)
 *   shared/   what several widgets draw with — cards, colors, number formats
 *   sources   the connector plugins the page reads, and what it says about each
 *   data/     the server side: one answer per period, assembled per source
 *
 * Widgets never reach into each other: each takes what it needs from the
 * page's context (see context.ts) and keeps its own choices, so one can be
 * changed, added or removed without touching the rest.
 */
export const overviewModule: AppModule = {
  id: 'overview',
  nav: { key: 'overview', path: '', exact: true, icon: DashboardOutlined },
}
