'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'

/**
 * Keeps one widget's failure to itself: a widget that throws while drawing is
 * replaced by a short notice with a retry, and the rest of the page carries
 * on. A fresh answer from the server (`resetKey`) gives it another go.
 */
export class WidgetBoundary extends Component<
  { id: string; resetKey: string; children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`Overview widget "${this.props.id}" failed to draw`, error, info.componentStack)
  }

  componentDidUpdate(previous: { resetKey: string }) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  render() {
    return this.state.error ? <WidgetFailed onRetry={() => this.setState({ error: null })} /> : this.props.children
  }
}

function WidgetFailed({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations('dashboard')
  return (
    <Alert
      severity="warning"
      action={
        <Button color="inherit" size="small" onClick={onRetry} sx={{ whiteSpace: 'nowrap' }}>
          {t('widgetRetry')}
        </Button>
      }
    >
      {t('widgetFailed')}
    </Alert>
  )
}
