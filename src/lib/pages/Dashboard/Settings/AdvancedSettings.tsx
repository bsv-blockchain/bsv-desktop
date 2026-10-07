import { Link as RouterLink } from 'react-router-dom'
import { useState, useContext, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Typography,
  LinearProgress,
  Box,
  Paper,
  Button,
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
import { toast } from 'react-toastify'
import { WalletContext } from '../../../WalletContext.js'
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded'
import { UserContext } from '../../../UserContext.js'
import PageLoading from '../../../components/PageLoading.js'
import MessageBoxConfig from '../../../components/MessageBoxConfig/index.tsx'
import WalletDiagnosis from './WalletDiagnosis.tsx'
import FeeSettings from './FeeSettings.tsx'
import { beginUserWalletOperation } from '../../../services/httpBridgeSession'
const AdvancedSettings = () => {
  const { t } = useTranslation()
  const { chain, useRemoteStorage, storageUrl, backupStorageUrls, addBackupStorageUrl, removeBackupStorageUrl, syncBackupStorage, setPrimaryStorage, permissionsConfig, updatePermissionsConfig } = useContext(WalletContext)
  const { pageLoaded } = useContext(UserContext)

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

  // Permissions configuration state
  const [localPermissionsConfig, setLocalPermissionsConfig] = useState(permissionsConfig)
  const [permissionsExpanded, setPermissionsExpanded] = useState(false)

  useEffect(() => {
    setLocalPermissionsConfig(permissionsConfig)
  }, [permissionsConfig])

  const handleAddBackupStorage = async (local?: boolean) => {
    if (!newBackupUrl && !local) {
      toast.error(t('backup_error_empty_url'));
      return;
    }

    let release: (() => void) | undefined
    try {
      release = beginUserWalletOperation()
      setBackupLoading(true);
      await addBackupStorageUrl(local ? 'LOCAL_STORAGE' : newBackupUrl);
      setShowBackupDialog(false);
      setNewBackupUrl('');
    } catch (e: any) {
      console.error('[Settings] addBackupStorageUrl failed:', e);
      toast.error(t('backup_error_add_failed', { message: e?.message || 'unknown error' }));
    } finally {
      release?.()
      setBackupLoading(false);
    }
  }

  const handleRemoveBackupStorage = async (url: string) => {
    let release: (() => void) | undefined
    try {
      release = beginUserWalletOperation()
      setBackupLoading(true);
      await removeBackupStorageUrl(url);
    } catch (e) {
      // Error already shown by removeBackupStorageUrl
    } finally {
      release?.()
      setBackupLoading(false);
    }
  }

  const handleMakePrimary = async (target: string) => {
    setSyncError('');
    setSyncProgressLogs([]);
    setSyncComplete(false);
    setShowSyncProgress(true);
    setBackupLoading(true);
    const progressCallback = (message: string) => {
      for (const line of message.split('\n')) {
        if (line.trim()) setSyncProgressLogs((prev) => [...prev, line]);
      }
    };
    let release: (() => void) | undefined
    try {
      release = beginUserWalletOperation()
      await setPrimaryStorage(target, progressCallback);
    } catch (e: any) {
      console.error('[Settings] setPrimaryStorage failed:', e);
      setSyncError(e?.message || 'Failed to switch primary storage');
    } finally {
      // Mark complete regardless of outcome so the dialog button flips from Cancel to Close.
      release?.()
      setSyncComplete(true);
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

    let release: (() => void) | undefined
    try {
      release = beginUserWalletOperation()
      await syncBackupStorage(progressCallback);
      toast.success(t('sync_backup_success'));
    } catch (e: any) {
      console.error('Sync error:', e);
      setSyncError(e?.message || String(e));
      toast.error(t('sync_backup_error', { error: e?.message || 'Unknown error' }));
    } finally {
      release?.()
      setSyncComplete(true);
      setSyncLoading(false);
    }
  }

  const handlePermissionToggle = (key: keyof typeof localPermissionsConfig) => {
    setLocalPermissionsConfig(prev => ({
      ...prev,
      [key]: !prev[key]
    }))
  }

  const handleSavePermissions = async () => {
    let release: (() => void) | undefined
    try {
      release = beginUserWalletOperation()
      await updatePermissionsConfig(localPermissionsConfig)
      handleReloadApp()
    } catch (e) {
      // Error already shown by updatePermissionsConfig
    } finally { release?.() }
  }

  const handleResetPermissions = () => {
    setLocalPermissionsConfig(permissionsConfig)
    setPermissionsExpanded(false)
  }

  const handleReloadApp = () => {
    window.location.reload()
  }

  if (!pageLoaded) {
    return <PageLoading />
  }

  return (
    <Box sx={{ maxWidth: 880, pb: 4 }}>
      <Button component={RouterLink} to="/dashboard/settings" startIcon={<ArrowBackRounded />} sx={{ mb: 2 }}>Back to settings</Button>
      <Typography variant="h1" color="textPrimary" sx={{ mb: 2 }}>
        Advanced settings
      </Typography>
      <Typography variant="body1" color="textSecondary" sx={{ mb: 2 }}>
        Manage fees, storage backups, payment delivery, and app permissions.
      </Typography>

      <Button component={RouterLink} to="/recovery/wallet-data" variant="outlined" sx={{ mb: 3 }}>Wallet data files · export, import and recovery</Button>

      <FeeSettings key={`${chain}-${useRemoteStorage}`} chain={chain} remote={useRemoteStorage} />

      <Paper elevation={0} sx={{ p: 3, mb: 4, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 3 }}>
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
                      variant="contained"
                      color="primary"
                      size="small"
                      onClick={() => handleMakePrimary(url)}
                      disabled={backupLoading}
                    >
                      {t('backup_storage_make_primary_button')}
                    </Button>
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


      <Dialog open={showBackupDialog} onClose={() => !backupLoading && setShowBackupDialog(false)} maxWidth="sm" fullWidth>
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

      <Dialog open={showSyncProgress} onClose={() => !syncLoading && !backupLoading && setShowSyncProgress(false)} maxWidth="md" fullWidth>
        <DialogTitle>{t('sync_progress_dialog_title')}</DialogTitle>
        <DialogContent>
          {syncError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {syncError}
            </Alert>
          )}
          <Box
            sx={{
              width: '100%',
              boxSizing: 'border-box',
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
          {(syncLoading || backupLoading) && (
            <Box sx={{ mt: 2 }}>
              <LinearProgress />
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setShowSyncProgress(false)}
            disabled={syncLoading || backupLoading}
            variant="contained"
          >
            {syncComplete ? t('sync_progress_close_button') : t('sync_progress_cancel_button')}
          </Button>
        </DialogActions>
      </Dialog>

      <WalletDiagnosis />

      <Paper elevation={0} sx={{ p: 3, mb: 4, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 3 }}>
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
    </Box>
  )
}

export default AdvancedSettings
