'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import Box from '@mui/material/Box'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import InsightsOutlined from '@mui/icons-material/InsightsOutlined'
import EditNoteOutlined from '@mui/icons-material/EditNoteOutlined'

/**
 * Booking & KOC's two parts, one above the other's page: the report (what
 * the booked videos brought) and the booking data it is read from (the list
 * the bookers keep). Links, so each has its own address and the browser's
 * back button moves between them; the bar sits in the section's layout, so it
 * stays put while the part below changes.
 */
export function BookingKocTabs({ projectId }: { projectId: string }) {
  const t = useTranslations('reports.bookingKoc')
  const pathname = usePathname()
  const base = `/projects/${projectId}/booking-koc`
  const value = pathname.startsWith(`${base}/data`) ? 'data' : 'report'
  return (
    <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2.5 }}>
      <Tabs value={value} variant="scrollable" allowScrollButtonsMobile aria-label={t('sections')}>
        <Tab
          value="report"
          component={Link}
          href={base}
          icon={<InsightsOutlined fontSize="small" />}
          iconPosition="start"
          label={t('tabReport')}
          sx={{ minHeight: 44, textTransform: 'none', fontWeight: 600 }}
        />
        <Tab
          value="data"
          component={Link}
          href={`${base}/data`}
          icon={<EditNoteOutlined fontSize="small" />}
          iconPosition="start"
          label={t('tabData')}
          sx={{ minHeight: 44, textTransform: 'none', fontWeight: 600 }}
        />
      </Tabs>
    </Box>
  )
}
