'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import CheckOutlined from '@mui/icons-material/CheckOutlined'
import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined'
import DownloadOutlined from '@mui/icons-material/DownloadOutlined'
import { formatBytes } from '@/core/utils/format'
import { MONO_STACK } from '@/theme'

/**
 * JSON viewer for API responses.
 *
 * Highlighting tokenises the serialised string rather than walking the object
 * tree: a provider response can be deeply nested and highly repetitive, and
 * one pass over the text stays fast where a React node per value would not.
 * Output above the size threshold is truncated so a large report cannot lock
 * up the tab.
 */
const MAX_RENDER_CHARS = 400_000

export function JsonViewer({
  value,
  filename = 'response.json',
  maxHeight = 440,
}: {
  value: unknown
  filename?: string
  maxHeight?: number | string
}) {
  const t = useTranslations('hub')
  const tc = useTranslations('common')
  const [copied, setCopied] = useState(false)

  const { text, truncated, bytes } = useMemo(() => {
    let serialised: string
    try {
      serialised = JSON.stringify(value, null, 2) ?? 'null'
    } catch {
      serialised = String(value)
    }
    const size = new TextEncoder().encode(serialised).length
    if (serialised.length > MAX_RENDER_CHARS) {
      return { text: serialised.slice(0, MAX_RENDER_CHARS), truncated: true, bytes: size }
    }
    return { text: serialised, truncated: false, bytes: size }
  }, [value])

  const highlighted = useMemo(() => highlight(text), [text])

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(value, null, 2) ?? '')
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard blocked; the text is selectable as a fallback */
    }
  }

  function handleDownload() {
    const blob = new Blob([JSON.stringify(value, null, 2) ?? ''], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Box sx={{ borderRadius: 3.5, overflow: 'hidden', bgcolor: 'var(--adshub-surface-inset)' }}>
      <Stack
        direction="row"
        sx={{
          px: 1.5,
          py: 0.75,
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px dashed var(--adshub-dashed)',
        }}
      >
        <Typography variant="caption" sx={{ color: 'text.disabled' }}>
          {formatBytes(bytes)}
        </Typography>
        <Stack direction="row" spacing={0.5}>
          <Button
            size="small"
            color="inherit"
            onClick={handleCopy}
            startIcon={
              copied ? (
                <CheckOutlined sx={{ fontSize: 15, color: 'success.main' }} />
              ) : (
                <ContentCopyOutlined sx={{ fontSize: 15 }} />
              )
            }
          >
            {copied ? tc('copied') : t('copyJson')}
          </Button>
          <Button
            size="small"
            color="inherit"
            onClick={handleDownload}
            startIcon={<DownloadOutlined sx={{ fontSize: 15 }} />}
          >
            {t('downloadJson')}
          </Button>
        </Stack>
      </Stack>

      <Box
        component="pre"
        sx={{
          m: 0,
          p: 2,
          maxHeight,
          overflow: 'auto',
          fontFamily: MONO_STACK,
          fontSize: 12.5,
          lineHeight: 1.65,
          tabSize: 2,
          // Token colours are declared per scheme so both stay readable.
          '& .k': { color: 'var(--json-key)' },
          '& .s': { color: 'var(--json-string)' },
          '& .n': { color: 'var(--json-number)' },
          '& .b': { color: 'var(--json-bool)' },
          '& .z': { color: 'text.disabled' },
          '--json-key': '#7C3AED',
          '--json-string': '#15803D',
          '--json-number': '#B45309',
          '--json-bool': '#0E7490',
          '[data-mui-color-scheme="dark"] &': {
            '--json-key': '#C4B5FD',
            '--json-string': '#86EFAC',
            '--json-number': '#FCD34D',
            '--json-bool': '#67E8F9',
          },
        }}
        dangerouslySetInnerHTML={{ __html: highlighted }}
      />

      {truncated ? (
        <Alert severity="warning" variant="standard" sx={{ borderRadius: 0, fontSize: 12 }}>
          Output truncated for display. Use “{t('downloadJson')}” to get the full payload.
        </Alert>
      ) : null}
    </Box>
  )
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
}

/**
 * Escapes only the three characters that can break out of text content.
 *
 * Quotes are left alone on purpose: the highlighter below keys off them to
 * find JSON strings, and escaping them first would hide every string token.
 * The result is inserted as element content, never into an attribute, so
 * unescaped quotes are inert.
 */
function escapeHtml(input: string): string {
  return input.replace(/[&<>]/g, (char) => ESCAPES[char])
}

/**
 * The source is always JSON.stringify output, so the grammar is known and a
 * single regex is enough — this is not a general-purpose tokeniser.
 */
const TOKEN =
  /("(?:\\.|[^"\\])*"\s*:)|("(?:\\.|[^"\\])*")|(\b-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|(\btrue\b|\bfalse\b)|(\bnull\b)/g

function highlight(json: string): string {
  return escapeHtml(json).replace(TOKEN, (match, key, str, num, bool, nul) => {
    if (key) return `<span class="k">${key}</span>`
    if (str) return `<span class="s">${str}</span>`
    if (num) return `<span class="n">${num}</span>`
    if (bool) return `<span class="b">${bool}</span>`
    if (nul) return `<span class="z">${nul}</span>`
    return match
  })
}
