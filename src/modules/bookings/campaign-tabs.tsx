'use client'

import { useTranslations } from 'next-intl'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import AddOutlined from '@mui/icons-material/AddOutlined'
import type { CampaignListRow } from '@/features/bookings/queries'

/** Which bookings the page shows: all, those outside any campaign, or one campaign's. */
export type CampaignFilter = 'all' | 'none' | string

/**
 * The campaigns as tabs over the booking list, each with how many bookings it
 * holds — running campaigns first, ended ones after and dimmed. Where each
 * stands against its target and budget is said once, for the tab chosen, in
 * the summary below (page.tsx), rather than on every tab.
 */
export function CampaignTabs({
  campaigns,
  counts,
  value,
  canEdit,
  onChange,
  onAdd,
}: {
  campaigns: CampaignListRow[]
  /** Bookings (not cancelled) by campaign id; `null` for those outside any. */
  counts: Map<string | null, number>
  value: CampaignFilter
  canEdit: boolean
  onChange: (next: CampaignFilter) => void
  onAdd: () => void
}) {
  const t = useTranslations('bookings')
  const ordered = [...campaigns].sort((a, b) => Number(a.status === 'ended') - Number(b.status === 'ended'))
  const all = [...counts.values()].reduce((sum, n) => sum + n, 0)
  const outside = counts.get(null) ?? 0

  const label = (name: string, count: number) => (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
      <Box component="span" sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {name}
      </Box>
      <Box component="span" sx={{ px: 0.75, borderRadius: 1, bgcolor: 'action.selected', fontSize: 12, fontWeight: 600 }}>
        {count}
      </Box>
    </Box>
  )

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', borderBottom: 1, borderColor: 'divider', minWidth: 0 }}>
      <Tabs value={value} onChange={(_event, next: CampaignFilter) => onChange(next)} variant="scrollable" scrollButtons="auto" sx={{ minHeight: 40, flex: 1, minWidth: 0 }}>
        <Tab value="all" label={label(t('campaign.all'), all)} sx={{ minHeight: 40, textTransform: 'none' }} />
        {ordered.map((campaign) => (
          <Tab
            key={campaign.id}
            value={campaign.id}
            title={campaign.name}
            label={label(campaign.name, counts.get(campaign.id) ?? 0)}
            sx={{ minHeight: 40, textTransform: 'none', opacity: campaign.status === 'ended' ? 0.55 : 1 }}
          />
        ))}
        {outside > 0 && campaigns.length > 0 ? <Tab value="none" label={label(t('campaign.none'), outside)} sx={{ minHeight: 40, textTransform: 'none' }} /> : null}
      </Tabs>
      {canEdit ? (
        <Button size="small" startIcon={<AddOutlined />} onClick={onAdd} sx={{ flexShrink: 0, ml: 1, whiteSpace: 'nowrap' }}>
          {t('campaign.add')}
        </Button>
      ) : null}
    </Box>
  )
}
