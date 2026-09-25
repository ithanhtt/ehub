import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Skeleton from '@mui/material/Skeleton'
import Stack from '@mui/material/Stack'

/**
 * What the System and Database pages show at once while the server collects
 * them: the heading, then cards (System) or the table list beside the grid
 * (Database), in the shapes the page will have — so nothing jumps when it
 * arrives.
 */
export function AdminLoading({ variant }: { variant: 'system' | 'database' }) {
  return (
    <Box sx={{ px: { xs: 2, md: 4 }, py: { xs: 2.5, md: 3.5 }, maxWidth: 1400, mx: 'auto' }}>
      <Skeleton variant="text" width={220} height={44} />
      <Skeleton variant="text" width="min(560px, 90%)" sx={{ mb: 3 }} />
      {variant === 'system' ? (
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' } }}>
          {Array.from({ length: 6 }, (_, i) => (
            <Card key={i}>
              <CardContent>
                <Skeleton variant="text" width={140} />
                <Skeleton variant="text" width={90} height={48} />
                <Skeleton variant="rounded" height={8} sx={{ my: 1.5 }} />
                <Skeleton variant="rounded" height={56} />
              </CardContent>
            </Card>
          ))}
        </Box>
      ) : (
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <Card sx={{ width: { md: 280 }, flexShrink: 0 }}>
            <CardContent>
              {Array.from({ length: 10 }, (_, i) => (
                <Skeleton key={i} variant="text" height={32} />
              ))}
            </CardContent>
          </Card>
          <Card sx={{ flexGrow: 1 }}>
            <CardContent>
              <Skeleton variant="text" width={200} height={36} />
              {Array.from({ length: 12 }, (_, i) => (
                <Skeleton key={i} variant="text" height={30} />
              ))}
            </CardContent>
          </Card>
        </Stack>
      )}
    </Box>
  )
}
