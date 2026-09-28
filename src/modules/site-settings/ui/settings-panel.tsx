'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import CircularProgress from '@mui/material/CircularProgress'
import FormControlLabel from '@mui/material/FormControlLabel'
import Stack from '@mui/material/Stack'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import ConstructionOutlined from '@mui/icons-material/ConstructionOutlined'
import InfoOutlined from '@mui/icons-material/InfoOutlined'
import { PageHeader } from '@/components/ui/page-header'
import { CardTitle, ConfirmDialog, useToast } from '@/modules/system-admin/ui/parts'
import { saveCorner, saveMaintenance } from '../data/actions'
import { fillTemplate, TEMPLATE_VARIABLES, type TemplateValues } from '../template'
import { CORNER_PLACEMENTS, MAX_CORNER_TEXT, MAX_MESSAGE, type SettingsOutcome, type SiteSettings } from '../types'
import { cornerSx } from './corner-style'

/**
 * The admin Settings page — platform Administrators only: maintenance mode,
 * switched on and off at will, and the small note in the corner of every page.
 */
export function SettingsPanel({ initial, updating, values }: { initial: SiteSettings; updating: boolean; values: TemplateValues }) {
  const t = useTranslations('siteSettings')
  const tc = useTranslations('common')
  const router = useRouter()
  const toast = useToast()
  const [busy, startBusy] = useTransition()

  const [maintenance, setMaintenance] = useState(initial.maintenance)
  const [corner, setCorner] = useState(initial.corner)
  const [confirmOn, setConfirmOn] = useState(false)

  const run = (action: () => Promise<SettingsOutcome>, done: string) =>
    startBusy(async () => {
      const outcome = await action()
      if (!outcome.ok) return toast.show('error', t(`errors.${outcome.message}`))
      toast.show('success', done)
      router.refresh()
    })

  const maintenanceChanged = maintenance.on !== initial.maintenance.on || maintenance.message.trim() !== initial.maintenance.message
  const cornerChanged =
    corner.on !== initial.corner.on || corner.text.trim() !== initial.corner.text || corner.placement !== initial.corner.placement
  const preview = fillTemplate(corner.text, values).trim()
  /** A variable put in where the text ends — the chips under a field. */
  const variables = (insert: (token: string) => void) => (
    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', alignItems: 'center', rowGap: 1 }}>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        {t('variables')}
      </Typography>
      {TEMPLATE_VARIABLES.map((name) => (
        <Chip
          key={name}
          size="small"
          variant="outlined"
          label={`{{${name}}}`}
          title={t(`variableHelp.${name}`, { value: values[name] ?? '—' })}
          onClick={() => insert(`{{${name}}}`)}
          sx={{ fontFamily: 'monospace' }}
        />
      ))}
    </Stack>
  )
  const join = (text: string, token: string) => (text && !/\s$/.test(text) ? `${text} ${token}` : `${text}${token}`)

  const submitMaintenance = () => {
    // Closing the app to everyone else is asked about first.
    if (maintenance.on && !initial.maintenance.on) return setConfirmOn(true)
    run(() => saveMaintenance(maintenance), t('saved'))
  }

  return (
    <Stack spacing={2.5}>
      <PageHeader title={t('title')} description={t('subtitle')} />

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, minmax(0, 1fr))' }, alignItems: 'start' }}>
        <Card>
          <CardContent>
            <CardTitle icon={<ConstructionOutlined fontSize="small" color="primary" />}>{t('maintenance.title')}</CardTitle>
            <Stack spacing={2}>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {t('maintenance.help')}
              </Typography>
              {updating ? <Alert severity="info">{t('maintenance.updatingNow')}</Alert> : null}
              {initial.maintenance.on ? <Alert severity="warning">{t('maintenance.onNow')}</Alert> : null}
              <FormControlLabel
                control={<Switch checked={maintenance.on} onChange={(e) => setMaintenance({ ...maintenance, on: e.target.checked })} />}
                label={t('maintenance.switch')}
              />
              <TextField
                label={t('maintenance.message')}
                placeholder={t('maintenance.messagePlaceholder')}
                value={maintenance.message}
                onChange={(e) => setMaintenance({ ...maintenance, message: e.target.value.slice(0, MAX_MESSAGE) })}
                multiline
                minRows={2}
                helperText={t('maintenance.messageHelp')}
              />
              {variables((token) => setMaintenance({ ...maintenance, message: join(maintenance.message, token).slice(0, MAX_MESSAGE) }))}
              <Box>
                <Button
                  variant="contained"
                  color={maintenance.on && !initial.maintenance.on ? 'warning' : 'primary'}
                  disabled={!maintenanceChanged || busy}
                  onClick={submitMaintenance}
                  startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}
                >
                  {tc('save')}
                </Button>
              </Box>
            </Stack>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <CardTitle icon={<InfoOutlined fontSize="small" color="primary" />}>{t('corner.title')}</CardTitle>
            <Stack spacing={2}>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {t('corner.help')}
              </Typography>
              <FormControlLabel
                control={<Switch checked={corner.on} onChange={(e) => setCorner({ ...corner, on: e.target.checked })} />}
                label={t('corner.switch')}
              />
              <TextField
                label={t('corner.text')}
                placeholder={t('corner.textPlaceholder')}
                value={corner.text}
                onChange={(e) => setCorner({ ...corner, text: e.target.value.slice(0, MAX_CORNER_TEXT) })}
                multiline
                minRows={2}
                helperText={t('corner.textHelp', { count: corner.text.length, max: MAX_CORNER_TEXT })}
              />
              {variables((token) => setCorner({ ...corner, text: join(corner.text, token).slice(0, MAX_CORNER_TEXT) }))}
              <Box>
                <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
                  {t('corner.placement')}
                </Typography>
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  value={corner.placement}
                  onChange={(_e, v) => v && setCorner({ ...corner, placement: v })}
                  sx={{ flexWrap: 'wrap' }}
                >
                  {CORNER_PLACEMENTS.map((placement) => (
                    <ToggleButton key={placement} value={placement} sx={{ px: 2 }}>
                      {t(`corner.placements.${placement}`)}
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
                <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 0.75 }}>
                  {t(`corner.placementHelp.${corner.placement}`)}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {t('corner.preview')}
                </Typography>
                <Box
                  sx={{
                    mt: 0.5,
                    p: corner.on && preview && corner.placement === 'footer' ? 0 : 1.5,
                    pt: 1.5,
                    borderRadius: 1,
                    bgcolor: 'action.hover',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-end',
                    justifyContent: 'flex-end',
                    minHeight: 64,
                    overflow: 'hidden',
                  }}
                >
                  {corner.on && preview ? (
                    corner.placement === 'footer' ? (
                      <Box sx={[cornerSx('footer'), { alignSelf: 'stretch', borderTop: 1, borderColor: 'divider' }]}>{preview}</Box>
                    ) : (
                      <Box sx={cornerSx('floating')}>{preview}</Box>
                    )
                  ) : (
                    <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                      {t('corner.hidden')}
                    </Typography>
                  )}
                </Box>
              </Box>
              <Box>
                <Button
                  variant="contained"
                  disabled={!cornerChanged || busy}
                  onClick={() => run(() => saveCorner(corner), t('saved'))}
                  startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}
                >
                  {tc('save')}
                </Button>
              </Box>
            </Stack>
          </CardContent>
        </Card>
      </Box>

      <ConfirmDialog
        open={confirmOn}
        title={t('maintenance.confirmTitle')}
        confirmLabel={t('maintenance.confirm')}
        danger
        busy={busy}
        onCancel={() => setConfirmOn(false)}
        onConfirm={() => {
          setConfirmOn(false)
          run(() => saveMaintenance(maintenance), t('saved'))
        }}
      >
        <Typography variant="body2">{t('maintenance.confirmBody')}</Typography>
      </ConfirmDialog>
      {toast.element}
    </Stack>
  )
}
