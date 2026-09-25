import { kocKey, kocOfVideoUrl, videoKey } from '@/modules/analytics/shared/keys'
import type { RawBooking } from './fields'

/**
 * The quick list: many bookings typed or pasted one per line — a video link
 * or a KOC, and optionally the fee after it:
 *
 *   https://www.tiktok.com/@linh.beauty/video/7412345678901234567  1tr5
 *   @an.an 800k
 *   7412345678901234567
 *
 * Everything else a booking needs comes from what the lines share (campaign,
 * product, booking date, the usual fee) or from the video itself (its KOC and
 * the day it aired — see fields.ts). The result is ordinary rows for the
 * import action, checked by the same standard.
 */

export type QuickLine = { line: number; text: string; raw: RawBooking }

/** A bare TikTok video id, as copied from the app's share menu or a report. */
const VIDEO_ID = /^\d{15,20}$/

export function parseQuickLines(text: string): QuickLine[] {
  const out: QuickLine[] = []
  text.split(/\r?\n/).forEach((source, index) => {
    const line = source.trim()
    if (!line) return
    // The target is the first token; the rest of the line, if any, is the fee ("1tr5", "1.500.000", "1 500 000").
    const [target, ...rest] = line.split(/[\t,;]+|\s+/).filter(Boolean)
    const cost = rest.join('').trim()
    const raw: RawBooking = {}
    if (/\/video\/\d/.test(target) || VIDEO_ID.test(target) || /vm\.tiktok\.com|vt\.tiktok\.com/i.test(target)) {
      raw.videoUrl = target
      const koc = kocOfVideoUrl(target)
      if (koc) raw.koc = koc
    } else {
      raw.koc = kocKey(target)
    }
    if (cost) raw.cost = cost
    out.push({ line: index + 1, text: line, raw })
  })
  return out
}

/** Lines naming a video that an earlier line already named — pasting a list twice happens. */
export function repeatedVideos(lines: QuickLine[]): Set<number> {
  const seen = new Set<string>()
  const repeated = new Set<number>()
  for (const { line, raw } of lines) {
    if (!raw.videoUrl) continue
    const id = videoKey(raw.videoUrl)
    if (seen.has(id)) repeated.add(line)
    seen.add(id)
  }
  return repeated
}
