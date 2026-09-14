'use client'

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Tab from '@mui/material/Tab'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Tabs from '@mui/material/Tabs'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined'
import ErrorOutlineOutlined from '@mui/icons-material/ErrorOutlineOutlined'
import StorageOutlined from '@mui/icons-material/StorageOutlined'
import { JsonViewer } from '@/components/json-viewer'
import { TableScroll } from '@/components/ui/table-scroll'
import { inferFields } from '@/core/utils/infer'
import { formatBytes, formatDuration } from '@/core/utils/format'
import { MONO_STACK } from '@/theme'
import type { ExecuteResponse, Tab as TabId } from './types'

export function ResultPanel({
  result,
  tab,
  onTabChange,
  endpointId,
  datasetName,
  onDatasetNameChange,
  onSaveDataset,
  savingDataset,
  datasetFeedback,
  canSaveDataset,
}: {
  result: ExecuteResponse
  tab: TabId
  onTabChange: (tab: TabId) => void
  endpointId: string
  datasetName: string
  onDatasetNameChange: (value: string) => void
  onSaveDataset: () => void
  savingDataset: boolean
  datasetFeedback: string | null
  canSaveDataset: boolean
}) {
  const t = useTranslations('hub')

  const fields = useMemo(
    () => (result.records?.length ? inferFields(result.records) : []),
    [result.records],
  )

  const tabs: Array<{ id: TabId; label: string; show: boolean }> = ([
    { id: 'response', label: t('responseTab'), show: true },
    {
      id: 'records',
      label: `${t('recordsTab')} (${result.recordCount ?? 0})`,
      show: Boolean(result.records),
    },
    { id: 'schema', label: t('schemaTab'), show: fields.length > 0 },
    { id: 'request', label: t('requestTab'), show: true },
  ] as Array<{ id: TabId; label: string; show: boolean }>).filter((item) => item.show)

  const metrics = [
    { label: t('status'), value: result.status || '—' },
    { label: t('duration'), value: formatDuration(result.durationMs) },
    { label: t('size'), value: formatBytes(result.bytes) },
    ...(result.recordCount !== undefined
      ? [{ label: t('records'), value: String(result.recordCount) }]
      : []),
  ]

  return (
    <Card>
      <Stack
        direction="row"
        spacing={2}
        sx={{
          px: 2.5,
          py: 1.5,
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          borderBottom: '1px dashed var(--adshub-dashed)',
        }}
      >
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          {result.ok ? (
            <CheckCircleOutlined sx={{ fontSize: 18, color: 'success.main' }} />
          ) : (
            <ErrorOutlineOutlined sx={{ fontSize: 18, color: 'error.main' }} />
          )}
          <Typography variant="subtitle2">{t('response')}</Typography>
        </Stack>

        <Stack
          direction="row"
          divider={<Divider orientation="vertical" flexItem />}
          spacing={1.5}
          sx={{ flexWrap: 'wrap', rowGap: 0.5 }}
        >
          {metrics.map((metric) => (
            <Typography key={metric.label} variant="caption" sx={{ color: 'text.secondary' }}>
              {metric.label}:{' '}
              <Box
                component="span"
                sx={{ fontFamily: MONO_STACK, fontWeight: 600, color: 'text.primary' }}
              >
                {metric.value}
              </Box>
            </Typography>
          ))}
        </Stack>
      </Stack>

      {result.error ? (
        <Box sx={{ px: 2.5, pt: 2 }}>
          <Alert severity="error">{result.error}</Alert>
        </Box>
      ) : null}

      <Tabs
        value={tab}
        onChange={(_event, next: TabId) => onTabChange(next)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ px: 1.5, borderBottom: '1px dashed var(--adshub-dashed)' }}
      >
        {tabs.map((item) => (
          <Tab key={item.id} value={item.id} label={item.label} />
        ))}
      </Tabs>

      <CardContent>
        {tab === 'response' ? (
          <JsonViewer value={result.data} filename={`${endpointId}-response.json`} />
        ) : null}

        {tab === 'records' ? (
          <Stack spacing={2}>
            <JsonViewer value={result.records ?? []} filename={`${endpointId}-records.json`} />

            {canSaveDataset ? (
              <Paper variant="outlined" sx={{ p: 2, bgcolor: 'action.hover' }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  {t('saveAsDataset')}
                </Typography>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                  <TextField
                    value={datasetName}
                    onChange={(event) => onDatasetNameChange(event.target.value)}
                    sx={{ flex: 1, minWidth: 220 }}
                  />
                  <Button
                    variant="outlined"
                    onClick={onSaveDataset}
                    disabled={savingDataset || !datasetName.trim()}
                    startIcon={
                      savingDataset ? <CircularProgress size={15} /> : <StorageOutlined />
                    }
                    sx={{ flexShrink: 0 }}
                  >
                    {t('saveAsDataset')}
                  </Button>
                </Stack>
                {datasetFeedback ? (
                  <Typography variant="caption" sx={{ mt: 1, display: 'block', color: 'text.secondary' }}>
                    {datasetFeedback}
                  </Typography>
                ) : null}
              </Paper>
            ) : null}
          </Stack>
        ) : null}

        {tab === 'schema' ? (
          // Capped like the JSON views, scrolling under pinned headings.
          <Paper variant="outlined">
            <TableScroll maxHeight={420} sx={{ borderRadius: 'inherit' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('fieldPath')}</TableCell>
                    <TableCell>{t('fieldType')}</TableCell>
                    <TableCell>{t('fieldSample')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {fields.map((field) => (
                    <TableRow key={field.path} hover>
                      <TableCell sx={{ fontFamily: MONO_STACK, fontSize: 12 }}>{field.path}</TableCell>
                      <TableCell sx={{ color: 'text.secondary' }}>{field.type}</TableCell>
                      <TableCell
                        sx={{
                          fontFamily: MONO_STACK,
                          fontSize: 11.5,
                          color: 'text.disabled',
                          maxWidth: 280,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {field.sample === undefined ? '—' : JSON.stringify(field.sample)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableScroll>
          </Paper>
        ) : null}

        {tab === 'request' ? (
          <JsonViewer
            value={result.request}
            filename={`${endpointId}-request.json`}
            maxHeight={320}
          />
        ) : null}
      </CardContent>
    </Card>
  )
}
