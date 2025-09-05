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
import React, { useState, useContext, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'react-toastify';
import { useHistory } from 'react-router';
import { WalletContext } from '../WalletContext';
import { UserContext } from '../UserContext';
import { useBreakpoint } from '../utils/useBreakpoints.js';
import { Utils, PushDrop, LockingScript, Transaction, SignableTransaction, SignActionSpend } from '@bsv/sdk';

// Type definition for profile structure from CWIStyleWalletManager
interface Profile {
  id: number[];
  name: string;
  createdAt: number | null;
  active: boolean;
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
});

interface MenuProps {
  menuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
  menuRef: React.RefObject<HTMLDivElement>;
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
  const {balance: accountBalance,refresh} = getAccountBalance("default")
  // History.push wrapper
  const navigation = {
    push: (path: string) => {
      // Explicitly cast breakpoints to avoid TypeScript error
      const { sm } = breakpoints as { sm: boolean };
      if (sm) {
        setMenuOpen(false)
      }
      history.push(path)
    }
  }

  // First useEffect to handle breakpoint changes
  useEffect(() => {
    // Explicitly cast breakpoints to avoid TypeScript error
    const { sm } = breakpoints as { sm: boolean };
    if (!sm) {
      setMenuOpen(true)
    } else {
      setMenuOpen(false)
    }
  }, [breakpoints])
useEffect(() => {
  let cancelled = false;

  const run = async () => {
    if (!managers?.walletManager || !activeProfile?.name) return;

    const cacheKey = `funds_${activeProfile.name}`;
    const cached = localStorage.getItem(cacheKey);
    if (!cached) return;

    try {
      const funding: {
        txid: string;
        vout: number;
        satoshis: number;
        lockingScript: string;
        beef: string | number[];
      } = JSON.parse(cached);

      // Build a signable tx that spends the funding output
      const provisional = await managers.walletManager.createAction({
        description: 'claiming funds',
        inputBEEF: funding.beef, // same BEEF flavor we saved
        inputs: [{
          inputDescription: 'Claim funds',
          outpoint: `${funding.txid}.${funding.vout}`, // dot format like the ToDo example
          // Provide context so fees/sighash are correct:
          unlockingScript: funding.lockingScript,
          // Reserve enough bytes for PushDrop 'anyone' unlock (longer than 73)
          unlockingScriptLength: 180
        }],
        options: {
          acceptDelayedBroadcast: true,
          randomizeOutputs: false
        }
      });

      if (!provisional?.signableTransaction) {
        throw new Error('No signable transaction returned');
      }

      const partialTx = Transaction.fromBEEF(provisional.signableTransaction.tx);

      // Build the actual unlocking script for input 0 using PushDrop 'anyone'
      const unlocker = new PushDrop(managers.walletManager).unlock(
        [0, 'fundingprofile'],
        '1',
        'anyone',
        // keep the same “shape” as the ToDo example: give scope/flags/value/script
        'all',
        false,
        funding.satoshis,
        LockingScript.fromHex(funding.lockingScript)
      );

      const unlockingScript = await unlocker.sign(partialTx, 0);
      // await managers.walletManager.signAction({
      //   reference: provisional.signableTransaction.reference,
      //   spends: { 0: { unlockingScript: unlockingScript.toHex() } }
      // });
      localStorage.removeItem(cacheKey);
      console.log('✅ Claimed profile funding for', activeProfile.name);
    } catch (err) {
      if (!cancelled) console.error(' Claim failed', err);
    }
  };

  void run();
  return () => { cancelled = true; };
}, [activeProfile?.name, managers?.walletManager]);

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
    if (!managers?.walletManager || !managers.walletManager?.listProfiles) return;

    try {
      setProfilesLoading(true);
      // Handle both synchronous and asynchronous listProfiles implementation
      if (managers.walletManager.saveSnapshot) {
        localStorage.snap = Utils.toBase64(managers.walletManager.saveSnapshot())
      }
      const profileList = await Promise.resolve(managers.walletManager?.listProfiles());
      setProfiles(profileList);
    } catch (error) {
      toast.error(`Error loading profiles: ${error.message || error}`);
    } finally {
      setProfilesLoading(false);
    }
  }, [managers?.walletManager]);

  // Handle profile creation
  const handleCreateProfile = async () => {
    if (!newProfileName.trim() || !managers?.walletManager) return;

    try {
      // Close dialog first before async operation
      setCreateProfileOpen(false);
      setNewProfileName('');
     if (fund) {
      const cacheKey = `funds_${name}`;

      const pd = new PushDrop(managers.walletManager);
      const fields = [ Utils.toArray(`Funding Wallet: ${name}`) ];
      const lockingScript = await pd.lock(
        fields,
        [0, 'fundingprofile'],
        '1',
        'anyone'
      );

      const createRes = await managers.walletManager.createAction({
        description: 'funding new profile',
        outputs: [{
          lockingScript: lockingScript.toHex(),
          satoshis: 1000,
          outputDescription: 'New profile funds',
          // (optional) basket: 'profile-funding'
        }],
        options: {
          randomizeOutputs: false,
          acceptDelayedBroadcast: false
        }
      });

      // If the funding action is signable, finish it now so the UTXO exists.
      if (createRes?.signableTransaction?.reference) {
        await managers.walletManager.signAction({
          reference: createRes.signableTransaction.reference,
          spends: {}
        });
      }

      // Use ONE BEEF flavor consistently (prefer the same key you’ll use later)
      const beef = createRes.tx ?? createRes.signableTransaction?.tx;
      const tx = Transaction.fromBEEF(beef);
      const vout = tx.outputs.findIndex(o => o.lockingScript.toHex() === lockingScript.toHex());
      if (vout < 0) throw new Error('Could not locate funding output');

      const txid = tx.id('hex');
      const satoshis = tx.outputs[vout].satoshis;

      // Persist everything needed to redeem after profile switch
      localStorage.setItem(cacheKey, JSON.stringify({
        txid,
        vout,
        satoshis,
        lockingScript: lockingScript.toHex(),
        beef
      }));
    }
      setProfilesLoading(true);

      // Then perform the async operation
      await managers.walletManager.addProfile(newProfileName.trim());

      // Refresh the profile list
      await refreshProfiles();
    } catch (error) {
      toast.error(`Error creating profile: ${error.message || error}`);
      setProfilesLoading(false);
    }
  };

  // Handle profile switching
  const handleSwitchProfile = async (profileId: number[]) => {
    if (!managers?.walletManager) return;

    try {
      // Show loading state
      setProfilesLoading(true);

      // Perform the async operation
      await managers.walletManager.switchProfile(profileId);
      setActiveProfile(profiles.find(profile => profile.id == profileId))

      // Refresh the profile list to update active status
      if( history.location.pathname.startsWith('/dashboard/app/')){
        history.push('/dashboard/apps')
      }
      await refreshProfiles();
    } catch (error) {
      toast.error(`Error switching profile: ${error.message || error}`);
      setProfilesLoading(false);
    }
  };

  // Handle profile deletion
  const confirmDeleteProfile = (profileId: number[]) => {
    setProfileToDelete(profileId);
    setDeleteConfirmOpen(true);
  };

  const handleDeleteProfile = async () => {
    if (!profileToDelete || !managers?.walletManager) return;

    try {
      // Close dialog first before async operation
      setDeleteConfirmOpen(false);
      const profileIdToDelete = [...profileToDelete]; // Create a copy
      setProfileToDelete(null);

      // Show loading state
      setProfilesLoading(true);

      // Then perform the async operation
      await managers.walletManager.deleteProfile(profileIdToDelete);

      // Refresh the profile list
      await refreshProfiles();
    } catch (error) {
      toast.error(`Error deleting profile: ${error.message || error}`);
      setProfilesLoading(false);
    }
  };

  // Render formatted profile ID (first 8 chars)
  const formatProfileId = (id: number[]) => {
    // Check if it's the default profile
    if (id.every(x => x === 0)) {
      return 'Default';
    }

    // Convert to hex and show first 8 characters
    return id.slice(0, 4).map(byte => byte.toString(16).padStart(2, '0')).join('');
  };

  // Load profiles when wallet is initialized
  useEffect(() => {
    refreshProfiles();
  }, [refreshProfiles]);
  
  const idToKey = (id: number[]) => id.join(".")

  const isDefaultId = (id: number[]) => id.every((x) => x === 0)
    const defaultProfile = useMemo(
    () => profiles.find((p) => isDefaultId(p.id)),
    [profiles])
    useEffect(() => {
    if (!selectedKey && defaultProfile) {
      const key = idToKey(defaultProfile.id);
      setSelectedKey(key);
      setTransferTo(defaultProfile);
    }
  }, [defaultProfile, selectedKey, setTransferTo]);

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
                                e.stopPropagation(); // Prevent card click from triggering
                                confirmDeleteProfile(profile.id);
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
              logout();
              history.push('/');
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
              const key = e.target.value as string;
              setSelectedKey(key);
              const chosen = profileByKey.get(key);
              if (chosen) setTransferTo(chosen); // pass the full Profile
            }}
          >
            <MenuItem value="" disabled>— Select a profile to transfer sats to —</MenuItem>
            {filteredProfiles.map((p) => {
              const key = idToKey(p.id); // <-- ID is the React key
              return (
                <MenuItem key={key} value={key}>
                  {p.name} — {formatProfileId(p.id)}
                </MenuItem>
              );
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