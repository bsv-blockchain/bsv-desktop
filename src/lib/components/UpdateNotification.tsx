import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  LinearProgress,
  Box
} from '@mui/material';
import { toast } from 'react-toastify';

interface UpdateInfo {
  version: string;
  releaseDate?: string;
  releaseNotes?: string;
}

interface DownloadProgress {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

interface UpdateNotificationProps {
  manualUpdateInfo?: UpdateInfo | null;
  onDismissManualUpdate?: () => void;
}

export const UpdateNotification: React.FC<UpdateNotificationProps> = ({
  manualUpdateInfo,
  onDismissManualUpdate
}) => {
  const { t } = useTranslation();
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [updateReady, setUpdateReady] = useState(false);

  // Handle manual update info from Settings
  useEffect(() => {
    if (manualUpdateInfo) {
      setUpdateInfo(manualUpdateInfo);
      setUpdateAvailable(true);
    }
  }, [manualUpdateInfo]);

  useEffect(() => {
    if (!window.electronAPI?.updates) return;

    // Query current update state on mount (in case we missed the event)
    const checkPendingUpdate = async () => {
      try {
        const result = await window.electronAPI.updates.getState();
        if (result.success && result.state) {
          const state = result.state;

          // If update is ready to install
          if (state.ready && state.updateInfo) {
            setUpdateInfo(state.updateInfo);
            setUpdateReady(true);
          }
          // If download is in progress
          else if (state.downloading && state.downloadProgress) {
            setUpdateInfo(state.updateInfo);
            setDownloadProgress(state.downloadProgress);
            setDownloading(true);
          }
          // If update is available but not downloaded
          else if (state.available && state.updateInfo && !state.downloading && !state.ready) {
            setUpdateInfo(state.updateInfo);
            setUpdateAvailable(true);
          }
        }
      } catch (error) {
        console.error('Failed to check pending update:', error);
      }
    };

    // Check immediately on mount
    checkPendingUpdate();

    // Listen for update available
    window.electronAPI.updates.onUpdateAvailable((info: UpdateInfo) => {
      console.log('Update available:', info);
      setUpdateInfo(info);
      setUpdateAvailable(true);
    });

    // Listen for download progress
    window.electronAPI.updates.onDownloadProgress((progress: DownloadProgress) => {
      console.log('Download progress:', progress);
      setDownloadProgress(progress);
    });

    // Listen for update downloaded
    window.electronAPI.updates.onUpdateDownloaded((info: UpdateInfo) => {
      console.log('Update downloaded:', info);
      setDownloading(false);
      setUpdateReady(true);
      toast.success(t('update_notification_downloaded_success'));
    });

    // Listen for errors
    window.electronAPI.updates.onUpdateError((error: string) => {
      console.error('Update error:', error);
      setDownloading(false);
      toast.error(`${t('update_notification_error_prefix')}: ${error}`);
    });

    return () => {
      window.electronAPI?.updates?.removeAllListeners();
    };
  }, []);

  const handleDownload = async () => {
    try {
      setDownloading(true);
      setUpdateAvailable(false);
      await window.electronAPI.updates.download();
      toast.info(t('update_notification_downloading'));
    } catch (error) {
      console.error('Failed to start download:', error);
      toast.error(t('update_notification_failed_to_start_download'));
      setDownloading(false);
    }
  };

  const handleInstall = async () => {
    try {
      await window.electronAPI.updates.install();
    } catch (error) {
      console.error('Failed to install update:', error);
      toast.error(t('update_notification_failed_to_install'));
    }
  };

  const handleDismiss = () => {
    setUpdateAvailable(false);
    if (onDismissManualUpdate) {
      onDismissManualUpdate();
    }
  };

  const handleDismissReady = () => {
    setUpdateReady(false);
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return t('update_notification_zero_bytes');
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  return (
    <>
      {/* Update Available Dialog */}
      <Dialog open={updateAvailable} onClose={handleDismiss}>
        <DialogTitle>{t('update_notification_available_title')}</DialogTitle>
        <DialogContent>
          <Typography variant="body1" gutterBottom>
            {t('update_notification_available_body')}
          </Typography>
          {updateInfo && (
            <>
              <Typography variant="body2" color="textSecondary" gutterBottom>
                {t('update_notification_version_label')}: {updateInfo.version}
              </Typography>
              {updateInfo.releaseNotes && (
                <Box mt={2}>
                  <Typography variant="body2" color="textSecondary">
                    {t('update_notification_release_notes_label')}:
                  </Typography>
                  <Box
                    sx={{
                      marginTop: 1,
                      padding: 1,
                      backgroundColor: 'background.paper',
                      borderRadius: 1,
                      border: '1px solid',
                      borderColor: 'divider'
                    }}
                  >
                    <div
                      dangerouslySetInnerHTML={{
                        __html: updateInfo.releaseNotes || t('update_notification_no_release_notes')
                      }}
                      style={{
                        fontSize: '0.875rem',
                        lineHeight: 1.5,
                        color: 'text.secondary'
                      }}
                    />
                  </Box>
                </Box>
              )}
            </>
          )}
          <Typography variant="body2" color="textSecondary" style={{ marginTop: 16 }}>
            {t('update_notification_data_preserved')}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDismiss} color="primary">
            {t('update_notification_later')}
          </Button>
          <Button onClick={handleDownload} color="primary" variant="contained">
            {t('update_notification_download_update')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Downloading Dialog */}
      <Dialog open={downloading} disableEscapeKeyDown>
        <DialogTitle>{t('update_notification_downloading_title')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" gutterBottom>
            {t('update_notification_downloading_body', { version: updateInfo?.version })}
          </Typography>
          {downloadProgress && (
            <Box mt={2}>
              <LinearProgress variant="determinate" value={downloadProgress.percent} />
              <Typography variant="body2" color="textSecondary" align="center" style={{ marginTop: 8 }}>
                {downloadProgress.percent.toFixed(1)}% - {formatBytes(downloadProgress.transferred)} / {formatBytes(downloadProgress.total)}
              </Typography>
              {downloadProgress.bytesPerSecond > 0 && (
                <Typography variant="body2" color="textSecondary" align="center">
                  {formatBytes(downloadProgress.bytesPerSecond)}/s
                </Typography>
              )}
            </Box>
          )}
        </DialogContent>
      </Dialog>

      {/* Update Ready Dialog */}
      <Dialog open={updateReady} onClose={handleDismissReady}>
        <DialogTitle>{t('update_notification_ready_title')}</DialogTitle>
        <DialogContent>
          <Typography variant="body1" gutterBottom>
            {t('update_notification_ready_body')}
          </Typography>
          <Typography variant="body2" color="textSecondary">
            {t('update_notification_ready_restart_note')}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDismissReady} color="primary">
            {t('update_notification_install_later')}
          </Button>
          <Button onClick={handleInstall} color="primary" variant="contained">
            {t('update_notification_install_and_restart')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};
