import { useContext } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { Alert, Box, Button, IconButton, Paper, Skeleton, Stack, Tooltip, Typography } from '@mui/material'
import { ArrowDownwardRounded, ArrowForwardRounded, ArrowUpwardRounded, RefreshRounded, QrCode2Rounded, ShieldOutlined, AppsRounded, NorthEastRounded } from '@mui/icons-material'
import { WalletContext } from '../../WalletContext'
import { useWalletOverview } from '../../hooks/useWalletOverview'
import AmountDisplay from '../../components/AmountDisplay'
import AppLogo from '../../components/AppLogo'
import { ActivityList } from './Activity'

export default function WalletHome() {
  const { activeProfile, chain, useRemoteStorage } = useContext(WalletContext)
  const { balance, actions, loading, error, refresh } = useWalletOverview()
  return <>
    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 3.5 }}><Box><Typography variant="h1">Your everyday wallet.</Typography><Typography color="text.secondary" sx={{ mt: 1 }}>A little simpler. A lot more possible.</Typography></Box><Tooltip title="Refresh wallet"><IconButton aria-label="Refresh wallet" onClick={() => void refresh()} disabled={loading}><RefreshRounded /></IconButton></Tooltip></Stack>
    {error && <Alert severity="error" sx={{ mb: 3 }} action={<Button onClick={() => void refresh()}>Retry</Button>}>{error}</Alert>}
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.7fr) minmax(260px, 1fr)' }, gap: 3, mb: 4 }}>
      <Paper sx={{ position: 'relative', overflow: 'hidden', borderRadius: 4, bgcolor: '#1b365d', color: '#fff', p: { xs: 3, md: 4 }, minHeight: 280 }}>
        <Box aria-hidden sx={{ position: 'absolute', width: 320, height: 320, right: -110, top: -70, opacity: 0.17, pointerEvents: 'none' }}><AppLogo color="#a9c2e4" /></Box>
        <Stack direction="row" alignItems="center" justifyContent="space-between"><Typography variant="body2" sx={{ color: '#cfdbec' }}>Available balance</Typography><Typography variant="caption" sx={{ color: '#cfdbec', border: '1px solid #ffffff25', px: 1.25, py: 0.4, borderRadius: 5 }}>{chain === 'main' ? 'BSV · Mainnet' : `BSV · ${chain.toUpperCase()}`}</Typography></Stack>
        <Typography sx={{ mt: 2.5, mb: 0.5, fontSize: { xs: 36, md: 44 }, letterSpacing: '-0.055em', fontWeight: 550, position: 'relative', '& span, & button': { color: '#ffffff !important' } }}>{balance === null ? loading ? <Skeleton width={200} sx={{ bgcolor: '#ffffff20' }} /> : <Box component="span" aria-label="Balance unavailable">—</Box> : <AmountDisplay>{balance}</AmountDisplay>}</Typography>
        <Typography variant="caption" sx={{ color: '#cfdbec' }}>{activeProfile?.name || 'My wallet'} · {useRemoteStorage ? 'Remote wallet storage' : 'Stored on this device'}</Typography>
        <Stack direction="row" gap={1.5} sx={{ mt: 4, position: 'relative' }}><Button component={RouterLink} to="/dashboard/payments" startIcon={<ArrowUpwardRounded />} sx={{ bgcolor: '#edf3fc', color: '#1b365d', '&:hover': { bgcolor: '#fff' }, minWidth: 116 }}>Pay</Button><Button component={RouterLink} to="/dashboard/payments?tab=receive" startIcon={<ArrowDownwardRounded />} sx={{ border: '1px solid #ffffff40', color: '#fff', minWidth: 116, '&:hover': { bgcolor: '#ffffff15' } }}>Get paid</Button></Stack>
      </Paper>
      <Paper sx={{ p: 3.5, border: '1px solid', borderColor: 'divider', borderRadius: 4, display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
        <Box sx={{ width: 44, height: 44, borderRadius: 3, bgcolor: 'background.default', color: 'primary.main', display: 'grid', placeItems: 'center', mb: 2.5 }}><QrCode2Rounded /></Box><Typography variant="h3">Right here. Right now.</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2 }}>Pay someone nearby with a QR code. From your desktop to their wallet.</Typography><Button component={RouterLink} to="/dashboard/payments?tab=nearby" endIcon={<ArrowForwardRounded />} sx={{ mt: 'auto', px: 0 }}>Pay nearby</Button>
      </Paper>
    </Box>
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.7fr) minmax(260px, 1fr)' }, gap: 3 }}>
      <Box><Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}><Typography variant="h4">Recent activity</Typography><Button component={RouterLink} to="/dashboard/activity" size="small" sx={{ color: 'text.secondary' }} endIcon={<ArrowForwardRounded fontSize="small" />}>View all</Button></Stack><Paper sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 3, overflow: 'hidden' }}>{error && !actions.length ? <Typography color="text.secondary" sx={{ p: 4, textAlign: 'center' }}>Activity is unavailable. Refresh to try again.</Typography> : <ActivityList actions={actions.slice(0, 5)} loading={loading} emptyAction />}</Paper></Box>
      <Stack gap={2.5} sx={{ pt: { xs: 0, lg: 6.5 } }}>
        <Paper sx={{ p: 3, border: '1px solid', borderColor: 'divider', borderRadius: 3 }}><ShieldOutlined sx={{ color: 'primary.main', mb: 1 }} /><Typography variant="h5">Keep your wallet yours.</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: 0.75, mb: 1.25 }}>Save your recovery phrase or create backup shares for peace of mind.</Typography><Button component={RouterLink} to="/dashboard/settings/backup" endIcon={<NorthEastRounded sx={{ fontSize: 16 }} />} size="small" sx={{ px: 0 }}>Back up wallet</Button></Paper>
        <Paper sx={{ p: 3, border: '1px solid', borderColor: 'divider', borderRadius: 3 }}><AppsRounded sx={{ color: 'primary.main', mb: 1 }} /><Typography variant="h5">A wallet that does more.</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: 0.75, mb: 1.25 }}>Connect to apps with your identity and approve payments as you go.</Typography><Button component={RouterLink} to="/dashboard/apps" endIcon={<NorthEastRounded sx={{ fontSize: 16 }} />} size="small" sx={{ px: 0 }}>Explore apps</Button></Paper>
      </Stack>
    </Box>
  </>
}
