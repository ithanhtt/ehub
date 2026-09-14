import { titled } from '@/core/metadata'

// The page is a client component, which cannot name itself; its layout does.
export const generateMetadata = titled('auth', 'registerTitle')

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return children
}
