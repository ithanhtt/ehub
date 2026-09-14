import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/core/auth/session'
import { resumePath } from '@/features/projects/resume'

export default async function RootPage() {
  // Back to the overview of the project this browser was in last, when there is one.
  redirect((await getCurrentUser()) ? await resumePath() : '/login')
}
