'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControlLabel from '@mui/material/FormControlLabel'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { formatNumber } from '@/core/utils/format'
import { saveDashboardSelection } from '@/modules/overview/data/actions'
import { channelName } from '@/modules/overview/data/channels'
import type { DashboardSources } from '@/modules/overview/data/types'

/**
 * Chooses which GMV Max shops and Sapo channels the project's dashboard counts.
 *
 * Each source starts on "all" — which also takes in shops and channels added
 * later — or on an explicit list. Shops are grouped by the ad account that
 * reports them, and ticking an account ticks all of its shops. An explicit
 * list may not be empty: a dashboard counting nothing would read as a
 * business with no sales.
 */

type Mode = 'all' | 'chosen'

export function DashboardSourcesDialog({
  projectId,
  open,
  canConfigure,
  onClose,
  onSaved,
}: {
  projectId: string
  open: boolean
  canConfigure: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const t = useTranslations('dashboard')
  const locale = useLocale()
  const [sources, setSources] = useState<DashboardSources | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [shopMode, setShopMode] = useState<Mode>('all')
  const [shops, setShops] = useState<Set<string>>(new Set())
  const [channelMode, setChannelMode] = useState<Mode>('all')
  const [channels, setChannels] = useState<Set<string>>(new Set())
  const [saving, startSaving] = useTransition()

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setSources(null)
    setLoadError(null)
    setSaveError(null)
    fetch(`/api/projects/${projectId}/dashboard/sources`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return (await response.json()) as DashboardSources
      })
      .then((data) => {
        if (cancelled) return
        setSources(data)
        setShopMode(data.tiktok?.selected ? 'chosen' : 'all')
        setShops(new Set(data.tiktok?.selected ?? data.tiktok?.shops.map((s) => s.key) ?? []))
        setChannelMode(data.sapo?.selected ? 'chosen' : 'all')
        setChannels(new Set(data.sapo?.selected ?? data.sapo?.channels.map((c) => c.name) ?? []))
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error))
      })
    return () => {
      cancelled = true
    }
  }, [open, projectId])

  const accounts = useMemo(() => {
    const groups = new Map<string, { name: string; shops: NonNullable<DashboardSources['tiktok']>['shops'] }>()
    for (const shop of sources?.tiktok?.shops ?? []) {
      const group = groups.get(shop.advertiserId) ?? { name: shop.advertiserName || shop.advertiserId, shops: [] }
      group.shops.push(shop)
      groups.set(shop.advertiserId, group)
    }
    return [...groups.entries()]
  }, [sources])

  const toggle = (set: Set<string>, keys: string[], on: boolean) => {
    const next = new Set(set)
    for (const key of keys) {
      if (on) next.add(key)
      else next.delete(key)
    }
    return next
  }

  const shopsInvalid = Boolean(sources?.tiktok) && shopMode === 'chosen' && shops.size === 0
  const channelsInvalid = Boolean(sources?.sapo) && channelMode === 'chosen' && channels.size === 0
  const disabled = !canConfigure || !sources || saving || shopsInvalid || channelsInvalid

  function save() {
    if (!sources) return
    const updates = [
      ...(sources.tiktok
        ? [{ connectionId: sources.tiktok.connectionId, key: 'gmvStores', values: shopMode === 'all' ? null : [...shops] }]
        : []),
      ...(sources.sapo
        ? [{ connectionId: sources.sapo.connectionId, key: 'sapoChannels', values: channelMode === 'all' ? null : [...channels] }]
        : []),
    ]
    if (updates.length === 0) return onClose()
    startSaving(async () => {
      const result = await saveDashboardSelection(projectId, updates)
      if (result.ok) onSaved()
      else setSaveError(t('saveError', { message: result.message ?? '' }))
    })
  }

  return (
    <Dialog open={open} onClose={() => (saving ? null : onClose())} maxWidth="sm">
      <DialogTitle sx={{ fontSize: '1rem', fontWeight: 600 }}>{t('sourcesDialogTitle')}</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
          {t('sourcesIntro')}
        </Typography>

        {loadError ? <Alert severity="error">{t('sourcesLoadError', { message: loadError })}</Alert> : null}
        {!sources && !loadError ? (
          <Stack sx={{ alignItems: 'center', py: 5 }}>
            <CircularProgress size={22} />
          </Stack>
        ) : null}
        {!canConfigure && sources ? (
          <Alert severity="info" sx={{ mb: 2 }}>
            {t('readOnly')}
          </Alert>
        ) : null}

        {sources?.tiktok ? (
          <Box sx={{ mb: 3 }}>
            <Typography variant="subtitle2">{t('shopsSection')}</Typography>
            <Typography variant="caption" sx={{ color: 'text.disabled' }}>
              {sources.tiktok.connectionName}
            </Typography>
            <RadioGroup value={shopMode} onChange={(event) => setShopMode(event.target.value as Mode)} sx={{ mt: 0.5 }}>
              <FormControlLabel value="all" control={<Radio size="small" />} label={t('shopsAll')} disabled={!canConfigure} />
              <FormControlLabel value="chosen" control={<Radio size="small" />} label={t('shopsChosen')} disabled={!canConfigure} />
            </RadioGroup>

            {shopMode === 'chosen' ? (
              <Stack spacing={1} sx={{ pl: 3.5, mt: 0.5 }}>
                {accounts.length === 0 ? (
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    {t('noShops')}
                  </Typography>
                ) : null}
                {accounts.map(([advertiserId, group]) => {
                  const keys = group.shops.map((s) => s.key)
                  const chosen = keys.filter((key) => shops.has(key)).length
                  return (
                    <Box key={advertiserId}>
                      <FormControlLabel
                        control={
                          <Checkbox
                            size="small"
                            checked={chosen === keys.length}
                            indeterminate={chosen > 0 && chosen < keys.length}
                            onChange={(event) => setShops((set) => toggle(set, keys, event.target.checked))}
                          />
                        }
                        label={
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {group.name}
                          </Typography>
                        }
                        disabled={!canConfigure}
                      />
                      <Stack sx={{ pl: 3.5 }}>
                        {group.shops.map((shop) => (
                          <FormControlLabel
                            key={shop.key}
                            control={
                              <Checkbox
                                size="small"
                                checked={shops.has(shop.key)}
                                onChange={(event) => setShops((set) => toggle(set, [shop.key], event.target.checked))}
                              />
                            }
                            label={<Typography variant="body2">{shop.storeName}</Typography>}
                            disabled={!canConfigure}
                          />
                        ))}
                      </Stack>
                    </Box>
                  )
                })}
                {shopsInvalid ? (
                  <Typography variant="caption" sx={{ color: 'error.main' }}>
                    {t('pickAtLeastOne')}
                  </Typography>
                ) : null}
              </Stack>
            ) : null}

            {sources.tiktok.accountsWithoutShops > 0 ? (
              <Typography variant="caption" sx={{ display: 'block', color: 'text.disabled', mt: 1 }}>
                {t('accountsWithoutShops', { count: sources.tiktok.accountsWithoutShops })}
              </Typography>
            ) : null}
          </Box>
        ) : null}

        {sources?.sapo ? (
          <Box>
            <Typography variant="subtitle2">{t('channelsSection')}</Typography>
            <Typography variant="caption" sx={{ color: 'text.disabled' }}>
              {sources.sapo.connectionName}
            </Typography>
            <RadioGroup value={channelMode} onChange={(event) => setChannelMode(event.target.value as Mode)} sx={{ mt: 0.5 }}>
              <FormControlLabel value="all" control={<Radio size="small" />} label={t('channelsAll')} disabled={!canConfigure} />
              <FormControlLabel value="chosen" control={<Radio size="small" />} label={t('channelsChosen')} disabled={!canConfigure} />
            </RadioGroup>

            {channelMode === 'chosen' ? (
              <Stack sx={{ pl: 3.5, mt: 0.5 }}>
                {sources.sapo.channels.length === 0 ? (
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    {t('noChannels')}
                  </Typography>
                ) : null}
                {sources.sapo.channels.map((channel) => (
                  <FormControlLabel
                    key={channel.name}
                    control={
                      <Checkbox
                        size="small"
                        checked={channels.has(channel.name)}
                        onChange={(event) => setChannels((set) => toggle(set, [channel.name], event.target.checked))}
                      />
                    }
                    label={
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
                        <Typography variant="body2">{channelName(channel.name, t('channelOther'))}</Typography>
                        <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                          {t('channelOrders', { count: formatNumber(channel.orders, locale) })}
                        </Typography>
                      </Stack>
                    }
                    disabled={!canConfigure}
                  />
                ))}
                {channelsInvalid ? (
                  <Typography variant="caption" sx={{ color: 'error.main' }}>
                    {t('pickAtLeastOne')}
                  </Typography>
                ) : null}
              </Stack>
            ) : null}
          </Box>
        ) : null}

        {saveError ? (
          <Alert severity="error" sx={{ mt: 2 }}>
            {saveError}
          </Alert>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} disabled={saving} color="inherit">
          {t('cancel')}
        </Button>
        <Button
          variant="contained"
          onClick={save}
          disabled={disabled}
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : null}
        >
          {t('save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
