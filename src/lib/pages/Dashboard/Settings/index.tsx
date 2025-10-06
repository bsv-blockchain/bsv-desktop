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
  Alert
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
  const { settings, updateSettings, wabUrl, useRemoteStorage, useMessageBox, storageUrl, useWab, messageBoxUrl, backupStorageUrls, addBackupStorageUrl, removeBackupStorageUrl, syncBackupStorage, updateMessageBoxUrl, removeMessageBoxUrl } = useContext(WalletContext)
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

  // Message Box configuration state
  const [showMessageBoxDialog, setShowMessageBoxDialog] = useState(false)
  const [newMessageBoxUrl, setNewMessageBoxUrl] = useState('')
  const [messageBoxLoading, setMessageBoxLoading] = useState(false)

  // Update check state
  const [updateCheckLoading, setUpdateCheckLoading] = useState(false)

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

  const handleAddBackupStorage = async () => {
    if (!newBackupUrl) {
      toast.error('Please enter a backup storage URL');
      return;
    }

    try {
      setBackupLoading(true);
      await addBackupStorageUrl(newBackupUrl);
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

  const handleSetupMessageBox = async () => {
    if (!newMessageBoxUrl) {
      toast.error('Please enter a Message Box URL');
      return;
    }

    try {
      setMessageBoxLoading(true);
      await updateMessageBoxUrl(newMessageBoxUrl);
      setShowMessageBoxDialog(false);
      setNewMessageBoxUrl('');
    } catch (e) {
      // Error already shown by updateMessageBoxUrl
    } finally {
      setMessageBoxLoading(false);
    }
  }

  const handleRemoveMessageBox = async () => {
    try {
      setMessageBoxLoading(true);
      await removeMessageBoxUrl();
    } catch (e) {
      // Error already shown by removeMessageBoxUrl
    } finally {
      setMessageBoxLoading(false);
    }
  }

  const handleCheckForUpdates = async () => {
    try {
      setUpdateCheckLoading(true);
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
          Wallet Configuration
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
              {useRemoteStorage ? storageUrl : 'Local File ~/.bsv-desktop/wallet.db'}
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
                      fontFamily: 'monospace',
                      wordBreak: 'break-all',
                      flex: 1
                    }}>
                      {url}
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

      <Paper elevation={0} className={classes.section} sx={{ p: 3, bgcolor: 'background.paper' }}>
        <Typography variant="h4" sx={{ mb: 2 }}>
          Message Box Configuration
        </Typography>
        <Typography variant="body1" color="textSecondary" sx={{ mb: 3 }}>
          Configure your Message Box URL to enable secure messaging functionality. This can be set up retroactively if not configured initially.
        </Typography>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {/* Current Message Box Status */}
          <Box>
            <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
              Status
            </Typography>
            <Chip
              label={useMessageBox && messageBoxUrl ? 'Message Box Active' : 'No Message Box'}
              color={useMessageBox && messageBoxUrl ? 'success' : 'default'}
              variant="outlined"
            />
          </Box>

          {/* Display current URL if configured */}
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
                {messageBoxUrl}
              </Box>
            </Box>
          )}

          {/* Setup/Update/Remove Buttons */}
          <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
            <Button
              variant="contained"
              onClick={() => setShowMessageBoxDialog(true)}
              disabled={messageBoxLoading}
            >
              {useMessageBox && messageBoxUrl ? 'Update Message Box URL' : 'Setup Message Box'}
            </Button>
            {useMessageBox && messageBoxUrl && (
              <Button
                variant="outlined"
                color="error"
                onClick={handleRemoveMessageBox}
                disabled={messageBoxLoading}
              >
                Remove Message Box
              </Button>
            )}
          </Box>

          {!useMessageBox && !messageBoxUrl && (
            <Typography variant="body2" color="textSecondary" sx={{ fontStyle: 'italic' }}>
              No Message Box configured. Click "Setup Message Box" to enable secure messaging functionality.
            </Typography>
          )}
        </Box>
      </Paper>

      <Dialog open={showBackupDialog} onClose={() => setShowBackupDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Backup Storage</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
            Enter the URL of your remote wallet storage provider. This will be used as a backup
            in addition to your primary storage.
          </Typography>
          <TextField
            fullWidth
            label="Backup Storage URL"
            placeholder="https://storage.example.com"
            value={newBackupUrl}
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
            onClick={handleAddBackupStorage}
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

      <Dialog open={showMessageBoxDialog} onClose={() => !messageBoxLoading && setShowMessageBoxDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{useMessageBox && messageBoxUrl ? 'Update Message Box URL' : 'Setup Message Box'}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
            Enter the URL of your Message Box server to enable secure messaging functionality.
            {useMessageBox && messageBoxUrl && ' This will update your existing configuration.'}
          </Typography>
          {useMessageBox && messageBoxUrl && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Current URL: {messageBoxUrl}
            </Alert>
          )}
          <TextField
            fullWidth
            label="Message Box URL"
            placeholder="https://messagebox.example.com"
            value={newMessageBoxUrl}
            onChange={(e) => setNewMessageBoxUrl(e.target.value)}
            disabled={messageBoxLoading}
            sx={{ mt: 2 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowMessageBoxDialog(false)} disabled={messageBoxLoading}>
            Cancel
          </Button>
          <Button
            onClick={handleSetupMessageBox}
            variant="contained"
            disabled={messageBoxLoading || !newMessageBoxUrl}
          >
            {messageBoxLoading ? 'Saving...' : (useMessageBox && messageBoxUrl ? 'Update' : 'Setup')}
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
    </div>
  )
}

export default Settings
