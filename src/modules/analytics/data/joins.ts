import 'server-only'

import type { SapoProductDay } from '@/modules/overview/data/sapo'
import { productKey, skuKey } from '../shared/keys'
import type { ShopOrderDay } from './tiktok-shop'

/**
 * How the sources name one product, and how those names are matched.
 *
 * The TikTok product id is the common key: TikTok Shop orders and analytics
 * carry it, GMV Max calls it `item_group_id`, and a booking sheet usually
 * holds it. Sapo does not know it — it knows SKUs — so the two meet through
 * the seller SKUs TikTok Shop orders are sold under: a Sapo product whose
 * SKUs include one of a TikTok product's is that product.
 */

export type ProductCatalog = {
  /** TikTok product id → its name, as the latest order calls it. */
  names: Map<string, string>
  /** Seller SKU (normalised) → TikTok product id. */
  bySku: Map<string, string>
}

/** The TikTok products and SKUs the shop's orders of `days` were sold under. */
export function catalogOf(orderDays: Record<string, ShopOrderDay>): ProductCatalog {
  const names = new Map<string, string>()
  const bySku = new Map<string, string>()
  for (const day of Object.keys(orderDays).sort()) {
    for (const [id, product] of Object.entries(orderDays[day].products)) {
      names.set(id, product.name)
      for (const sku of Object.values(product.skus)) if (sku) bySku.set(skuKey(sku), id)
    }
  }
  return { names, bySku }
}

/** The TikTok product a booking row names: its id, or the product an SKU typed in its place belongs to. */
export function bookingProduct(raw: string, catalog: ProductCatalog | null): string {
  const key = productKey(raw)
  if (/^\d{10,}$/.test(key)) return key
  return catalog?.bySku.get(skuKey(key)) ?? key
}

/** Sapo product id → the TikTok product it is, where one of its SKUs was sold on TikTok. */
export function sapoToTiktok(sapoDays: Record<string, Record<string, SapoProductDay>>, catalog: ProductCatalog | null): Map<string, string> {
  const out = new Map<string, string>()
  if (!catalog) return out
  for (const products of Object.values(sapoDays)) {
    for (const [key, product] of Object.entries(products)) {
      if (out.has(key)) continue
      for (const sku of product.skus) {
        const match = catalog.bySku.get(skuKey(sku))
        if (match) {
          out.set(key, match)
          break
        }
      }
    }
  }
  return out
}
