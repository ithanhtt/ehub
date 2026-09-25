/**
 * The keys the sources are joined on, written the same way whichever source
 * they come from.
 *
 * A booking sheet is typed by people: a KOC appears as "@Handle", "handle",
 * or a link to the profile; a video as its id or its link; a product as the
 * TikTok product id, sometimes as a link to the product page. TikTok's own
 * data carries bare ids and handles. Each key is brought to one form here, so
 * "@Linh.Beauty" in the sheet and "linh.beauty" on an affiliate order are the
 * same KOC.
 */

/** A TikTok handle: no "@", no profile URL around it, lower case. */
export function kocKey(raw: unknown): string {
  let value = String(raw ?? '').trim()
  const fromUrl = value.match(/tiktok\.com\/@([^/?#\s]+)/i)
  if (fromUrl) value = fromUrl[1]
  return value.replace(/^@+/, '').trim().toLowerCase()
}

/** A TikTok video (item) id: the digits, from a bare id or a …/video/<id> link. */
export function videoKey(raw: unknown): string {
  const value = String(raw ?? '').trim()
  const fromUrl = value.match(/\/video\/(\d{6,})/)
  if (fromUrl) return fromUrl[1]
  const digits = value.match(/\d{10,}/)
  return digits ? digits[0] : value
}

/** The handle inside a video link (…tiktok.com/@handle/video/…), when there is one. */
export function kocOfVideoUrl(raw: unknown): string {
  const match = String(raw ?? '').match(/tiktok\.com\/@([^/?#\s]+)\/video\//i)
  return match ? match[1].toLowerCase() : ''
}

/**
 * A TikTok Shop product id, from a bare id or a product link
 * (shop.tiktok.com/view/product/<id>, …/product/<id>). Anything else — an SKU
 * typed in its place — is kept as typed, trimmed, so it can still be matched
 * against SKUs.
 */
export function productKey(raw: unknown): string {
  const value = String(raw ?? '').trim()
  const fromUrl = value.match(/product\/(\d{10,})/)
  if (fromUrl) return fromUrl[1]
  if (/^\d{10,}$/.test(value)) return value
  return value
}

/** An SKU as the stores write it, compared without case or surrounding spaces. */
export const skuKey = (raw: unknown) => String(raw ?? '').trim().toUpperCase()
