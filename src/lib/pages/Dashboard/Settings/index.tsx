import { useState, useContext, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useLanguage, languageNames } from '../../../i18n/LanguageContext'
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
import WalletDiagnosis from './WalletDiagnosis.tsx'
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
  const { t } = useTranslation()
  const { currentLanguage, setCurrentLanguage, supportedLanguages } = useLanguage()
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

      toast.success(t('theme_updated_success'));
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

      toast.success(t('currency_updated_success'));
    } catch (e) {
      toast.error(e.message);
      setSelectedCurrency(settings?.currency || 'BSV');
    } finally {
      setSettingsLoading(false);
    }
  }

  const handleAddBackupStorage = async (local?: boolean) => {
    if (!newBackupUrl && !local) {
      toast.error(t('backup_error_empty_url'));
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
      toast.success(t('sync_backup_success'));
    } catch (e: any) {
      console.error('Sync error:', e);
      setSyncError(e?.message || String(e));
      toast.error(t('sync_backup_error', { error: e?.message || 'Unknown error' }));
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
          toast.success(t('updates_success_latest'));
        }
      } else {
        toast.error(t('updates_error_check_failed', { error: result.error }));
      }
    } catch (e: any) {
      console.error('Update check error:', e);
      toast.error(t('updates_error_generic'));
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
        {t('settings_title')}
      </Typography>
      <Typography variant="body1" color="textSecondary" sx={{ mb: 2 }}>
        {t('settings_subtitle')}
      </Typography>

      {settingsLoading && (
        <Box sx={{ width: '100%', mb: 2 }}>
          <LinearProgress />
        </Box>
      )}

      <Paper elevation={0} className={classes.section} sx={{ p: 3, bgcolor: 'background.paper' }}>
        <Typography variant="h4" sx={{ mb: 2 }}>
          {t('currency_section_title')}
        </Typography>
        <Typography variant="body1" color="textSecondary" sx={{ mb: 3 }}>
          {t('currency_section_description')}
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
          {t('at_glance_section_title')}
        </Typography>
        <Typography variant="body1" color="textSecondary" sx={{ mb: 3 }}>
          {t('at_glance_section_description')}
        </Typography>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box>
            <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
              {t('at_glance_mode_label')}
            </Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Chip
                label={useWab ? t('at_glance_wab_recovery') : t('at_glance_solo_recovery')}
                color="primary"
                variant="outlined"
              />
              <Chip
                label={useRemoteStorage ? t('at_glance_remote_storage') : t('at_glance_local_storage')}
                color="primary"
                variant="outlined"
              />
              <Chip
                label={useMessageBox ? t('at_glance_message_box_active') : t('at_glance_no_message_box')}
                color="primary"
                variant="outlined"
              />
            </Box>
          </Box>

          {useWab && wabUrl && (
            <Box>
              <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
                {t('at_glance_wab_url_label')}
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
                {t('at_glance_storage_url_label')}
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
                {t('at_glance_message_box_url_label')}
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
          {t('backup_storage_section_title')}
        </Typography>
        <Typography variant="body1" color="textSecondary" sx={{ mb: 3 }}>
          {t('backup_storage_section_description')}
        </Typography>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {/* Active Storage (not removable) */}
          <Box>
            <Typography variant="body2" color="textSecondary">
              {t('backup_storage_active_label')}
            </Typography>
            <Box component="div">
              {useRemoteStorage ? storageUrl : t('backup_storage_local_default')}
            </Box>
          </Box>

          {/* Backup Storage List */}
          {backupStorageUrls.length > 0 && (
            <Box>
              <Typography variant="body2" color="textSecondary" sx={{ mb: 1, fontWeight: 'bold' }}>
                {t('backup_storage_providers_label', { count: backupStorageUrls.length })}
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
                      {url === 'LOCAL_STORAGE' ? t('backup_storage_local_electron') : url}
                    </Box>
                    <Button
                      variant="outlined"
                      color="error"
                      size="small"
                      onClick={() => handleRemoveBackupStorage(url)}
                      disabled={backupLoading}
                    >
                      {t('backup_storage_remove_button')}
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
              {t('backup_storage_add_button')}
            </Button>
            {backupStorageUrls.length > 0 && (
              <Button
                variant="outlined"
                onClick={handleSyncBackupStorage}
                disabled={syncLoading || backupLoading}
              >
                {syncLoading ? t('backup_storage_sync_syncing') : t('backup_storage_sync_button')}
              </Button>
            )}
          </Box>

          {backupStorageUrls.length === 0 && (
            <Typography variant="body2" color="textSecondary" sx={{ fontStyle: 'italic' }}>
              {t('backup_storage_empty_message')}
            </Typography>
          )}
        </Box>
      </Paper>

      <Box sx={{ my: 3 }}>
        <MessageBoxConfig />
      </Box>

      <Dialog open={showBackupDialog} onClose={() => setShowBackupDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('backup_dialog_title')}</DialogTitle>
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
                  {t('backup_dialog_local_storage_button')}
                </Button>
              </Box>

              <Divider sx={{ my: 2 }}>{t('backup_dialog_divider_text')}</Divider>
            </>
          )}

          <TextField
            fullWidth
            label={t('backup_dialog_url_label')}
            placeholder={t('backup_dialog_url_placeholder')}
            value={newBackupUrl === 'LOCAL_STORAGE' ? '' : newBackupUrl}
            onChange={(e) => setNewBackupUrl(e.target.value)}
            disabled={backupLoading}
            sx={{ mt: 2 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowBackupDialog(false)} disabled={backupLoading}>
            {t('backup_dialog_cancel_button')}
          </Button>
          <Button
            onClick={() => handleAddBackupStorage(false)}
            variant="contained"
            disabled={backupLoading || !newBackupUrl}
          >
            {backupLoading ? t('backup_dialog_add_loading') : t('backup_dialog_add_button')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={showSyncProgress} onClose={() => !syncLoading && setShowSyncProgress(false)} maxWidth="md" fullWidth>
        <DialogTitle>{t('sync_progress_dialog_title')}</DialogTitle>
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
                {t('sync_progress_initializing')}
              </Typography>
            )}
            {syncProgressLogs.map((log, index) => (
              <Box key={index} sx={{ mb: 0.5 }}>
                {log}
              </Box>
            ))}
            {syncComplete && syncProgressLogs.length === 0 && !syncError && (
              <Typography variant="body2" color="success.main">
                {t('sync_progress_complete')}
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
            {syncComplete ? t('sync_progress_close_button') : t('sync_progress_cancel_button')}
          </Button>
        </DialogActions>
      </Dialog>

      <Paper elevation={0} className={classes.section} sx={{ p: 3, bgcolor: 'background.paper' }}>
        <Typography variant="h4" sx={{ mb: 2 }}>
          {t('theme_section_title')}
        </Typography>
        <Typography variant="body1" color="textSecondary" sx={{ mb: 3 }}>
          {t('theme_section_description')}
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
                  {themeOption === 'light' ? t('theme_light') : themeOption === 'dark' ? t('theme_dark') : t('theme_system')}
                </Typography>
              </Button>
            </Grid>
          ))}
        </Grid>
      </Paper>

      {/* Language */}
      <Box className={classes.section}>
        <Typography variant="h6" gutterBottom>
          {t('language_section_title')}
        </Typography>
        <Typography variant="body2" color="textSecondary" gutterBottom>
          {t('language_section_description')}
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1 }}>
          {supportedLanguages.map((lang) => (
            <Chip
              key={lang}
              label={languageNames[lang] || lang}
              onClick={() => setCurrentLanguage(lang)}
              variant={currentLanguage === lang ? 'filled' : 'outlined'}
              color={currentLanguage === lang ? 'primary' : 'default'}
              clickable
            />
          ))}
        </Box>
      </Box>

      <Paper elevation={0} className={classes.section} sx={{ p: 3, bgcolor: 'background.paper' }}>
        <Typography variant="h4" sx={{ mb: 2 }}>
          {t('updates_section_title')}
        </Typography>
        <Typography variant="body1" color="textSecondary" sx={{ mb: 3 }}>
          {t('updates_section_description')}
        </Typography>

        <Button
          variant="contained"
          onClick={handleCheckForUpdates}
          disabled={updateCheckLoading}
        >
          {updateCheckLoading ? t('updates_checking_button') : t('updates_check_button')}
        </Button>
      </Paper>

      <WalletDiagnosis />

      <Paper elevation={0} className={classes.section} sx={{ p: 3, bgcolor: 'background.paper' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h4">
            {t('permissions_section_title')}
          </Typography>
          <Button
            size="small"
            onClick={() => setPermissionsExpanded(!permissionsExpanded)}
          >
            {permissionsExpanded ? t('permissions_advanced_hide') : t('permissions_advanced_show')}
          </Button>
        </Box>

        <Alert severity="info" sx={{ mb: 2 }}>
          {t('permissions_info_alert')}
        </Alert>

        <Collapse in={permissionsExpanded}>
          <Box sx={{ mt: 2 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>{t('permissions_protocol_heading')}</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, ml: 2 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={localPermissionsConfig.seekProtocolPermissionsForSigning}
                    onChange={() => handlePermissionToggle('seekProtocolPermissionsForSigning')}
                  />
                }
                label={t('permissions_protocol_signing')}
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={localPermissionsConfig.seekProtocolPermissionsForEncrypting}
                    onChange={() => handlePermissionToggle('seekProtocolPermissionsForEncrypting')}
                  />
                }
                label={t('permissions_protocol_encryption')}
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={localPermissionsConfig.seekProtocolPermissionsForHMAC}
                    onChange={() => handlePermissionToggle('seekProtocolPermissionsForHMAC')}
                  />
                }
                label={t('permissions_protocol_hmac')}
              />
            </Box>

            <Divider sx={{ my: 3 }} />

            <Typography variant="h6" sx={{ mb: 2 }}>{t('permissions_identity_heading')}</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, ml: 2 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={localPermissionsConfig.seekPermissionsForPublicKeyRevelation}
                    onChange={() => handlePermissionToggle('seekPermissionsForPublicKeyRevelation')}
                  />
                }
                label={t('permissions_identity_public_key')}
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={localPermissionsConfig.seekPermissionsForIdentityKeyRevelation}
                    onChange={() => handlePermissionToggle('seekPermissionsForIdentityKeyRevelation')}
                  />
                }
                label={t('permissions_identity_key')}
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={localPermissionsConfig.seekPermissionsForKeyLinkageRevelation}
                    onChange={() => handlePermissionToggle('seekPermissionsForKeyLinkageRevelation')}
                  />
                }
                label={t('permissions_identity_linkage')}
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={localPermissionsConfig.seekPermissionsForIdentityResolution}
                    onChange={() => handlePermissionToggle('seekPermissionsForIdentityResolution')}
                  />
                }
                label={t('permissions_identity_resolution')}
              />
            </Box>

            <Divider sx={{ my: 3 }} />

            <Typography variant="h6" sx={{ mb: 2 }}>{t('permissions_basket_heading')}</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, ml: 2 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={localPermissionsConfig.seekBasketInsertionPermissions}
                    onChange={() => handlePermissionToggle('seekBasketInsertionPermissions')}
                  />
                }
                label={t('permissions_basket_insertion')}
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={localPermissionsConfig.seekBasketListingPermissions}
                    onChange={() => handlePermissionToggle('seekBasketListingPermissions')}
                  />
                }
                label={t('permissions_basket_listing')}
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={localPermissionsConfig.seekBasketRemovalPermissions}
                    onChange={() => handlePermissionToggle('seekBasketRemovalPermissions')}
                  />
                }
                label={t('permissions_basket_removal')}
              />
            </Box>

            <Divider sx={{ my: 3 }} />

            <Typography variant="h6" sx={{ mb: 2 }}>{t('permissions_certificate_heading')}</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, ml: 2 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={localPermissionsConfig.seekCertificateAcquisitionPermissions}
                    onChange={() => handlePermissionToggle('seekCertificateAcquisitionPermissions')}
                  />
                }
                label={t('permissions_certificate_acquisition')}
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={localPermissionsConfig.seekCertificateDisclosurePermissions}
                    onChange={() => handlePermissionToggle('seekCertificateDisclosurePermissions')}
                  />
                }
                label={t('permissions_certificate_disclosure')}
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={localPermissionsConfig.seekCertificateRelinquishmentPermissions}
                    onChange={() => handlePermissionToggle('seekCertificateRelinquishmentPermissions')}
                  />
                }
                label={t('permissions_certificate_relinquishment')}
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={localPermissionsConfig.seekCertificateListingPermissions}
                    onChange={() => handlePermissionToggle('seekCertificateListingPermissions')}
                  />
                }
                label={t('permissions_certificate_listing')}
              />
            </Box>

            <Divider sx={{ my: 3 }} />

            <Typography variant="h6" sx={{ mb: 2 }}>{t('permissions_action_heading')}</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, ml: 2 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={localPermissionsConfig.seekPermissionWhenApplyingActionLabels}
                    onChange={() => handlePermissionToggle('seekPermissionWhenApplyingActionLabels')}
                  />
                }
                label={t('permissions_action_label_apply')}
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={localPermissionsConfig.seekPermissionWhenListingActionsByLabel}
                    onChange={() => handlePermissionToggle('seekPermissionWhenListingActionsByLabel')}
                  />
                }
                label={t('permissions_action_label_listing')}
              />
            </Box>

            <Divider sx={{ my: 3 }} />

            <Typography variant="h6" sx={{ mb: 2 }}>{t('permissions_general_heading')}</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, ml: 2 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={localPermissionsConfig.seekGroupedPermission}
                    onChange={() => handlePermissionToggle('seekGroupedPermission')}
                  />
                }
                label={t('permissions_general_grouped')}
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={localPermissionsConfig.seekSpendingPermissions}
                    onChange={() => handlePermissionToggle('seekSpendingPermissions')}
                  />
                }
                label={t('permissions_general_spending')}
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={localPermissionsConfig.differentiatePrivilegedOperations}
                    onChange={() => handlePermissionToggle('differentiatePrivilegedOperations')}
                  />
                }
                label={t('permissions_general_privileged')}
              />
            </Box>

            <Box sx={{ mt: 3, display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
              <Button
                variant="outlined"
                onClick={handleResetPermissions}
              >
                {t('permissions_reset_button')}
              </Button>
              <Button
                variant="contained"
                onClick={handleSavePermissions}
              >
                {t('permissions_save_button')}
              </Button>
            </Box>
          </Box>
        </Collapse>
      </Paper>
    </div>
  )
}

export default Settings
