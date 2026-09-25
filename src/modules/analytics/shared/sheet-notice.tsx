'use client'

import { useTranslations } from 'next-intl'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import { AppLink } from '@/components/ui/app-link'

/** What the booking file holds, as the reports read it (cancelled bookings left out). */
export type BookingFileSummary = {
  rows: number
  /** Booked but not aired yet, so not counted on any day. */
  withoutAirDate: number
  /** Aired in the period, with a product that matches nothing on TikTok. */
  unmatchedProducts: number
}

/**
 * The booking file's state above the reports it feeds, with the way to it: an
 * empty file, rows waiting for an air date and products that match nothing
 * would otherwise just look like a quiet month.
 */
export function SheetNotice({ sheet, projectId }: { sheet: BookingFileSummary; projectId: string }) {
  const t = useTranslations('reports.sheet')
  const trouble = sheet.rows === 0 || sheet.unmatchedProducts > 0

  return (
    <Alert
      severity={sheet.rows === 0 ? 'warning' : trouble ? 'info' : 'success'}
      action={
        <Button color="inherit" size="small" component={AppLink} href={`/projects/${projectId}/booking-koc/data`} sx={{ whiteSpace: 'nowrap' }}>
          {t('open')}
        </Button>
      }
    >
      <Typography variant="body2">
        {sheet.rows === 0 ? t('empty') : t('summary', { rows: sheet.rows })}
        {sheet.withoutAirDate > 0 ? ` ${t('withoutAirDate', { count: sheet.withoutAirDate })}` : ''}
        {sheet.unmatchedProducts > 0 ? ` ${t('unmatched', { count: sheet.unmatchedProducts })}` : ''}
      </Typography>
    </Alert>
  )
}
