import { useContext, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { Box, Button, IconButton, MenuItem, Paper, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { ArrowForwardRounded, BackupOutlined, BadgeOutlined, DarkModeOutlined, DevicesOutlined, LanguageRounded, LightModeOutlined, PublicOutlined, SettingsOutlined, ShieldOutlined, TuneRounded } from '@mui/icons-material'
import { toast } from 'react-toastify'
import { WalletContext } from '../../../WalletContext'
import { UserContext } from '../../../UserContext'
import { useLanguage, languageNames } from '../../../i18n/LanguageContext'

const networks = { main: 'Mainnet', test: 'Testnet', ttn: 'TeraTestNet', tstn: 'TSTN' }
const row = { display: 'flex', alignItems: 'center', gap: 2, p: 2.5, width: '100%', borderRadius: 2.5, color: 'text.primary', textAlign: 'left', justifyContent: 'flex-start' }

function SettingsLink({ to, icon: Icon, title, description }: { to: string; icon: typeof BackupOutlined; title: string; description: string }) {
  return <Button component={RouterLink} to={to} sx={row}><Icon sx={{ color: 'text.secondary' }} /><Box sx={{ flex: 1 }}><Typography variant="body2" fontWeight={600}>{title}</Typography><Typography variant="caption" color="text.secondary">{description}</Typography></Box><ArrowForwardRounded sx={{ fontSize: 18, color: 'text.secondary' }} /></Button>
}

export default function Settings() {
  const { chain, settings, updateSettings, useRemoteStorage, messageBoxUrl } = useContext(WalletContext)
  const { appVersion, setManualUpdateInfo } = useContext(UserContext)
  const { currentLanguage, setCurrentLanguage, supportedLanguages } = useLanguage()
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(false)
  const save = async (change: any) => {
    setBusy(true)
    try { await updateSettings({ ...settings, ...change }) }
    catch (error) { toast.error(error.message || 'Could not save settings.') }
    finally { setBusy(false) }
  }
  const checkUpdates = async () => {
    setChecking(true)
    try {
      if (!window.electronAPI?.updates) throw new Error('Update checks are available in the desktop app.')
      const result = await window.electronAPI.updates.check()
      if (!result.success) throw new Error(result.error || 'Could not check for updates.')
      if (result.updateInfo) setManualUpdateInfo(result.updateInfo)
      else toast.success('Your wallet is up to date.')
    } catch (error) { toast.error(error.message) }
    finally { setChecking(false) }
  }
  return <Box sx={{ maxWidth: 880 }}>
    <Typography variant="h1">Make it yours.</Typography><Typography color="text.secondary" sx={{ mt: 1, mb: 4 }}>A few preferences. Everything you need to feel at home.</Typography>
    <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: '0.1em', fontSize: 11 }}>WALLET & RECOVERY</Typography>
    <Paper sx={{ mt: 1.25, mb: 4, p: 0.75, border: '1px solid', borderColor: 'divider', borderRadius: 3 }}>
      <SettingsLink to="/dashboard/settings/backup" icon={ShieldOutlined} title="Back up & recover" description="Your recovery phrase and backup shares" />
      <SettingsLink to="/recovery/wallet-data" icon={BackupOutlined} title="Wallet data files" description="Export, import, or move your encrypted wallet data" />
      <SettingsLink to="/dashboard/settings/identity" icon={BadgeOutlined} title="Your identity" description="Manage your identity and certificates" />
      <SettingsLink to="/dashboard/settings/trust" icon={DevicesOutlined} title="Trust network" description="Choose who you trust with your identity" />
    </Paper>
    <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: '0.1em', fontSize: 11 }}>PREFERENCES</Typography>
    <Paper sx={{ mt: 1.25, mb: 4, p: 3, border: '1px solid', borderColor: 'divider', borderRadius: 3 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} gap={2} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }} sx={{ mb: 3 }}><Box><Typography variant="body2" fontWeight={600}>Appearance</Typography><Typography variant="caption" color="text.secondary">Set the mood for your wallet.</Typography></Box><ToggleButtonGroup size="small" exclusive value={settings?.theme?.mode || 'system'} onChange={(_, mode) => mode && void save({ theme: { mode } })} disabled={busy} aria-label="Appearance"><ToggleButton value="light" aria-label="Light appearance"><LightModeOutlined sx={{ fontSize: 18, mr: 0.75 }} />Light</ToggleButton><ToggleButton value="dark" aria-label="Dark appearance"><DarkModeOutlined sx={{ fontSize: 18, mr: 0.75 }} />Dark</ToggleButton><ToggleButton value="system" aria-label="System appearance">System</ToggleButton></ToggleButtonGroup></Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} gap={2} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} sx={{ mb: 3 }}><Box><Typography variant="body2" fontWeight={600}>Display currency</Typography><Typography variant="caption" color="text.secondary">Your balance, in the unit you prefer.</Typography></Box><TextField select size="small" label="Currency" sx={{ minWidth: 210 }} value={settings?.currency || 'BSV'} onChange={event => void save({ currency: event.target.value })} disabled={busy}>{['BSV', 'SATS', 'USD', 'EUR', 'GBP'].map(currency => <MenuItem key={currency} value={currency}>{currency === 'SATS' ? 'Satoshis' : currency}</MenuItem>)}</TextField></Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} gap={2} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }}><Box><Typography variant="body2" fontWeight={600}>Language</Typography><Typography variant="caption" color="text.secondary">Feel right at home.</Typography></Box><TextField select size="small" label="Language" sx={{ minWidth: 210 }} value={currentLanguage} onChange={event => setCurrentLanguage(event.target.value)}>{supportedLanguages.map(language => <MenuItem key={language} value={language}>{languageNames[language] || language}</MenuItem>)}</TextField></Stack>
    </Paper>
    <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: '0.1em', fontSize: 11 }}>NETWORK & CONNECTIONS</Typography>
    <Paper sx={{ mt: 1.25, mb: 4, p: 0.75, border: '1px solid', borderColor: 'divider', borderRadius: 3 }}>
      <Button sx={row} onClick={() => window.dispatchEvent(new CustomEvent('open-network-settings'))}><PublicOutlined sx={{ color: 'text.secondary' }} /><Box sx={{ flex: 1 }}><Typography variant="body2" fontWeight={600}>BSV network</Typography><Typography variant="caption" color="text.secondary">{networks[chain] || chain} · Switch networks and configure wallet services</Typography></Box><ArrowForwardRounded sx={{ fontSize: 18, color: 'text.secondary' }} /></Button>
      <SettingsLink to="/dashboard/settings/advanced" icon={TuneRounded} title="Advanced settings" description={`Fees, storage, payment inbox, and permissions · ${useRemoteStorage ? 'Remote storage' : 'Stored on this device'}`} />
    </Paper>
    <Stack direction="row" justifyContent="space-between" alignItems="center"><Typography variant="caption" color="text.secondary">BSV Desktop · {appVersion}</Typography><Button size="small" onClick={() => void checkUpdates()} disabled={checking}>{checking ? 'Checking…' : 'Check for updates'}</Button></Stack>
  </Box>
}
