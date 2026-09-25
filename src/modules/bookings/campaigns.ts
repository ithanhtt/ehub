import type { CampaignStatus } from '@/core/db/schema/bookings'
import { productKey } from '@/modules/analytics/shared/keys'
import { parseDate, parseMoney, plain } from './fields'

/**
 * The booking campaign's standard, shared by its form and the server action
 * like fields.ts is for bookings: what a campaign holds, and how its form
 * becomes one — checked the same way in the browser and on the server.
 */

export const CAMPAIGN_STATUSES: readonly CampaignStatus[] = ['active', 'ended']

/** A campaign as stored, without its bookkeeping columns. */
export type CampaignInput = {
  name: string
  product: string | null
  defaultCost: number | null
  startOn: string
  endOn: string | null
  budget: number | null
  targetVideos: number | null
  status: CampaignStatus
  note: string | null
}

export type CampaignField = 'name' | 'product' | 'defaultCost' | 'startOn' | 'endOn' | 'budget' | 'targetVideos' | 'status' | 'note'

/** The campaign form as typed. */
export type CampaignDraft = Record<CampaignField, string>

/** A key of the "bookings.campaignErrors" messages. */
export type CampaignErrorCode = 'required' | 'invalidDate' | 'invalidMoney' | 'invalidNumber' | 'endBeforeStart' | 'tooLong' | 'duplicateName'

export type CampaignIssue = { field: CampaignField; code: CampaignErrorCode }

const MAX_NAME = 120

/** Two campaign names are the same one whatever their accents, case or spacing. */
export const campaignKey = (name: unknown) => plain(name)

export function normalizeCampaign(draft: Partial<CampaignDraft>): { value: CampaignInput | null; issues: CampaignIssue[] } {
  const issues: CampaignIssue[] = []
  const add = (field: CampaignField, code: CampaignErrorCode) => issues.push({ field, code })
  const text = (field: CampaignField) => String(draft[field] ?? '').trim()

  const name = text('name').replace(/\s+/g, ' ')
  if (!name) add('name', 'required')
  else if (name.length > MAX_NAME) add('name', 'tooLong')
  if (text('note').length > 1000) add('note', 'tooLong')

  const startOn = text('startOn') ? parseDate(text('startOn')) : null
  if (!text('startOn')) add('startOn', 'required')
  else if (!startOn) add('startOn', 'invalidDate')
  const endOn = text('endOn') ? parseDate(text('endOn')) : null
  if (text('endOn') && !endOn) add('endOn', 'invalidDate')
  if (startOn && endOn && endOn < startOn) add('endOn', 'endBeforeStart')

  const money = (field: 'budget' | 'defaultCost') => {
    if (!text(field)) return null
    const value = parseMoney(text(field))
    if (value === null) add(field, 'invalidMoney')
    return value
  }
  const budget = money('budget')
  const defaultCost = money('defaultCost')

  let targetVideos: number | null = null
  if (text('targetVideos')) {
    const value = Number(text('targetVideos').replace(/[.,\s]/g, ''))
    if (Number.isInteger(value) && value >= 0 && value < 1_000_000) targetVideos = value
    else add('targetVideos', 'invalidNumber')
  }

  const status: CampaignStatus = text('status') === 'ended' ? 'ended' : 'active'
  if (issues.length > 0 || !startOn) return { value: null, issues }
  return {
    value: {
      name,
      product: text('product') ? productKey(text('product')) : null,
      defaultCost,
      startOn,
      endOn,
      budget,
      targetVideos,
      status,
      note: text('note') || null,
    },
    issues,
  }
}
