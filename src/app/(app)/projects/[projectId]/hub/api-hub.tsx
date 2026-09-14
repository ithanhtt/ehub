'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import Alert from '@mui/material/Alert'
import AlertTitle from '@mui/material/AlertTitle'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import FormControlLabel from '@mui/material/FormControlLabel'
import Grid from '@mui/material/Grid'
import MuiLink from '@mui/material/Link'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import BoltOutlined from '@mui/icons-material/BoltOutlined'
import ListAltOutlined from '@mui/icons-material/ListAltOutlined'
import TerminalOutlined from '@mui/icons-material/TerminalOutlined'
import MenuBookOutlined from '@mui/icons-material/MenuBookOutlined'
import PlayArrowOutlined from '@mui/icons-material/PlayArrowOutlined'
import PowerOutlined from '@mui/icons-material/PowerOutlined'
import type { CatalogEntry } from '@/core/plugins/registry'
import type { ParamSpec } from '@/core/plugins/types'
import type { ConnectionView } from '@/features/connections/queries'
import { saveDataset } from '@/features/datasets/actions'
import { coerceParams, validateParams } from '@/core/plugins/params'
import { EmptyState } from '@/components/ui/page-header'
import type { Locale } from '@/i18n/config'
import { MONO_STACK } from '@/theme'
import { CustomRequest } from './custom-request'
import { EndpointCatalog } from './endpoint-catalog'
import { ParamField, stringifyDefault, type ParamChoices } from './param-field'
import { ResultPanel } from './result-panel'
import { METHOD_COLOR, type ExecuteResponse, type Tab as TabId } from './types'

export function ApiHub({
  projectId,
  connections,
  catalog,
  canExecute,
  canCustom,
  canCustomWrite,
  initialConnectionId,
}: {
  projectId: string
  connections: ConnectionView[]
  catalog: CatalogEntry[]
  canExecute: boolean
  canCustom: boolean
  canCustomWrite: boolean
  initialConnectionId?: string
}) {
  const t = useTranslations('hub')
  const te = useTranslations('errors')
  const locale = useLocale() as Locale

  const [mode, setMode] = useState<'catalogue' | 'custom'>('catalogue')
  const [query, setQuery] = useState('')
  const [sourceFilter, setSourceFilter] = useState<string>(
    initialConnectionId
      ? (connections.find((c) => c.id === initialConnectionId)?.pluginId ?? 'all')
      : 'all',
  )
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [connectionId, setConnectionId] = useState<string>(initialConnectionId ?? '')
  const [values, setValues] = useState<Record<string, string>>({})
  const [result, setResult] = useState<ExecuteResponse | null>(null)
  const [requestError, setRequestError] = useState<string | null>(null)
  const [tab, setTab] = useState<TabId>('response')
  const [sending, setSending] = useState(false)
  const [confirmedMutation, setConfirmedMutation] = useState(false)

  const [datasetName, setDatasetName] = useState('')
  const [datasetFeedback, setDatasetFeedback] = useState<string | null>(null)
  const [savingDataset, startSaving] = useTransition()

  const selected = useMemo(
    () => catalog.find((entry) => `${entry.pluginId}:${entry.id}` === selectedKey) ?? null,
    [catalog, selectedKey],
  )

  const eligibleConnections = useMemo(
    () => (selected ? connections.filter((c) => c.pluginId === selected.pluginId) : []),
    [connections, selected],
  )
  const activeConnection = eligibleConnections.find((c) => c.id === connectionId)

  const issues = useMemo(() => {
    if (!selected) return []
    // trustConnection: the browser has no access to credentials, so params
    // the connector fills server-side must not block the Send button.
    return validateParams(selected, coerceParams(selected, values), { trustConnection: true })
  }, [selected, values])

  function selectEndpoint(entry: CatalogEntry) {
    setSelectedKey(`${entry.pluginId}:${entry.id}`)
    setResult(null)
    setRequestError(null)
    setTab('response')
    setConfirmedMutation(false)
    setDatasetFeedback(null)
    setDatasetName(`${entry.pluginName} · ${entry.name[locale]}`)

    const defaults: Record<string, string> = {}
    for (const spec of entry.params) defaults[spec.key] = stringifyDefault(spec)
    setValues(defaults)

    // Keep the current connection when it can serve the new endpoint,
    // otherwise fall back to the first one that can.
    const usable = connections.filter((c) => c.pluginId === entry.pluginId)
    if (!usable.some((c) => c.id === connectionId)) setConnectionId(usable[0]?.id ?? '')
  }

  async function handleSend() {
    if (!selected || !connectionId) return
    setSending(true)
    setRequestError(null)
    setResult(null)
    setDatasetFeedback(null)

    try {
      const response = await fetch('/api/hub/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          connectionId,
          endpointId: selected.id,
          params: coerceParams(selected, values),
        }),
      })

      if (response.status === 403) {
        setRequestError(te('forbidden'))
        return
      }

      const payload = (await response.json()) as ExecuteResponse & { error?: string }
      if (!response.ok) {
        setRequestError(payload.error ?? te('serverError'))
        return
      }

      setResult(payload)
      setTab(payload.records?.length ? 'records' : 'response')
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : te('serverError'))
    } finally {
      setSending(false)
    }
  }

  function handleSaveDataset() {
    if (!selected || !connectionId || !datasetName.trim()) return
    startSaving(async () => {
      const outcome = await saveDataset(projectId, {
        connectionId,
        endpointId: selected.id,
        name: datasetName.trim(),
        params: coerceParams(selected, values),
      })
      setDatasetFeedback(
        outcome.ok
          ? `${t('savedDataset')} (${outcome.recordCount ?? 0})`
          : (outcome.message ?? te('serverError')),
      )
    })
  }

  if (connections.length === 0) {
    return (
      <EmptyState
        icon={<PowerOutlined sx={{ fontSize: 32 }} />}
        title={t('noConnections')}
        description={t('noConnectionsHint')}
        action={
          <Button
            variant="contained"
            component={Link}
            href={`/projects/${projectId}/settings/connections`}
          >
            {t('goToConnections')}
          </Button>
        }
      />
    )
  }

  return (
    <Stack spacing={2.5}>
      {/*
        Two ways to reach a provider, side by side.

        The catalogue is curated and form-driven; the free-form tab reaches
        everything else. Neither TikTok nor Sapo publishes a machine-readable
        spec — checked — so a hand-written catalogue can never be complete, and
        pretending otherwise would leave the gap for a code change to fill.
      */}
      {canCustom ? (
        <Tabs
          value={mode}
          onChange={(_event, next: 'catalogue' | 'custom') => setMode(next)}
          sx={{ borderBottom: '1px dashed var(--adshub-dashed)' }}
        >
          <Tab
            value="catalogue"
            icon={<ListAltOutlined fontSize="small" />}
            iconPosition="start"
            label={t('modeCatalogue', { count: catalog.length })}
          />
          <Tab
            value="custom"
            icon={<TerminalOutlined fontSize="small" />}
            iconPosition="start"
            label={t('modeCustom')}
          />
        </Tabs>
      ) : null}

      {mode === 'custom' && canCustom ? (
        <CustomRequest
          projectId={projectId}
          connections={connections}
          canExecute={canExecute}
          canWrite={canCustomWrite}
        />
      ) : (
    <Grid container spacing={2.5}>
      <Grid size={{ xs: 12, lg: 4, xl: 3 }}>
        <EndpointCatalog
          catalog={catalog}
          query={query}
          onQueryChange={setQuery}
          sourceFilter={sourceFilter}
          onSourceFilterChange={setSourceFilter}
          selectedKey={selectedKey}
          onSelect={selectEndpoint}
        />
      </Grid>

      <Grid size={{ xs: 12, lg: 8, xl: 9 }} sx={{ minWidth: 0 }}>
        {!selected ? (
          <EmptyState icon={<BoltOutlined sx={{ fontSize: 32 }} />} title={t('selectEndpoint')} />
        ) : (
          <Stack spacing={2.5}>
            <Card>
              <CardContent>
                <Stack
                  direction="row"
                  spacing={2}
                  sx={{ alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap' }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.75 }}
                    >
                      <Chip
                        size="small"
                        label={selected.method}
                        color={METHOD_COLOR[selected.method] ?? 'default'}
                      />
                      <Typography variant="h5" component="h2">
                        {selected.name[locale]}
                      </Typography>
                      <Chip size="small" variant="outlined" label={selected.pluginName} />
                      {selected.mutating ? (
                        <Chip size="small" color="warning" label="mutating" />
                      ) : null}
                      {selected.unverified ? (
                        <Chip size="small" variant="outlined" color="info" label={t('unverifiedBadge')} />
                      ) : null}
                    </Stack>

                    <Typography
                      variant="caption"
                      sx={{
                        display: 'block',
                        mt: 1,
                        fontFamily: MONO_STACK,
                        color: 'text.secondary',
                        wordBreak: 'break-all',
                      }}
                    >
                      {selected.path}
                    </Typography>

                    {selected.description ? (
                      <Typography variant="body2" sx={{ mt: 1.25, maxWidth: 760, color: 'text.secondary' }}>
                        {selected.description[locale]}
                      </Typography>
                    ) : null}
                  </Box>

                  {selected.docsUrl ? (
                    <MuiLink
                      href={selected.docsUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      variant="caption"
                      underline="hover"
                      sx={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 0.5,
                        flexShrink: 0,
                        fontWeight: 600,
                      }}
                    >
                      <MenuBookOutlined sx={{ fontSize: 15 }} />
                      {t('docs')}
                    </MuiLink>
                  ) : null}
                </Stack>
              </CardContent>
            </Card>

            <Card>
              <CardContent>
                <Stack spacing={3}>
                  <TextField
                    select
                    label={t('connection')}
                    value={connectionId}
                    onChange={(event) => setConnectionId(event.target.value)}
                    sx={{ maxWidth: 380 }}
                  >
                    {eligibleConnections.length === 0 ? <MenuItem value="">—</MenuItem> : null}
                    {eligibleConnections.map((connection) => (
                      <MenuItem key={connection.id} value={connection.id} sx={{ fontSize: 13 }}>
                        {connection.name}
                        {connection.status === 'connected' ? '' : ` (${connection.status})`}
                      </MenuItem>
                    ))}
                  </TextField>

                  <Box>
                    <Typography variant="subtitle2" sx={{ mb: 2 }}>
                      {t('parameters')}
                    </Typography>

                    {selected.params.length === 0 ? (
                      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                        {t('noParameters')}
                      </Typography>
                    ) : (
                      <Grid container spacing={2.5}>
                        {selected.params.map((spec) => (
                          <Grid
                            key={spec.key}
                            size={{
                              xs: 12,
                              // Textareas need the full row; scalar inputs pair up.
                              sm: spec.type === 'json' || spec.type === 'string[]' ? 12 : 6,
                            }}
                          >
                            <ParamField
                              spec={spec}
                              choices={choicesFor(spec, activeConnection)}
                              value={values[spec.key] ?? ''}
                              onChange={(next) =>
                                setValues((prev) => ({ ...prev, [spec.key]: next }))
                              }
                            />
                          </Grid>
                        ))}
                      </Grid>
                    )}
                  </Box>

                  {selected.unverified ? (
                    <Alert severity="info">
                      <AlertTitle sx={{ fontSize: '0.8125rem' }}>{t('unverifiedTitle')}</AlertTitle>
                      <Typography variant="caption" sx={{ display: 'block' }}>
                        {t('unverifiedBody')}
                      </Typography>
                    </Alert>
                  ) : null}

                  {selected.mutating ? (
                    <Alert severity="warning">
                      <AlertTitle sx={{ fontSize: '0.8125rem' }}>{t('mutatingWarning')}</AlertTitle>
                      <FormControlLabel
                        control={
                          <Checkbox
                            size="small"
                            checked={confirmedMutation}
                            onChange={(event) => setConfirmedMutation(event.target.checked)}
                          />
                        }
                        label={
                          <Typography variant="caption" sx={{ fontWeight: 600 }}>
                            {t('mutatingConfirm')}
                          </Typography>
                        }
                      />
                    </Alert>
                  ) : null}

                  {issues.length > 0 ? (
                    <Alert severity="warning">
                      <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                        {issues.map((issue) => (
                          <li key={issue.key}>{issue.message}</li>
                        ))}
                      </Box>
                    </Alert>
                  ) : null}

                  {!canExecute ? <Alert severity="info">{t('noPermission')}</Alert> : null}

                  <Divider />

                  <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
                    <Button
                      variant="contained"
                      size="large"
                      onClick={handleSend}
                      disabled={
                        !canExecute ||
                        sending ||
                        !connectionId ||
                        issues.length > 0 ||
                        (selected.mutating && !confirmedMutation)
                      }
                      startIcon={
                        sending ? (
                          <CircularProgress size={16} color="inherit" />
                        ) : (
                          <PlayArrowOutlined />
                        )
                      }
                    >
                      {sending ? t('sending') : t('send')}
                    </Button>
                  </Stack>
                </Stack>
              </CardContent>
            </Card>

            {requestError ? <Alert severity="error">{requestError}</Alert> : null}

            {result ? (
              <ResultPanel
                result={result}
                tab={tab}
                onTabChange={setTab}
                endpointId={selected.id}
                datasetName={datasetName}
                onDatasetNameChange={setDatasetName}
                onSaveDataset={handleSaveDataset}
                savingDataset={savingDataset}
                datasetFeedback={datasetFeedback}
                canSaveDataset={canExecute && Boolean(selected.resultPath) && !selected.unverified}
              />
            ) : (
              <Card>
                <CardContent sx={{ py: 5, textAlign: 'center' }}>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    {t('runFirst')}
                  </Typography>
                </CardContent>
              </Card>
            )}
          </Stack>
        )}
      </Grid>
    </Grid>
      )}
    </Stack>
  )
}

/**
 * Reads a `choicesFrom` declaration against the selected connection's
 * metadata. Returns nothing when the connection has not stored the list yet
 * (it is written by the connection test), so the field stays a text box.
 */
function choicesFor(spec: ParamSpec, connection: ConnectionView | undefined): ParamChoices | undefined {
  if (!spec.choicesFrom || !connection) return undefined

  const raw = connection.metadata?.[spec.choicesFrom.list]
  if (!Array.isArray(raw)) return undefined

  const options = raw.flatMap((item) => {
    if (!item || typeof item !== 'object' || !('id' in item)) return []
    const { id, name } = item as { id: unknown; name?: unknown }
    return [{ value: String(id), label: typeof name === 'string' && name ? name : String(id) }]
  })
  if (options.length === 0) return undefined

  const autoValue = spec.choicesFrom.auto ? connection.metadata?.[spec.choicesFrom.auto] : undefined
  const auto =
    autoValue === undefined || autoValue === null || autoValue === ''
      ? undefined
      : (options.find((option) => option.value === String(autoValue)) ?? {
          value: String(autoValue),
          label: String(autoValue),
        })

  return { options, auto }
}
