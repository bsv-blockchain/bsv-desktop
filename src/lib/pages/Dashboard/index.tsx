import { lazy, Suspense, useContext, useState } from 'react'
import { Switch, Route, Redirect, useLocation } from 'react-router-dom'
import { Backdrop, Box, Button, Chip, CircularProgress, IconButton, Stack, Typography, useMediaQuery } from '@mui/material'
import { MenuRounded, LanguageRounded } from '@mui/icons-material'
import { WalletContext } from '../../WalletContext'
import { UserContext } from '../../UserContext'
import Menu, { SIDEBAR_WIDTH } from '../../navigation/Menu'
import PageLoading from '../../components/PageLoading'
import ErrorBoundary from '../../components/ErrorBoundary'
import WalletHome from './WalletHome'
import Activity from './Activity'
const Payments = lazy(() => import('./Payments'))
const AppsHub = lazy(() => import('./AppsHub'))

const App = lazy(() => import('./App/Index'))
const Settings = lazy(() => import('./Settings'))
const AdvancedSettings = lazy(() => import('./Settings/AdvancedSettings'))
const Security = lazy(() => import('./Security'))
const MyIdentity = lazy(() => import('./MyIdentity'))
const Trust = lazy(() => import('./Trust'))
const AppAccess = lazy(() => import('./AppAccess'))
const BasketAccess = lazy(() => import('./BasketAccess'))
const ProtocolAccess = lazy(() => import('./ProtocolAccess'))
const CounterpartyAccess = lazy(() => import('./CounterpartyAccess'))
const CertificateAccess = lazy(() => import('./CertificateAccess'))

const chainNames = { main: 'Mainnet', test: 'Testnet', ttn: 'TeraTestNet', tstn: 'TSTN' }

export default function Dashboard() {
  const { pageLoaded } = useContext(UserContext)
  const { activeProfile, chain, switchingNetwork, managers } = useContext(WalletContext)
  const [menuOpen, setMenuOpen] = useState(false)
  const compact = useMediaQuery('(max-width:900px)')
  const location = useLocation()
  const area = location.pathname.split('/')[2]
  const label = ({ payments: 'Payments', activity: 'Activity', apps: 'Apps', 'app-catalog': 'Apps', settings: 'Settings' } as Record<string, string>)[area] || 'Wallet'
  if (!pageLoaded) return <PageLoading />
  if (!managers.permissionsManager && !switchingNetwork) return <Redirect to="/" />

  return <Box sx={{ minHeight: '100vh' }}>
    <Backdrop open={switchingNetwork} sx={{ zIndex: theme => theme.zIndex.drawer + 1, bgcolor: 'rgba(15, 23, 42, 0.5)', backdropFilter: 'blur(3px)' }}><PaperStatus /></Backdrop>
    <Menu menuOpen={menuOpen} setMenuOpen={setMenuOpen} />
    <Box sx={{ ml: compact ? 0 : `${SIDEBAR_WIDTH}px` }}>
      <Box component="header" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: { xs: 2.5, md: 5 }, height: 80, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Stack direction="row" gap={1} alignItems="center">{compact && <IconButton aria-label="Open navigation" onClick={() => setMenuOpen(true)}><MenuRounded /></IconButton>}<Typography variant="body2" color="text.secondary">Your wallet <Box component="span" sx={{ mx: 1.5, color: 'text.disabled' }}>/</Box><Box component="span" sx={{ color: 'text.primary', fontWeight: 500 }}>{label}</Box></Typography></Stack>
        <Button size="small" startIcon={<LanguageRounded sx={{ fontSize: '17px !important' }} />} onClick={() => window.dispatchEvent(new CustomEvent('open-network-settings'))} sx={{ color: 'text.secondary', border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', px: 1.5, py: 0.6 }} aria-label={`Network: ${chainNames[chain] || chain}. Change network`}>
          {chainNames[chain] || chain}{chain !== 'main' && <Chip label="TEST" size="small" sx={{ ml: 1, height: 18, fontSize: 9 }} />}
        </Button>
      </Box>
      <Box component="main" key={`${activeProfile?.identityKey || 'wallet'}-${chain}`} sx={{ maxWidth: 1320, mx: 'auto', px: { xs: 2.5, md: 5 }, pt: { xs: 3, md: 5 }, pb: 6 }}>
        <ErrorBoundary><Suspense fallback={<Box sx={{ display: 'grid', placeItems: 'center', minHeight: 260 }}><CircularProgress size={28} aria-label="Loading page" /></Box>}><Switch>
          <Route exact path="/dashboard" component={WalletHome} />
          <Route path="/dashboard/payments" component={Payments} />
          <Route path="/dashboard/activity" component={Activity} />
          <Route path="/dashboard/settings/backup" component={Security} />
          <Route path="/dashboard/settings/advanced" component={AdvancedSettings} />
          <Route path="/dashboard/settings/identity" component={MyIdentity} />
          <Route path="/dashboard/settings/trust" component={Trust} />
          <Route path="/dashboard/settings" component={Settings} />
          <Redirect from="/dashboard/app-catalog" to="/dashboard/apps" />
          <Route path="/dashboard/apps" component={AppsHub} />
          <Route path="/dashboard/app" component={App} />
          <Route path="/dashboard/manage-app/:originator" component={AppAccess} />
          <Route path="/dashboard/basket/:basketId" component={BasketAccess} />
          <Route path="/dashboard/protocol/:protocolId/:securityLevel" component={ProtocolAccess} />
          <Route path="/dashboard/counterparty/:counterparty" component={CounterpartyAccess} />
          <Route path="/dashboard/certificate/:certType" component={CertificateAccess} />
          <Redirect from="/dashboard/legacybridge" to="/dashboard/payments?tab=receive" />
          <Redirect from="/dashboard/transfers" to="/dashboard/payments" />
          <Redirect from="/dashboard/peer-tokens" to="/dashboard/payments" />
          <Redirect from="/dashboard/security" to="/dashboard/settings/backup" />
          <Redirect from="/dashboard/identity" to="/dashboard/settings/identity" />
          <Redirect from="/dashboard/trust" to="/dashboard/settings/trust" />
          <Redirect to="/dashboard" />
        </Switch></Suspense></ErrorBoundary>
      </Box>
    </Box>
  </Box>
}

function PaperStatus() { return <Stack alignItems="center" gap={2} sx={{ bgcolor: 'background.paper', color: 'text.primary', p: 4, borderRadius: 4 }}><CircularProgress size={28} /><Typography variant="body2">Opening your wallet on this network…</Typography></Stack> }
