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
  Person as PersonIcon
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
  alpha
} from '@mui/material'
import Profile from '../components/Profile'
import React, { useState, useContext, useEffect, useCallback } from 'react';
import { useHistory } from 'react-router';
import { WalletContext } from '../WalletContext';
import { UserContext } from '../UserContext';
import { useBreakpoint } from '../utils/useBreakpoints.js';
import { Utils } from '@bsv/sdk';


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
  const { logout, managers } = useContext(WalletContext)
  const { appName, appVersion } = useContext(UserContext)

  // Profile management state
  const [profilesOpen, setProfilesOpen] = useState(false)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [createProfileOpen, setCreateProfileOpen] = useState(false)
  const [newProfileName, setNewProfileName] = useState('')
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [profileToDelete, setProfileToDelete] = useState<number[] | null>(null)

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
    if (!managers?.walletManager || !managers.walletManager.listProfiles) return;

    try {
      // Handle both synchronous and asynchronous listProfiles implementation
      if (managers.walletManager.saveSnapshot) {
        localStorage.snap = Utils.toBase64(managers.walletManager.saveSnapshot())
      }
      const profileList = await Promise.resolve(managers.walletManager.listProfiles());
      setProfiles(profileList);
    } catch (error) {
      console.error('Error loading profiles:', error);
    }
  }, [managers?.walletManager]);

  // Handle profile creation
  const handleCreateProfile = async () => {
    if (!newProfileName.trim() || !managers?.walletManager) return;

    try {
      // Close dialog first before async operation
      setCreateProfileOpen(false);
      setNewProfileName('');

      // Then perform the async operation
      await managers.walletManager.addProfile(newProfileName.trim());

      // Refresh the profile list
      await refreshProfiles();
    } catch (error) {
      console.error('Error creating profile:', error);
    }
  };

  // Handle profile switching
  const handleSwitchProfile = async (profileId: number[]) => {
    if (!managers?.walletManager) return;

    try {
      // Create a copy of the profile ID to prevent any reference issues
      const profileIdCopy = [...profileId];

      // Perform the async operation
      await managers.walletManager.switchProfile(profileIdCopy);

      // Refresh the profile list to update active status
      await refreshProfiles();
    } catch (error) {
      console.error('Error switching profile:', error);
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

      // Then perform the async operation
      await managers.walletManager.deleteProfile(profileIdToDelete);

      // Refresh the profile list
      await refreshProfiles();
    } catch (error) {
      console.error('Error deleting profile:', error);
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
                        <Typography variant="caption" color="textSecondary">
                          ID: {formatProfileId(profile.id)}
                        </Typography>
                        <Box mt={1} display="flex" justifyContent="flex-end" alignItems="center">
                          {!profile.active && !profile.id.every(x => x === 0) && (
                            <IconButton
                              size="small"
                              onClick={(e) => {
                                e.stopPropagation(); // Prevent card click from triggering
                                confirmDeleteProfile(profile.id);
                              }}
                              sx={{
                                color: 'error.main',
                                p: 0.5,
                                '&:hover': {
                                  backgroundColor: alpha('#f44336', 0.1)
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
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateProfileOpen(false)}>Cancel</Button>
          <Button onClick={handleCreateProfile} color="primary">
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
            Are you sure you want to delete this profile? This action cannot be undone.
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