'use client'

import Alert from '@mui/material/Alert'
import AlertTitle from '@mui/material/AlertTitle'
import Box from '@mui/material/Box'
import { useTranslations } from 'next-intl'
import { MONO_STACK } from '@/theme'

/**
 * The result of a connection test.
 *
 * Two layers, because they answer different questions. The hint is the
 * diagnosis — which credential is at fault and what to do — written in the
 * user's language. The provider's own message sits underneath in monospace,
 * because when the hint is wrong or the user is asking support for help, the
 * exact wording and error code are what matter.
 */
export function TestFeedback({
  ok,
  message,
  hint,
}: {
  ok: boolean
  message?: string | null
  hint?: string | null
}) {
  const t = useTranslations('connections')
  if (!message && !hint) return null

  // Unknown keys must not crash the page: a connector can ship a hint the
  // running message bundle has not caught up with yet.
  const hintText = hint ? safeTranslate(t, `hints.${hint}`) : null

  return (
    <Alert severity={ok ? 'success' : 'error'}>
      {hintText ? <AlertTitle sx={{ fontSize: '0.8125rem' }}>{hintText}</AlertTitle> : null}
      {message ? (
        <Box
          component="span"
          sx={{
            display: 'block',
            fontFamily: MONO_STACK,
            fontSize: 11.5,
            opacity: hintText ? 0.8 : 1,
            wordBreak: 'break-word',
          }}
        >
          {message}
        </Box>
      ) : null}
    </Alert>
  )
}

function safeTranslate(t: ReturnType<typeof useTranslations>, key: string): string | null {
  try {
    return t(key as never)
  } catch {
    return null
  }
}
