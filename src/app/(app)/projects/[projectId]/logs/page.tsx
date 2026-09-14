import { getLocale, getTranslations } from 'next-intl/server'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined'
import ErrorOutlineOutlined from '@mui/icons-material/ErrorOutlineOutlined'
import ReceiptLongOutlined from '@mui/icons-material/ReceiptLongOutlined'
import { requireProject } from '@/core/auth/session'
import { listRecentCalls } from '@/features/projects/queries'
import { EmptyState, PageHeader } from '@/components/ui/page-header'
import { TableScroll } from '@/components/ui/table-scroll'
import { formatBytes, formatDateTime, formatDuration } from '@/core/utils/format'
import { titled } from '@/core/metadata'

export const generateMetadata = titled('nav', 'logs')

export default async function LogsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  await requireProject(projectId)

  const [calls, t, locale] = await Promise.all([
    listRecentCalls(projectId, 100),
    getTranslations('logs'),
    getLocale(),
  ])

  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} />

      {calls.length === 0 ? (
        <EmptyState icon={<ReceiptLongOutlined sx={{ fontSize: 32 }} />} title={t('empty')} />
      ) : (
        // The table scrolls in its own box, about a screen tall, so its headings can stay pinned.
        <Paper>
          <TableScroll maxHeight="max(320px, calc(100dvh - 220px))" sx={{ borderRadius: 'inherit' }}>
            <Table size="small" sx={{ minWidth: 820 }}>
              <TableHead>
                <TableRow>
                  <TableCell>{t('endpoint')}</TableCell>
                  <TableCell>HTTP</TableCell>
                  <TableCell align="right">ms</TableCell>
                  <TableCell align="right">size</TableCell>
                  <TableCell>{t('by')}</TableCell>
                  <TableCell>{t('when')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {calls.map((call) => (
                  <TableRow key={call.id} hover sx={{ verticalAlign: 'top' }}>
                    <TableCell>
                      <Stack direction="row" spacing={1}>
                        {call.ok === 'true' ? (
                          <CheckCircleOutlined sx={{ fontSize: 16, mt: 0.25, color: 'success.main' }} />
                        ) : (
                          <ErrorOutlineOutlined sx={{ fontSize: 16, mt: 0.25, color: 'error.main' }} />
                        )}
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {call.endpointId}
                          </Typography>
                          <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                            {call.pluginId}
                          </Typography>
                          {call.errorMessage ? (
                            <Typography
                              variant="caption"
                              sx={{ display: 'block', mt: 0.25, maxWidth: 420, color: 'error.main' }}
                            >
                              {call.errorMessage}
                            </Typography>
                          ) : null}
                        </Box>
                      </Stack>
                    </TableCell>

                    <TableCell>
                      <Chip
                        size="small"
                        variant="outlined"
                        color={call.ok === 'true' ? 'success' : 'error'}
                        label={`${call.method} ${call.statusCode ?? '—'}`}
                      />
                    </TableCell>

                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: 'text.secondary' }}>
                      {formatDuration(call.durationMs)}
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: 'text.secondary' }}>
                      {formatBytes(call.responseBytes)}
                    </TableCell>
                    <TableCell sx={{ color: 'text.secondary' }}>{call.actorName ?? '—'}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap', color: 'text.secondary' }}>
                      {formatDateTime(call.createdAt, locale)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableScroll>
        </Paper>
      )}
    </>
  )
}
