import type { BookingStatus } from '@/core/db/schema/bookings'
import { shiftDay, vnDate } from '@/modules/analytics/period'
import { kocKey, kocOfVideoUrl, productKey, videoKey } from '@/modules/analytics/shared/keys'

/**
 * The booking file's standard: its fields, and how whatever a booker types or
 * imports becomes one clean row.
 *
 * Nothing here is server-only. The entry form, the import preview and the
 * server action all run `normalizeBooking`, so a row the preview shows as
 * valid is the row the server stores — and the server never trusts the
 * browser's verdict, it runs the same rules again.
 *
 * Imported files are matched to the fields by their headings (`ALIASES`),
 * compared without accents, case or punctuation, so a team's existing sheet
 * ("Cast", "Link air", "Ngày lên video") imports without being reworked.
 */

export type BookingField =
  | 'campaign'
  | 'code'
  | 'bookedOn'
  | 'product'
  | 'koc'
  | 'kocName'
  | 'kocContact'
  | 'cost'
  | 'plannedAirOn'
  | 'airedOn'
  | 'status'
  | 'resultOrders'
  | 'resultRevenue'
  | 'kocTier'
  | 'videoUrl'
  | 'note'

/**
 * In the order the template and the import show them — the list's order
 * (Mã, Ngày book, Sản phẩm, KOC, …), with the campaign first as the file's
 * grouping. A planned air date comes before the real one on purpose: a
 * heading such as "Ngày air dự kiến (KOC)" is matched by containment, field
 * by field in this order, and must not be claimed by "Ngày air".
 */
export const BOOKING_FIELDS: readonly BookingField[] = [
  'campaign',
  'code',
  'bookedOn',
  'product',
  'koc',
  'kocName',
  'kocContact',
  'cost',
  'plannedAirOn',
  'airedOn',
  'status',
  'resultOrders',
  'resultRevenue',
  'kocTier',
  'videoUrl',
  'note',
]

/** Worked out from a booking, never typed: its month, and where its airing stands (triage.ts). Exported, not imported. */
export type DerivedColumn = 'month' | 'airStanding'

/**
 * The columns of an exported file, in the list's order — the derived ones in
 * their places — then what the list leaves out (status, campaign, contact),
 * so the file still imports back as it is: the derived columns match no
 * field, and "Trạng thái" is claimed by its exact heading before "Trạng thái
 * air" could be.
 */
export const EXPORT_COLUMNS: ReadonlyArray<BookingField | DerivedColumn> = [
  'code',
  'bookedOn',
  'month',
  'product',
  'koc',
  'kocName',
  'cost',
  'plannedAirOn',
  'airedOn',
  'airStanding',
  'resultOrders',
  'resultRevenue',
  'kocTier',
  'videoUrl',
  'note',
  'status',
  'campaign',
  'kocContact',
]

/** Must be present on every row. */
export const REQUIRED_FIELDS: ReadonlySet<BookingField> = new Set(['koc', 'bookedOn', 'cost'])

export const BOOKING_STATUSES: readonly BookingStatus[] = ['pending', 'aired', 'cancelled']

/** The template's headings — also the first alias of each field, so an exported file imports back as is. */
export const TEMPLATE_HEADINGS: Record<BookingField | DerivedColumn, string> = {
  campaign: 'Chiến dịch',
  code: 'Mã',
  koc: 'ID KOC',
  kocName: 'Tên KOC',
  kocContact: 'Liên hệ',
  bookedOn: 'Ngày book',
  month: 'Tháng',
  plannedAirOn: 'Ngày air dự kiến',
  airedOn: 'Ngày air thực tế',
  airStanding: 'Trạng thái air',
  videoUrl: 'Link video',
  product: 'ID sản phẩm',
  cost: 'Chi phí booking',
  status: 'Trạng thái',
  resultOrders: 'Số đơn ra',
  resultRevenue: 'Doanh thu quy KOC',
  kocTier: 'Phân loại KOC',
  note: 'Ghi chú',
}

/** Headings as written, plain (see `plain`) — most specific first within a field. */
const ALIASES: Record<BookingField, string[]> = {
  campaign: ['chien dich', 'ten chien dich', 'campaign', 'dot booking'],
  code: ['ma', 'ma booking', 'ma bk', 'booking code', 'booking id', 'code'],
  koc: ['id koc', 'ma koc', 'koc id', 'ma kol', 'id kol', 'tiktok id', 'id tiktok', 'username', 'user name', 'link kenh', 'id kenh', 'kenh', 'koc', 'kol'],
  kocName: ['ten koc', 'ten kol', 'ten kenh', 'ho ten', 'ten'],
  kocContact: ['lien he', 'sdt', 'so dien thoai', 'dien thoai', 'zalo', 'phone', 'contact', 'email'],
  bookedOn: ['ngay book', 'ngay booking', 'booking date', 'ngay dat', 'ngay chot'],
  plannedAirOn: ['ngay air du kien', 'du kien air', 'ngay du kien air', 'ngay hen air', 'lich air', 'planned air date', 'planned air', 'deadline air'],
  airedOn: ['ngay air thuc te', 'ngay air', 'ngay air video', 'ngay len video', 'ngay dang video', 'ngay dang', 'air date', 'ngay len', 'ngay post'],
  videoUrl: ['link video', 'id video', 'video id', 'link air', 'video'],
  product: ['id san pham', 'id sp', 'product id', 'ma san pham', 'ma sp', 'id sku', 'sku', 'link san pham', 'san pham', 'sp', 'product'],
  cost: ['chi phi booking', 'phi booking', 'gia booking', 'chi phi', 'cast', 'cat xe', 'cost', 'phi', 'gia'],
  status: ['trang thai', 'tinh trang', 'status'],
  resultOrders: ['so don ra', 'so don', 'don ra', 'orders', 'order count', 'sku orders'],
  resultRevenue: ['doanh thu quy koc', 'doanh thu koc', 'doanh thu', 'gmv', 'revenue'],
  kocTier: ['phan loai koc', 'phan loai', 'loai koc', 'hang koc', 'tier', 'koc tier', 'size koc'],
  note: ['ghi chu', 'note', 'notes'],
}

/** Status as people write it, plain. */
const STATUS_WORDS: Record<BookingStatus, string[]> = {
  pending: ['pending', 'cho air', 'chua air', 'da book', 'booked', 'cho len', 'cho'],
  aired: ['aired', 'da air', 'da len', 'da dang', 'xong', 'done'],
  cancelled: ['cancelled', 'canceled', 'huy', 'da huy', 'cancel'],
}

/** Text without accents, case or punctuation: "Ngày Air video" → "ngay air video". */
export const plain = (text: unknown) =>
  String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** Which column holds each field, judged from one row of headings. */
export function columnsOf(headings: readonly unknown[]): Partial<Record<BookingField, number>> {
  const texts = headings.map(plain)
  const taken = new Set<number>()
  const out: Partial<Record<BookingField, number>> = {}
  // Exact headings first across every field, then headings that contain the name — so "Chi phí" cannot claim "Chi phí booking"'s column when both exist.
  for (const exact of [true, false]) {
    for (const field of BOOKING_FIELDS) {
      if (out[field] !== undefined) continue
      for (const name of ALIASES[field]) {
        // A short, generic name ("koc", "phi", "gia", "ten") only matches a heading that is exactly it:
        // inside a longer heading it means something else ("Tên KOC", "Phí ship", "Giá SP").
        if (!exact && (name.length <= 4 || !name.includes(' '))) continue
        const index = texts.findIndex((text, i) => !taken.has(i) && text && (exact ? text === name : ` ${text} `.includes(` ${name} `)))
        if (index >= 0) {
          out[field] = index
          taken.add(index)
          break
        }
      }
    }
  }
  return out
}

/** A heading row the file can be read by: it names the KOC (or the video) and a date. */
export const usableColumns = (columns: Partial<Record<BookingField, number>>) =>
  (columns.koc !== undefined || columns.videoUrl !== undefined) && (columns.bookedOn !== undefined || columns.airedOn !== undefined)

/* ------------------------------------------------------------- parsing --- */

/** A spreadsheet's date serial: days since 30 Dec 1899. */
function fromSerial(serial: number): string | null {
  if (!(serial > 20_000 && serial < 80_000)) return null
  return new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000).toISOString().slice(0, 10)
}

/**
 * A date as typed: 12/09/2026, 12-9-26, 2026-09-12, a spreadsheet serial, or
 * 12/09 with the year left out — then the most recent such date not more than
 * a month ahead, since a booking file records what was booked, not what is a
 * year away. Day first, the Vietnamese way.
 */
export function parseDate(raw: unknown, today = vnDate(new Date())): string | null {
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : vnDate(raw)
  if (typeof raw === 'number') return fromSerial(raw)
  const text = String(raw ?? '').trim()
  if (!text) return null
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (iso) return valid(Number(iso[1]), Number(iso[2]), Number(iso[3]))
  const dmy = text.match(/^(\d{1,2})[/.\-](\d{1,2})(?:[/.\-](\d{2,4}))?(?!\d)/)
  if (!dmy) return /^\d+(\.\d+)?$/.test(text) ? fromSerial(Number(text)) : null
  const day = Number(dmy[1])
  const month = Number(dmy[2])
  if (dmy[3]) {
    const year = dmy[3].length === 2 ? 2000 + Number(dmy[3]) : Number(dmy[3])
    return valid(year, month, day)
  }
  const thisYear = Number(today.slice(0, 4))
  const guess = valid(thisYear, month, day)
  return guess && guess > shiftDay(today, 31) ? valid(thisYear - 1, month, day) : guess
}

function valid(year: number, month: number, day: number): string | null {
  if (!(year >= 2000 && year < 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31)) return null
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCMonth() === month - 1 ? date.toISOString().slice(0, 10) : null
}

/**
 * A fee as typed: 1500000, "1.500.000đ", "1,500,000", "1,5tr", "1tr5", "500k".
 * Null when there is nothing that reads as money in it.
 */
export function parseMoney(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? Math.round(raw) : null
  const text = String(raw ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, '')
  if (!text) return null
  // "1tr5", "1tr500", "1tr25": millions, then the decimals of a million.
  const spoken = text.match(/^(\d+)tr(\d{1,3})(?!\d)/)
  if (spoken) return Math.round(Number(`${spoken[1]}.${spoken[2]}`) * 1_000_000)
  // "1,500k", "1.500k": thousands separators before the unit.
  const grouped = text.match(/^(\d{1,3}(?:[.,]\d{3})+)(k|nghin|ngan)(?![a-z])/)
  if (grouped) return Number(grouped[1].replace(/[.,]/g, '')) * 1_000
  const scaled = text.match(/^(\d+(?:[.,]\d{1,3})?)(tr|trieu|m|k|nghin|ngan)(?![a-z])/)
  if (scaled && !/^\d+[.,]\d{3}$/.test(scaled[1])) {
    const value = Number(scaled[1].replace(',', '.'))
    return Math.round(value * (scaled[2].startsWith('k') || scaled[2].startsWith('ng') ? 1_000 : 1_000_000))
  }
  if (text.startsWith('-')) return null
  // Separators of thousands, whichever the writer used: only the digits count.
  const digits = String(raw).replace(/[^\d]/g, '')
  return digits ? Number(digits) : null
}

export function parseStatus(raw: unknown): BookingStatus | null {
  const text = plain(raw)
  if (!text) return null
  for (const status of BOOKING_STATUSES) if (STATUS_WORDS[status].includes(text)) return status
  return null
}

/** A count as typed: 12, "1.200", "1,200", "1 200". Null when it is not a whole, non-negative number. */
export function parseCount(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isInteger(raw) && raw >= 0 && raw < 2 ** 31 ? raw : null
  const text = String(raw ?? '').trim()
  if (!/^\d{1,3}([.,\s]\d{3})*$|^\d+$/.test(text)) return null
  const value = Number(text.replace(/[^\d]/g, ''))
  return value < 2 ** 31 ? value : null
}

/**
 * The size classes a team files its KOCs under, by followers — offered as
 * presets; any other word the team uses is kept as typed. The follower bounds
 * are what the UI shows beside each name.
 */
export const KOC_TIERS = ['Nano', 'Micro', 'Mid', 'Macro', 'Mega'] as const

export const KOC_TIER_RANGES: Record<(typeof KOC_TIERS)[number], string> = {
  Nano: '<10K',
  Micro: '10K–100K',
  Mid: '100K–500K',
  Macro: '500K–1M',
  Mega: '>1M',
}

const MAX_TIER = 60

/** A tier as typed: a preset whatever its case ("micro", "KOC Micro", "Mid-tier"), else the text itself, trimmed. */
export function parseTier(raw: unknown): string | null {
  const typed = String(raw ?? '').trim().replace(/\s+/g, ' ')
  if (!typed) return null
  const words = plain(typed).split(' ')
  const preset = KOC_TIERS.find((tier) => words.includes(tier.toLowerCase()))
  return preset ?? typed.slice(0, MAX_TIER)
}

/** Where a tier falls among the presets (a free-text tier after them, none last), to sort by size. */
export const tierRank = (tier: string | null | undefined) => {
  if (!tier) return KOC_TIERS.length + 1
  const index = (KOC_TIERS as readonly string[]).indexOf(tier)
  return index >= 0 ? index : KOC_TIERS.length
}

/** A booking code as stored: trimmed, upper-case, inner spaces gone ("bk-12" → "BK-12"). */
export const codeKey = (raw: unknown) => (raw instanceof Date ? '' : String(raw ?? '').trim().replace(/\s+/g, '').toUpperCase())

/** The code of the n-th booking of a project: BK-0001 … BK-9999, then BK-10000 on. */
export const bookingCode = (n: number) => `BK-${String(n).padStart(4, '0')}`

/** The number in a code the app gave ("BK-0042" → 42); null for a code of the team's own. */
export const codeNumber = (code: string | null | undefined) => {
  // Six digits at most: a longer one (typed or imported) is a code of the team's own, never counted —
  // else the next code would outgrow what the counter reads (result-writes.ts), and every new booking clash.
  const match = /^BK-(\d{1,6})$/.exec(code ?? '')
  return match ? Number(match[1]) : null
}

/** 2026-09-12 → "09/2026", the month a booking is counted in. */
export const monthOf = (day: string) => `${day.slice(5, 7)}/${day.slice(0, 4)}`

/* ----------------------------------------------------------- normalise --- */

/**
 * The day a TikTok video was posted, read from its id: the id's top 32 bits
 * are the Unix time it was created. Null for an id that does not carry a
 * plausible time (before TikTok, or in the future).
 */
export function postedOnOfVideo(videoId: string | null | undefined, today = vnDate(new Date())): string | null {
  if (!videoId || !/^\d{15,20}$/.test(videoId)) return null
  const seconds = Number(BigInt(videoId) >> BigInt(32))
  const day = vnDate(new Date(seconds * 1000))
  return day >= '2016-09-01' && day <= today ? day : null
}

/** What a campaign fills in for its bookings when a row leaves it out. */
export type CampaignDefaults = { product: string | null; defaultCost: number | null }

/** A row with the blanks its campaign fills: the product, and the fee most of its KOCs get. */
export function withCampaignDefaults(raw: RawBooking, campaign: CampaignDefaults | null | undefined): RawBooking {
  if (!campaign) return raw
  const blank = (value: unknown) => value === undefined || value === null || String(value).trim() === ''
  return {
    ...raw,
    ...(blank(raw.product) && campaign.product ? { product: campaign.product } : {}),
    ...(blank(raw.cost) && campaign.defaultCost !== null ? { cost: campaign.defaultCost } : {}),
  }
}

/**
 * A booking as stored (see core/db/schema/bookings.ts), without its
 * bookkeeping columns; `campaign` is the campaign's name. `code` null means
 * "give it the next one"; results typed here are the booker's own (manual) —
 * null leaves them to the sync.
 */
export type BookingInput = {
  campaign: string | null
  code: string | null
  kocHandle: string
  kocName: string | null
  kocContact: string | null
  kocTier: string | null
  bookedOn: string
  plannedAirOn: string | null
  airedOn: string | null
  videoUrl: string | null
  videoId: string | null
  product: string | null
  cost: number
  status: BookingStatus
  note: string | null
  resultOrders: number | null
  resultRevenue: number | null
}

/** What is wrong with a field, as a key of the "bookings.errors" messages. */
export type BookingErrorCode =
  | 'required'
  | 'invalidDate'
  | 'invalidMoney'
  | 'invalidNumber'
  | 'invalidVideo'
  | 'invalidStatus'
  | 'invalidCode'
  | 'airBeforeBook'
  | 'airedNeedsDate'
  | 'tooLong'

export type BookingIssue = { field: BookingField; code: BookingErrorCode }

export type RawBooking = Partial<Record<BookingField, unknown>>

const MAX_TEXT = 500
const MAX_CODE = 40

const text = (value: unknown) => {
  const out = value instanceof Date ? '' : String(value ?? '').trim()
  return out || null
}

/**
 * One row as typed into a clean booking, or the reasons it cannot be one.
 *
 * Lenient where the intent is plain: a KOC left out is read from the video
 * link (…/@handle/video/…), and an air date left out from the video id (the
 * day it was posted); a status left out is "aired" once there is an air date;
 * a booking date left out is the air date. Strict where a guess would
 * put wrong figures in a report: a date or a fee that does not read, a video
 * link without an id, an air date before the booking.
 */
export function normalizeBooking(raw: RawBooking, today = vnDate(new Date())): { value: BookingInput | null; issues: BookingIssue[] } {
  const issues: BookingIssue[] = []
  const add = (field: BookingField, code: BookingErrorCode) => issues.push({ field, code })

  for (const field of BOOKING_FIELDS) {
    if ((text(raw[field])?.length ?? 0) > MAX_TEXT) add(field, 'tooLong')
  }

  const videoUrl = text(raw.videoUrl)
  let videoId: string | null = null
  if (videoUrl) {
    const id = videoKey(videoUrl)
    if (/^\d{10,}$/.test(id)) videoId = id
    else add('videoUrl', 'invalidVideo')
  }

  const kocHandle = kocKey(raw.koc) || (videoUrl ? kocOfVideoUrl(videoUrl) : '')
  if (!kocHandle) add('koc', 'required')

  const dateOf = (field: 'bookedOn' | 'airedOn' | 'plannedAirOn') => {
    const value = raw[field]
    if (value === undefined || value === null || String(value).trim() === '') return null
    const parsed = parseDate(value, today)
    if (!parsed) add(field, 'invalidDate')
    return parsed
  }
  const airedTyped = dateOf('airedOn')
  const airedGiven = text(raw.airedOn) !== null || raw.airedOn instanceof Date
  const airedOn = airedTyped ?? (airedGiven ? null : postedOnOfVideo(videoId, today))
  let bookedOn = dateOf('bookedOn')
  const bookedGiven = text(raw.bookedOn) !== null || raw.bookedOn instanceof Date
  if (!bookedOn && !bookedGiven) {
    if (airedOn) bookedOn = airedOn
    else add('bookedOn', 'required')
  }
  // Only a typed air date is held to it: a video booked after it was posted (its rights bought for ads) is fine.
  if (bookedOn && airedTyped && airedTyped < bookedOn) add('airedOn', 'airBeforeBook')
  const plannedAirOn = dateOf('plannedAirOn')
  if (bookedOn && plannedAirOn && plannedAirOn < bookedOn) add('plannedAirOn', 'airBeforeBook')

  const code = codeKey(raw.code) || null
  if (code && code.length > MAX_CODE) add('code', 'invalidCode')

  // Results typed by the booker; blank leaves them to the sync (features/bookings/sync.ts).
  const blank = (value: unknown) => value === undefined || value === null || String(value).trim() === ''
  let resultOrders: number | null = null
  if (!blank(raw.resultOrders)) {
    resultOrders = parseCount(raw.resultOrders)
    if (resultOrders === null) add('resultOrders', 'invalidNumber')
  }
  let resultRevenue: number | null = null
  if (!blank(raw.resultRevenue)) {
    resultRevenue = parseMoney(raw.resultRevenue)
    if (resultRevenue === null) add('resultRevenue', 'invalidMoney')
  }

  let cost = 0
  if (raw.cost === undefined || raw.cost === null || String(raw.cost).trim() === '') add('cost', 'required')
  else {
    const parsed = parseMoney(raw.cost)
    if (parsed === null) add('cost', 'invalidMoney')
    else cost = parsed
  }

  let status: BookingStatus = airedOn ? 'aired' : 'pending'
  if (text(raw.status)) {
    const parsed = parseStatus(raw.status)
    if (!parsed) add('status', 'invalidStatus')
    else if (parsed === 'aired' && !airedOn) add('airedOn', 'airedNeedsDate')
    else status = parsed === 'pending' && airedOn ? 'aired' : parsed
  }

  if (issues.length > 0 || !bookedOn) return { value: null, issues }
  const product = text(raw.product)
  return {
    value: {
      campaign: text(raw.campaign),
      code,
      kocHandle,
      kocName: text(raw.kocName),
      kocContact: text(raw.kocContact),
      kocTier: parseTier(raw.kocTier),
      bookedOn,
      plannedAirOn,
      airedOn,
      videoUrl,
      videoId,
      product: product ? productKey(product) : null,
      cost,
      status,
      note: text(raw.note),
      resultOrders,
      resultRevenue,
    },
    issues,
  }
}
