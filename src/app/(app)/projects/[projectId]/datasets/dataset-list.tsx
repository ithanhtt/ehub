'use client'

import { useState, useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import DeleteOutlineOutlined from '@mui/icons-material/DeleteOutlineOutlined'
import RefreshOutlined from '@mui/icons-material/RefreshOutlined'
import StorageOutlined from '@mui/icons-material/StorageOutlined'
import type { DatasetView } from '@/features/datasets/queries'
import { deleteDataset, resyncDataset } from '@/features/datasets/actions'
import { formatDateTime } from '@/core/utils/format'

const SYNC_COLOR = { ok: 'success', failed: 'error', running: 'warning' } as const

export function DatasetList({
  projectId,
  datasets,
  canSync,
  canDelete,
}: {
  projectId: string
  datasets: DatasetView[]
  canSync: boolean
  canDelete: boolean
}) {
  const t = useTranslations('datasets')
  const tc = useTranslations('common')
  const locale = useLocale()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Record<string, string>>({})
  const [, startTransition] = useTransition()

  return (
    <Stack spacing={1.5}>
      {datasets.map((dataset) => (
        <Card key={dataset.id}>
          <CardContent sx={{ p: 2 }}>
            <Stack
              direction="row"
              spacing={2}
              sx={{
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                rowGap: 1.5,
              }}
            >
              <Stack direction="row" spacing={1.5} sx={{ minWidth: 0, flex: 1 }}>
                <Avatar
                  variant="rounded"
                  sx={{ width: 34, height: 34, bgcolor: dataset.pluginColor }}
                >
                  <StorageOutlined sx={{ fontSize: 18 }} />
                </Avatar>

                <Box sx={{ minWidth: 0 }}>
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}
                  >
                    <Typography variant="subtitle2" noWrap>
                      {dataset.name}
                    </Typography>
                    {dataset.lastSyncStatus ? (
                      <Chip
                        size="small"
                        label={dataset.lastSyncStatus}
                        color={SYNC_COLOR[dataset.lastSyncStatus]}
                        variant="outlined"
                      />
                    ) : null}
                  </Stack>

                  <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }} noWrap>
                    {dataset.pluginName} · {dataset.endpointId} · {dataset.connectionName}
                  </Typography>

                  <Typography variant="caption" sx={{ display: 'block', color: 'text.disabled' }}>
                    {t('records')}:{' '}
                    <Box
                      component="span"
                      sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'text.secondary' }}
                    >
                      {dataset.recordCount}
                    </Box>
                    {' · '}
                    {dataset.fieldCount} fields
                    {' · '}
                    {t('lastSynced')}:{' '}
                    {dataset.lastSyncedAt
                      ? formatDateTime(dataset.lastSyncedAt, locale)
                      : tc('never')}
                  </Typography>

                  {(feedback[dataset.id] ?? dataset.lastSyncMessage) ? (
                    <Typography
                      variant="caption"
                      sx={{ display: 'block', mt: 0.5, color: 'text.disabled', wordBreak: 'break-word' }}
                    >
                      {feedback[dataset.id] ?? dataset.lastSyncMessage}
                    </Typography>
                  ) : null}
                </Box>
              </Stack>

              <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', flexShrink: 0 }}>
                {canSync ? (
                  <Button
                    size="small"
                    variant="outlined"
                    color="inherit"
                    disabled={busyId === dataset.id}
                    startIcon={
                      busyId === dataset.id ? (
                        <CircularProgress size={14} />
                      ) : (
                        <RefreshOutlined sx={{ fontSize: 16 }} />
                      )
                    }
                    onClick={() => {
                      setBusyId(dataset.id)
                      startTransition(async () => {
                        const outcome = await resyncDataset(projectId, dataset.id)
                        setFeedback((prev) => ({
                          ...prev,
                          [dataset.id]: outcome.ok
                            ? `${outcome.recordCount ?? 0} ${t('records').toLowerCase()}`
                            : (outcome.message ?? ''),
                        }))
                        setBusyId(null)
                      })
                    }}
                  >
                    {busyId === dataset.id ? t('syncing') : t('sync')}
                  </Button>
                ) : null}

                {canDelete ? (
                  <Tooltip title={tc('delete')}>
                    <IconButton
                      size="small"
                      color="error"
                      disabled={busyId === dataset.id}
                      onClick={() => {
                        if (!window.confirm(tc('delete'))) return
                        setBusyId(dataset.id)
                        startTransition(async () => {
                          await deleteDataset(projectId, dataset.id)
                          setBusyId(null)
                        })
                      }}
                    >
                      <DeleteOutlineOutlined fontSize="small" />
                    </IconButton>
                  </Tooltip>
                ) : null}
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      ))}
    </Stack>
  )
}
