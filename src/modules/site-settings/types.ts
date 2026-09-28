/**
 * Settings of the whole app that platform Administrators set on the admin
 * Settings page — shared by the page, the server code and the layouts.
 */
/** Where the corner note sits: in the screen's corner as the page scrolls, or at the foot of the page. */
export type CornerPlacement = 'floating' | 'footer'

export const CORNER_PLACEMENTS: readonly CornerPlacement[] = ['floating', 'footer']

export interface SiteSettings {
  /** Maintenance switched on by hand: everyone but Administrators sees the maintenance notice. */
  maintenance: { on: boolean; message: string }
  /** A small note in the bottom-right corner of every page; {{version}} and the other variables in template.ts are filled in. */
  corner: { on: boolean; text: string; placement: CornerPlacement }
}

export const DEFAULT_SETTINGS: SiteSettings = {
  maintenance: { on: false, message: '' },
  corner: { on: false, text: '{{appName}} v{{version}}', placement: 'floating' },
}

export const MAX_MESSAGE = 500
export const MAX_CORNER_TEXT = 300

/**
 * Whether the app is closed for maintenance now, and why: switched on by
 * hand, or an update being applied (which closes it on its own and reopens
 * it when done).
 */
export interface MaintenanceState {
  active: boolean
  manual: boolean
  updating: boolean
  message: string
}

export type SettingsOutcome = { ok: true } | { ok: false; message: 'forbidden' | 'validation' | 'error' }
