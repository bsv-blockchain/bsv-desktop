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
} from '@mui/icons-material'
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser'
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
  Card,
  CardContent,
  Button,
  IconButton,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  TextField,
  Grid,
  alpha,
  LinearProgress,
  Select,
  MenuItem,
  InputLabel,
  Checkbox,
  FormControlLabel
} from '@mui/material'
import Profile from '../components/Profile'
import { getAccountBalance } from '../utils/getAccountBalance'
import React, { useState, useContext, useEffect, useCallback, useMemo, useRef } from 'react'
import { toast } from 'react-toastify'
import { useHistory } from 'react-router'
import { WalletContext } from '../WalletContext'
import { UserContext } from '../UserContext'
import { useBreakpoint } from '../utils/useBreakpoints.js'
import { Utils, PushDrop, LockingScript, Transaction, SignableTransaction, SignActionSpend } from '@bsv/sdk'

// Type definition for profile structure from CWIStyleWalletManager
interface Profile {
  id: number[]
  name: string
  createdAt: number | null
  active: boolean
}

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
  const history = useHistory()
  const breakpoints = useBreakpoint()
  const { logout, managers, activeProfile, setActiveProfile } = useContext(WalletContext)
  const { appName, appVersion } = useContext(UserContext)

  // Profile management state
  const [profilesOpen, setProfilesOpen] = useState(false)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [createProfileOpen, setCreateProfileOpen] = useState(false)
  const [newProfileName, setNewProfileName] = useState('')
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [profileToDelete, setProfileToDelete] = useState<number[] | 0>(null)
  const [profilesLoading, setProfilesLoading] = useState(false)
  const [transferTo, setTransferTo] = useState<Profile>(null)
  const [selectedKey, setSelectedKey] = useState<string>("")
  const [amount, setAmount] = useState<number>(0)
  const [fund, setFund] = useState<boolean>(false)
  const balanceAPI = getAccountBalance("default") 
  const balanceRef = useRef<number>(balanceAPI.balance ?? 0)

  useEffect(() => {
    balanceRef.current = balanceAPI.balance ?? 0
  }, [balanceAPI.balance])

  const readBalanceNow = useCallback(() => balanceRef.current, [])
  const refreshBalanceNow = balanceAPI.refresh // usually a function
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
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * Switch to profile, refresh balance, read it (via callbacks), then switch back.
 * No hooks inside.
 */
async function getBalanceForProfileThenBack(
  profileId: number[],
  readBalance: () => number,
  refreshBalance?: () => Promise<any> | void,
  timeoutMs = 2000,
  pollEveryMs = 100
): Promise<number> {
  const profiles = await managers.walletManager.listProfiles()
  const current = profiles.find(p => p.active)
  if (!current?.id) throw new Error("No active profile to switch back to.")

  const alreadyOnTarget =
    Array.isArray(current.id) &&
    Array.isArray(profileId) &&
    current.id.length === profileId.length &&
    current.id.every((v: number, i: number) => v === profileId[i])

  if (alreadyOnTarget) {
    await Promise.resolve(refreshBalance?.())
    const start = Date.now()
    let last = readBalance()
    while (Date.now() - start < timeoutMs) {
      const v = readBalance()
      if (v !== last) return v
      await sleep(pollEveryMs)
    }
    return readBalance()
  }

  await managers.walletManager.switchProfile(profileId)
  try {
    await Promise.resolve(refreshBalance?.())

    const start = Date.now()
    let last = readBalance()

    while (Date.now() - start < timeoutMs) {
      const v = readBalance()
      if (v !== last) return v
      last = v
      await sleep(pollEveryMs)
    }
    return readBalance()
  } finally {
    await managers.walletManager.switchProfile(current.id)
    Promise.resolve(refreshBalance?.()).catch(() => {})
  }
}

const idsEqual = (a: number[] = [], b: number[] = []) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

// Helper: get identity public key (MRPK) for a given profile ID
const getPKey = async (profileId: number[]) => {
  const profiles = await managers.walletManager.listProfiles();
  const current = profiles.find(p => p.active);

  if (!current?.id) throw new Error("No active profile.");

  if (!idsEqual(current.id, profileId)) {
    await managers.walletManager.switchProfile(profileId);
  }

  try {
    const pkey = await managers.walletManager.getPublicKey(
      { identityKey: true },
      "Metanet-Desktop"
    );
    return pkey.publicKey as string;
  } finally {
    if (!idsEqual(current.id, profileId)) {
      await managers.walletManager.switchProfile(current.id);
    }
  }
};




  //get Most Recent Profile Key
  const getMRPK = async () =>{
    const listprofiles = await managers.walletManager.listProfiles()
    const mostRecent = listprofiles.reduce((a, b) => (a.createdAt > b.createdAt ? a : b))
    const lastProfileId: number[] = mostRecent.id
    await managers.walletManager.switchProfile(lastProfileId)
    const pkey = await managers.walletManager.getPublicKey({ identityKey: true }, 'Metanet-Desktop')
    await managers.walletManager.switchProfile(activeProfile.id)
    return pkey.publicKey
  }

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      if (!managers?.walletManager || !activeProfile?.name) return
      console.log('I am trying to fund')
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

        const {signableTransaction} = await managers.walletManager.createAction({
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
        const counterparty = (await managers.walletManager.getPublicKey({ identityKey: true }, 'Metanet-Desktop')).publicKey
        console.log('REDEEM the counterparty for this token is:', counterparty
        ,'the current wallet is', funding.sender
      )
        
        const unlocker = new PushDrop(managers.walletManager).unlock(
          [0, 'fundingprofile'],
          '1',
          funding.sender,
          'all',
          false,
          1000,
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
        console.log('✅ Claimed profile funding for', activeProfile.name)
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

  // Helper function to refresh profiles
  const refreshProfiles = useCallback(async () => {
    if (!managers?.walletManager || !managers.walletManager?.listProfiles) return

    try {
      setProfilesLoading(true)
      // Handle both synchronous and asynchronous listProfiles implementation
      if (managers.walletManager.saveSnapshot) {
        localStorage.snap = Utils.toBase64(managers.walletManager.saveSnapshot())
      }
      const profileList = await Promise.resolve(managers.walletManager?.listProfiles())
      setProfiles(profileList)
    } catch (error) {
      toast.error(`Error loading profiles: ${error.message || error}`)
    } finally {
      setProfilesLoading(false)
    }
  }, [managers?.walletManager])

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
      const cacheKey = `funds_${newProfileName.trim()}`

      const pd = new PushDrop(managers.walletManager)
      const fields = [ Utils.toArray(`Funding Wallet: ${newProfileName.trim()}`) ]
      const counterparty = await getMRPK()
      const sender = await managers.walletManager.getPublicKey({ identityKey: true }, 'Metanet-Desktop')
      console.log('the counterparty for this token is:', counterparty
        ,'the current wallet is', sender.publicKey
      )
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
          satoshis: 1000,
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
        sender: sender.publicKey
      }))
    }

      // Refresh the profile list
      await refreshProfiles()     
    } catch (error) {
      toast.error(`Error creating profile: ${error.message || error}`)
      setProfilesLoading(false)
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
      if( history.location.pathname.startsWith('/dashboard/app/')){
        history.push('/dashboard/apps')
      }
      await refreshProfiles()
    } catch (error) {
      toast.error(`Error switching profile: ${error.message || error}`)
      setProfilesLoading(false)
    }
  }

  // Handle profile deletion
  const confirmDeleteProfile = (profileId: number[]) => {
  setProfileToDelete(profileId)
  setAmount(null)
  setDeleteConfirmOpen(true)

  getBalanceForProfileThenBack(profileId, readBalanceNow, refreshBalanceNow)
    .then(setAmount)
    .catch(err => {
      console.error("Failed to get balance:", err)
    })
}

const handleDeleteProfile = async () => {
  if (!profileToDelete || !managers?.walletManager) return;

  try {
    // Close the dialog immediately
    setDeleteConfirmOpen(false);

    // Snapshot IDs and names for nicer labels + cache key
    const profiles = await managers.walletManager.listProfiles();
    const current = profiles.find(p => p.active);
    const toDelete = profiles.find(p => idsEqual(p.id, profileToDelete));
    const target = profiles.find(p => idsEqual(p.id, transferTo.id));
debugger
    if (!current?.id) throw new Error("No active profile.");
    if (!toDelete) throw new Error("Profile to delete not found.");
    if (!target) throw new Error("Target profile not found.");

    setProfilesLoading(true);

    // Compute transfer sats:
    // - use the already-computed balance in state (amount)
    // - leave 20 sats to cover fees to avoid "exact spend" failures
    const balanceSats = Math.max(0, Number(amount ?? 0));
    const keepForFees = 20; // tweak if you want
    const transferSats = Math.max(0, balanceSats - keepForFees);

    if (transferSats > 0) {
      // Counterparty = MRPK of the target profile
      const counterparty = await getPKey(transferTo.id);

      // Switch to the profile being deleted so we can spend its coins
      if (!idsEqual(current.id, profileToDelete)) {
        await managers.walletManager.switchProfile(profileToDelete);
      }

      try {
        const pd = new PushDrop(managers.walletManager);
        debugger
        // Cosmetic field so you can see what this is later
        const fields = [
          Utils.toArray(
            `Transfer on delete: ${toDelete.name} → ${target.name}`
          ),
        ];

        // Sender pubkey is from the deleting profile (nice to have in cache)
        const sender = await managers.walletManager.getPublicKey(
          { identityKey: true },
          "Metanet-Desktop"
        );

        // Lock to the target's MRPK
        const lockingScript = await pd.lock(
          fields,
          [0, "fundingprofile"],
          "1",
          counterparty
        );

        // Create the on-chain action (wallet will add inputs + fee/change)
        const createRes = await managers.walletManager.createAction(
          {
            description: `transfer on delete → ${target.name}`,
            outputs: [
              {
                lockingScript: lockingScript.toHex(),
                satoshis: transferSats,
                outputDescription: "Transfer from deleted profile",
              },
            ],
            options: {
              randomizeOutputs: false,
              acceptDelayedBroadcast: false,
            },
          },
          "Metanet-Desktop"
        );

        // Cache like your create-profile flow so the target can auto-claim later
        const beef = createRes.tx!;
        const tx = Transaction.fromAtomicBEEF(beef);
        const outpoint = `${createRes.txid}.0`;
        const txid = tx.id("hex");
        const satoshis = tx.outputs[0].satoshis;

        const cacheKey = `funds_${target.name || transferTo.id.join("_")}`;
        localStorage.setItem(
          cacheKey,
          JSON.stringify({
            txid,
            tx,
            outpoint,
            satoshis,
            lockingScript: lockingScript.toHex(),
            beef,
            sender: sender.publicKey,
          })
        );
      } finally {
        // Return to whoever was active originally
        if (!idsEqual(current.id, profileToDelete)) {
          await managers.walletManager.switchProfile(current.id);
        }
      }
    }

    // Finally, delete the profile
    await managers.walletManager.deleteProfile(profileToDelete);

    // Clear selection + refresh UI
    setProfileToDelete(null);
    await refreshProfiles();
  } catch (error: any) {
    toast.error(`Error deleting profile: ${error.message || error}`);
    setProfilesLoading(false);
  }
};

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
  
  const idToKey = (id: number[]) => id.join(".")

  const isDefaultId = (id: number[]) => id.every((x) => x === 0)
    const defaultProfile = useMemo(
    () => profiles.find((p) => isDefaultId(p.id)),
    [profiles])
    useEffect(() => {
    if (!selectedKey && defaultProfile) {
      const key = idToKey(defaultProfile.id)
      setSelectedKey(key)
      setTransferTo(defaultProfile)
    }
  }, [defaultProfile, selectedKey, setTransferTo])

    const profileByKey = useMemo(() => {
    const m = new Map<string, Profile>()
    profiles.forEach((p) => m.set(idToKey(p.id), p))
    return m
  }, [profiles])

  const filteredProfiles = useMemo(
  () => profiles.filter((p) => p.id !== profileToDelete),
  [profiles, profileToDelete]
)
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

        {/* Profile Management Section */}
        <List component="nav" sx={{ mb: 1 }}>
          <ListItemButton onClick={() => setProfilesOpen(!profilesOpen)} sx={menuItemStyle(false)}>
            <ListItemIcon sx={{ minWidth: 40 }}>
              <PersonIcon />
            </ListItemIcon>
            <ListItemText
              primary={
                <Typography variant="body1">
                  Profiles
                </Typography>
              }
              secondary={
                !profilesOpen && profiles.length > 0 ? (
                  <Box sx={{ display: 'flex', alignItems: 'center', mt: 0.5, overflow: 'hidden' }}>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{
                        display: 'inline',
                        maxWidth: '100%',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      Active: {profiles.find(p => p.active)?.name || 'Default'}
                    </Typography>
                  </Box>
                ) : null
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
            <Box sx={{ p: 1 }}>
              <Grid container spacing={1} sx={{ width: '100%', maxWidth: '100%', overflow: 'hidden' }}>
                {profiles.map((profile) => (
                  <Grid item xs={12} key={formatProfileId(profile.id)}>
                    <Card
                      variant={profile.active ? 'outlined' : 'elevation'}
                      onClick={!profile.active ? () => handleSwitchProfile(profile.id) : undefined}
                      sx={{
                        borderColor: profile.active ? 'primary.main' : undefined,
                        backgroundColor: profile.active ? alpha('#1976d2', 0.08) : undefined,
                        position: 'relative',
                        width: '100%',
                        maxWidth: '100%',
                        overflow: 'hidden',
                        cursor: profile.active ? 'default' : 'pointer',
                        '&:hover': {
                          boxShadow: profile.active ? 1 : 3,
                          backgroundColor: profile.active ? alpha('#1976d2', 0.08) : alpha('#1976d2', 0.04)
                        }
                      }}
                    >
                      <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                        <Box display="flex" justifyContent="space-between" alignItems="center">
                          <Typography variant="subtitle2" sx={{ fontWeight: profile.active ? 'bold' : 'normal' }}>
                            {profile.name}
                          </Typography>
                          {profile.active && <Chip size="small" label="Active" color="primary" sx={{ height: 20, fontSize: '0.7rem' }} />}
                        </Box>
                        <Box display="flex" justifyContent="space-between" alignItems="center">
                          <Typography variant="caption" color="textSecondary">
                            ID: {formatProfileId(profile.id)}
                          </Typography>
                          {!profile.active && !profile.id.every(x => x === 0) && (
                            <IconButton
                              size="small"
                              onClick={(e) => {
                                e.stopPropagation() // Prevent card click from triggering
                                confirmDeleteProfile(profile.id)
                              }}
                              sx={{
                                color: 'white',
                                p: 0.5,
                                '&:hover': {
                                  backgroundColor: alpha('#1976d2', 0.1)
                                }
                              }}
                            >
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          )}
                        </Box>
                      </CardContent>
                    </Card>
                  </Grid>
                ))}
                <Grid item xs={12}>
                  <Button
                    fullWidth
                    variant="outlined"
                    color="primary"
                    startIcon={<AddIcon />}
                    onClick={() => setCreateProfileOpen(true)}
                    size="small"
                    sx={{ mt: 1, justifyContent: 'start' }}
                  >
                    New Profile
                  </Button>
                </Grid>
              </Grid>
            </Box>
          </Collapse>
        </List>

        <Divider sx={{ mb: 2 }} />

        <List component="nav" sx={{ mb: 2 }}>
          <ListItemButton
            onClick={() => navigation.push('/dashboard/apps')}
            selected={history.location.pathname === '/dashboard/apps'}
            sx={menuItemStyle(history.location.pathname === '/dashboard/apps')}
          >
            <ListItemIcon sx={{ minWidth: 40, color: history.location.pathname === '/dashboard/apps' ? 'primary.main' : 'inherit' }}>
              <BrowseIcon />
            </ListItemIcon>
            <ListItemText
              primary={
                <Typography
                  variant="body1"
                  fontWeight={history.location.pathname === '/dashboard/apps' ? 600 : 400}
                >
                  Apps
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
                  Identity
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
                  Trust
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
                  Security
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
                  Settings
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
                  Logout
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
            <i>Made with love for the BSV Blockchain</i>
          </Typography>
        </Box>
      </Box>

      {/* Create Profile Dialog */}
       <Dialog open={createProfileOpen} onClose={() => setCreateProfileOpen(false)}>
      <DialogTitle>Create New Profile</DialogTitle>
      <DialogContent>
        <DialogContentText>
          Enter a name for the new profile. Each profile has its own set of keys and can be used for different purposes.
        </DialogContentText>

        <TextField
          autoFocus
          margin="dense"
          label="Profile Name"
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
          label="Automatically fund wallet with 1000 sats?"
          sx={{ mt: 1 }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setCreateProfileOpen(false)}>Cancel</Button>
        <Button
          onClick={() => handleCreateProfile()}
          color="primary"
        >
          Create
        </Button>
      </DialogActions>
    </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
      >
        <DialogTitle>Delete Profile</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete this profile ({formatProfileId(profileToDelete || [0])})? This action cannot be undone.
          </DialogContentText>
          <InputLabel id="id-select-label">Profile</InputLabel>
          <Select
            labelId="id-select-label"
            id="id-select"
            value={selectedKey}
            label="Profile"
            displayEmpty
            onChange={(e) => {
              const key = e.target.value as string
              setSelectedKey(key)
              const chosen = profileByKey.get(key)
              if (chosen) setTransferTo(chosen) 
            }}
          >
            <MenuItem value="" disabled>— Select a profile to transfer sats to —</MenuItem>
            {filteredProfiles.map((p) => {
              const key = idToKey(p.id) 
              return (
                <MenuItem key={key} value={key}>
                  {p.name} — {formatProfileId(p.id)}
                </MenuItem>
              )
            })}
          </Select>
        <DialogContentText>
        This accounts balance: {amount}
        </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirmOpen(false)}>Cancel</Button>
          <Button onClick={handleDeleteProfile} color="error">
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Drawer>
  )
}