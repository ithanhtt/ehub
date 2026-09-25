'use client'

import { Fragment, useState } from 'react'
import { useTranslations } from 'next-intl'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import ButtonBase from '@mui/material/ButtonBase'
import Chip from '@mui/material/Chip'
import Collapse from '@mui/material/Collapse'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import CheckOutlined from '@mui/icons-material/CheckOutlined'
import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined'
import ExpandMoreOutlined from '@mui/icons-material/ExpandMoreOutlined'
import LaunchOutlined from '@mui/icons-material/LaunchOutlined'
import MenuBookOutlined from '@mui/icons-material/MenuBookOutlined'
import type { ConnectionGuide, GuideStep, LocalizedText } from '@/core/plugins/types'
import type { Locale } from '@/i18n/config'
import { MONO_STACK } from '@/theme'

/**
 * A connector's step-by-step setup, in the connection dialog
 * (AuthSpec.guide). The ways to connect as tabs; numbered steps, each ticked
 * off by pressing its number, so a reader coming back from the cloud console
 * sees where they were; links that open the right console page; and a value
 * to copy — the email a sheet must be shared with — read live from what was
 * just pasted into the form. Reference tables and troubleshooting fold away
 * below.
 */

/** **bold** and `code`, nothing else: guide text never becomes markup. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
        part.startsWith('**') && part.endsWith('**') ? (
          <Box key={i} component="strong" sx={{ fontWeight: 700 }}>
            {part.slice(2, -2)}
          </Box>
        ) : part.startsWith('`') && part.endsWith('`') ? (
          <Box
            key={i}
            component="code"
            sx={{ fontFamily: MONO_STACK, fontSize: '0.75rem', px: 0.5, py: 0.1, borderRadius: 1, bgcolor: 'var(--adshub-surface-inset)' }}
          >
            {part.slice(1, -1)}
          </Box>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  )
}

/** The value a step offers to copy: from the form as it is being filled, else from the saved connection. */
function copyValue(step: GuideStep, fields: Record<string, string>, metadata: Record<string, unknown>): string {
  const source = step.copy
  if (!source) return ''
  if (source.field) {
    const raw = fields[source.field.key] ?? ''
    if (raw && !source.field.jsonKey) return raw
    if (raw && source.field.jsonKey) {
      try {
        const value = (JSON.parse(raw) as Record<string, unknown>)[source.field.jsonKey]
        if (typeof value === 'string' && value) return value
      } catch {
        /* not whole JSON yet */
      }
    }
  }
  const saved = source.metadataKey ? metadata[source.metadataKey] : undefined
  return typeof saved === 'string' ? saved : ''
}

function CopyBox({ label, value, pending }: { label: string; value: string; pending: string }) {
  const t = useTranslations('connections')
  const [copied, setCopied] = useState(false)
  return (
    <Box sx={{ mt: 1, px: 1.5, py: 1, borderRadius: 2, bgcolor: 'var(--adshub-surface-inset)' }}>
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
        {label}
      </Typography>
      {value ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
          <Typography sx={{ fontFamily: MONO_STACK, fontSize: 13, fontWeight: 600, overflowWrap: 'anywhere', flex: 1 }}>{value}</Typography>
          <Tooltip title={copied ? t('guideCopied') : t('guideCopy')}>
            <IconButton
              size="small"
              aria-label={t('guideCopy')}
              onClick={() => {
                void navigator.clipboard?.writeText(value).then(() => {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                })
              }}
            >
              {copied ? <CheckOutlined fontSize="small" color="success" /> : <ContentCopyOutlined fontSize="small" />}
            </IconButton>
          </Tooltip>
        </Stack>
      ) : (
        <Typography variant="body2" sx={{ color: 'text.disabled' }}>
          {pending}
        </Typography>
      )}
    </Box>
  )
}

export function ConnectionGuideView({
  guide,
  locale,
  fields,
  metadata,
  defaultOpen,
}: {
  guide: ConnectionGuide
  locale: Locale
  /** The form's current values, by field key, for the steps that copy from them. */
  fields: Record<string, string>
  metadata: Record<string, unknown>
  defaultOpen: boolean
}) {
  const t = useTranslations('connections')
  const text = (value: LocalizedText) => value[locale]
  const [open, setOpen] = useState(defaultOpen)
  const [methodId, setMethodId] = useState(guide.methods[0]?.id ?? '')
  const [done, setDone] = useState<Record<string, boolean>>({})
  const [section, setSection] = useState<'references' | 'troubleshooting' | null>(null)
  const method = guide.methods.find((m) => m.id === methodId) ?? guide.methods[0]
  if (!method) return null
  const finished = method.steps.filter((_, i) => done[`${method.id}:${i}`]).length

  return (
    <Box sx={{ border: '1px dashed var(--adshub-dashed)', borderRadius: 3.5, overflow: 'hidden' }}>
      <ButtonBase
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        sx={{ width: '100%', justifyContent: 'space-between', px: 2, py: 1.25, textAlign: 'left', '&:hover': { bgcolor: 'action.hover' } }}
      >
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <MenuBookOutlined fontSize="small" color="primary" />
          <Typography variant="subtitle2">{t('guideTitle')}</Typography>
          {finished > 0 ? <Chip size="small" color="success" variant="outlined" label={`${finished}/${method.steps.length}`} sx={{ height: 20 }} /> : null}
        </Stack>
        <ExpandMoreOutlined sx={{ color: 'text.secondary', transition: 'transform .15s', transform: open ? 'rotate(180deg)' : 'none' }} />
      </ButtonBase>

      <Collapse in={open}>
        <Stack spacing={2} sx={{ px: 2, pb: 2 }}>
          {guide.methods.length > 1 ? (
            <ToggleButtonGroup exclusive size="small" value={method.id} onChange={(_e, next: string | null) => next && setMethodId(next)} sx={{ flexWrap: 'wrap' }}>
              {guide.methods.map((m) => (
                <ToggleButton key={m.id} value={m.id} sx={{ textTransform: 'none', fontWeight: 600, gap: 0.75 }}>
                  {text(m.label)}
                  {m.badge ? <Chip size="small" color="primary" label={text(m.badge)} sx={{ height: 18, fontSize: '0.6875rem' }} /> : null}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          ) : null}
          {method.summary ? (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              <Rich text={text(method.summary)} />
            </Typography>
          ) : null}

          <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0 }}>
            {method.steps.map((step, i) => {
              const key = `${method.id}:${i}`
              const isDone = Boolean(done[key])
              const last = i === method.steps.length - 1
              return (
                <Box component="li" key={key} sx={{ display: 'flex', gap: 1.5 }}>
                  {/* The number doubles as the "done" tick; the rail joins the steps. */}
                  <Stack sx={{ alignItems: 'center', flexShrink: 0 }}>
                    <Tooltip title={isDone ? t('guideUndo') : t('guideMarkDone')}>
                      <ButtonBase
                        onClick={() => setDone((current) => ({ ...current, [key]: !isDone }))}
                        aria-pressed={isDone}
                        aria-label={`${t('guideStep', { number: i + 1 })} — ${isDone ? t('guideUndo') : t('guideMarkDone')}`}
                        sx={{
                          width: 28,
                          height: 28,
                          borderRadius: '50%',
                          fontSize: 13,
                          fontWeight: 700,
                          color: isDone ? 'primary.contrastText' : 'primary.main',
                          bgcolor: isDone ? 'primary.main' : 'transparent',
                          border: '2px solid',
                          borderColor: 'primary.main',
                          '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
                        }}
                      >
                        {isDone ? <CheckOutlined sx={{ fontSize: 16 }} /> : i + 1}
                      </ButtonBase>
                    </Tooltip>
                    {!last ? <Box sx={{ flex: 1, width: 0, borderLeft: '2px dashed var(--adshub-dashed)', my: 0.5 }} /> : null}
                  </Stack>

                  <Box sx={{ flex: 1, minWidth: 0, pb: last ? 0 : 2.5, opacity: isDone ? 0.6 : 1, transition: 'opacity .15s' }}>
                    <Typography variant="subtitle2" sx={{ lineHeight: '28px' }}>
                      {text(step.title)}
                    </Typography>
                    <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 2.25 }}>
                      {step.lines.map((line, j) => (
                        <Typography key={j} component="li" variant="body2">
                          <Rich text={text(line)} />
                        </Typography>
                      ))}
                    </Stack>
                    {step.links?.length ? (
                      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1, mt: 1 }}>
                        {step.links.map((link) => (
                          <Button
                            key={link.href}
                            size="small"
                            variant="outlined"
                            href={link.href}
                            target="_blank"
                            rel="noreferrer noopener"
                            endIcon={<LaunchOutlined sx={{ fontSize: 14 }} />}
                          >
                            {text(link.label)}
                          </Button>
                        ))}
                      </Stack>
                    ) : null}
                    {step.copy ? (
                      <CopyBox label={text(step.copy.label)} value={copyValue(step, fields, metadata)} pending={text(step.copy.pending)} />
                    ) : null}
                    {step.caution ? (
                      <Alert severity="warning" sx={{ mt: 1, py: 0, '& .MuiAlert-message': { fontSize: '0.8125rem' } }}>
                        <Rich text={text(step.caution)} />
                      </Alert>
                    ) : null}
                  </Box>
                </Box>
              )
            })}
          </Box>

          {guide.references?.length || guide.troubleshooting?.length ? (
            <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
              {guide.references?.length ? (
                <Button size="small" color="inherit" onClick={() => setSection(section === 'references' ? null : 'references')} endIcon={<ExpandMoreOutlined sx={{ transform: section === 'references' ? 'rotate(180deg)' : 'none' }} />}>
                  {text(guide.references[0].title)}
                </Button>
              ) : null}
              {guide.troubleshooting?.length ? (
                <Button size="small" color="inherit" onClick={() => setSection(section === 'troubleshooting' ? null : 'troubleshooting')} endIcon={<ExpandMoreOutlined sx={{ transform: section === 'troubleshooting' ? 'rotate(180deg)' : 'none' }} />}>
                  {t('guideTroubleshooting')}
                </Button>
              ) : null}
            </Stack>
          ) : null}

          <Collapse in={section === 'references'} unmountOnExit>
            {guide.references?.map((reference) => (
              <Box key={text(reference.title)}>
                <Box sx={{ overflowX: 'auto' }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        {reference.columns.map((column) => (
                          <TableCell key={text(column)} sx={{ whiteSpace: 'nowrap' }}>
                            {text(column)}
                          </TableCell>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {reference.rows.map((row, r) => (
                        <TableRow key={r}>
                          {row.map((cell, c) => (
                            <TableCell key={c} sx={{ fontSize: '0.8125rem', verticalAlign: 'top', fontWeight: c === 0 ? 600 : 400 }}>
                              <Rich text={text(cell)} />
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
                {reference.note ? (
                  <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mt: 1 }}>
                    <Rich text={text(reference.note)} />
                  </Typography>
                ) : null}
              </Box>
            ))}
          </Collapse>

          <Collapse in={section === 'troubleshooting'} unmountOnExit>
            <Stack spacing={1}>
              {guide.troubleshooting?.map((item) => (
                <Box key={text(item.problem)} sx={{ px: 1.5, py: 1, borderRadius: 2, bgcolor: 'var(--adshub-surface-inset)' }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    <Rich text={text(item.problem)} />
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    <Rich text={text(item.fix)} />
                  </Typography>
                </Box>
              ))}
            </Stack>
          </Collapse>
        </Stack>
      </Collapse>
    </Box>
  )
}
