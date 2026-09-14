'use client'

import { useMemo } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import InputAdornment from '@mui/material/InputAdornment'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import SearchOutlined from '@mui/icons-material/SearchOutlined'
import type { CatalogEntry } from '@/core/plugins/registry'
import type { Locale } from '@/i18n/config'
import { MONO_STACK } from '@/theme'
import { METHOD_COLOR } from './types'

/**
 * The searchable endpoint catalogue.
 *
 * Grouped source → group → endpoint because that is how the user thinks about
 * it ("the TikTok campaign endpoints"), and because with several providers
 * connected a flat list of forty entries stops being scannable.
 */
export function EndpointCatalog({
  catalog,
  query,
  onQueryChange,
  sourceFilter,
  onSourceFilterChange,
  selectedKey,
  onSelect,
}: {
  catalog: CatalogEntry[]
  query: string
  onQueryChange: (value: string) => void
  sourceFilter: string
  onSourceFilterChange: (value: string) => void
  selectedKey: string | null
  onSelect: (entry: CatalogEntry) => void
}) {
  const t = useTranslations('hub')
  const tc = useTranslations('common')
  const locale = useLocale() as Locale

  const sources = useMemo(() => {
    const seen = new Map<string, string>()
    for (const entry of catalog) if (!seen.has(entry.pluginId)) seen.set(entry.pluginId, entry.pluginName)
    return [...seen.entries()]
  }, [catalog])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return catalog.filter((entry) => {
      if (sourceFilter !== 'all' && entry.pluginId !== sourceFilter) return false
      if (!needle) return true
      return [entry.name.vi, entry.name.en, entry.group, entry.path, entry.id, entry.pluginName]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    })
  }, [catalog, query, sourceFilter])

  const unverifiedCount = useMemo(
    () => filtered.filter((entry) => entry.unverified).length,
    [filtered],
  )

  const grouped = useMemo(() => {
    const bySource = new Map<string, Map<string, CatalogEntry[]>>()
    for (const entry of filtered) {
      if (!bySource.has(entry.pluginName)) bySource.set(entry.pluginName, new Map())
      const groups = bySource.get(entry.pluginName)!
      if (!groups.has(entry.group)) groups.set(entry.group, [])
      groups.get(entry.group)!.push(entry)
    }
    return bySource
  }, [filtered])

  return (
    <Paper sx={{ overflow: 'hidden', position: { lg: 'sticky' }, top: { lg: 72 } }}>
      <Stack spacing={1.25} sx={{ p: 1.5, borderBottom: '1px dashed var(--adshub-dashed)' }}>
        <TextField
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={t('searchPlaceholder')}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchOutlined sx={{ fontSize: 17, color: 'text.disabled' }} />
                </InputAdornment>
              ),
            },
          }}
        />

        {sources.length > 1 ? (
          <TextField select value={sourceFilter} onChange={(e) => onSourceFilterChange(e.target.value)}>
            <MenuItem value="all" sx={{ fontSize: 13 }}>
              {t('allSources')}
            </MenuItem>
            {sources.map(([id, name]) => (
              <MenuItem key={id} value={id} sx={{ fontSize: 13 }}>
                {name}
              </MenuItem>
            ))}
          </TextField>
        ) : null}

        <Typography variant="caption" sx={{ color: 'text.disabled', pl: 0.5 }}>
          {filtered.length} {t('endpoints').toLowerCase()}
          {unverifiedCount > 0 ? ` · ${t('unverifiedCount', { count: unverifiedCount })}` : ''}
        </Typography>
      </Stack>

      <Box sx={{ maxHeight: { lg: 'calc(100dvh - 260px)' }, overflowY: 'auto', p: 1 }}>
        {filtered.length === 0 ? (
          <Typography
            variant="caption"
            sx={{ display: 'block', py: 4, textAlign: 'center', color: 'text.disabled' }}
          >
            {tc('noResults')}
          </Typography>
        ) : (
          [...grouped.entries()].map(([sourceName, groups]) => (
            <Box key={sourceName} sx={{ mb: 1.5 }}>
              <Typography
                variant="overline"
                sx={{ display: 'block', px: 1, color: 'text.disabled' }}
              >
                {sourceName}
              </Typography>

              {[...groups.entries()].map(([group, entries]) => (
                <Box key={group} sx={{ mb: 0.75 }}>
                  <Typography
                    variant="caption"
                    sx={{ display: 'block', px: 1, py: 0.5, color: 'text.secondary' }}
                  >
                    {group}
                  </Typography>

                  <List disablePadding>
                    {entries.map((entry) => {
                      const key = `${entry.pluginId}:${entry.id}`
                      const active = key === selectedKey
                      return (
                        <ListItemButton
                          key={key}
                          selected={active}
                          onClick={() => onSelect(entry)}
                          sx={{ py: 0.5, px: 1, mb: 0.25, alignItems: 'flex-start', gap: 1 }}
                        >
                          <Chip
                            size="small"
                            label={entry.method}
                            color={METHOD_COLOR[entry.method] ?? 'default'}
                            variant="outlined"
                            sx={{ mt: 0.35, height: 17, fontSize: 9, px: 0 }}
                          />
                          <ListItemText
                            sx={{ my: 0 }}
                            primary={
                              <Typography
                                variant="body2"
                                noWrap
                                sx={{
                                  fontWeight: active ? 600 : 400,
                                  color: active ? 'primary.main' : 'text.primary',
                                }}
                              >
                                {entry.name[locale]}
                              </Typography>
                            }
                            secondary={
                              <Typography
                                variant="caption"
                                noWrap
                                sx={{
                                  display: 'block',
                                  fontFamily: MONO_STACK,
                                  fontSize: 10.5,
                                  color: 'text.disabled',
                                  ...(entry.unverified
                                    ? {
                                        textDecoration: 'underline dotted',
                                        textUnderlineOffset: 3,
                                        textDecorationColor: 'var(--adshub-dashed)',
                                      }
                                    : null),
                                }}
                                title={entry.unverified ? t('unverifiedBadge') : undefined}
                              >
                                {entry.path}
                              </Typography>
                            }
                            disableTypography
                          />
                        </ListItemButton>
                      )
                    })}
                  </List>
                </Box>
              ))}
            </Box>
          ))
        )}
      </Box>
    </Paper>
  )
}
