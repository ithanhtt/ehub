import { getTranslations } from 'next-intl/server'
import { requireProject } from '@/core/auth/session'
import { can } from '@/core/auth/rbac'
import { listMembers, listPendingInvitations } from '@/features/projects/queries'
import { PageHeader } from '@/components/ui/page-header'
import { MembersManager } from './members-manager'
import { titled } from '@/core/metadata'

export const generateMetadata = titled('nav', 'members')

export default async function MembersPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  const { role, user } = await requireProject(projectId)

  const [members, invitations, t] = await Promise.all([
    listMembers(projectId),
    can(role, 'member:invite') ? listPendingInvitations(projectId) : Promise.resolve([]),
    getTranslations('members'),
  ])

  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} />
      <MembersManager
        projectId={projectId}
        members={members}
        invitations={invitations.map((invitation) => ({
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          token: invitation.token,
          expiresAt: invitation.expiresAt,
        }))}
        currentUserId={user.id}
        canInvite={can(role, 'member:invite')}
        canManageRoles={can(role, 'member:update-role')}
      />
    </>
  )
}
