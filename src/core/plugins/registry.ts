import type { ConnectorAction, ConnectorPlugin, EndpointSpec, LocalizedText } from './types'
import { plugins } from '@/plugins'

/**
 * The registry is the single place the core learns which connectors exist.
 *
 * Registration is an explicit import list in src/plugins/index.ts rather than
 * a filesystem scan: Next bundles the server graph statically, so a glob would
 * work in dev and silently ship an empty registry in production. One import
 * line per plugin keeps the extension point honest and traceable.
 */
const byId = new Map<string, ConnectorPlugin>()

for (const plugin of plugins) {
  if (byId.has(plugin.id)) {
    throw new Error(`Duplicate plugin id "${plugin.id}". Plugin ids must be unique across the registry.`)
  }
  assertPluginShape(plugin)
  byId.set(plugin.id, plugin)
}

function assertPluginShape(plugin: ConnectorPlugin): void {
  const seen = new Set<string>()
  for (const endpoint of plugin.endpoints) {
    if (seen.has(endpoint.id)) {
      throw new Error(`Plugin "${plugin.id}" declares endpoint "${endpoint.id}" twice.`)
    }
    seen.add(endpoint.id)
  }
}

export function listPlugins(): ConnectorPlugin[] {
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export function getPlugin(id: string): ConnectorPlugin | null {
  return byId.get(id) ?? null
}

export function requirePlugin(id: string): ConnectorPlugin {
  const plugin = byId.get(id)
  if (!plugin) throw new Error(`Unknown plugin "${id}". Register it in src/plugins/index.ts.`)
  return plugin
}

export function getEndpoint(pluginId: string, endpointId: string): EndpointSpec | null {
  return getPlugin(pluginId)?.endpoints.find((e) => e.id === endpointId) ?? null
}

export function requireEndpoint(pluginId: string, endpointId: string): EndpointSpec {
  const endpoint = getEndpoint(pluginId, endpointId)
  if (!endpoint) throw new Error(`Unknown endpoint "${endpointId}" on plugin "${pluginId}".`)
  return endpoint
}

/* ---------------------------------------------------------- serialisation --- */

/**
 * Serialisable projection of a connector action.
 *
 * Lives here rather than beside the runtime runner so that importing it does
 * not drag the database in — and so registry and runner do not import each
 * other in a cycle.
 */
export type ActionSummary = {
  id: string
  label: ConnectorAction['label']
  description?: ConnectorAction['description']
  inputs: NonNullable<ConnectorAction['inputs']>
  mutatesCredentials: boolean
}

export function toActionSummary(action: ConnectorAction): ActionSummary {
  return {
    id: action.id,
    label: action.label,
    description: action.description,
    inputs: action.inputs ?? [],
    mutatesCredentials: Boolean(action.mutatesCredentials),
  }
}

/**
 * Plugins hold functions, which cannot cross the server/client boundary.
 * These projections are the wire format the API Hub renders from.
 */
export type PluginSummary = {
  id: string
  name: string
  description: LocalizedText
  version: string
  category: ConnectorPlugin['category']
  color: string
  docsUrl?: string
  authType: ConnectorPlugin['auth']['type']
  authFields: ConnectorPlugin['auth']['fields']
  authInstructions?: LocalizedText
  endpointCount: number
  groups: string[]
  /** Repair tools the connector offers, already stripped of their run(). */
  actions: ActionSummary[]
}

export function toPluginSummary(plugin: ConnectorPlugin): PluginSummary {
  return {
    id: plugin.id,
    name: plugin.name,
    description: plugin.description,
    version: plugin.version,
    category: plugin.category,
    color: plugin.color,
    docsUrl: plugin.docsUrl,
    authType: plugin.auth.type,
    authFields: plugin.auth.fields,
    authInstructions: plugin.auth.instructions,
    endpointCount: plugin.endpoints.length,
    groups: [...new Set(plugin.endpoints.map((e) => e.group))],
    actions: (plugin.actions ?? []).map(toActionSummary),
  }
}

export function listPluginSummaries(): PluginSummary[] {
  return listPlugins().map(toPluginSummary)
}

/** EndpointSpec is already plain data; this only stamps on the owning plugin. */
export type CatalogEntry = EndpointSpec & {
  pluginId: string
  pluginName: string
  pluginColor: string
}

export function listCatalog(pluginIds?: string[]): CatalogEntry[] {
  const source = pluginIds ? listPlugins().filter((p) => pluginIds.includes(p.id)) : listPlugins()
  return source.flatMap((plugin) =>
    plugin.endpoints.map((endpoint) => ({
      ...endpoint,
      pluginId: plugin.id,
      pluginName: plugin.name,
      pluginColor: plugin.color,
    })),
  )
}
