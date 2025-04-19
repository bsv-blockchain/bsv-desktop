import { useState, useContext, useRef, useEffect } from 'react'
import { useBreakpoint } from '../../utils/useBreakpoints.js'
import { Switch, Route, Redirect } from 'react-router-dom'
import style from '../../navigation/style.js'
import { makeStyles } from '@mui/styles'
import {
  Typography,
  IconButton,
  Toolbar,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  TextField,
  Box,
  Card,
  CardContent,
  Grid,
  Chip,
  Paper
} from '@mui/material'
import PageLoading from '../../components/PageLoading.js'
import Menu from '../../navigation/Menu.js'
import { Menu as MenuIcon, Add as AddIcon, Delete as DeleteIcon } from '@mui/icons-material'
import MyIdentity from './MyIdentity/index.js'
import Trust from './Trust/index.js'
import Apps from './Apps'
// @ts-ignore - Ignoring case sensitivity issues with imports
import App from './App'
import Settings from './Settings/index.js'
import Security from './Security/index.js'
import { UserContext } from '../../UserContext'
import { WalletContext } from '../../WalletContext'

// @ts-ignore - Ignoring type issues with makeStyles
const useStyles = makeStyles(style, {
  name: 'Dashboard'
})

// Type definition for profile structure from CWIStyleWalletManager
interface Profile {
  id: number[];
  name: string;
  createdAt: number | null;
  active: boolean;
}

/**
 * Renders the Apps page and menu by default
 */
export default function Dashboard() {
  const { pageLoaded } = useContext(UserContext)
  const { managers } = useContext(WalletContext)
  const breakpoints = useBreakpoint()
  const classes = useStyles({ breakpoints })
  const menuRef = useRef(null)
  const [menuOpen, setMenuOpen] = useState(true)
  const [myIdentityKey] = useState('self')

  // Profile management state
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [createProfileOpen, setCreateProfileOpen] = useState(false)
  const [newProfileName, setNewProfileName] = useState('')
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [profileToDelete, setProfileToDelete] = useState<number[] | null>(null)


  const getMargin = () => {
    if (menuOpen && !breakpoints.sm) {
      return '320px'
    }
    return '0px'
  }

  // Helper function to refresh profiles
  const refreshProfiles = async () => {
    if (!managers.walletManager || !managers.walletManager.listProfiles) return;

    try {
      // Handle both synchronous and asynchronous listProfiles implementation
      const profileList = await Promise.resolve(managers.walletManager.listProfiles());
      console.log('PROFILES', profileList)
      setProfiles(profileList);
    } catch (error) {
      console.error('Error loading profiles:', error);
    }
  };

  // Load profiles when wallet is initialized
  useEffect(() => {
    refreshProfiles();
  }, [managers.walletManager, pageLoaded]);

  // Handle profile creation
  const handleCreateProfile = async () => {
    if (!newProfileName.trim() || !managers.walletManager) return;

    try {
      await managers.walletManager.addProfile(newProfileName.trim());
      setNewProfileName('');
      setCreateProfileOpen(false);

      // Refresh the profile list
      await refreshProfiles();
    } catch (error) {
      console.error('Error creating profile:', error);
    }
  };

  // Handle profile switching
  const handleSwitchProfile = async (profileId: number[]) => {
    if (!managers.walletManager) return;

    try {
      await managers.walletManager.switchProfile(profileId);

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
    if (!profileToDelete || !managers.walletManager) return;

    try {
      await managers.walletManager.deleteProfile(profileToDelete);
      setDeleteConfirmOpen(false);
      setProfileToDelete(null);

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

  if (!pageLoaded) {
    return <PageLoading />
  }

  return (
    <div className={classes.content_wrap} style={{ marginLeft: getMargin(), transition: 'margin 0.3s ease' }}>
      <div style={{
        marginLeft: 0,
        width: menuOpen ? `calc(100vw - ${getMargin()})` : '100vw',
        transition: 'width 0.3s ease, margin 0.3s ease'
      }}>
        {breakpoints.sm &&
          <div style={{ padding: '0.5em 0 0 0.5em' }} ref={menuRef}>
            <Toolbar>
              <IconButton
                edge='start'
                onClick={() => setMenuOpen(menuOpen => !menuOpen)}
                aria-label='menu'
                sx={{
                  color: 'primary.main',
                  '&:hover': {
                    backgroundColor: 'rgba(25, 118, 210, 0.1)',
                  }
                }}
              >
                <MenuIcon />
              </IconButton>
            </Toolbar>
          </div>}
      </div>
      <Menu menuOpen={menuOpen} setMenuOpen={setMenuOpen} menuRef={menuRef} />
      <div className={classes.page_container}>
        {/* Profile Management Section */}
        <Paper elevation={2} style={{ margin: '1rem', padding: '1rem' }}>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
            <Typography variant="h6">Profiles</Typography>
            <Button
              variant="contained"
              color="primary"
              startIcon={<AddIcon />}
              onClick={() => setCreateProfileOpen(true)}
              size="small"
            >
              New Profile
            </Button>
          </Box>

          <Grid container spacing={2} width="100%" style={{ overflow: 'hidden' }}>
            {profiles.map((profile) => (
              <Grid item xs={12} sm={6} md={4} key={formatProfileId(profile.id)}>
                <Card
                  variant={profile.active ? 'outlined' : 'elevation'}
                  style={{
                    borderColor: profile.active ? '#1976d2' : undefined,
                    backgroundColor: profile.active ? 'rgba(25, 118, 210, 0.08)' : undefined,
                    position: 'relative',
                    width: '100%',
                    maxWidth: '100%'
                  }}
                >
                  <CardContent>
                    <Box display="flex" justifyContent="space-between" alignItems="center">
                      <Typography variant="subtitle1" style={{ fontWeight: profile.active ? 'bold' : 'normal' }}>
                        {profile.name}
                      </Typography>
                      {profile.active && <Chip size="small" label="Active" color="primary" />}
                    </Box>
                    <Typography variant="body2" color="textSecondary">
                      ID: {formatProfileId(profile.id)}
                    </Typography>
                    {profile.createdAt && (
                      <Typography variant="caption" color="textSecondary" display="block">
                        Created: {new Date(profile.createdAt * 1000).toLocaleDateString()}
                      </Typography>
                    )}
                    <Box mt={1}>
                      {!profile.active && (
                        <Button
                          size="small"
                          color="primary"
                          onClick={() => handleSwitchProfile(profile.id)}
                        >
                          Switch to this profile
                        </Button>
                      )}
                      {!profile.active && !profile.id.every(x => x === 0) && (
                        <IconButton
                          size="small"
                          onClick={() => confirmDeleteProfile(profile.id)}
                          style={{ color: '#d32f2f' }}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      )}
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        </Paper>

        <Switch>
          <Redirect from='/dashboard/counterparty/self' to={`/dashboard/counterparty/${myIdentityKey}`} />
          <Redirect from='/dashboard/counterparty/anyone' to='/dashboard/counterparty/0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798' />
          <Route
            path='/dashboard/settings'
            component={Settings}
          />
          <Route
            path='/dashboard/identity'
            component={MyIdentity}
          />
          <Route
            path='/dashboard/trust'
            component={Trust}
          />
          <Route
            path='/dashboard/security'
            component={Security}
          />
          <Route
            path='/dashboard/apps'
            component={Apps}
          />
          <Route
            path='/dashboard/app'
            component={App}
          />
          <Route
            component={() => {
              return (
                <div className={(classes as any).full_width} style={{ padding: '1em' }}>
                  <br />
                  <br />
                  <Typography align='center' color='textPrimary'>Use the menu to select a page</Typography>
                </div>
              )
            }}
          />
        </Switch>
      </div>

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
    </div>
  )
}
