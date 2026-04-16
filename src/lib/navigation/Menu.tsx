import { useTranslation } from 'react-i18next'
import {
  Apps as BrowseIcon,
  Settings as SettingsIcon,
  Badge as IdentityIcon,
  ExitToApp as LogoutIcon,
  Security as SecurityIcon,
  Add as AddIcon,
  Delete as DeleteIcon,
  ExpandLess,
  ExpandMore,
  Person as PersonIcon,
  AccountBalanceWallet as PaymentsIcon,
} from '@mui/icons-material'
import SyncAltIcon from '@mui/icons-material/SyncAlt';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser'
import GridViewIcon from '@mui/icons-material/GridView'
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong'
import QrCodeIcon from '@mui/icons-material/QrCode'
import {
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
  Drawer,
  Box,
  Divider,
  Collapse,
  Button,
  IconButton,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  TextField,
  alpha,
  LinearProgress,
  Checkbox,
  FormControlLabel
} from '@mui/material'
import Profile from '../components/Profile.js'
import React, { useState, useContext, useEffect, useCallback } from 'react'
import { toast } from 'react-toastify'
import { useHistory } from 'react-router'
import { WalletContext, LoginType } from '../WalletContext.js'
import { UserContext } from '../UserContext.js'
import { useBreakpoint } from '../utils/useBreakpoints.js'
import { Utils, PushDrop, LockingScript, Transaction } from '@bsv/sdk'
import { WalletProfile } from '../types/WalletProfile.js';
// Custom styling for menu items
const menuItemStyle = (isSelected) => ({
  borderRadius: '8px',
  margin: '4px 8px',
  transition: 'all 0.2s ease',
  '&:hover': {
    backgroundColor: 'rgba(25, 118, 210, 0.1)',
  },
  ...(isSelected && {
    backgroundColor: 'rgba(25, 118, 210, 0.12)',
    '&:hover': {
      backgroundColor: 'rgba(25, 118, 210, 0.2)',
    },
  }),
})

interface MenuProps {
  menuOpen: boolean
  setMenuOpen: (open: boolean) => void
  menuRef: React.RefObject<HTMLDivElement>
}


export default function Menu({ menuOpen, setMenuOpen, menuRef }: MenuProps) {
  const { t } = useTranslation()
  const history = useHistory()
  const breakpoints = useBreakpoint()
  const { logout, managers, activeProfile, setActiveProfile, saveEnhancedSnapshot, loginType } = useContext(WalletContext)
  const isDirectKey = loginType === 'direct-key'
  const { appName, appVersion } = useContext(UserContext)

  // Profile management state
  const [profilesOpen, setProfilesOpen] = useState(false)
  const [profiles, setProfiles] = useState<WalletProfile[]>([])
  const [createProfileOpen, setCreateProfileOpen] = useState(false)
  const [newProfileName, setNewProfileName] = useState('')
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [profileToDelete, setProfileToDelete] = useState<WalletProfile>(null)
  const [profilesLoading, setProfilesLoading] = useState(false)
  const [fund, setFund] = useState<boolean>(false)


  // History.push wrapper
  const navigation = {
    push: (path: string) => {
      // Explicitly cast breakpoints to avoid TypeScript error
      const { sm } = breakpoints as { sm: boolean }
      if (sm) {
        setMenuOpen(false)
      }
      history.push(path)
    }
  }

  // First useEffect to handle breakpoint changes
  useEffect(() => {
    // Explicitly cast breakpoints to avoid TypeScript error
    const { sm } = breakpoints as { sm: boolean }
    if (!sm) {
      setMenuOpen(true)
    } else {
      setMenuOpen(false)
    }
  }, [breakpoints])

  //get Most Recent Profile Key
  const getMRPK = async () => {
    const listprofiles = await managers.walletManager.listProfiles()
    const mostRecent = listprofiles.reduce((a, b) => (a.createdAt > b.createdAt ? a : b))
    return mostRecent.identityKey
  }

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      if (!managers?.walletManager || !activeProfile?.name) return
      const cacheKey = `funds_${activeProfile.name}`
      const cached = localStorage.getItem(cacheKey)
      if (!cached) return
      try {
        const funding: {
          txid: string
          outpoint: string
          satoshis: number
          lockingScript: string
          tx: Transaction,
          beef: number[],
          sender: string
        } = JSON.parse(cached)

        const { signableTransaction } = await managers.walletManager.createAction({
          description: 'claiming funds',
          inputBEEF: funding.beef,
          inputs: [{
            inputDescription: 'Claim funds',
            outpoint: funding.outpoint,
            unlockingScriptLength: 74
          }],
          options: {
            acceptDelayedBroadcast: false,
            randomizeOutputs: false
          }
        })

        if (!signableTransaction) {
          throw new Error('No signable transaction returned')
        }

        const tx = Transaction.fromBEEF(signableTransaction.tx!)


        const unlocker = new PushDrop(managers.walletManager).unlock(
          [0, 'fundingprofile'],
          '1',
          funding.sender,
          'all',
          false,
          5000,
          LockingScript.fromHex(funding.lockingScript)
        )

        let unlockingScript = await unlocker.sign(tx, 0)
        let reference = signableTransaction.reference
        const signRes = await managers.walletManager.signAction({
          reference,
          spends: {
            0: {
              unlockingScript: unlockingScript.toHex()
            }
          }
        })
        localStorage.removeItem(cacheKey)
      } catch (err) {
        if (!cancelled) console.error(' Claim failed', err)
      }
    }

    void run()
    return () => { cancelled = true }
  }, [activeProfile?.name, managers?.walletManager])

  // Second useEffect to handle outside clicks
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }

    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    } else {
      document.removeEventListener('mousedown', handleClickOutside)
    }

    // Cleanup
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [menuOpen])

  const createTokenFor = async(profile: string, amount:number) =>
  {
    if(amount < 0)
    {
      return
    }
    const cacheKey = `funds_${newProfileName.trim()}`
    const pd = new PushDrop(managers.walletManager)
    const fields = [Utils.toArray(`Funding Wallet: ${newProfileName.trim()}`)]
    const counterparty = profile
    const sender = activeProfile.identityKey
    const lockingScript = await pd.lock(
      fields,
      [0, 'fundingprofile'],
      '1',
      counterparty
    )

    const createRes = await managers.walletManager.createAction({
      description: 'funding new profile',
      outputs: [{
        lockingScript: lockingScript.toHex(),
        satoshis: amount,
        outputDescription: 'New profile funds',
      }],
      options: {
        randomizeOutputs: false,
        acceptDelayedBroadcast: false
      }
    }, 'Metanet-Desktop')

    const beef = createRes.tx!
    const tx = Transaction.fromAtomicBEEF(createRes.tx!)
    const outpoint = `${createRes.txid}.0`
    const txid = tx.id('hex')
    const satoshis = tx.outputs[0].satoshis

    localStorage.setItem(cacheKey, JSON.stringify({
      txid,
      tx,
      outpoint,
      satoshis,
      lockingScript: lockingScript.toHex(),
      beef,
      sender: sender
    }))
  }

  // Helper function to refresh profiles
  const refreshProfiles = useCallback(async () => {
    if (!managers?.walletManager || !managers.walletManager?.listProfiles) return

    try {
      setProfilesLoading(true)
      // Handle both synchronous and asynchronous listProfiles implementation
      if (managers.walletManager.saveSnapshot) {
        localStorage.snap = saveEnhancedSnapshot()
      }
      const profileList = await Promise.resolve(managers.walletManager?.listProfiles())
      setProfiles(profileList)
    } catch (error) {
      toast.error(`Error loading profiles: ${error.message || error}`)
    } finally {
      setProfilesLoading(false)
    }
  }, [managers?.walletManager, saveEnhancedSnapshot])

  // Handle profile creation
  const handleCreateProfile = async () => {
    if (!newProfileName.trim() || !managers?.walletManager) return

    try {
      // Close dialog first before async operation
      setCreateProfileOpen(false)
      setNewProfileName('')

      setProfilesLoading(true)

      // Then perform the async operation
      await managers.walletManager.addProfile(newProfileName.trim())

      // Then fund the new profile
      if (fund) {
          createTokenFor(await getMRPK(), 5000)
      }

      // Refresh the profile list
      await refreshProfiles()
    } catch (error) {
      toast.error(`Error creating profile: ${error.message || error}`)
      setProfilesLoading(false)
    }
    finally{
      setFund(false)
    }
  }

  // Handle profile switching
  const handleSwitchProfile = async (profileId: number[]) => {
    if (!managers?.walletManager) return

    try {
      // Show loading state
      setProfilesLoading(true)

      // Perform the async operation
      await managers.walletManager.switchProfile(profileId)
      setActiveProfile(profiles.find(profile => profile.id == profileId))

      // Refresh the profile list to update active status
      if (history.location.pathname.startsWith('/dashboard/app/')) {
        history.push('/dashboard/apps')
      }
      await refreshProfiles()
    } catch (error) {
      toast.error(`Error switching profile: ${error.message || error}`)
      setProfilesLoading(false)
    }
  }

  // Handle profile deletion
  const confirmDeleteProfile = (profile: WalletProfile) => {
    setProfileToDelete(profile)
    setDeleteConfirmOpen(true)
  }


  const handleDeleteProfile = async () => {
    if (!profileToDelete || !managers?.walletManager) return

    try {
      setDeleteConfirmOpen(false)
      setProfilesLoading(true)

      await managers.walletManager.deleteProfile(profileToDelete.id)

      // Cleanup & refresh
      setProfileToDelete(null)
      await refreshProfiles()
    } catch (error: any) {
      toast.error(`Error deleting profile: ${error.message || error}`)
      setProfilesLoading(false)
    }
  }

  // Render formatted profile ID (first 8 chars)
  const formatProfileId = (id: number[]) => {
    // Check if it's the default profile
    if (id.every(x => x === 0)) {
      return 'Default'
    }

    // Convert to hex and show first 8 characters
    return id.slice(0, 4).map(byte => byte.toString(16).padStart(2, '0')).join('')
  }

  // Load profiles when wallet is initialized
  useEffect(() => {
    refreshProfiles()
  }, [refreshProfiles])

  return (
    <Drawer
      anchor='left'
      open={menuOpen}
      variant='persistent'
      onClose={() => setMenuOpen(false)}
      sx={{
        width: 320,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width: 320,
          boxSizing: 'border-box',
          borderRight: '1px solid',
          borderColor: 'divider',
          boxShadow: 3,
          background: 'background.paper',
          overflowX: 'hidden',
        },
      }}
    >
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          p: 2
        }}
      >
        <Box sx={{ mb: 3, display: 'flex', justifyContent: 'center' }}>
          <Profile />
        </Box>

        <Divider sx={{ mb: 2 }} />

        {/* Profile Management Section - hidden in direct-key mode */}
        {!isDirectKey && (
          <>
            <List component="nav" sx={{ mb: 1 }}>
              <ListItemButton onClick={() => setProfilesOpen(!profilesOpen)} sx={menuItemStyle(false)}>
                <ListItemIcon sx={{ minWidth: 40 }}>
                  <PersonIcon />
                </ListItemIcon>
                <ListItemText
                  primary={
                    <Typography variant="body1">
                      {t('menu_profiles')}
                    </Typography>
                  }
                  secondary={
                    !profilesOpen && profiles.length > 0
                      ? `${t('menu_profiles_active')}: ${profiles.find(p => p.active)?.name || t('menu_profiles_default')}`
                      : undefined
                  }
                />
                {profilesOpen ? <ExpandLess /> : <ExpandMore />}
              </ListItemButton>

              {/* Profile loading indicator */}
              {profilesLoading && (
                <LinearProgress
                  sx={{
                    height: 2,
                    mt: -0.5,
                    mb: 0.5,
                    borderRadius: 1,
                    mx: 1
                  }}
                />
              )}

              <Collapse in={profilesOpen} timeout="auto" unmountOnExit>
                <List disablePadding sx={{ mt: 0.5 }}>
                  {profiles.map((profile) => (
                    <ListItemButton
                      key={formatProfileId(profile.id)}
                      onClick={!profile.active ? () => handleSwitchProfile(profile.id) : undefined}
                      disableRipple={profile.active}
                      sx={{
                        borderRadius: '8px',
                        mx: 1,
                        mb: 0.5,
                        py: 0.75,
                        pl: 1.5,
                        pr: 1,
                        borderLeft: 'none',
                        backgroundColor: profile.active ? alpha('#1976d2', 0.08) : 'transparent',
                        cursor: profile.active ? 'default' : 'pointer',
                        '&:hover': {
                          backgroundColor: profile.active ? alpha('#1976d2', 0.08) : alpha('#1976d2', 0.06),
                        },
                        '&:hover .profile-delete': {
                          opacity: 1,
                        },
                      }}
                    >
                      {/* Avatar circle with initial */}
                      <Box
                        sx={{
                          width: 32,
                          height: 32,
                          borderRadius: '50%',
                          backgroundColor: profile.active ? 'primary.main' : alpha('#fff', 0.08),
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          mr: 1.5,
                          flexShrink: 0,
                        }}
                      >
                        <Typography
                          variant="caption"
                          sx={{
                            fontWeight: 600,
                            fontSize: '0.8rem',
                            color: profile.active ? '#fff' : 'text.secondary',
                            textTransform: 'uppercase',
                          }}
                        >
                          {profile.name?.charAt(0) || '?'}
                        </Typography>
                      </Box>

                      {/* Name + truncated key */}
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography
                          variant="body2"
                          sx={{
                            fontWeight: profile.active ? 600 : 400,
                            lineHeight: 1.3,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {profile.name}
                        </Typography>
                        <Typography
                          variant="caption"
                          sx={{
                            color: 'text.disabled',
                            fontFamily: 'monospace',
                            fontSize: '0.65rem',
                            letterSpacing: '0.02em',
                          }}
                        >
                          {profile?.identityKey?.slice(0, 12)}...
                        </Typography>
                      </Box>

                      {/* Active dot or delete button */}
                      {profile.active ? (
                        <Box
                          sx={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            backgroundColor: 'primary.main',
                            ml: 1,
                            flexShrink: 0,
                          }}
                        />
                      ) : !profile.id.every(x => x === 0) ? (
                        <IconButton
                          className="profile-delete"
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation()
                            confirmDeleteProfile(profile)
                          }}
                          sx={{
                            opacity: 0,
                            transition: 'opacity 0.15s',
                            color: 'text.disabled',
                            p: 0.5,
                            ml: 0.5,
                            '&:hover': {
                              color: 'error.main',
                              backgroundColor: alpha('#f44336', 0.08),
                            },
                          }}
                        >
                          <DeleteIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                      ) : null}
                    </ListItemButton>
                  ))}

                  {/* Add profile row */}
                  <ListItemButton
                    onClick={() => setCreateProfileOpen(true)}
                    sx={{
                      borderRadius: '8px',
                      mx: 1,
                      mt: 0.5,
                      py: 0.75,
                      pl: 1.5,
                      opacity: 0.6,
                      '&:hover': {
                        opacity: 1,
                        backgroundColor: alpha('#1976d2', 0.06),
                      },
                    }}
                  >
                    <Box
                      sx={{
                        width: 32,
                        height: 32,
                        borderRadius: '50%',
                        border: '1.5px dashed',
                        borderColor: 'text.disabled',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        mr: 1.5,
                        flexShrink: 0,
                      }}
                    >
                      <AddIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
                    </Box>
                    <Typography variant="body2" color="text.secondary">
                      {t('menu_new_profile')}
                    </Typography>
                  </ListItemButton>
                </List>
              </Collapse>
            </List>

            <Divider sx={{ mb: 2 }} />
          </>
        )}

        <List component="nav" sx={{ mb: 2 }}>
          <ListItemButton
            onClick={() => navigation.push('/dashboard/app-catalog')}
            selected={history.location.pathname === '/dashboard/app-catalog'}
            sx={menuItemStyle(history.location.pathname === '/dashboard/app-catalog')}
          >
            <ListItemIcon sx={{ minWidth: 40, color: history.location.pathname === '/dashboard/app-catalog' ? 'primary.main' : 'inherit' }}>
              <GridViewIcon />
            </ListItemIcon>
            <ListItemText
              primary={
                <Typography
                  variant="body1"
                  fontWeight={history.location.pathname === '/dashboard/app-catalog' ? 600 : 400}
                >
                  {t('menu_apps')}
                </Typography>
              }
            />
          </ListItemButton>

          <ListItemButton
            onClick={() => navigation.push('/dashboard/apps')}
            selected={history.location.pathname === '/dashboard/apps'}
            sx={menuItemStyle(history.location.pathname === '/dashboard/apps')}
          >
            <ListItemIcon sx={{ minWidth: 40, color: history.location.pathname === '/dashboard/apps' ? 'primary.main' : 'inherit' }}>
              <ReceiptLongIcon />
            </ListItemIcon>
            <ListItemText
              primary={
                <Typography
                  variant="body1"
                  fontWeight={history.location.pathname === '/dashboard/apps' ? 600 : 400}
                >
                  {t('menu_transactions')}
                </Typography>
              }
            />
          </ListItemButton>

          <ListItemButton
            onClick={() => navigation.push('/dashboard/identity')}
            selected={history.location.pathname === '/dashboard/identity'}
            sx={menuItemStyle(history.location.pathname === '/dashboard/identity')}
          >
            <ListItemIcon sx={{ minWidth: 40, color: history.location.pathname === '/dashboard/identity' ? 'primary.main' : 'inherit' }}>
              <IdentityIcon />
            </ListItemIcon>
            <ListItemText
              primary={
                <Typography
                  variant="body1"
                  fontWeight={history.location.pathname === '/dashboard/identity' ? 600 : 400}
                >
                  {t('menu_identity')}
                </Typography>
              }
            />
          </ListItemButton>

          <ListItemButton
            onClick={() => navigation.push('/dashboard/trust')}
            selected={history.location.pathname === '/dashboard/trust'}
            sx={menuItemStyle(history.location.pathname === '/dashboard/trust')}
          >
            <ListItemIcon sx={{ minWidth: 40, color: history.location.pathname === '/dashboard/trust' ? 'primary.main' : 'inherit' }}>
              <VerifiedUserIcon />
            </ListItemIcon>
            <ListItemText
              primary={
                <Typography
                  variant="body1"
                  fontWeight={history.location.pathname === '/dashboard/trust' ? 600 : 400}
                >
                  {t('menu_trust')}
                </Typography>
              }
            />
          </ListItemButton>

          <ListItemButton
            onClick={() => navigation.push('/dashboard/security')}
            selected={history.location.pathname === '/dashboard/security'}
            sx={menuItemStyle(history.location.pathname === '/dashboard/security')}
          >
            <ListItemIcon sx={{ minWidth: 40, color: history.location.pathname === '/dashboard/security' ? 'primary.main' : 'inherit' }}>
              <SecurityIcon />
            </ListItemIcon>
            <ListItemText
              primary={
                <Typography
                  variant="body1"
                  fontWeight={history.location.pathname === '/dashboard/security' ? 600 : 400}
                >
                  {t('menu_security')}
                </Typography>
              }
            />
          </ListItemButton>

          <ListItemButton
            onClick={() => navigation.push('/dashboard/settings')}
            selected={history.location.pathname === '/dashboard/settings'}
            sx={menuItemStyle(history.location.pathname === '/dashboard/settings')}
          >
            <ListItemIcon sx={{ minWidth: 40, color: history.location.pathname === '/dashboard/settings' ? 'primary.main' : 'inherit' }}>
              <SettingsIcon />
            </ListItemIcon>
            <ListItemText
              primary={
                <Typography
                  variant="body1"
                  fontWeight={history.location.pathname === '/dashboard/settings' ? 600 : 400}
                >
                  {t('menu_settings')}
                </Typography>
              }
            />
          </ListItemButton>

          <ListItemButton
            onClick={() => navigation.push('/dashboard/payments')}
            selected={history.location.pathname === '/dashboard/payments'}
            sx={menuItemStyle(history.location.pathname === '/dashboard/payments')}
          >
            <ListItemIcon sx={{ minWidth: 40, color: history.location.pathname === '/dashboard/payments' ? 'primary.main' : 'inherit' }}>
              <SyncAltIcon />
            </ListItemIcon>
            <ListItemText
              primary={
                <Typography
                  variant="body1"
                  fontWeight={history.location.pathname === '/dashboard/payments' ? 600 : 400}
                >
                  {t('menu_payments')}
                </Typography>
              }
            />
          </ListItemButton>

          <ListItemButton
            onClick={() => navigation.push('/dashboard/legacybridge')}
            selected={history.location.pathname === '/dashboard/legacybridge'}
            sx={menuItemStyle(history.location.pathname === '/dashboard/legacybridge')}
          >
            <ListItemIcon sx={{ minWidth: 40, color: history.location.pathname === '/dashboard/legacybridge' ? 'primary.main' : 'inherit' }}>
              <QrCodeIcon />
            </ListItemIcon>
            <ListItemText
              primary={
                <Typography
                  variant="body1"
                  fontWeight={history.location.pathname === '/dashboard/legacybridge' ? 600 : 400}
                >
                  {t('menu_legacy_bridge')}
                </Typography>
              }
            />
          </ListItemButton>
        </List>


        <Box sx={{ mt: 'auto', mb: 2 }}>
          <ListItemButton
            onClick={() => {
              logout()
              history.push('/')
            }}
            sx={menuItemStyle(false)}
          >
            <ListItemIcon sx={{ minWidth: 40 }}>
              <LogoutIcon />
            </ListItemIcon>
            <ListItemText
              primary={
                <Typography variant="body1">
                  {t('menu_logout')}
                </Typography>
              }
            />
          </ListItemButton>

          <Typography
            variant='caption'
            color='textSecondary'
            align='center'
            sx={{
              display: 'block',
              mt: 2,
              textAlign: 'center',
              width: '100%',
              opacity: 0.5,
            }}
          >
            {appName} v{appVersion}
            <br />
            <i>{t('menu_footer_tagline')}</i>
          </Typography>
        </Box>
      </Box>


      {/* Create Profile Dialog */}
      <Dialog open={createProfileOpen} onClose={() => setCreateProfileOpen(false)}>
        <DialogTitle>{t('menu_create_profile_title')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('menu_create_profile_description')}
          </DialogContentText>

          <TextField
            autoFocus
            margin="dense"
            label={t('menu_profile_name_label')}
            type="text"
            fullWidth
            value={newProfileName}
            onChange={(e) => setNewProfileName(e.target.value)}
          />

          <FormControlLabel
            control={
              <Checkbox
                checked={fund}
                onChange={(e) => setFund(e.target.checked)}
                value='on'
              />
            }
            label={t('menu_auto_fund_label')}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateProfileOpen(false)}>{t('menu_cancel')}</Button>
          <Button
            onClick={() => handleCreateProfile()}
            color="primary"
          >
            {t('menu_create')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
    <Dialog open={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)}>
      <DialogTitle>{t('menu_delete_profile_title')}</DialogTitle>

      <DialogContent>
        <DialogContentText
          sx={{
            textAlign: 'center',
            '& strong': { color: 'error.main' },
            wordBreak: 'break-word',
          }}
        >
          <strong>{t('menu_delete_permanent')}</strong><br />
          {t('menu_delete_warning')}<br />
          {t('menu_delete_confirm', { name: profileToDelete?.name?.slice(0, 10), key: profileToDelete?.identityKey?.slice(0, 10) })}<br />
          {t('menu_delete_undone')}
        </DialogContentText>

        {/* Center the checkbox + label */}
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
          <FormControlLabel
            control={
            <ListItemButton
            onClick={() => {navigation.push('/dashboard/payments')
              setDeleteConfirmOpen(false)
            }}
            selected={history.location.pathname === '/dashboard/payments'}
            sx={menuItemStyle(history.location.pathname === '/dashboard/payments')}
          >
            <ListItemIcon sx={{ minWidth: 40, color: history.location.pathname === '/dashboard/payments' ? 'primary.main' : 'inherit' }}>
              <SyncAltIcon />
            </ListItemIcon>
            <ListItemText
              primary={
                <Typography
                  variant="body1"
                  fontWeight={history.location.pathname === '/dashboard/payments' ? 600 : 400}
                >
                  {t('menu_transfer')}
                </Typography>
              }
            />
          </ListItemButton>
            }
            label={t('menu_transfer_funds_label')}
            sx={{ '& .MuiFormControlLabel-label': { textAlign: 'center' } }}
          />
        </Box>
        
      </DialogContent>

      <DialogActions>
        <Button onClick={() => setDeleteConfirmOpen(false)}>{t('menu_cancel')}</Button>
        <Button onClick={handleDeleteProfile} color="error">{t('menu_delete')}</Button>
      </DialogActions>
    </Dialog>
    </Drawer>
  )
}