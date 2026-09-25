import { redirect } from 'next/navigation'

/**
 * The booking data's old address: it is now a part of Booking & KOC
 * (../booking-koc/data). Kept so links and bookmarks made before still land.
 */
export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  redirect(`/projects/${projectId}/booking-koc/data`)
}
