import { redirect } from 'next/navigation'

/** /admin has no page of its own: it opens on System. */
export default function AdminPage() {
  redirect('/admin/system')
}
