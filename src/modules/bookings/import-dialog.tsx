'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControlLabel from '@mui/material/FormControlLabel'
import Grid from '@mui/material/Grid'
import LinearProgress from '@mui/material/LinearProgress'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import Switch from '@mui/material/Switch'
import Tab from '@mui/material/Tab'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Tabs from '@mui/material/Tabs'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { alpha } from '@mui/material/styles'
import UploadFileOutlined from '@mui/icons-material/UploadFileOutlined'
import { formatMoney } from '@/core/utils/format'
import { TableScroll } from '@/components/ui/table-scroll'
import { importBookings, type ImportResult } from '@/features/bookings/actions'
import type { CampaignListRow } from '@/features/bookings/queries'
import { campaignKey } from './campaigns'
import { BOOKING_FIELDS, normalizeBooking, REQUIRED_FIELDS, withCampaignDefaults, type BookingField, type BookingIssue, type RawBooking } from './fields'
import { downloadRows, findHeader, readFile, readPasted, type Table as SheetTable } from './spreadsheet'

/** Sent to the server this many rows at a time (the action takes up to 1000). */
const BATCH = 500
const PREVIEW_ROWS = 300
const ACCEPT = '.xlsx,.xls,.xlsm,.xlsb,.ods,.csv,.tsv,.txt'

type Mapping = Partial<Record<BookingField, number>>
type Parsed = { raw: RawBooking; line: number; issues: BookingIssue[] }

/**
 * Brings a file — the standard template, an export from here, or a team's
 * own sheet — into the booking file.
 *
 * The file's columns are matched to the fields by their headings; anything
 * not recognised can be pointed at the right column by hand. Every row is
 * checked against the standard before anything is sent, and the rows that
 * fail can be downloaded with their reasons, fixed and imported again.
 */
export function ImportDialog({
  projectId,
  open,
  campaigns,
  defaultCampaignId,
  onClose,
  onImported,
  onTemplate,
}: {
  projectId: string
  open: boolean
  campaigns: CampaignListRow[]
  /** The campaign the page is showing: rows that name none go into it. */
  defaultCampaignId: string | null
  onClose: () => void
  onImported: (message: string) => void
  onTemplate: () => void
}) {
  const t = useTranslations('bookings')
  const locale = useLocale()
  const input = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<'file' | 'paste'>('file')
  const [pasted, setPasted] = useState('')
  const [dragging, setDragging] = useState(false)
  const [source, setSource] = useState<{ name: string; tables: SheetTable[] } | null>(null)
  const [tableIndex, setTableIndex] = useState(0)
  const [headerIndex, setHeaderIndex] = useState(0)
  const [mapping, setMapping] = useState<Mapping>({})
  const [campaignId, setCampaignId] = useState(defaultCampaignId ?? '')
  useEffect(() => {
    if (open) setCampaignId(defaultCampaignId ?? '')
  }, [open, defaultCampaignId])
  const [onlyErrors, setOnlyErrors] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [result, setResult] = useState<Omit<ImportResult, 'ok' | 'message' | 'invalid'> & { invalid: Parsed[] } | null>(null)

  function reset() {
    setCampaignId(defaultCampaignId ?? '')
    setSource(null)
    setPasted('')
    setMapping({})
    setError(null)
    setProgress(null)
    setResult(null)
    setOnlyErrors(false)
  }

  function close() {
    if (progress !== null) return
    reset()
    onClose()
  }

  function use(name: string, tables: SheetTable[]) {
    if (tables.length === 0) {
      setError(t('import.emptyFile'))
      return
    }
    // The first sheet whose headings are recognised; else the first sheet.
    const index = Math.max(0, tables.findIndex((table) => findHeader(table.rows)))
    setSource({ name, tables })
    pickTable(tables, index)
    setError(null)
    setResult(null)
  }

  function pickTable(tables: SheetTable[], index: number) {
    setTableIndex(index)
    const header = findHeader(tables[index]?.rows ?? [])
    setHeaderIndex(header?.index ?? 0)
    setMapping(header?.columns ?? {})
  }

  async function openFile(file: File | undefined) {
    if (!file) return
    try {
      use(file.name, await readFile(file))
    } catch {
      setError(t('import.unreadable'))
    }
  }

  async function openPasted() {
    try {
      use(t('import.pastedName'), await readPasted(pasted))
    } catch {
      setError(t('import.unreadable'))
    }
  }

  const table = source?.tables[tableIndex]
  const headings = (table?.rows[headerIndex] ?? []).map((cell, i) => String(cell ?? '').trim() || t('import.column', { n: i + 1 }))

  const fallback = campaigns.find((c) => c.id === campaignId) ?? null
  const byKey = useMemo(() => new Map(campaigns.map((c) => [campaignKey(c.name), c])), [campaigns])

  // Each row checked as the server will: its campaign (or the one chosen here) filling its blanks.
  const parsed: Parsed[] = useMemo(() => {
    if (!table) return []
    const out: Parsed[] = []
    for (let r = headerIndex + 1; r < table.rows.length; r++) {
      const cells = table.rows[r] ?? []
      if (cells.every((cell) => String(cell ?? '').trim() === '')) continue
      const raw: RawBooking = {}
      for (const field of BOOKING_FIELDS) if (mapping[field] !== undefined) raw[field] = cells[mapping[field]!]
      const named = String(raw.campaign ?? '').trim()
      const campaign = named ? byKey.get(campaignKey(named)) : fallback
      out.push({ raw, line: r + 1, issues: normalizeBooking(withCampaignDefaults(raw, campaign)).issues })
    }
    return out
  }, [table, headerIndex, mapping, byKey, fallback])

  /** Campaigns the file names that do not exist yet: the import creates them. */
  const newCampaigns = useMemo(() => {
    const names = new Map<string, string>()
    for (const row of parsed) {
      const named = String(row.raw.campaign ?? '').trim()
      if (named && !byKey.has(campaignKey(named))) names.set(campaignKey(named), named)
    }
    return [...names.values()]
  }, [parsed, byKey])

  const valid = parsed.filter((row) => row.issues.length === 0)
  const invalid = parsed.filter((row) => row.issues.length > 0)
  const missingRequired = [...REQUIRED_FIELDS].filter((field) => mapping[field] === undefined && !(field === 'koc' && mapping.videoUrl !== undefined) && !(field === 'bookedOn' && mapping.airedOn !== undefined))
  const shown = (onlyErrors ? invalid : parsed).slice(0, PREVIEW_ROWS)

  const issueText = (issues: BookingIssue[]) => issues.map((issue) => `${t(`fields.${issue.field}`)}: ${t(`errors.${issue.code}`)}`).join('; ')

  async function run() {
    setProgress(0)
    setError(null)
    const total = { inserted: 0, updated: 0, duplicates: 0, campaignsCreated: 0 }
    const refused: Parsed[] = []
    try {
      for (let start = 0; start < valid.length; start += BATCH) {
        const batch = valid.slice(start, start + BATCH)
        const answer = await importBookings(projectId, batch.map((row) => row.raw), fallback?.name ?? null)
        if (!answer.ok) {
          setError(t(`actionErrors.${answer.message ?? 'server'}`))
          break
        }
        total.inserted += answer.inserted
        total.updated += answer.updated
        total.duplicates += answer.duplicates
        total.campaignsCreated += answer.campaignsCreated
        for (const miss of answer.invalid) refused.push({ ...batch[miss.index], issues: miss.issues })
        setProgress(Math.round(((start + batch.length) / valid.length) * 100))
      }
    } catch {
      setError(t('actionErrors.server'))
    }
    setProgress(null)
    const all = [...invalid, ...refused]
    setResult({ ...total, invalid: all })
    if (total.inserted + total.updated > 0) onImported(t('import.done', { inserted: total.inserted, updated: total.updated }))
  }

  function downloadErrors(rows: Parsed[]) {
    void downloadRows(
      rows.map((row) => ({ ...row.raw, extra: [String(row.line), issueText(row.issues)] })),
      'booking-errors.xlsx',
      'Booking',
      [t('import.line'), t('import.problems')],
    )
  }

  const cell = (row: Parsed, field: BookingField) => {
    const value = row.raw[field]
    const shownValue = value instanceof Date ? value.toLocaleDateString(locale) : String(value ?? '')
    const issue = row.issues.find((i) => i.field === field)
    const content =
      field === 'cost' && !issue && shownValue ? formatMoney(normalizeBooking(row.raw).value?.cost ?? 0, locale) : shownValue
    return (
      <TableCell key={field} sx={{ whiteSpace: 'nowrap', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', ...(issue ? { bgcolor: (theme) => alpha(theme.palette.error.main, 0.08), color: 'error.main', fontWeight: 600 } : {}) }}>
        {issue ? (
          <Tooltip title={t(`errors.${issue.code}`)}>
            <span>{content || '—'}</span>
          </Tooltip>
        ) : (
          content
        )}
      </TableCell>
    )
  }

  return (
    <Dialog open={open} onClose={close} maxWidth="xl" fullWidth>
      <DialogTitle>{t('import.title')}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {error ? <Alert severity="error">{error}</Alert> : null}

          {result ? (
            <Alert
              severity={result.invalid.length > 0 ? 'warning' : 'success'}
              action={
                result.invalid.length > 0 ? (
                  <Button color="inherit" size="small" onClick={() => downloadErrors(result.invalid)}>
                    {t('import.downloadErrors')}
                  </Button>
                ) : null
              }
            >
              {t('import.result', { inserted: result.inserted, updated: result.updated, duplicates: result.duplicates, invalid: result.invalid.length })}
              {result.campaignsCreated > 0 ? ` ${t('import.campaignsCreated', { count: result.campaignsCreated })}` : ''}
            </Alert>
          ) : null}

          {!source ? (
            <>
              <Tabs value={mode} onChange={(_event, next) => setMode(next)}>
                <Tab value="file" label={t('import.fromFile')} />
                <Tab value="paste" label={t('import.fromPaste')} />
              </Tabs>
              {mode === 'file' ? (
                <Box
                  onDragOver={(event) => {
                    event.preventDefault()
                    setDragging(true)
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(event) => {
                    event.preventDefault()
                    setDragging(false)
                    void openFile(event.dataTransfer.files[0])
                  }}
                  onClick={() => input.current?.click()}
                  sx={{
                    border: '2px dashed',
                    borderColor: dragging ? 'primary.main' : 'divider',
                    borderRadius: 2,
                    p: 5,
                    textAlign: 'center',
                    cursor: 'pointer',
                    bgcolor: dragging ? 'action.hover' : 'transparent',
                  }}
                >
                  <UploadFileOutlined sx={{ fontSize: 40, color: 'text.secondary' }} />
                  <Typography variant="subtitle1">{t('import.drop')}</Typography>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    {t('import.formats')}
                  </Typography>
                  <input ref={input} type="file" accept={ACCEPT} hidden onChange={(event) => void openFile(event.target.files?.[0])} />
                </Box>
              ) : (
                <Stack spacing={1}>
                  <TextField
                    multiline
                    minRows={8}
                    maxRows={16}
                    fullWidth
                    value={pasted}
                    onChange={(event) => setPasted(event.target.value)}
                    placeholder={t('import.pastePlaceholder')}
                    slotProps={{ htmlInput: { style: { fontFamily: 'monospace', fontSize: 13 } } }}
                  />
                  <Box>
                    <Button variant="contained" disabled={!pasted.trim()} onClick={() => void openPasted()}>
                      {t('import.readPasted')}
                    </Button>
                  </Box>
                </Stack>
              )}
              <Alert severity="info" action={<Button color="inherit" size="small" onClick={onTemplate}>{t('template')}</Button>}>
                {t('import.standardHint')}
              </Alert>
            </>
          ) : (
            <>
              <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
                <TextField
                  select
                  size="small"
                  label={t('import.campaign')}
                  value={campaignId}
                  onChange={(event) => setCampaignId(event.target.value)}
                  sx={{ minWidth: 220 }}
                  helperText={mapping.campaign !== undefined ? t('import.campaignFallback') : undefined}
                >
                  <MenuItem value="">
                    <em>{t('noCampaign')}</em>
                  </MenuItem>
                  {campaigns.map((campaign) => (
                    <MenuItem key={campaign.id} value={campaign.id}>
                      {campaign.name}
                    </MenuItem>
                  ))}
                </TextField>
                <Chip label={source.name} onDelete={progress === null ? reset : undefined} />
                {source.tables.length > 1 ? (
                  <TextField select size="small" label={t('import.sheet')} value={tableIndex} onChange={(event) => pickTable(source.tables, Number(event.target.value))} sx={{ minWidth: 180 }}>
                    {source.tables.map((sheet, i) => (
                      <MenuItem key={sheet.name} value={i}>
                        {sheet.name}
                      </MenuItem>
                    ))}
                  </TextField>
                ) : null}
                <TextField
                  select
                  size="small"
                  label={t('import.headerRow')}
                  value={headerIndex}
                  onChange={(event) => {
                    const index = Number(event.target.value)
                    setHeaderIndex(index)
                    const header = findHeader([table?.rows[index] ?? []])
                    if (header) setMapping(header.columns)
                  }}
                  sx={{ minWidth: 140 }}
                >
                  {(table?.rows ?? []).slice(0, 12).map((_row, i) => (
                    <MenuItem key={i} value={i}>
                      {t('import.rowN', { n: i + 1 })}
                    </MenuItem>
                  ))}
                </TextField>
              </Stack>

              <Box>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  {t('import.mapping')}
                </Typography>
                <Grid container spacing={1.5}>
                  {BOOKING_FIELDS.map((field) => (
                    <Grid key={field} size={{ xs: 6, sm: 4, md: 2.4 }}>
                      <TextField
                        select
                        fullWidth
                        size="small"
                        label={`${t(`fields.${field}`)}${REQUIRED_FIELDS.has(field) ? ' *' : ''}`}
                        value={mapping[field] ?? ''}
                        error={missingRequired.includes(field)}
                        onChange={(event) =>
                          setMapping((current) => {
                            const next = { ...current }
                            if (event.target.value === '') delete next[field]
                            else next[field] = Number(event.target.value)
                            return next
                          })
                        }
                      >
                        <MenuItem value="">
                          <em>{t('import.notInFile')}</em>
                        </MenuItem>
                        {headings.map((heading, i) => (
                          <MenuItem key={i} value={i}>
                            {heading}
                          </MenuItem>
                        ))}
                      </TextField>
                    </Grid>
                  ))}
                </Grid>
                {newCampaigns.length > 0 ? (
                  <Alert severity="info" sx={{ mt: 1.5 }}>
                    {t('import.newCampaigns', { count: newCampaigns.length, names: newCampaigns.slice(0, 5).join(', ') })}
                  </Alert>
                ) : null}
                {missingRequired.length > 0 ? (
                  <Alert severity="warning" sx={{ mt: 1.5 }}>
                    {t('import.missingColumns', { fields: missingRequired.map((field) => t(`fields.${field}`)).join(', ') })}
                  </Alert>
                ) : null}
              </Box>

              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
                <Chip color="success" variant="outlined" label={t('import.validRows', { count: valid.length })} />
                <Chip color={invalid.length > 0 ? 'error' : 'default'} variant="outlined" label={t('import.invalidRows', { count: invalid.length })} />
                <FormControlLabel control={<Switch size="small" checked={onlyErrors} onChange={(event) => setOnlyErrors(event.target.checked)} />} label={t('import.onlyErrors')} sx={{ ml: 1 }} />
                {invalid.length > 0 ? (
                  <Button size="small" onClick={() => downloadErrors(invalid)}>
                    {t('import.downloadErrors')}
                  </Button>
                ) : null}
              </Stack>

              <TableScroll maxHeight={380}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{t('import.line')}</TableCell>
                      {BOOKING_FIELDS.map((field) => (
                        <TableCell key={field} sx={{ whiteSpace: 'nowrap' }}>
                          {t(`fields.${field}`)}
                        </TableCell>
                      ))}
                      <TableCell>{t('import.problems')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {shown.map((row) => (
                      <TableRow key={row.line}>
                        <TableCell sx={{ color: 'text.secondary' }}>{row.line}</TableCell>
                        {BOOKING_FIELDS.map((field) => cell(row, field))}
                        <TableCell sx={{ color: 'error.main', minWidth: 220 }}>{issueText(row.issues)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableScroll>
              {(onlyErrors ? invalid : parsed).length > PREVIEW_ROWS ? (
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {t('import.previewCapped', { shown: PREVIEW_ROWS, total: (onlyErrors ? invalid : parsed).length })}
                </Typography>
              ) : null}
            </>
          )}
          {progress !== null ? <LinearProgress variant="determinate" value={progress} /> : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={close} disabled={progress !== null}>
          {result ? t('close') : t('cancel')}
        </Button>
        {source && !result ? (
          <Button variant="contained" disabled={valid.length === 0 || progress !== null || missingRequired.length > 0} onClick={() => void run()}>
            {t('import.run', { count: valid.length })}
          </Button>
        ) : null}
      </DialogActions>
    </Dialog>
  )
}
