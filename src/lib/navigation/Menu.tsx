import React, { useContext, useEffect, useState } from 'react'
import { NavLink, useHistory } from 'react-router-dom'
import { AccountBalanceWalletOutlined, SwapHorizRounded, ReceiptLongOutlined, AppsRounded, SettingsOutlined, UnfoldMoreRounded, AddRounded, CheckRounded, LogoutRounded, CloseRounded } from '@mui/icons-material'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Drawer, IconButton, List, ListItemButton, ListItemIcon, ListItemText, TextField, Typography, alpha, useMediaQuery } from '@mui/material'
import { toast } from 'react-toastify'
import { WalletContext } from '../WalletContext'
import { UserContext } from '../UserContext'
import AppLogo from '../components/AppLogo'
import type { WalletProfile } from '../types/WalletProfile'
import * as secrets from '../services/secrets'
import { getWalletService } from '../hooks/useWalletService'
import RemoveWalletDialog from '../components/RemoveWalletDialog'
import { activeUserWalletOperations, activeHttpBridgeRequests, beginUserWalletOperation, isHttpBridgePaused, setHttpBridgePaused } from '../services/httpBridgeSession'

export const SIDEBAR_WIDTH = 248
const items = [
  { label: 'Wallet', path: '/dashboard', icon: AccountBalanceWalletOutlined, exact: true },
  { label: 'Payments', path: '/dashboard/payments', icon: SwapHorizRounded },
  { label: 'Activity', path: '/dashboard/activity', icon: ReceiptLongOutlined },
  { label: 'Apps', path: '/dashboard/apps', icon: AppsRounded },
  { label: 'Settings', path: '/dashboard/settings', icon: SettingsOutlined },
]

export default function Menu({ menuOpen, setMenuOpen }: { menuOpen: boolean; setMenuOpen: (open: boolean) => void; menuRef?: React.RefObject<HTMLDivElement> }) {
  const compact = useMediaQuery('(max-width:900px)')
  const history = useHistory()
  const { activeProfile, loginType, managers, saveEnhancedSnapshot, setActiveProfile, switchingNetwork, basketRequests, protocolRequests, certificateRequests, spendingRequests, groupPermissionRequests, stasTransferRequests, counterpartyPermissionRequests, refreshAppWallet } = useContext(WalletContext)
  const { appVersion } = useContext(UserContext)
  const [profileOpen, setProfileOpen] = useState(false)
  const [profiles, setProfiles] = useState<WalletProfile[]>([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [removeOpen, setRemoveOpen] = useState(false)
  const supportsProfiles = typeof managers.walletManager?.listProfiles === 'function'

  useEffect(() => {
    if (!profileOpen) return
    let cancelled = false
    Promise.resolve(supportsProfiles ? managers.walletManager.listProfiles() : activeProfile ? [activeProfile] : []).then(result => {
      if (!cancelled) setProfiles(result || [])
    }).catch(error => toast.error(error.message))
    return () => { cancelled = true }
  }, [profileOpen, managers.walletManager, activeProfile, supportsProfiles])

  const assertIdle = () => {
    if (isHttpBridgePaused() || switchingNetwork || activeUserWalletOperations() || activeHttpBridgeRequests() || [basketRequests, protocolRequests, certificateRequests, spendingRequests, groupPermissionRequests, stasTransferRequests, counterpartyPermissionRequests].some(queue => queue.length)) throw new Error('Finish your current payment or app request before changing or locking the wallet.')
  }
  const switchProfile = async (profile: WalletProfile) => {
    setBusy(true)
    let release: (() => void) | undefined
    let bridgeReady = false
    let profileVerified = false
    try {
      assertIdle()
      release = beginUserWalletOperation()
      setHttpBridgePaused(true)
      await managers.walletManager.switchProfile(profile.id)
      const current = getWalletService().getSnapshot()
      if (!current.wallet || current.lifecycle !== 'ready' || !current.managers.permissionsManager) throw new Error('This profile could not be opened. Reopen your saved wallet to try again.')
      const { publicKey } = await current.managers.permissionsManager.getPublicKey({ identityKey: true }, current.adminOriginator)
      if (publicKey !== profile.identityKey) throw new Error('The selected profile identity could not be verified. App connections remain paused.')
      profileVerified = true
      setActiveProfile(profile)
      await secrets.persistSnapshot(saveEnhancedSnapshot())
      await refreshAppWallet()
      bridgeReady = true
      setProfileOpen(false)
      history.push('/dashboard')
      window.dispatchEvent(new Event('balance-changed'))
    } catch (error) {
      // A phrase wallet reopens the previous profile after a failed switch; reconnect apps to it.
      if (release && (profileVerified || getWalletService().getSnapshot().lifecycle === 'ready')) {
        try { await refreshAppWallet(); bridgeReady = true }
        catch { toast.error('App connections are paused. Reopen the wallet to reconnect safely.') }
      }
      toast.error(error.message || 'Could not switch profiles.')
    }
    finally { if (release) { if (bridgeReady) setHttpBridgePaused(false); release() }; setBusy(false) }
  }
  const createProfile = async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    let release: (() => void) | undefined
    let bridgeReady = false
    try {
      assertIdle()
      release = beginUserWalletOperation()
      setHttpBridgePaused(true)
      await managers.walletManager.addProfile(name.trim())
      await secrets.persistSnapshot(saveEnhancedSnapshot())
      await refreshAppWallet()
      bridgeReady = true
      setProfiles(await managers.walletManager.listProfiles())
      setName('')
    } catch (error) {
      if (release) {
        try { await refreshAppWallet(); bridgeReady = true }
        catch { toast.error('App connections are paused. Reopen the wallet to reconnect safely.') }
      }
      toast.error(error.message || 'Could not create a profile.')
    }
    finally { if (release) { if (bridgeReady) setHttpBridgePaused(false); release() }; setBusy(false) }
  }
  const lockWallet = async () => {
    setBusy(true)
    let release: (() => void) | undefined
    try {
      assertIdle()
      release = beginUserWalletOperation()
      setHttpBridgePaused(true)
      await secrets.persistSnapshot(saveEnhancedSnapshot())
      await secrets.lockVault()
      window.location.reload()
    } catch (error) {
      if (release) { setHttpBridgePaused(false); release() }
      toast.error(error.message || 'Could not lock wallet.')
      setBusy(false)
    }
  }

  return <>
    <Drawer open={compact ? menuOpen : true} onClose={() => setMenuOpen(false)} variant={compact ? 'temporary' : 'permanent'} sx={{ width: compact ? 0 : SIDEBAR_WIDTH, flexShrink: 0, '& .MuiDrawer-paper': { width: SIDEBAR_WIDTH, borderRight: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' } }}>
      <Box sx={{ p: 3, pb: 2, display: 'flex', alignItems: 'center', gap: 1.25, height: 96 }}>
        <Box aria-hidden sx={{ width: 38, height: 38, flexShrink: 0, color: 'primary.main', display: 'grid', placeItems: 'center' }}><AppLogo size={38} color="currentColor" /></Box>
        <Box><Typography sx={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.04em', lineHeight: 1.2 }}>BSV Desktop</Typography></Box>
        {compact && <IconButton aria-label="Close navigation" size="small" onClick={() => setMenuOpen(false)} sx={{ ml: 'auto' }}><CloseRounded fontSize="small" /></IconButton>}
      </Box>
      <Typography variant="overline" color="text.secondary" sx={{ px: 3.5, mt: 3, fontSize: 10, letterSpacing: '0.12em' }}>YOUR WALLET</Typography>
      <List sx={{ px: 2, pt: 1 }}>
        {items.map(({ label, path, icon: Icon, exact }) => <ListItemButton key={path} component={NavLink} exact={exact} to={path} activeClassName="wallet-nav-active" onClick={() => setMenuOpen(false)} sx={{ borderRadius: 2.5, my: 0.5, py: 1.25, color: 'text.secondary', '&.wallet-nav-active': { bgcolor: theme => alpha(theme.palette.primary.main, 0.09), color: 'primary.main', '& .MuiListItemIcon-root': { color: 'primary.main' } } }}>
          <ListItemIcon sx={{ minWidth: 38, color: 'inherit' }}><Icon sx={{ fontSize: 21 }} /></ListItemIcon><ListItemText primary={label} primaryTypographyProps={{ fontSize: 14, fontWeight: 550 }} />
        </ListItemButton>)}
      </List>
      <Box sx={{ mt: 'auto', px: 2.5, pb: 2.5 }}>
        <Box sx={{ p: 2, mb: 3, borderRadius: 3, bgcolor: 'background.default' }}>
          <Typography variant="body2" fontWeight={600}>Your keys. Your wallet.</Typography><Typography variant="caption" color="text.secondary">Payments, identity, and apps.<br />Together on your desktop.</Typography>
        </Box>
        <Button fullWidth onClick={() => setProfileOpen(true)} endIcon={<UnfoldMoreRounded />} sx={{ textAlign: 'left', color: 'text.primary', justifyContent: 'space-between', px: 0.75 }}>
          <Box sx={{ display: 'flex', gap: 1.2, alignItems: 'center', minWidth: 0 }}><Box sx={{ width: 32, height: 32, borderRadius: '50%', bgcolor: 'primary.main', color: 'primary.contrastText', display: 'grid', placeItems: 'center', flexShrink: 0 }}>{(activeProfile?.name || 'My wallet')[0].toUpperCase()}</Box><Box sx={{ minWidth: 0 }}><Typography variant="body2" fontWeight={600} noWrap>{activeProfile?.name || 'My wallet'}</Typography><Typography variant="caption" color="text.secondary">Wallet profile</Typography></Box></Box>
        </Button>
        <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 2, px: 0.75 }}>BSV Desktop{appVersion ? ` · ${appVersion}` : ''}</Typography>
      </Box>
    </Drawer>
    <Dialog open={profileOpen} onClose={() => !busy && setProfileOpen(false)} fullWidth maxWidth="xs">
      <DialogTitle>Wallet profiles</DialogTitle><DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{supportsProfiles ? 'Use a separate identity for each part of your life.' : 'Your wallet identity is protected on this device.'}</Typography>
        <List>{profiles.map(profile => <ListItemButton key={profile.id.join(',')} disabled={busy || profile.active} onClick={() => switchProfile(profile)} sx={{ borderRadius: 2 }}><ListItemText primary={profile.name} secondary={`${profile.identityKey?.slice(0, 16)}…`} />{profile.active && <CheckRounded color="primary" />}</ListItemButton>)}</List>
        {supportsProfiles && loginType === 'mnemonic' && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>Every profile comes from your recovery phrase. On a new device, add profiles in the same order to bring them back.</Typography>}
        {supportsProfiles && <Box component="form" onSubmit={event => { event.preventDefault(); void createProfile() }} sx={{ display: 'flex', gap: 1, mt: 2 }}><TextField size="small" label="New profile name" value={name} onChange={event => setName(event.target.value)} fullWidth inputProps={{ maxLength: 60 }} /><IconButton type="submit" aria-label="Create profile" disabled={!name.trim() || busy}><AddRounded /></IconButton></Box>}
      </DialogContent><DialogActions><Button startIcon={<LogoutRounded />} onClick={lockWallet} disabled={busy}>Lock wallet</Button><Button color="error" onClick={() => { setProfileOpen(false); setRemoveOpen(true) }} disabled={busy} sx={{ mr: 'auto' }}>Remove wallet…</Button><Button onClick={() => setProfileOpen(false)} disabled={busy}>Done</Button></DialogActions>
    </Dialog>
    <RemoveWalletDialog open={removeOpen} onClose={() => setRemoveOpen(false)} />
  </>
}
