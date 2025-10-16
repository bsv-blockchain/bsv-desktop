import { useState, useContext, useEffect } from 'react'
import {
  Typography,
  LinearProgress,
  Box,
  Paper,
  Button,
  useTheme,
  Chip,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  Switch,
  FormControlLabel,
  Collapse,
  Divider
} from '@mui/material'
import { Grid } from '@mui/material'
import { makeStyles } from '@mui/styles'
import { toast } from 'react-toastify'
import { WalletContext } from '../../../WalletContext.js'
import { Theme } from '@mui/material/styles'
import DarkModeImage from "../../../images/darkMode.jsx"
import LightModeImage from "../../../images/lightMode.jsx"
import ComputerIcon from '@mui/icons-material/Computer'
import { UserContext } from '../../../UserContext.js'
import PageLoading from '../../../components/PageLoading.js'
import MessageBoxConfig from '../../../components/MessageBoxConfig/index.tsx'
const useStyles = makeStyles((theme: Theme) => ({
  root: {
    padding: theme.spacing(3),
    maxWidth: '800px',
    margin: '0 auto'
  },
  section: {
    marginBottom: theme.spacing(4)
  },
  themeButton: {
    width: '120px',
    height: '120px',
    borderRadius: theme.shape.borderRadius,
    border: `2px solid ${theme.palette.divider}`,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s ease-in-out',
    '&.selected': {
      borderColor: theme.palette.mode === 'dark' ? '#FFFFFF' : theme.palette.primary.main,
      borderWidth: '2px',
      boxShadow: theme.palette.mode === 'dark' ? 'none' : theme.shadows[3]
    }
  },
  currencyButton: {
    width: '100px',
    height: '80px',
    margin: '8px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s ease-in-out',
    '&.selected': {
      borderColor: theme.palette.mode === 'dark' ? '#FFFFFF' : theme.palette.primary.main,
      borderWidth: '2px',
      backgroundColor: theme.palette.action.selected
    }
  }
}))

const Settings = () => {
  const classes = useStyles()
  const { settings, updateSettings, wabUrl, useRemoteStorage, useMessageBox, storageUrl, useWab, messageBoxUrl, backupStorageUrls, addBackupStorageUrl, removeBackupStorageUrl, syncBackupStorage, permissionsConfig, updatePermissionsConfig } = useContext(WalletContext)
  const { pageLoaded, setManualUpdateInfo } = useContext(UserContext)
  const [settingsLoading, setSettingsLoading] = useState(false)
  const theme = useTheme()
  const isDarkMode = theme.palette.mode === 'dark'

  // Backup storage state
  const [showBackupDialog, setShowBackupDialog] = useState(false)
  const [newBackupUrl, setNewBackupUrl] = useState('')
  const [backupLoading, setBackupLoading] = useState(false)
  const [syncLoading, setSyncLoading] = useState(false)

  // Sync progress state
  const [showSyncProgress, setShowSyncProgress] = useState(false)
  const [syncProgressLogs, setSyncProgressLogs] = useState<string[]>([])
  const [syncComplete, setSyncComplete] = useState(false)
  const [syncError, setSyncError] = useState('')

  // Update check state
  const [updateCheckLoading, setUpdateCheckLoading] = useState(false)

  // Permissions configuration state
  const [localPermissionsConfig, setLocalPermissionsConfig] = useState(permissionsConfig)
  const [permissionsExpanded, setPermissionsExpanded] = useState(false)

  useEffect(() => {
    setLocalPermissionsConfig(permissionsConfig)
  }, [permissionsConfig])

  const currencies = {
    BSV: '0.033',
    SATS: '3,333,333',
    USD: '$10',
    EUR: '€9.15',
    GBP: '£7.86'
  }

  const themes = ['light', 'dark', 'system']
  const [selectedTheme, setSelectedTheme] = useState(settings?.theme?.mode || 'system')
  const [selectedCurrency, setSelectedCurrency] = useState(settings?.currency || 'BSV')

  useEffect(() => {
    if (settings?.theme?.mode) {
      setSelectedTheme(settings.theme.mode);
    }
    if (settings?.currency) {
      setSelectedCurrency(settings.currency);
    }
  }, [settings]);

  const handleThemeChange = async (themeOption: string) => {
    if (selectedTheme === themeOption) return;

    try {
      setSettingsLoading(true);

      await updateSettings({
        ...settings,
        theme: {
          mode: themeOption
        }
      });

      setSelectedTheme(themeOption);

      toast.success('Theme updated!');
    } catch (e) {
      toast.error(e.message);
      setSelectedTheme(settings?.theme?.mode || 'system');
    } finally {
      setSettingsLoading(false);
    }
  }

  const handleCurrencyChange = async (currency) => {
    if (selectedCurrency === currency) return;

    try {
      setSettingsLoading(true);
      setSelectedCurrency(currency);

      await updateSettings({
        ...settings,
        currency,
      });

      toast.success('Currency updated!');
    } catch (e) {
      toast.error(e.message);
      setSelectedCurrency(settings?.currency || 'BSV');
    } finally {
      setSettingsLoading(false);
    }
  }

  const handleAddBackupStorage = async (local?: boolean) => {
    if (!newBackupUrl && !local) {
      toast.error('Please enter a backup storage URL');
      return;
    }

    try {
      setBackupLoading(true);
      await addBackupStorageUrl(local ? 'LOCAL_STORAGE' : newBackupUrl);
      setShowBackupDialog(false);
      setNewBackupUrl('');
    } catch (e) {
      // Error already shown by addBackupStorageUrl
    } finally {
      setBackupLoading(false);
    }
  }

  const handleRemoveBackupStorage = async (url: string) => {
    try {
      setBackupLoading(true);
      await removeBackupStorageUrl(url);
    } catch (e) {
      // Error already shown by removeBackupStorageUrl
    } finally {
      setBackupLoading(false);
    }
  }

  const handleSyncBackupStorage = async () => {
    // Reset state
    setSyncError('');
    setSyncProgressLogs([]);
    setSyncComplete(false);
    setShowSyncProgress(true);
    setSyncLoading(true);

    // Progress callback to capture log messages
    const progressCallback = (message: string) => {
      const lines = message.split('\n');
      for (const line of lines) {
        if (line.trim()) {
          setSyncProgressLogs((prev) => [...prev, line]);
        }
      }
    };

    try {
      await syncBackupStorage(progressCallback);
      toast.success('Backup storage synced successfully!');
    } catch (e: any) {
      console.error('Sync error:', e);
      setSyncError(e?.message || String(e));
      toast.error('Failed to sync backup storage: ' + (e?.message || 'Unknown error'));
    } finally {
      setSyncComplete(true);
      setSyncLoading(false);
    }
  }

  const handleCheckForUpdates = async () => {
    try {
      setUpdateCheckLoading(true);

      // In development mode, fetch latest release data from GitHub for testing
      if (process.env.NODE_ENV === 'development') {
        try {
          const response = await fetch('https://api.github.com/repos/bsv-blockchain/bsv-desktop/releases/latest');
          if (response.ok) {
            const release = await response.json();
            setManualUpdateInfo({
              version: release.tag_name.replace('v', ''),
              releaseDate: release.published_at,
              releaseNotes: release.body || 'No release notes available.'
            });
          } else {
            // Fallback to sample data if API fails
            setManualUpdateInfo({
              version: '0.8.1-dev',
              releaseDate: new Date().toISOString(),
              releaseNotes: `
<p><strong>Version 0.8.1</strong> - Latest Release</p>
<p>This update brings several important improvements:</p>
<ul>
<li><strong>Enhanced Security:</strong> Improved encryption for all wallet data</li>
<li><strong>Better Performance:</strong> Faster transaction processing and UI responsiveness</li>
<li><strong>New Features:</strong> Added support for batch transactions</li>
<li><strong>Bug Fixes:</strong> Resolved issues with payment notifications</li>
</ul>
<p><strong>Breaking Changes:</strong></p>
<p>Please note that this update requires a restart of the application.</p>
<p>For more information, visit our <a href="https://docs.bsvblockchain.org" target="_blank">documentation</a>.</p>
`
            });
          }
        } catch (error) {
          console.error('Failed to fetch release data:', error);
          // Fallback to sample data
          setManualUpdateInfo({
            version: '0.8.1-dev',
            releaseDate: new Date().toISOString(),
            releaseNotes: `
<p><strong>Version 0.8.1</strong> - Latest Release</p>
<p>This update brings several important improvements:</p>
<ul>
<li><strong>Enhanced Security:</strong> Improved encryption for all wallet data</li>
<li><strong>Better Performance:</strong> Faster transaction processing and UI responsiveness</li>
<li><strong>New Features:</strong> Added support for batch transactions</li>
<li><strong>Bug Fixes:</strong> Resolved issues with payment notifications</li>
</ul>
<p><strong>Breaking Changes:</strong></p>
<p>Please note that this update requires a restart of the application.</p>
<p>For more information, visit our <a href="https://docs.bsvblockchain.org" target="_blank">documentation</a>.</p>
`
          });
        }
        return;
      }

      const result = await window.electronAPI.updates.check();
      if (result.success) {
        if (result.updateInfo) {
          // Trigger the update dialog immediately
          setManualUpdateInfo(result.updateInfo);
        } else {
          toast.success('You are running the latest version!');
        }
      } else {
        toast.error(`Failed to check for updates: ${result.error}`);
      }
    } catch (e: any) {
      console.error('Update check error:', e);
      toast.error('Failed to check for updates');
    } finally {
      setUpdateCheckLoading(false);
    }
  }

  const handlePermissionToggle = (key: keyof typeof localPermissionsConfig) => {
    setLocalPermissionsConfig(prev => ({
      ...prev,
      [key]: !prev[key]
    }))
  }

  const handleSavePermissions = async () => {
    try {
      await updatePermissionsConfig(localPermissionsConfig)
      handleReloadApp()
    } catch (e) {
      // Error already shown by updatePermissionsConfig
    }
  }

  const handleResetPermissions = () => {
    setLocalPermissionsConfig(permissionsConfig)
    setPermissionsExpanded(false)
  }

  const handleReloadApp = () => {
    window.location.reload()
  }

  const renderThemeIcon = (themeType) => {
    switch (themeType) {
      case 'light':
        return <LightModeImage />;
      case 'dark':
        return <DarkModeImage />;
      case 'system':
        return <ComputerIcon sx={{ fontSize: 40 }} />;
      default:
        return null;
    }
  };

  const getThemeButtonStyles = (themeType) => {
    switch (themeType) {
      case 'light':
        return {
          color: 'text.primary',
          backgroundColor: 'background.paper',
        };
      case 'dark':
        return {
          color: 'common.white',
          backgroundColor: 'grey.800',
        };
      case 'system':
        return {
          color: theme.palette.mode === 'dark' ? 'common.white' : 'text.primary',
          backgroundColor: theme.palette.mode === 'dark' ? 'grey.800' : 'background.paper',
          backgroundImage: theme.palette.mode === 'dark'
            ? 'linear-gradient(135deg, #474747 0%, #111111 100%)'
            : 'linear-gradient(135deg, #ffffff 0%, #f0f0f0 100%)',
        };
      default:
        return {};
    }
  };

  const getSelectedButtonStyle = (isSelected) => {
    if (!isSelected) return {};

    return isDarkMode ? {
      borderColor: 'common.white',
      borderWidth: '2px',
      outline: '1px solid rgba(255, 255, 255, 0.5)',
      boxShadow: 'none',
    } : {
      borderColor: 'primary.main',
      borderWidth: '2px',
      boxShadow: 3,
    };
  };

  if (!pageLoaded) {
    return <PageLoading />
  }

  return (
    <div className={classes.root}>
      <Typography variant="h1" color="textPrimary" sx={{ mb: 2 }}>
        User Settings
      </Typography>
      <Typography variant="body1" color="textSecondary" sx={{ mb: 2 }}>
        Adjust your preferences to customize your experience.
      </Typography>

      {settingsLoading && (
        <Box sx={{ width: '100%', mb: 2 }}>
          <LinearProgress />
        </Box>
      )}

      <Paper elevation={0} className={classes.section} sx={{ p: 3, bgcolor: 'background.paper' }}>
        <Typography variant="h4" sx={{ mb: 2 }}>
          Default Currency
        </Typography>
        <Typography variant="body1" color="textSecondary" sx={{ mb: 3 }}>
          How would you like to see your account balance?
        </Typography>

        <Grid container spacing={2} justifyContent="center">
          {Object.keys(currencies).map(currency => (
            <Grid key={currency}>
              <Button
                variant="outlined"
                disabled={settingsLoading}
                className={`${classes.currencyButton} ${selectedCurrency === currency ? 'selected' : ''}`}
                onClick={() => handleCurrencyChange(currency)}
                sx={{
                  ...(selectedCurrency === currency && getSelectedButtonStyle(true)),
                  bgcolor: selectedCurrency === currency ? 'action.selected' : 'transparent',
                }}
              >
                <Typography variant="body1" fontWeight="bold">
                  {currency}
                </Typography>
                <Typography variant="body2" color="textSecondary">
                  {currencies[currency]}
                </Typography>
              </Button>
            </Grid>
          ))}
        </Grid>
      </Paper>

      <Paper elevation={0} className={classes.section} sx={{ p: 3, bgcolor: 'background.paper' }}>
        <Typography variant="h4" sx={{ mb: 2 }}>
          At a Glance
        </Typography>
        <Typography variant="body1" color="textSecondary" sx={{ mb: 3 }}>
          Current wallet service configuration. Logout to change.
        </Typography>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box>
            <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
              Mode
            </Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Chip
                label={useWab ? 'WAB Recovery' : 'Solo Recovery'}
                color="primary"
                variant="outlined"
              />
              <Chip
                label={useRemoteStorage ? 'Remote Storage' : 'Local Storage'}
                color="primary"
                variant="outlined"
              />
              <Chip
                label={useMessageBox ? 'Message Box Active' : 'No Message Box'}
                color="primary"
                variant="outlined"
              />
            </Box>
          </Box>

          {useWab && wabUrl && (
            <Box>
              <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
                WAB Server URL
              </Typography>
              <Box component="div" sx={{
                fontFamily: 'monospace',
                wordBreak: 'break-all',
                bgcolor: 'action.hover',
                p: 1,
                borderRadius: 1
              }}>
                {wabUrl || ' '}
              </Box>
            </Box>
          )}

          {useRemoteStorage && storageUrl && (
              <Box>
              <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
                Wallet Storage URL
              </Typography>
              <Box component="div" sx={{
                fontFamily: 'monospace',
                wordBreak: 'break-all',
                bgcolor: 'action.hover',
                p: 1,
                borderRadius: 1
              }}>
                {storageUrl || ' '}
              </Box>
            </Box>
          )}

          {useMessageBox && messageBoxUrl && (
            <Box>
              <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
                Message Box Server URL
              </Typography>
              <Box component="div" sx={{
                fontFamily: 'monospace',
              wordBreak: 'break-all',
              bgcolor: 'action.hover',
              p: 1,
              borderRadius: 1
            }}>
              {messageBoxUrl || ' '}
            </Box>
          </Box>
          )}
        </Box>
      </Paper>

      <Paper elevation={0} className={classes.section} sx={{ p: 3, bgcolor: 'background.paper' }}>
        <Typography variant="h4" sx={{ mb: 2 }}>
          Backup Storage
        </Typography>
        <Typography variant="body1" color="textSecondary" sx={{ mb: 3 }}>
          Add remote backup storage providers to keep your wallet data synced across multiple locations.
          The WalletStorageManager will automatically sync new actions to all backup storage providers.
        </Typography>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {/* Active Storage (not removable) */}
          <Box>
            <Typography variant="body2" color="textSecondary">
              Active Storage (Primary)
            </Typography>
            <Box component="div">
              {useRemoteStorage ? storageUrl : 'Local File ~/.bsv-desktop/wallet-<identityKey>-<chain>.db'}
            </Box>
          </Box>

          {/* Backup Storage List */}
          {backupStorageUrls.length > 0 && (
            <Box>
              <Typography variant="body2" color="textSecondary" sx={{ mb: 1, fontWeight: 'bold' }}>
                Backup Storage Providers ({backupStorageUrls.length})
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                {backupStorageUrls.map((url, index) => (
                  <Box
                    key={url}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 2,
                      bgcolor: 'action.hover',
                      p: 1.5,
                      borderRadius: 1
                    }}
                  >
                    <Box component="div" sx={{
                      fontFamily: url === 'LOCAL_STORAGE' ? 'inherit' : 'monospace',
                      wordBreak: 'break-all',
                      flex: 1
                    }}>
                      {url === 'LOCAL_STORAGE' ? 'Local Electron Storage (~/.bsv-desktop/wallet-*.db)' : url}
                    </Box>
                    <Button
                      variant="outlined"
                      color="error"
                      size="small"
                      onClick={() => handleRemoveBackupStorage(url)}
                      disabled={backupLoading}
                    >
                      Remove
                    </Button>
                  </Box>
                ))}
              </Box>
            </Box>
          )}

          {/* Action Buttons */}
          <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
            <Button
              variant="contained"
              onClick={() => setShowBackupDialog(true)}
              disabled={backupLoading}
            >
              Add Backup Storage
            </Button>
            {backupStorageUrls.length > 0 && (
              <Button
                variant="outlined"
                onClick={handleSyncBackupStorage}
                disabled={syncLoading || backupLoading}
              >
                {syncLoading ? 'Syncing...' : 'Sync All Backups'}
              </Button>
            )}
          </Box>

          {backupStorageUrls.length === 0 && (
            <Typography variant="body2" color="textSecondary" sx={{ fontStyle: 'italic' }}>
              No backup storage providers configured. Add one to enable automatic backup syncing.
            </Typography>
          )}
        </Box>
      </Paper>

      <Box sx={{ my: 3 }}>
        <MessageBoxConfig />
      </Box>

      <Dialog open={showBackupDialog} onClose={() => setShowBackupDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Backup Storage</DialogTitle>
        <DialogContent>
          {/* Only show local storage option if remote storage is primary AND local storage not already in backups */}
          {useRemoteStorage && !backupStorageUrls.includes('LOCAL_STORAGE') && (
            <>
              <Box sx={{ my: 3 }}>
                <Button
                  variant="contained"
                  fullWidth
                  onClick={() => {
                    handleAddBackupStorage(true)
                  }}
                  disabled={backupLoading}
                  sx={{ mb: 2 }}
                >
                  Add Local Storage Backup
                </Button>
              </Box>

              <Divider sx={{ my: 2 }}>OR</Divider>
            </>
          )}

          <TextField
            fullWidth
            label="Remote Backup Storage URL"
            placeholder="https://storage.example.com"
            value={newBackupUrl === 'LOCAL_STORAGE' ? '' : newBackupUrl}
            onChange={(e) => setNewBackupUrl(e.target.value)}
            disabled={backupLoading}
            sx={{ mt: 2 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowBackupDialog(false)} disabled={backupLoading}>
            Cancel
          </Button>
          <Button
            onClick={() => handleAddBackupStorage(false)}
            variant="contained"
            disabled={backupLoading || !newBackupUrl}
          >
            {backupLoading ? 'Adding...' : 'Add Backup'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={showSyncProgress} onClose={() => !syncLoading && setShowSyncProgress(false)} maxWidth="md" fullWidth>
        <DialogTitle>Backup Sync Progress</DialogTitle>
        <DialogContent>
          {syncError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {syncError}
            </Alert>
          )}
          <Box
            sx={{
              minWidth: 600,
              maxHeight: 400,
              overflowY: 'auto',
              whiteSpace: 'pre-wrap',
              fontFamily: 'monospace',
              fontSize: '0.875rem',
              bgcolor: 'action.hover',
              p: 2,
              borderRadius: 1
            }}
          >
            {syncProgressLogs.length === 0 && !syncComplete && (
              <Typography variant="body2" color="textSecondary">
                Initializing sync...
              </Typography>
            )}
            {syncProgressLogs.map((log, index) => (
              <Box key={index} sx={{ mb: 0.5 }}>
                {log}
              </Box>
            ))}
            {syncComplete && syncProgressLogs.length === 0 && !syncError && (
              <Typography variant="body2" color="success.main">
                Sync completed successfully!
              </Typography>
            )}
          </Box>
          {syncLoading && (
            <Box sx={{ mt: 2 }}>
              <LinearProgress />
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setShowSyncProgress(false)}
            disabled={syncLoading}
            variant="contained"
          >
            {syncComplete ? 'Close' : 'Cancel'}
          </Button>
        </DialogActions>
      </Dialog>

      <Paper elevation={0} className={classes.section} sx={{ p: 3, bgcolor: 'background.paper' }}>
        <Typography variant="h4" sx={{ mb: 2 }}>
          Choose Your Theme
        </Typography>
        <Typography variant="body1" color="textSecondary" sx={{ mb: 3 }}>
          Select a theme that's comfortable for your eyes.
        </Typography>

        <Grid container spacing={3} justifyContent="center">
          {themes.map(themeOption => (
            <Grid key={themeOption}>
              <Button
                onClick={() => handleThemeChange(themeOption)}
                disabled={settingsLoading}
                className={`${classes.themeButton} ${selectedTheme === themeOption ? 'selected' : ''}`}
                sx={{
                  ...getThemeButtonStyles(themeOption),
                  ...(selectedTheme === themeOption && getSelectedButtonStyle(true)),
                }}
              >
                {renderThemeIcon(themeOption)}
                <Typography variant="body2" sx={{ mt: 1, fontWeight: selectedTheme === themeOption ? 'bold' : 'normal' }}>
                  {themeOption.charAt(0).toUpperCase() + themeOption.slice(1)}
                </Typography>
              </Button>
            </Grid>
          ))}
        </Grid>
      </Paper>

      <Paper elevation={0} className={classes.section} sx={{ p: 3, bgcolor: 'background.paper' }}>
        <Typography variant="h4" sx={{ mb: 2 }}>
          Software Updates
        </Typography>
        <Typography variant="body1" color="textSecondary" sx={{ mb: 3 }}>
          BSV Desktop automatically checks for updates on startup and every 4 hours. You can manually check for updates at any time.
        </Typography>

        <Button
          variant="contained"
          onClick={handleCheckForUpdates}
          disabled={updateCheckLoading}
        >
          {updateCheckLoading ? 'Checking for Updates...' : 'Check for Updates'}
        </Button>
      </Paper>

      <Paper elevation={0} className={classes.section} sx={{ p: 3, bgcolor: 'background.paper' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h4">
            Permissions Configuration
          </Typography>
          <Button
            size="small"
            onClick={() => setPermissionsExpanded(!permissionsExpanded)}
          >
            {permissionsExpanded ? 'Hide' : 'Show'} Advanced Settings
          </Button>
        </Box>

        <Alert severity="info" sx={{ mb: 2 }}>
          These settings control what permissions external apps need to request before accessing wallet functionality.
          Changes require app reload to take effect.
        </Alert>

        <Collapse in={permissionsExpanded}>
          <Box sx={{ mt: 2 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>Protocol Permissions</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, ml: 2 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={localPermissionsConfig.seekProtocolPermissionsForSigning}
                    onChange={() => handlePermissionToggle('seekProtocolPermissionsForSigning')}
                  />
                }
                label="Require permission for signature creation"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={localPermissionsConfig.seekProtocolPermissionsForEncrypting}
                    onChange={() => handlePermissionToggle('seekProtocolPermissionsForEncrypting')}
                  />
                }
                label="Require permission for encryption operations"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={localPermissionsConfig.seekProtocolPermissionsForHMAC}
                    onChange={() => handlePermissionToggle('seekProtocolPermissionsForHMAC')}
                  />
                }
                label="Require permission for HMAC operations"
              />
            </Box>

            <Divider sx={{ my: 3 }} />

            <Typography variant="h6" sx={{ mb: 2 }}>Key & Identity Permissions</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, ml: 2 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={localPermissionsConfig.seekPermissionsForPublicKeyRevelation}
                    onChange={() => handlePermissionToggle('seekPermissionsForPublicKeyRevelation')}
                  />
                }
                label="Require permission for public key revelation"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={localPermissionsConfig.seekPermissionsForIdentityKeyRevelation}
                    onChange={() => handlePermissionToggle('seekPermissionsForIdentityKeyRevelation')}
                  />
                }
                label="Require permission for identity key revelation"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={localPermissionsConfig.seekPermissionsForKeyLinkageRevelation}
                    onChange={() => handlePermissionToggle('seekPermissionsForKeyLinkageRevelation')}
                  />
                }
                label="Require permission for key linkage revelation"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={localPermissionsConfig.seekPermissionsForIdentityResolution}
                    onChange={() => handlePermissionToggle('seekPermissionsForIdentityResolution')}
                  />
                }
                label="Require permission for identity resolution"
              />
            </Box>

            <Divider sx={{ my: 3 }} />

            <Typography variant="h6" sx={{ mb: 2 }}>Basket Permissions</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, ml: 2 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={localPermissionsConfig.seekBasketInsertionPermissions}
                    onChange={() => handlePermissionToggle('seekBasketInsertionPermissions')}
                  />
                }
                label="Require permission for basket insertion"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={localPermissionsConfig.seekBasketListingPermissions}
                    onChange={() => handlePermissionToggle('seekBasketListingPermissions')}
                  />
                }
                label="Require permission for basket listing"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={localPermissionsConfig.seekBasketRemovalPermissions}
                    onChange={() => handlePermissionToggle('seekBasketRemovalPermissions')}
                  />
                }
                label="Require permission for basket removal"
              />
            </Box>

            <Divider sx={{ my: 3 }} />

            <Typography variant="h6" sx={{ mb: 2 }}>Certificate Permissions</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, ml: 2 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={localPermissionsConfig.seekCertificateAcquisitionPermissions}
                    onChange={() => handlePermissionToggle('seekCertificateAcquisitionPermissions')}
                  />
                }
                label="Require permission for certificate acquisition"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={localPermissionsConfig.seekCertificateDisclosurePermissions}
                    onChange={() => handlePermissionToggle('seekCertificateDisclosurePermissions')}
                  />
                }
                label="Require permission for certificate disclosure"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={localPermissionsConfig.seekCertificateRelinquishmentPermissions}
                    onChange={() => handlePermissionToggle('seekCertificateRelinquishmentPermissions')}
                  />
                }
                label="Require permission for certificate relinquishment"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={localPermissionsConfig.seekCertificateListingPermissions}
                    onChange={() => handlePermissionToggle('seekCertificateListingPermissions')}
                  />
                }
                label="Require permission for certificate listing"
              />
            </Box>

            <Divider sx={{ my: 3 }} />

            <Typography variant="h6" sx={{ mb: 2 }}>Action & Label Permissions</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, ml: 2 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={localPermissionsConfig.seekPermissionWhenApplyingActionLabels}
                    onChange={() => handlePermissionToggle('seekPermissionWhenApplyingActionLabels')}
                  />
                }
                label="Require permission when applying action labels"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={localPermissionsConfig.seekPermissionWhenListingActionsByLabel}
                    onChange={() => handlePermissionToggle('seekPermissionWhenListingActionsByLabel')}
                  />
                }
                label="Require permission when listing actions by label"
              />
            </Box>

            <Divider sx={{ my: 3 }} />

            <Typography variant="h6" sx={{ mb: 2 }}>General Settings</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, ml: 2 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={localPermissionsConfig.seekGroupedPermission}
                    onChange={() => handlePermissionToggle('seekGroupedPermission')}
                  />
                }
                label="Enable grouped permission requests (recommended)"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={localPermissionsConfig.seekSpendingPermissions}
                    onChange={() => handlePermissionToggle('seekSpendingPermissions')}
                  />
                }
                label="Require permission for spending wallet funds"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={localPermissionsConfig.differentiatePrivilegedOperations}
                    onChange={() => handlePermissionToggle('differentiatePrivilegedOperations')}
                  />
                }
                label="Differentiate privileged operations"
              />
            </Box>

            <Box sx={{ mt: 3, display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
              <Button
                variant="outlined"
                onClick={handleResetPermissions}
              >
                Reset Changes
              </Button>
              <Button
                variant="contained"
                onClick={handleSavePermissions}
              >
                Save Permissions Configuration
              </Button>
            </Box>
          </Box>
        </Collapse>
      </Paper>
    </div>
  )
}

export default Settings
