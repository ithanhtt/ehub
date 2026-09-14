/**
 * Display names for Sapo's `source_name` values, the channel an order came in
 * through. Unknown values show as they are — a new channel should appear,
 * not vanish behind a missing translation.
 */
const NAMES: Record<string, string> = {
  tiktokshop: 'TikTok Shop',
  shopee: 'Shopee',
  lazada: 'Lazada',
  tiki: 'Tiki',
  web: 'Website',
  pos: 'POS',
  facebook: 'Facebook',
  zalo: 'Zalo',
}

/** Orders without a source are grouped under this key. */
export const OTHER_CHANNEL = 'other'

export function channelName(key: string, otherLabel: string): string {
  if (key === OTHER_CHANNEL) return otherLabel
  return NAMES[key.toLowerCase()] ?? key
}
