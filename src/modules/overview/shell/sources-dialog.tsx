'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import FormControlLabel from '@mui/material/FormControlLabel'
import Link from '@mui/material/Link'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'
import Stack from '@mui/material/Stack'
import Switch from '@mui/material/Switch'
import Typography from '@mui/material/Typography'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import { AppLink } from '@/components/ui/app-link'
import { formatNumber } from '@/core/utils/format'
import { saveDashboardSelection } from '@/modules/overview/data/actions'
import { channelName } from '@/modules/overview/data/channels'
import type { DashboardSources } from '@/modules/overview/data/types'

/**
 * What the project's overview reads, source by source — Sapo, the TikTok
 * Shop, TikTok Ads (GMV Max), in the page's own order:
 *
 *   - each connected source shown or hidden (hidden: off the overview, its
 *     connection untouched and the reports still reading it);
 *   - Sapo's sales channels and the GMV Max shops counted — all of them
 *     (shops and channels added later too), or a list, never an empty one:
 *     an overview counting nothing reads as a business with no sales;
 *   - the shop a TikTok Shop app reads, when it is authorised for several.
 *
 * A source not connected yet is listed too, with the way to connect it, so
 * the dialog always shows the whole picture.
 */

type Mode = 'all' | 'chosen'

/** The connection's last test, as a small coloured chip. */
function StatusChip({ status }: { status: string }) {
  const t = useTranslations('dashboard')
  const tone = status === 'connected' ? 'success' : status === 'draft' ? 'default' : 'warning'
  return <Chip size="small" variant="outlined" color={tone} label={t(`sourceStatus.${status === 'connected' || status === 'draft' || status === 'expired' ? status : 'error'}`)} />
}

/** One source: its name, its connection and state, the switch that shows it, and what can be chosen for it. */
function SourceSection({
  title,
  caption,
  connection,
  hidden,
  onHidden,
  canConfigure,
  connectHref,
  children,
}: {
  title: string
  caption: string
  connection: { connectionName: string; status: string } | null
  hidden: boolean
  onHidden: (hidden: boolean) => void
  canConfigure: boolean
  connectHref: string
  children?: React.ReactNode
}) {
  const t = useTranslations('dashboard')
  return (
    <Box component="section" sx={{ py: 2 }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              {title}
            </Typography>
            {connection ? <StatusChip status={connection.status} /> : null}
          </Stack>
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
            {connection ? `${caption} · ${connection.connectionName}` : caption}
          </Typography>
        </Box>
        {connection ? (
          <FormControlLabel
            labelPlacement="start"
            control={<Switch checked={!hidden} onChange={(event) => onHidden(!event.target.checked)} disabled={!canConfigure} />}
            label={<Typography variant="body2">{t('sourceShown')}</Typography>}
            sx={{ mr: 0, flexShrink: 0 }}
          />
        ) : (
          <Button size="small" variant="outlined" component={AppLink} href={connectHref} sx={{ flexShrink: 0 }}>
            {t('connect')}
          </Button>
        )}
      </Stack>
      {connection && hidden ? (
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>
          {t('sourceHiddenNote')}
        </Typography>
      ) : null}
      {connection && !hidden && children ? <Box sx={{ mt: 1.5 }}>{children}</Box> : null}
    </Box>
  )
}

/** "Select all · Clear" for a list of choices. */
function QuickPick({ onAll, onNone, disabled }: { onAll: () => void; onNone: () => void; disabled: boolean }) {
  const t = useTranslations('dashboard')
  return (
    <Stack direction="row" spacing={1.5} sx={{ mb: 0.5 }}>
      <Link component="button" type="button" variant="caption" onClick={onAll} disabled={disabled} underline="hover">
        {t('selectAll')}
      </Link>
      <Link component="button" type="button" variant="caption" onClick={onNone} disabled={disabled} underline="hover">
        {t('selectNone')}
      </Link>
    </Stack>
  )
}

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
  const theme = useTheme()
  const phone = useMediaQuery(theme.breakpoints.down('sm'))
  const [sources, setSources] = useState<DashboardSources | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [hidden, setHidden] = useState({ tiktok: false, tiktokShop: false, sapo: false })
  const [shopMode, setShopMode] = useState<Mode>('all')
  const [shops, setShops] = useState<Set<string>>(new Set())
  const [channelMode, setChannelMode] = useState<Mode>('all')
  const [channels, setChannels] = useState<Set<string>>(new Set())
  const [ttsShop, setTtsShop] = useState<string | null>(null)
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
        setHidden({ tiktok: data.tiktok?.hidden ?? false, tiktokShop: data.tiktokShop?.hidden ?? false, sapo: data.sapo?.hidden ?? false })
        setShopMode(data.tiktok?.selected ? 'chosen' : 'all')
        setShops(new Set(data.tiktok?.selected ?? data.tiktok?.shops.map((s) => s.key) ?? []))
        setChannelMode(data.sapo?.selected ? 'chosen' : 'all')
        setChannels(new Set(data.sapo?.selected ?? data.sapo?.channels.map((c) => c.name) ?? []))
        setTtsShop(data.tiktokShop?.selected ?? null)
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

  const shopsInvalid = Boolean(sources?.tiktok) && !hidden.tiktok && shopMode === 'chosen' && shops.size === 0
  const channelsInvalid = Boolean(sources?.sapo) && !hidden.sapo && channelMode === 'chosen' && channels.size === 0
  const disabled = !canConfigure || !sources || saving || shopsInvalid || channelsInvalid
  const connectHref = `/projects/${projectId}/settings/connections`

  function save() {
    if (!sources) return
    const updates: unknown[] = []
    if (sources.sapo) {
      updates.push({ connectionId: sources.sapo.connectionId, key: 'hidden', value: hidden.sapo })
      if (!hidden.sapo) updates.push({ connectionId: sources.sapo.connectionId, key: 'sapoChannels', values: channelMode === 'all' ? null : [...channels] })
    }
    if (sources.tiktokShop) {
      updates.push({ connectionId: sources.tiktokShop.connectionId, key: 'hidden', value: hidden.tiktokShop })
      if (!hidden.tiktokShop && ttsShop && ttsShop !== sources.tiktokShop.selected) {
        updates.push({ connectionId: sources.tiktokShop.connectionId, key: 'shopCipher', value: ttsShop })
      }
    }
    if (sources.tiktok) {
      updates.push({ connectionId: sources.tiktok.connectionId, key: 'hidden', value: hidden.tiktok })
      if (!hidden.tiktok) updates.push({ connectionId: sources.tiktok.connectionId, key: 'gmvStores', values: shopMode === 'all' ? null : [...shops] })
    }
    if (updates.length === 0) return onClose()
    startSaving(async () => {
      const result = await saveDashboardSelection(projectId, updates)
      if (result.ok) onSaved()
      else setSaveError(t('saveError', { message: result.message ?? '' }))
    })
  }

  return (
    <Dialog open={open} onClose={() => (saving ? null : onClose())} maxWidth="sm" fullWidth fullScreen={phone} scroll="paper">
      <DialogTitle sx={{ fontSize: '1.05rem', fontWeight: 700 }}>{t('sourcesDialogTitle')}</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {t('sourcesIntro')}
        </Typography>

        {loadError ? (
          <Alert severity="error" sx={{ mt: 2 }}>
            {t('sourcesLoadError', { message: loadError })}
          </Alert>
        ) : null}
        {!sources && !loadError ? (
          <Stack sx={{ alignItems: 'center', py: 5 }}>
            <CircularProgress size={22} />
          </Stack>
        ) : null}
        {!canConfigure && sources ? (
          <Alert severity="info" sx={{ mt: 2 }}>
            {t('readOnly')}
          </Alert>
        ) : null}

        {sources ? (
          <Stack divider={<Divider flexItem />}>
            {/* Sapo: the whole store — which of its sales channels count. */}
            <SourceSection
              title="Sapo"
              caption={t('sourceSapoCaption')}
              connection={sources.sapo}
              hidden={hidden.sapo}
              onHidden={(value) => setHidden((h) => ({ ...h, sapo: value }))}
              canConfigure={canConfigure}
              connectHref={connectHref}
            >
              {sources.sapo ? (
                <>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {t('channelsSection')}
                  </Typography>
                  <RadioGroup value={channelMode} onChange={(event) => setChannelMode(event.target.value as Mode)}>
                    <FormControlLabel value="all" control={<Radio size="small" />} label={t('channelsAll')} disabled={!canConfigure} />
                    <FormControlLabel value="chosen" control={<Radio size="small" />} label={t('channelsChosen')} disabled={!canConfigure} />
                  </RadioGroup>
                  {channelMode === 'chosen' ? (
                    <Stack sx={{ pl: 3.5, mt: 0.5 }}>
                      {sources.sapo.channels.length === 0 ? (
                        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                          {t('noChannels')}
                        </Typography>
                      ) : (
                        <QuickPick
                          disabled={!canConfigure}
                          onAll={() => setChannels(new Set(sources.sapo!.channels.map((c) => c.name)))}
                          onNone={() => setChannels(new Set())}
                        />
                      )}
                      {sources.sapo.channels.map((channel) => (
                        <FormControlLabel
                          key={channel.name}
                          control={<Checkbox size="small" checked={channels.has(channel.name)} onChange={(event) => setChannels((set) => toggle(set, [channel.name], event.target.checked))} />}
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
                </>
              ) : null}
            </SourceSection>

            {/* TikTok Shop: the TikTok channel's own orders — which authorised shop it reads. */}
            <SourceSection
              title="TikTok Shop"
              caption={t('sourceShopCaption')}
              connection={sources.tiktokShop}
              hidden={hidden.tiktokShop}
              onHidden={(value) => setHidden((h) => ({ ...h, tiktokShop: value }))}
              canConfigure={canConfigure}
              connectHref={connectHref}
            >
              {sources.tiktokShop ? (
                sources.tiktokShop.shops.length === 0 ? (
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    {t('shopUnknown')}
                  </Typography>
                ) : sources.tiktokShop.shops.length === 1 ? (
                  <Typography variant="body2">
                    {t('shopOnly', { name: sources.tiktokShop.shops[0].name, region: sources.tiktokShop.shops[0].region })}
                  </Typography>
                ) : (
                  <>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {t('shopPick')}
                    </Typography>
                    <RadioGroup value={ttsShop ?? ''} onChange={(event) => setTtsShop(event.target.value)}>
                      {sources.tiktokShop.shops.map((shop) => (
                        <FormControlLabel
                          key={shop.cipher}
                          value={shop.cipher}
                          control={<Radio size="small" />}
                          label={
                            <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
                              <Typography variant="body2">{shop.name}</Typography>
                              <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                                {shop.region}
                              </Typography>
                            </Stack>
                          }
                          disabled={!canConfigure}
                        />
                      ))}
                    </RadioGroup>
                    <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                      {t('shopPickNote')}
                    </Typography>
                  </>
                )
              ) : null}
            </SourceSection>

            {/* TikTok Ads: GMV Max — which of the shops it advertises count. */}
            <SourceSection
              title="TikTok Ads"
              caption={t('sourceAdsCaption')}
              connection={sources.tiktok}
              hidden={hidden.tiktok}
              onHidden={(value) => setHidden((h) => ({ ...h, tiktok: value }))}
              canConfigure={canConfigure}
              connectHref={connectHref}
            >
              {sources.tiktok ? (
                <>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {t('shopsSection')}
                  </Typography>
                  <RadioGroup value={shopMode} onChange={(event) => setShopMode(event.target.value as Mode)}>
                    <FormControlLabel value="all" control={<Radio size="small" />} label={t('shopsAll')} disabled={!canConfigure} />
                    <FormControlLabel value="chosen" control={<Radio size="small" />} label={t('shopsChosen')} disabled={!canConfigure} />
                  </RadioGroup>
                  {shopMode === 'chosen' ? (
                    <Stack spacing={1} sx={{ pl: 3.5, mt: 0.5 }}>
                      {accounts.length === 0 ? (
                        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                          {t('noShops')}
                        </Typography>
                      ) : (
                        <QuickPick
                          disabled={!canConfigure}
                          onAll={() => setShops(new Set(sources.tiktok!.shops.map((s) => s.key)))}
                          onNone={() => setShops(new Set())}
                        />
                      )}
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
                                  control={<Checkbox size="small" checked={shops.has(shop.key)} onChange={(event) => setShops((set) => toggle(set, [shop.key], event.target.checked))} />}
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
                </>
              ) : null}
            </SourceSection>
          </Stack>
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
        <Button variant="contained" onClick={save} disabled={disabled} startIcon={saving ? <CircularProgress size={16} color="inherit" /> : null}>
          {t('save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
