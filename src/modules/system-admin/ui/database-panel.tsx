'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControlLabel from '@mui/material/FormControlLabel'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import LinearProgress from '@mui/material/LinearProgress'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import Switch from '@mui/material/Switch'
import Tab from '@mui/material/Tab'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TablePagination from '@mui/material/TablePagination'
import TableRow from '@mui/material/TableRow'
import TableSortLabel from '@mui/material/TableSortLabel'
import Tabs from '@mui/material/Tabs'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import DeleteOutlineOutlined from '@mui/icons-material/DeleteOutlineOutlined'
import DownloadOutlined from '@mui/icons-material/DownloadOutlined'
import EditOutlined from '@mui/icons-material/EditOutlined'
import LockOutlined from '@mui/icons-material/LockOutlined'
import PlayArrowOutlined from '@mui/icons-material/PlayArrowOutlined'
import RefreshOutlined from '@mui/icons-material/RefreshOutlined'
import SearchOutlined from '@mui/icons-material/SearchOutlined'
import TableChartOutlined from '@mui/icons-material/TableChartOutlined'
import TerminalOutlined from '@mui/icons-material/TerminalOutlined'
import { PageHeader } from '@/components/ui/page-header'
import { formatBytes, formatNumber } from '@/core/utils/format'
import { MONO_STACK } from '@/theme'
import { loadGrid, loadRow, loadTables, removeRow, runSql, saveRow } from '../data/actions'
import { MASK } from '../secrets'
import type { ColumnInfo, ConsoleOutcome, FullRow, GridPage, GridQuery, RowOutcome, TableSummary } from '../types'
import { ConfirmDialog, useToast } from './parts'

/**
 * The Database page: the public schema's tables on the left, the chosen one's
 * rows on the right (50 a page, sortable, searchable across its text
 * columns, editable when it has a primary key), and a SQL console on the
 * second tab. Secret columns arrive already masked from the server — the
 * browser never has them to hide.
 */

type Notify = (severity: 'success' | 'error' | 'info' | 'warning', message: string) => void

export function DatabasePanel({ initialTables, embedded }: { initialTables: TableSummary[]; embedded: boolean }) {
  const t = useTranslations('system')
  const [tab, setTab] = useState<'data' | 'sql'>('data')
  const [tables, setTables] = useState(initialTables)
  const [selected, setSelected] = useState<string | null>(initialTables[0]?.name ?? null)
  const toast = useToast()

  const reloadTables = useCallback(async () => {
    const outcome = await loadTables()
    if (outcome.ok) setTables(outcome.data)
  }, [])

  return (
    <Stack spacing={2}>
      <PageHeader title={t('db.title')} description={t('db.subtitle')} />
      <Tabs value={tab} onChange={(_event, value: 'data' | 'sql') => setTab(value)} sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Tab value="data" icon={<TableChartOutlined fontSize="small" />} iconPosition="start" label={t('db.tabs.data')} sx={{ minHeight: 44 }} />
        <Tab value="sql" icon={<TerminalOutlined fontSize="small" />} iconPosition="start" label={t('db.tabs.sql')} sx={{ minHeight: 44 }} />
      </Tabs>
      {tab === 'data' ? (
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: { md: 'flex-start' } }}>
          <TableList tables={tables} selected={selected} onSelect={setSelected} />
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            {selected ? (
              <GridView key={selected} table={tables.find((item) => item.name === selected) ?? null} name={selected} onChanged={reloadTables} notify={toast.show} />
            ) : (
              <Alert severity="info">{t('db.pickTable')}</Alert>
            )}
          </Box>
        </Stack>
      ) : (
        <SqlConsole embedded={embedded} notify={toast.show} />
      )}
      {toast.element}
    </Stack>
  )
}

/* ---------------------------------------------------------------- tables --- */

function TableList({ tables, selected, onSelect }: { tables: TableSummary[]; selected: string | null; onSelect: (name: string) => void }) {
  const t = useTranslations('system')
  const locale = useLocale()
  const [filter, setFilter] = useState('')
  const shown = tables.filter((table) => table.name.toLowerCase().includes(filter.trim().toLowerCase()))
  return (
    <Card sx={{ width: { md: 280 }, flexShrink: 0 }}>
      <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
        <TextField
          size="small"
          fullWidth
          placeholder={t('db.filterTables')}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchOutlined fontSize="small" /></InputAdornment> } }}
        />
        <List dense sx={{ mt: 1, maxHeight: { md: '70vh' }, overflow: 'auto' }}>
          {shown.length === 0 ? (
            <Typography variant="body2" sx={{ color: 'text.secondary', px: 1, py: 2 }}>
              {t('db.noTables')}
            </Typography>
          ) : (
            shown.map((table) => (
              <ListItemButton key={table.name} selected={table.name === selected} onClick={() => onSelect(table.name)} sx={{ borderRadius: 1 }}>
                <ListItemText
                  primary={table.name}
                  secondary={`${table.exact ? '' : '≈ '}${t('db.rowsCount', { n: formatNumber(table.rows, locale) })} · ${formatBytes(table.bytes)}`}
                  slotProps={{ primary: { sx: { fontFamily: MONO_STACK, fontSize: 13 }, noWrap: true } }}
                />
              </ListItemButton>
            ))
          )}
        </List>
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ grid --- */

function useRowFailure() {
  const t = useTranslations('system')
  return (outcome: Extract<RowOutcome, { ok: false }>) => {
    if (outcome.reason === 'forbidden') return t('db.rowError.forbidden')
    if (outcome.reason === 'notFound') return t('db.rowError.notFound')
    if (outcome.reason === 'database') return t('db.rowError.database', { detail: outcome.detail ?? '' })
    return t(`db.rowError.${outcome.code ?? 'key'}`, { column: outcome.column ?? '' })
  }
}

function GridView({ table, name, onChanged, notify }: { table: TableSummary | null; name: string; onChanged: () => Promise<void>; notify: Notify }) {
  const t = useTranslations('system')
  const locale = useLocale()
  const rowFailure = useRowFailure()
  const [query, setQuery] = useState<GridQuery>({ page: 1, sort: null, dir: 'asc', q: '' })
  const [search, setSearch] = useState('')
  const [data, setData] = useState<GridPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Record<string, string> | null>(null)
  const [deleting, setDeleting] = useState<Record<string, string> | null>(null)
  const [deletingBusy, setDeletingBusy] = useState(false)
  const request = useRef(0)

  const load = useCallback(async () => {
    const id = ++request.current
    setLoading(true)
    try {
      const outcome = await loadGrid(name, query)
      if (id !== request.current) return
      if (outcome.ok) {
        setData(outcome.data)
        setError(null)
      } else setError(outcome.reason === 'forbidden' ? t('db.rowError.forbidden') : (outcome.detail ?? outcome.reason))
    } catch (err) {
      if (id === request.current) setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (id === request.current) setLoading(false)
    }
  }, [name, query, t])

  useEffect(() => {
    void load()
  }, [load])

  // The search runs a moment after typing stops, from the first page.
  useEffect(() => {
    const timer = setTimeout(() => setQuery((current) => (current.q === search.trim() ? current : { ...current, q: search.trim(), page: 1 })), 400)
    return () => clearTimeout(timer)
  }, [search])

  const sortBy = (column: ColumnInfo) =>
    setQuery((current) => ({ ...current, page: 1, sort: column.name, dir: current.sort === column.name && current.dir === 'asc' ? 'desc' : 'asc' }))

  async function confirmDelete() {
    if (!deleting) return
    setDeletingBusy(true)
    try {
      const outcome = await removeRow(name, deleting)
      if (outcome.ok) {
        notify('success', t('db.deleted'))
        setDeleting(null)
        await load()
        void onChanged()
      } else notify('error', rowFailure(outcome))
    } finally {
      setDeletingBusy(false)
    }
  }

  const exportHref = `/api/system/database/export?${new URLSearchParams({ table: name, ...(query.q ? { q: query.q } : {}) }).toString()}`
  const keyText = (key: Record<string, string>) => Object.entries(key).map(([k, v]) => `${k} = ${v}`).join(', ')

  return (
    <Card>
      <CardContent>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' }, mb: 1.5 }}>
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography variant="h6" component="h2" sx={{ fontFamily: MONO_STACK }} noWrap>
              {name}
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {data ? t('db.rowsCount', { n: formatNumber(data.total, locale) }) : table ? t('db.rowsCount', { n: formatNumber(table.rows, locale) }) : ''}
              {table ? ` · ${formatBytes(table.bytes)}` : ''}
            </Typography>
          </Box>
          <TextField
            size="small"
            placeholder={t('db.search')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchOutlined fontSize="small" /></InputAdornment> } }}
            sx={{ width: { sm: 260 } }}
          />
          <Stack direction="row" spacing={1}>
            <Tooltip title={t('db.exportHint')}>
              <Button size="small" variant="outlined" startIcon={<DownloadOutlined />} component="a" href={exportHref} download>
                {t('db.export')}
              </Button>
            </Tooltip>
            <IconButton size="small" onClick={() => void load()} aria-label={t('refresh')}>
              <RefreshOutlined fontSize="small" />
            </IconButton>
          </Stack>
        </Stack>

        {data && !data.editable ? (
          <Alert severity="info" sx={{ mb: 1.5 }}>
            {table?.readOnly ? t('db.readOnlyAudit') : t('db.noPrimaryKey')}
          </Alert>
        ) : null}
        {error ? (
          <Alert severity="error" sx={{ mb: 1.5 }}>
            {error}
          </Alert>
        ) : null}

        <Box sx={{ position: 'relative' }}>
          {loading ? <LinearProgress sx={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 3 }} /> : null}
          <Box sx={{ maxHeight: '65vh', overflow: 'auto', border: 1, borderColor: 'divider', borderRadius: 1 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  {data?.editable ? <TableCell sx={{ width: 76 }}>{t('db.actions')}</TableCell> : null}
                  {(data?.columns ?? []).map((column) => (
                    <TableCell key={column.name} sx={{ whiteSpace: 'nowrap', verticalAlign: 'bottom' }}>
                      {column.secret ? (
                        <Tooltip title={t('db.secretHint')}>
                          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                            <LockOutlined sx={{ fontSize: 14, color: 'text.disabled' }} />
                            <span>{column.name}</span>
                          </Stack>
                        </Tooltip>
                      ) : (
                        <TableSortLabel active={data?.sort === column.name} direction={data?.sort === column.name ? data.dir : 'asc'} onClick={() => sortBy(column)}>
                          {column.primary ? <b>{column.name}</b> : column.name}
                        </TableSortLabel>
                      )}
                      <Typography variant="caption" sx={{ display: 'block', color: 'text.disabled', fontWeight: 400 }}>
                        {column.type}
                        {column.nullable ? '' : ' · not null'}
                      </Typography>
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {data && data.rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={(data.columns.length || 1) + (data.editable ? 1 : 0)} sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>
                      {t('db.empty')}
                    </TableCell>
                  </TableRow>
                ) : null}
                {(data?.rows ?? []).map((row, index) => (
                  <TableRow key={row.key ? JSON.stringify(row.key) : index} hover>
                    {data?.editable && row.key ? (
                      <TableCell sx={{ whiteSpace: 'nowrap', py: 0 }}>
                        <IconButton size="small" aria-label={t('db.edit')} onClick={() => setEditing(row.key)}>
                          <EditOutlined fontSize="small" />
                        </IconButton>
                        <IconButton size="small" aria-label={t('db.delete')} onClick={() => setDeleting(row.key)}>
                          <DeleteOutlineOutlined fontSize="small" />
                        </IconButton>
                      </TableCell>
                    ) : null}
                    {row.cells.map((cell, i) => (
                      <TableCell key={i} sx={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: MONO_STACK, fontSize: 12 }} title={cell && cell !== MASK ? cell.slice(0, 500) : undefined}>
                        <Cell value={cell} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </Box>
        {data ? (
          <TablePagination
            component="div"
            count={data.total}
            page={Math.max(0, data.page - 1)}
            rowsPerPage={data.pageSize}
            rowsPerPageOptions={[]}
            onPageChange={(_event, page) => setQuery((current) => ({ ...current, page: page + 1 }))}
            labelDisplayedRows={({ from, to, count }) => t('db.pageOf', { from, to, count })}
          />
        ) : null}
      </CardContent>

      {editing ? (
        <EditDialog
          table={name}
          rowKey={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            notify('success', t('db.saved'))
            await load()
          }}
          notify={notify}
        />
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        title={t('db.deleteTitle')}
        confirmLabel={t('db.delete')}
        danger
        busy={deletingBusy}
        onCancel={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
      >
        <Typography variant="body2">{t('db.deleteBody', { table: name, key: deleting ? keyText(deleting) : '' })}</Typography>
      </ConfirmDialog>
    </Card>
  )
}

function Cell({ value }: { value: string | null }) {
  if (value === null) {
    return (
      <Box component="span" sx={{ color: 'text.disabled', fontStyle: 'italic' }}>
        NULL
      </Box>
    )
  }
  if (value === MASK) {
    return (
      <Box component="span" sx={{ color: 'text.disabled', display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
        <LockOutlined sx={{ fontSize: 12 }} />
        {MASK}
      </Box>
    )
  }
  return <>{value}</>
}

/* ------------------------------------------------------------- edit row --- */

type Field = { value: string; isNull: boolean }

const NUMBER = /^\s*[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?\s*$/

function fieldError(column: ColumnInfo, field: Field): 'json' | 'number' | 'boolean' | null {
  if (field.isNull) return null
  if (column.category === 'json') {
    try {
      JSON.parse(field.value)
      return null
    } catch {
      return 'json'
    }
  }
  if (column.category === 'number' && !NUMBER.test(field.value)) return 'number'
  if (column.category === 'boolean' && !/^(true|false)$/i.test(field.value)) return 'boolean'
  return null
}

function EditDialog({
  table,
  rowKey,
  onClose,
  onSaved,
  notify,
}: {
  table: string
  rowKey: Record<string, string>
  onClose: () => void
  onSaved: () => Promise<void>
  notify: Notify
}) {
  const t = useTranslations('system')
  const tc = useTranslations('common')
  const rowFailure = useRowFailure()
  const [row, setRow] = useState<FullRow | null>(null)
  const [fields, setFields] = useState<Record<string, Field>>({})
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let live = true
    void loadRow(table, rowKey).then((outcome) => {
      if (!live) return
      if (!outcome.ok) {
        setLoadError(outcome.detail === 'notFound' ? t('db.rowError.notFound') : outcome.reason === 'forbidden' ? t('db.rowError.forbidden') : (outcome.detail ?? outcome.reason))
        return
      }
      setRow(outcome.data)
      setFields(Object.fromEntries(outcome.data.columns.map((column) => {
        const value = outcome.data.values[column.name]
        return [column.name, { value: value ?? '', isNull: value === null }]
      })))
    })
    return () => {
      live = false
    }
  }, [table, rowKey, t])

  const editable = useMemo(() => (row ? row.columns.filter((column) => !column.secret && !column.primary) : []), [row])
  const errors = useMemo(() => Object.fromEntries(editable.map((column) => [column.name, fields[column.name] ? fieldError(column, fields[column.name]) : null])), [editable, fields])
  const invalid = Object.values(errors).some(Boolean)

  async function save() {
    if (!row) return
    const changes: Record<string, string | null> = {}
    for (const column of editable) {
      const field = fields[column.name]
      const original = row.values[column.name]
      if (field.isNull) {
        if (original !== null) changes[column.name] = null
      } else if (original === null || field.value !== original) changes[column.name] = field.value
    }
    if (Object.keys(changes).length === 0) {
      notify('info', t('db.noChanges'))
      onClose()
      return
    }
    setSaving(true)
    try {
      const outcome = await saveRow(table, rowKey, changes)
      if (outcome.ok) await onSaved()
      else notify('error', rowFailure(outcome))
    } finally {
      setSaving(false)
    }
  }

  const set = (name: string, patch: Partial<Field>) => setFields((current) => ({ ...current, [name]: { ...current[name], ...patch } }))

  return (
    <Dialog open onClose={saving ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle>{t('db.editTitle', { table })}</DialogTitle>
      <DialogContent dividers>
        {loadError ? <Alert severity="error">{loadError}</Alert> : null}
        {!row && !loadError ? <LinearProgress /> : null}
        {row ? (
          <Stack spacing={2}>
            {row.columns.map((column) => {
              const field = fields[column.name] ?? { value: '', isNull: true }
              const locked = column.secret || column.primary
              const error = errors[column.name]
              const helper = column.secret
                ? t('db.secretHint')
                : column.primary
                  ? t('db.primaryHint')
                  : error === 'json'
                    ? t('db.jsonInvalid')
                    : error === 'number'
                      ? t('db.numberInvalid')
                      : column.category === 'datetime'
                        ? t('db.datetimeHint')
                        : undefined
              const label = `${column.name} · ${column.type}`
              return (
                <Stack key={column.name} direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
                  {column.category === 'boolean' && !locked ? (
                    <TextField
                      select
                      fullWidth
                      size="small"
                      label={label}
                      value={field.isNull ? '' : field.value.toLowerCase()}
                      disabled={field.isNull}
                      onChange={(event) => set(column.name, { value: event.target.value })}
                      helperText={helper}
                    >
                      <MenuItem value="true">true</MenuItem>
                      <MenuItem value="false">false</MenuItem>
                    </TextField>
                  ) : (
                    <TextField
                      fullWidth
                      size="small"
                      label={label}
                      value={column.secret ? (field.isNull ? '' : MASK) : field.isNull ? '' : field.value}
                      placeholder={field.isNull ? 'NULL' : undefined}
                      disabled={locked || field.isNull}
                      error={Boolean(error)}
                      helperText={helper}
                      multiline={column.category === 'json' || column.category === 'text' || column.category === 'other'}
                      minRows={column.category === 'json' ? 4 : 1}
                      maxRows={column.category === 'json' ? 16 : 8}
                      onChange={(event) => set(column.name, { value: event.target.value })}
                      slotProps={{ input: { sx: { fontFamily: column.category === 'json' ? MONO_STACK : undefined, fontSize: column.category === 'json' ? 13 : undefined } } }}
                    />
                  )}
                  {column.nullable && !locked ? (
                    <FormControlLabel
                      sx={{ flexShrink: 0, mt: 0.5, mr: 0 }}
                      control={<Switch size="small" checked={field.isNull} onChange={(event) => set(column.name, { isNull: event.target.checked })} />}
                      label={t('db.setNull')}
                    />
                  ) : (
                    <Box sx={{ width: 84, flexShrink: 0 }} />
                  )}
                </Stack>
              )
            })}
          </Stack>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          {tc('cancel')}
        </Button>
        <Button variant="contained" onClick={() => void save()} disabled={!row || saving || invalid} startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}>
          {tc('save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

/* --------------------------------------------------------------- console --- */

function SqlConsole({ embedded, notify }: { embedded: boolean; notify: Notify }) {
  const t = useTranslations('system')
  const locale = useLocale()
  const [text, setText] = useState('select * from "user" limit 20')
  const [write, setWrite] = useState(false)
  const [asking, setAsking] = useState(false)
  const [running, setRunning] = useState(false)
  const [outcome, setOutcome] = useState<ConsoleOutcome | null>(null)

  async function run() {
    if (running || !text.trim()) return
    setRunning(true)
    try {
      const result = await runSql(text, write)
      setOutcome(result)
      if (result.ok && result.wrote) notify('success', t('console.wrote'))
    } catch (error) {
      notify('error', error instanceof Error ? error.message : String(error))
    } finally {
      setRunning(false)
    }
  }

  const failureText = (result: Extract<ConsoleOutcome, { ok: false }>) => {
    if (result.reason === 'forbidden') return t('console.forbidden')
    if (result.reason === 'database') return t('console.database', { detail: result.detail })
    if (result.reason === 'snapshot') return t('console.snapshotFailed', { detail: result.detail })
    if (result.code === 'denied') return t(`console.deny.${result.detail ?? 'dropSchema'}`)
    return t(`console.guard.${result.code}`, { detail: result.detail ?? '' })
  }

  return (
    <Card>
      <CardContent>
        <TextField
          fullWidth
          multiline
          minRows={6}
          maxRows={20}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault()
              void run()
            }
          }}
          placeholder={t('console.placeholder')}
          slotProps={{ input: { sx: { fontFamily: MONO_STACK, fontSize: 13 } }, htmlInput: { spellCheck: false, 'aria-label': t('console.placeholder') } }}
        />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mt: 1.5, alignItems: { sm: 'center' } }}>
          <Button variant="contained" startIcon={running ? <CircularProgress size={16} color="inherit" /> : <PlayArrowOutlined />} onClick={() => void run()} disabled={running || !text.trim()}>
            {running ? t('console.running') : t('console.run')}
          </Button>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {t('console.shortcut')}
          </Typography>
          <Box sx={{ flexGrow: 1 }} />
          <FormControlLabel
            control={
              <Switch
                color="error"
                checked={write}
                onChange={(event) => {
                  if (event.target.checked) setAsking(true)
                  else setWrite(false)
                }}
              />
            }
            label={t('console.write')}
          />
        </Stack>
        <Alert severity={write ? 'warning' : 'info'} sx={{ mt: 1.5 }}>
          {write ? (embedded ? t('console.writeHintEmbedded') : t('console.writeHintPostgres')) : t('console.readOnlyHint')}
        </Alert>

        {outcome && !outcome.ok ? (
          <Alert severity="error" sx={{ mt: 2, whiteSpace: 'pre-wrap', fontFamily: outcome.reason === 'database' ? MONO_STACK : undefined }}>
            {failureText(outcome)}
          </Alert>
        ) : null}
        {outcome?.ok ? (
          <Box sx={{ mt: 2 }}>
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', mb: 1 }}>
              <Chip size="small" label={t('console.rows', { n: formatNumber(Math.min(outcome.rowCount, outcome.rows.length), locale) })} />
              {outcome.truncated ? <Chip size="small" color="warning" variant="outlined" label={t('console.truncated', { cap: outcome.rows.length })} /> : null}
              {outcome.affected !== null ? <Chip size="small" color="primary" variant="outlined" label={t('console.affected', { n: outcome.affected })} /> : null}
              <Chip size="small" variant="outlined" label={t('console.ms', { ms: outcome.ms })} />
              {outcome.snapshot ? <Chip size="small" variant="outlined" label={t('console.snapshot', { name: outcome.snapshot })} /> : null}
            </Stack>
            {outcome.columns.length === 0 ? (
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {t('console.noColumns')}
              </Typography>
            ) : (
              <Box sx={{ maxHeight: '60vh', overflow: 'auto', border: 1, borderColor: 'divider', borderRadius: 1 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      {outcome.columns.map((column) => (
                        <TableCell key={column} sx={{ whiteSpace: 'nowrap' }}>
                          {column}
                        </TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {outcome.rows.map((row, index) => (
                      <TableRow key={index} hover>
                        {row.map((cell, i) => (
                          <TableCell key={i} sx={{ maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: MONO_STACK, fontSize: 12 }} title={cell && cell !== MASK ? cell.slice(0, 500) : undefined}>
                            <Cell value={cell} />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            )}
          </Box>
        ) : null}
      </CardContent>

      <ConfirmDialog
        open={asking}
        title={t('console.confirmTitle')}
        confirmLabel={t('console.confirm')}
        danger
        onCancel={() => setAsking(false)}
        onConfirm={() => {
          setWrite(true)
          setAsking(false)
        }}
      >
        <Typography variant="body2">{embedded ? t('console.confirmBodyEmbedded') : t('console.confirmBodyPostgres')}</Typography>
      </ConfirmDialog>
    </Card>
  )
}
