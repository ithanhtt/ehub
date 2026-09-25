'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import TextField, { type TextFieldProps } from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import VisibilityOffOutlined from '@mui/icons-material/VisibilityOffOutlined'
import VisibilityOutlined from '@mui/icons-material/VisibilityOutlined'

/**
 * An input for an API credential — an App ID, a secret, a token — that
 * browsers and password managers leave alone.
 *
 * A `type="password"` input is a login form to every browser: it offers the
 * user's saved passwords, suggests generating a new one, fills the account
 * password into an App Secret, and takes the text field before it (the App
 * ID, the connection name) for the user name. `autocomplete="off"` does not
 * stop that — browsers ignore it on password fields on purpose.
 *
 * So a secret is a plain text input whose characters are drawn as dots
 * (`-webkit-text-security`, checked for in the browser), with a button to show what was pasted — which a credential, unlike a
 * password, often needs checked. Nothing about it looks like a login: no
 * password type, no "password" in its name, and the ignore attributes the
 * common password managers read (1Password, LastPass, Bitwarden, Dashlane).
 * A masked value cannot be copied or cut out of the field, as with a password.
 *
 * Only a browser without text-security falls back to a password input, with
 * `autocomplete="new-password"` so at least nothing saved is filled in.
 */

const IGNORE_ATTRIBUTES = {
  autoComplete: 'off',
  autoCorrect: 'off',
  autoCapitalize: 'off',
  spellCheck: false,
  'data-1p-ignore': 'true',
  'data-lpignore': 'true',
  'data-bwignore': 'true',
  'data-form-type': 'other',
} as const

export function CredentialField({
  secret = false,
  slotProps,
  ...props
}: Omit<TextFieldProps, 'type'> & {
  /** Drawn as dots, with a button to show it. */
  secret?: boolean
}) {
  const t = useTranslations('common')
  const [shown, setShown] = useState(false)
  // Known only in the browser; the first render assumes support, as every current browser has it.
  const [maskable, setMaskable] = useState(true)
  useEffect(() => {
    setMaskable(typeof CSS !== 'undefined' && (CSS.supports('-webkit-text-security', 'disc') || CSS.supports('text-security', 'disc')))
  }, [])

  const masked = secret && !shown
  const fallback = masked && !maskable
  const htmlInput = (slotProps?.htmlInput ?? {}) as Record<string, unknown>
  const inputStyle = (htmlInput.style ?? {}) as React.CSSProperties

  return (
    <TextField
      {...props}
      type={fallback ? 'password' : 'text'}
      slotProps={{
        ...slotProps,
        htmlInput: {
          ...htmlInput,
          ...IGNORE_ATTRIBUTES,
          ...(fallback ? { autoComplete: 'new-password' } : null),
          style: masked && maskable ? { ...inputStyle, WebkitTextSecurity: 'disc' } : inputStyle,
          onCopy: masked ? (event: React.ClipboardEvent) => event.preventDefault() : undefined,
          onCut: masked ? (event: React.ClipboardEvent) => event.preventDefault() : undefined,
        },
        input: secret
          ? {
              endAdornment: (
                <InputAdornment position="end">
                  <Tooltip title={shown ? t('hideValue') : t('showValue')}>
                    <IconButton
                      size="small"
                      edge="end"
                      aria-label={shown ? t('hideValue') : t('showValue')}
                      aria-pressed={shown}
                      onClick={() => setShown((value) => !value)}
                      // Keeps the caret in the field when the button is pressed.
                      onMouseDown={(event) => event.preventDefault()}
                    >
                      {shown ? <VisibilityOffOutlined fontSize="small" /> : <VisibilityOutlined fontSize="small" />}
                    </IconButton>
                  </Tooltip>
                </InputAdornment>
              ),
            }
          : slotProps?.input,
      }}
    />
  )
}

/** The attributes that keep browsers and password managers away from a plain field of a credential form. */
export const NO_AUTOFILL = IGNORE_ATTRIBUTES
