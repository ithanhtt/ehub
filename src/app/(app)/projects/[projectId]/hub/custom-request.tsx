'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import Alert from '@mui/material/Alert'
import AlertTitle from '@mui/material/AlertTitle'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Checkbox from '@mui/material/Checkbox'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import FormControlLabel from '@mui/material/FormControlLabel'
import Grid from '@mui/material/Grid'
import IconButton from '@mui/material/IconButton'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import AddOutlined from '@mui/icons-material/AddOutlined'
import DeleteOutlineOutlined from '@mui/icons-material/DeleteOutlineOutlined'
import PlayArrowOutlined from '@mui/icons-material/PlayArrowOutlined'
import type { ConnectionView } from '@/features/connections/queries'
import { ALLOWED_METHODS, SAFE_METHODS } from '@/core/plugins/custom-path'
import { MONO_STACK } from '@/theme'
import { ResultPanel } from './result-panel'
import type { ExecuteResponse, Tab } from './types'

type QueryRow = { id: number; key: string; value: string }

let nextRowId = 1

/**
 * A request to any path the provider exposes.
 *
 * The catalogue is hand-written because neither provider publishes a spec, so
 * it will always trail the real API. This is the way to reach the rest of it
 * without editing code: the path is sent relative to the connector's base URL,
 * with the connection's credentials, through the same execute-and-log pipeline
 * a declared endpoint uses.
 */
export function CustomRequest({
  projectId,
  connections,
  canExecute,
  canWrite,
}: {
  projectId: string
  connections: ConnectionView[]
  canExecute: boolean
  canWrite: boolean
}) {
  const t = useTranslations('hub')
  const te = useTranslations('errors')

  const [connectionId, setConnectionId] = useState(connections[0]?.id ?? '')
  const [method, setMethod] = useState<string>('GET')
  const [path, setPath] = useState('')
  const [rows, setRows] = useState<QueryRow[]>([{ id: 0, key: '', value: '' }])
  const [body, setBody] = useState('')
  const [resultPath, setResultPath] = useState('')
  const [confirmedWrite, setConfirmedWrite] = useState(false)

  const [result, setResult] = useState<ExecuteResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('response')
  const [sending, setSending] = useState(false)

  const connection = connections.find((c) => c.id === connectionId)
  const writes = !SAFE_METHODS.has(method)
  const blocked = writes && !canWrite

  async function send() {
    if (!connectionId || !path.trim()) return
    setSending(true)
    setError(null)
    setResult(null)

    const query: Record<string, string> = {}
    for (const row of rows) {
      const key = row.key.trim()
      if (key) query[key] = row.value
    }

    try {
      const response = await fetch('/api/hub/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          connectionId,
          method,
          path: path.trim(),
          query,
          body: writes && body.trim() ? body : undefined,
          resultPath: resultPath.trim() || undefined,
        }),
      })

      const payload = (await response.json()) as ExecuteResponse & { error?: string }

      if (!response.ok) {
        setError(explain(payload.error))
        return
      }
      setResult(payload)
      setTab(payload.records?.length ? 'records' : 'response')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : te('serverError'))
    } finally {
      setSending(false)
    }
  }

  /** Turns a rejection reason into the rule the user broke. */
  function explain(reason?: string): string {
    if (!reason) return te('serverError')
    if (reason === 'FORBIDDEN_WRITE') return t('customForbiddenWrite')
    if (reason === 'FORBIDDEN') return te('forbidden')
    if (reason === 'CONNECTION_NOT_FOUND') return te('notFound')
    if (reason === 'BAD_BODY') return t('customBadBody')
    if (reason.startsWith('PATH_')) return t('customBadPath')
    return reason
  }

  return (
    <Stack spacing={2.5}>
      <Alert severity="info">
        <AlertTitle sx={{ fontSize: '0.8125rem' }}>{t('customTitle')}</AlertTitle>
        {t('customIntro')}
      </Alert>

      <Card>
        <CardContent>
          <Stack spacing={2.5}>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  select
                  label={t('connection')}
                  value={connectionId}
                  onChange={(event) => setConnectionId(event.target.value)}
                >
                  {connections.map((c) => (
                    <MenuItem key={c.id} value={c.id} sx={{ fontSize: 13 }}>
                      {c.name} · {c.pluginName}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  select
                  label={t('customMethod')}
                  value={method}
                  onChange={(event) => {
                    setMethod(event.target.value)
                    setConfirmedWrite(false)
                  }}
                >
                  {ALLOWED_METHODS.map((m) => (
                    <MenuItem key={m} value={m} sx={{ fontSize: 13 }}>
                      {m}
                      {!SAFE_METHODS.has(m) ? ' — ' + t('customWrites') : ''}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
            </Grid>

            <TextField
              label={t('customPath')}
              value={path}
              onChange={(event) => setPath(event.target.value)}
              placeholder={connection?.pluginId === 'sapo' ? '/admin/locations.json' : '/app/info/'}
              helperText={t('customPathHelp')}
              slotProps={{ htmlInput: { style: { fontFamily: MONO_STACK, fontSize: 13 } } }}
            />

            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {t('customQuery')}
              </Typography>
              <Stack spacing={1}>
                {rows.map((row, index) => (
                  <Stack key={row.id} direction="row" spacing={1}>
                    <TextField
                      value={row.key}
                      onChange={(event) =>
                        setRows((prev) =>
                          prev.map((r) => (r.id === row.id ? { ...r, key: event.target.value } : r)),
                        )
                      }
                      placeholder="page_size"
                      slotProps={{ htmlInput: { style: { fontFamily: MONO_STACK, fontSize: 13 } } }}
                    />
                    <TextField
                      value={row.value}
                      onChange={(event) =>
                        setRows((prev) =>
                          prev.map((r) => (r.id === row.id ? { ...r, value: event.target.value } : r)),
                        )
                      }
                      placeholder="10"
                      slotProps={{ htmlInput: { style: { fontFamily: MONO_STACK, fontSize: 13 } } }}
                    />
                    <Tooltip title={t('customRemoveParam')}>
                      <IconButton
                        size="small"
                        onClick={() => setRows((prev) => prev.filter((r) => r.id !== row.id))}
                        disabled={rows.length === 1 && index === 0}
                      >
                        <DeleteOutlineOutlined fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                ))}
              </Stack>
              <Button
                size="small"
                color="inherit"
                startIcon={<AddOutlined sx={{ fontSize: 16 }} />}
                onClick={() => setRows((prev) => [...prev, { id: nextRowId++, key: '', value: '' }])}
                sx={{ mt: 1 }}
              >
                {t('customAddParam')}
              </Button>
            </Box>

            {writes ? (
              <TextField
                label={t('customBody')}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                multiline
                rows={4}
                spellCheck={false}
                placeholder="{ }"
                helperText={t('customBodyHelp')}
                slotProps={{ htmlInput: { style: { fontFamily: MONO_STACK, fontSize: 13 } } }}
              />
            ) : null}

            <TextField
              label={t('customResultPath')}
              value={resultPath}
              onChange={(event) => setResultPath(event.target.value)}
              placeholder="data.list"
              helperText={t('customResultPathHelp')}
              slotProps={{ htmlInput: { style: { fontFamily: MONO_STACK, fontSize: 13 } } }}
            />

            {writes ? (
              <Alert severity="warning">
                <AlertTitle sx={{ fontSize: '0.8125rem' }}>{t('customWriteWarning')}</AlertTitle>
                {blocked ? (
                  t('customForbiddenWrite')
                ) : (
                  <FormControlLabel
                    control={
                      <Checkbox
                        size="small"
                        checked={confirmedWrite}
                        onChange={(event) => setConfirmedWrite(event.target.checked)}
                      />
                    }
                    label={
                      <Typography variant="caption" sx={{ fontWeight: 600 }}>
                        {t('mutatingConfirm')}
                      </Typography>
                    }
                  />
                )}
              </Alert>
            ) : null}

            {!canExecute ? <Alert severity="info">{t('noPermission')}</Alert> : null}
            {error ? <Alert severity="error">{error}</Alert> : null}

            <Divider />

            <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
              <Button
                variant="contained"
                size="large"
                onClick={send}
                disabled={
                  !canExecute ||
                  sending ||
                  !connectionId ||
                  !path.trim() ||
                  blocked ||
                  (writes && !confirmedWrite)
                }
                startIcon={
                  sending ? <CircularProgress size={16} color="inherit" /> : <PlayArrowOutlined />
                }
              >
                {sending ? t('sending') : t('send')}
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      {result ? (
        <ResultPanel
          result={result}
          tab={tab}
          onTabChange={setTab}
          endpointId="custom"
          datasetName=""
          onDatasetNameChange={() => {}}
          onSaveDataset={() => {}}
          savingDataset={false}
          datasetFeedback={null}
          canSaveDataset={false}
        />
      ) : null}

    </Stack>
  )
}
