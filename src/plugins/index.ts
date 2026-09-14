import type { ConnectorPlugin } from '@/core/plugins/types'
import { sapoPlugin } from './sapo'
import { tiktokAdsPlugin } from './tiktok-ads'

/**
 * ── The extension point ──────────────────────────────────────────────
 *
 * To add a provider (Meta Ads, Shopee, Lazada, Google Ads…):
 *
 *   1. Create src/plugins/<your-plugin>/ with an index.ts that default-exports
 *      an object satisfying ConnectorPlugin, plus an endpoints.ts holding the
 *      catalogue.
 *   2. Import it here and add it to the array below.
 *
 * That is the whole integration. No core file changes: settings forms, the API
 * Hub catalogue, request execution, logging and dataset capture all read the
 * plugin through the ConnectorPlugin contract. Nothing else in the app may
 * import a plugin folder directly — go through core/plugins/registry instead,
 * so a broken or removed plugin can never take the rest of the app down.
 */
export const plugins: ConnectorPlugin[] = [tiktokAdsPlugin, sapoPlugin]
