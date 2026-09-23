import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  LinearProgress,
  Box,
  Stack
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { toast } from 'react-toastify';
import { releaseNotesToHtml } from '../utils/formatReleaseNotes';

interface UpdateInfo {
  version: string;
  releaseDate?: string;
  releaseNotes?: string | Array<{ version: string; note: string | null }> | null;
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

const dialogPaperSx = {
  width: '100%',
  maxWidth: 520
} as const;

export const UpdateNotification: React.FC<UpdateNotificationProps> = ({
  manualUpdateInfo,
  onDismissManualUpdate
}) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [updateReady, setUpdateReady] = useState(false);

  const notesHtml = useMemo(
    () => releaseNotesToHtml(updateInfo?.releaseNotes),
    [updateInfo?.releaseNotes]
  );

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

  const linkColor = theme.palette.mode === 'light' ? '#1B365D' : '#8BB4E0';
  const linkHover = theme.palette.mode === 'light' ? '#2C5282' : '#B7D2F3';
  const notesInk = theme.palette.mode === 'light' ? '#3D4654' : 'rgba(255,255,255,0.82)';
  const notesSurface = theme.palette.mode === 'light'
    ? 'rgba(27,54,93,0.04)'
    : 'rgba(255,255,255,0.045)';
  const notesBorder = theme.palette.mode === 'light'
    ? 'rgba(27,54,93,0.10)'
    : 'rgba(255,255,255,0.08)';

  const versionChip = updateInfo?.version ? (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        px: 1.25,
        py: 0.35,
        borderRadius: '999px',
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: '0.01em',
        fontVariantNumeric: 'tabular-nums',
        color: '#FFFFFF',
        backgroundColor: 'rgba(255,255,255,0.16)',
        border: '1px solid rgba(255,255,255,0.18)'
      }}
    >
      {updateInfo.version}
    </Box>
  ) : null;

  return (
    <>
      {/* Update Available Dialog */}
      <Dialog
        open={updateAvailable}
        onClose={handleDismiss}
        fullWidth
        PaperProps={{ sx: dialogPaperSx }}
      >
        <DialogTitle component="div" sx={{ px: 3, py: 2 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" gap={2}>
            <Typography component="h2" variant="h6" fontWeight={700} sx={{ color: 'inherit' }}>
              {t('update_notification_available_title')}
            </Typography>
            {versionChip}
          </Stack>
        </DialogTitle>
        <DialogContent sx={{ p: 0 }}>
          <Box sx={{ px: 3, pt: 3, pb: 1.5 }}>
          <Typography variant="body1" sx={{ mb: 2.5, lineHeight: 1.55 }}>
            {t('update_notification_available_body')}
          </Typography>
          {notesHtml ? (
            <Box sx={{ mb: 2.5 }}>
              <Typography
                variant="overline"
                sx={{
                  display: 'block',
                  mb: 1,
                  color: 'text.secondary',
                  letterSpacing: '0.08em',
                  fontWeight: 600
                }}
              >
                {t('update_notification_release_notes_label')}
              </Typography>
              <Box
                className="update-release-notes"
                sx={{
                  px: 2.5,
                  py: 2,
                  maxHeight: 300,
                  overflow: 'auto',
                  borderRadius: '8px',
                  backgroundColor: notesSurface,
                  border: '1px solid',
                  borderColor: notesBorder,
                  color: notesInk,
                  fontSize: '0.9rem',
                  lineHeight: 1.6,
                  '& > :first-of-type': { mt: 0 },
                  '& > :last-child': { mb: 0 },
                  '& h1, & h2, & h3': {
                    color: theme.palette.mode === 'light' ? '#1B365D' : '#FFFFFF',
                    fontWeight: 600,
                    letterSpacing: '-0.015em',
                    textWrap: 'balance',
                    mt: 2,
                    mb: 1
                  },
                  '& h1': { fontSize: '1.15rem' },
                  '& h2': { fontSize: '1.02rem' },
                  '& h3': { fontSize: '0.95rem' },
                  '& p': { my: 1.25 },
                  '& ul, & ol': { my: 1.25, pl: 2.5 },
                  '& li': { mb: 0.75, pl: 0.25 },
                  '& li::marker': { color: alpha(linkColor, 0.7) },
                  '& a': {
                    color: `${linkColor} !important`,
                    textDecoration: 'underline',
                    textDecorationColor: alpha(linkColor, 0.35),
                    textUnderlineOffset: '3px',
                    fontWeight: 500
                  },
                  '& a:hover': {
                    color: `${linkHover} !important`,
                    textDecorationColor: linkHover
                  },
                  '& a:visited': {
                    color: `${linkColor} !important`
                  },
                  '& code': {
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    fontSize: '0.82em',
                    px: 0.6,
                    py: 0.15,
                    borderRadius: '4px',
                    backgroundColor: theme.palette.mode === 'light'
                      ? 'rgba(27,54,93,0.08)'
                      : 'rgba(255,255,255,0.08)'
                  },
                  '& pre': {
                    my: 1.5,
                    px: 1.5,
                    py: 1.25,
                    overflow: 'auto',
                    borderRadius: '6px',
                    backgroundColor: theme.palette.mode === 'light'
                      ? 'rgba(27,54,93,0.06)'
                      : 'rgba(0,0,0,0.28)'
                  },
                  '& pre code': {
                    px: 0,
                    backgroundColor: 'transparent'
                  },
                  '& hr': {
                    border: 0,
                    borderTop: `1px solid ${notesBorder}`,
                    my: 2
                  },
                  '& strong': { fontWeight: 600, color: theme.palette.mode === 'light' ? '#1B365D' : '#FFFFFF' }
                }}
                dangerouslySetInnerHTML={{ __html: notesHtml }}
              />
            </Box>
          ) : null}
          <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.5 }}>
            {t('update_notification_data_preserved')}
          </Typography>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2, gap: 1 }}>
          <Button onClick={handleDismiss} color="primary">
            {t('update_notification_later')}
          </Button>
          <Button onClick={handleDownload} color="primary" variant="contained">
            {t('update_notification_download_update')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Downloading Dialog */}
      <Dialog open={downloading} disableEscapeKeyDown fullWidth PaperProps={{ sx: dialogPaperSx }}>
        <DialogTitle component="div" sx={{ px: 3, py: 2 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" gap={2}>
            <Typography component="h2" variant="h6" fontWeight={700} sx={{ color: 'inherit' }}>
              {t('update_notification_downloading_title')}
            </Typography>
            {versionChip}
          </Stack>
        </DialogTitle>
        <DialogContent sx={{ p: 0 }}>
          <Box sx={{ px: 3, pt: 3, pb: 3 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3, lineHeight: 1.55 }}>
            {t('update_notification_downloading_body', { version: updateInfo?.version })}
          </Typography>
          {downloadProgress && (
            <Box>
              <Typography
                sx={{
                  fontSize: 32,
                  fontWeight: 600,
                  letterSpacing: '-0.03em',
                  fontVariantNumeric: 'tabular-nums',
                  lineHeight: 1,
                  mb: 2,
                  color: theme.palette.mode === 'light' ? '#1B365D' : '#FFFFFF'
                }}
              >
                {downloadProgress.percent.toFixed(0)}%
              </Typography>
              <LinearProgress
                variant="determinate"
                value={downloadProgress.percent}
                sx={{
                  height: 6,
                  borderRadius: 999,
                  backgroundColor: notesSurface,
                  '& .MuiLinearProgress-bar': { borderRadius: 999 }
                }}
              />
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mt: 1.5, fontVariantNumeric: 'tabular-nums' }}
              >
                {formatBytes(downloadProgress.transferred)} / {formatBytes(downloadProgress.total)}
                {downloadProgress.bytesPerSecond > 0
                  ? ` · ${formatBytes(downloadProgress.bytesPerSecond)}/s`
                  : ''}
              </Typography>
            </Box>
          )}
          </Box>
        </DialogContent>
      </Dialog>

      {/* Update Ready Dialog */}
      <Dialog
        open={updateReady}
        onClose={handleDismissReady}
        fullWidth
        PaperProps={{ sx: dialogPaperSx }}
      >
        <DialogTitle component="div" sx={{ px: 3, py: 2 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" gap={2}>
            <Typography component="h2" variant="h6" fontWeight={700} sx={{ color: 'inherit' }}>
              {t('update_notification_ready_title')}
            </Typography>
            {versionChip}
          </Stack>
        </DialogTitle>
        <DialogContent sx={{ p: 0 }}>
          <Box sx={{ px: 3, pt: 3, pb: 1.5 }}>
          <Typography variant="body1" sx={{ mb: 1.5, lineHeight: 1.55 }}>
            {t('update_notification_ready_body')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.55 }}>
            {t('update_notification_ready_restart_note')}
          </Typography>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2, gap: 1 }}>
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
