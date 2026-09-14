import { probeCatalog, summariseProbe } from './probe-catalog'
import { requirePlugin } from './registry'
import type { ConnectorAction, ConnectorActionResult } from './types'

/**
 * Builds the "what can this connection reach?" action for one connector.
 *
 * Generic on purpose: it answers by asking the provider rather than by
 * consulting a permissions table, because no such table exists. Neither TikTok
 * nor Sapo exposes scope introspection, and neither publishes a machine
 * readable spec — both verified by probing — so calling each read endpoint once
 * is the only honest way to find out.
 *
 * A factory rather than a shared constant: the action needs to know which
 * plugin owns it, and `ConnectionContext` carries ids but not the plugin. A
 * closure keeps that per-connector, where a module-level variable would be
 * overwritten by whichever plugin registered last.
 */
export function createListPermissionsAction(pluginId: string): ConnectorAction {
  return {
    id: 'list-permissions',
    label: {
      vi: 'Liệt kê endpoint kết nối có quyền',
      en: 'List endpoints this connection may use',
    },
    description: {
      vi: 'Gọi thử từng endpoint chỉ-đọc trong danh mục với request nhỏ nhất, rồi báo cái nào được phép và cái nào bị từ chối. Endpoint có thể thay đổi dữ liệu được bỏ qua, không gọi.',
      en: 'Calls each read-only catalogue endpoint once with the smallest legal request, then reports which are permitted and which are refused. Endpoints that could change data are skipped, not called.',
    },
    mutatesCredentials: false,

    async run({ context }): Promise<ConnectorActionResult> {
      const plugin = requirePlugin(pluginId)
      const probes = await probeCatalog(plugin, context)
      const { findings, allowed, denied, skipped } = summariseProbe(probes)

      return {
        ok: allowed > 0,
        message: `${allowed} allowed, ${denied} denied, ${skipped} not probed.`,
        hint:
          allowed === 0
            ? 'permissionsNone'
            : denied > 0
              ? 'permissionsPartial'
              : 'permissionsAll',
        findings,
      }
    },
  }
}

/** Hint keys the action above can emit, for the contract check. */
export const LIST_PERMISSIONS_HINTS = [
  'permissionsAll',
  'permissionsPartial',
  'permissionsNone',
] as const
