import { Suspense } from 'react'
import Skeleton from '@mui/material/Skeleton'
import { isFreshInstall } from '@/core/auth/bootstrap'
import { LoginForm } from './login-form'
import { titled } from '@/core/metadata'

export const generateMetadata = titled('auth', 'loginTitle')

export default async function LoginPage() {
  // Read on the server so the form can say "nobody has registered yet"
  // instead of rejecting correct credentials with no explanation.
  const freshInstall = await isFreshInstall()

  return (
    // useSearchParams needs a Suspense boundary so the shell can prerender.
    <Suspense fallback={<Skeleton variant="rounded" height={392} sx={{ borderRadius: 4.5 }} />}>
      <LoginForm freshInstall={freshInstall} />
    </Suspense>
  )
}
