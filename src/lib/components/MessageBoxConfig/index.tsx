import { useState, useContext } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Typography,
  Box,
  Paper,
  Button,
  Chip,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  CircularProgress,
  Collapse,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  Tooltip
} from '@mui/material'
import DeleteIcon from '@mui/icons-material/Delete'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import { WalletContext } from '../../WalletContext'

interface MessageBoxConfigProps {
  showTitle?: boolean
  embedded?: boolean
}

export default function MessageBoxConfig({ showTitle = true, embedded = false }: MessageBoxConfigProps) {
  const { t } = useTranslation()
  const {
    useMessageBox,
    messageBoxUrl,
    updateMessageBoxUrl,
    removeMessageBoxUrl,
    isHostAnointed,
    anointedHosts,
    anointmentLoading,
    anointCurrentHost,
    revokeHostAnointment
  } = useContext(WalletContext)

  const [showMessageBoxDialog, setShowMessageBoxDialog] = useState(false)
  const [newMessageBoxUrl, setNewMessageBoxUrl] = useState('')
  const [messageBoxLoading, setMessageBoxLoading] = useState(false)
  const [showAnointedHosts, setShowAnointedHosts] = useState(false)

  const handleSetupMessageBox = async () => {
    if (!newMessageBoxUrl) {
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

  const handleAnointHost = async () => {
    try {
      await anointCurrentHost();
    } catch (e) {
      // Error already shown by anointCurrentHost
    }
  }

  const content = (
    <>
      {showTitle && (
        <>
          <Typography variant="h4" sx={{ mb: 2 }}>
            {t('msgbox_title')}
          </Typography>
          <Typography variant="body1" color="textSecondary" sx={{ mb: 3 }}>
            {t('msgbox_description')}
          </Typography>
        </>
      )}

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {/* Display current URL if configured */}
        {useMessageBox && messageBoxUrl ? (
          <>
            <Box>
              <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
                {t('msgbox_current_url_label')}
              </Typography>
              <Box component="div" sx={{
                fontFamily: 'monospace',
                wordBreak: 'break-all',
                bgcolor: 'action.hover',
                p: 1,
                borderRadius: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 1
              }}>
                <span>{messageBoxUrl}</span>
                <Chip
                  label={isHostAnointed ? t('msgbox_anointed') : t('msgbox_not_anointed')}
                  color={isHostAnointed ? "success" : "warning"}
                  size="small"
                />
              </Box>
            </Box>

            {/* Anointment Status and Actions */}
            {!isHostAnointed && (
              <Alert severity="warning" sx={{ mt: 1 }}>
                <Typography variant="body2" sx={{ mb: 1 }}>
                  {t('msgbox_not_anointed_description')}
                </Typography>
                <Button
                  variant="contained"
                  size="small"
                  onClick={handleAnointHost}
                  disabled={anointmentLoading}
                  startIcon={anointmentLoading ? <CircularProgress size={16} /> : null}
                >
                  {anointmentLoading ? t('msgbox_anointing') : t('msgbox_anoint_button')}
                </Button>
              </Alert>
            )}

            {isHostAnointed && (
              <Alert severity="success" sx={{ mt: 1 }}>
                <Typography variant="body2">
                  {t('msgbox_anointed_description')}
                </Typography>
              </Alert>
            )}

            {/* Show all anointed hosts */}
            {anointedHosts.length > 0 && (
              <Box sx={{ mt: 1 }}>
                <Button
                  size="small"
                  onClick={() => setShowAnointedHosts(!showAnointedHosts)}
                  endIcon={showAnointedHosts ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                >
                  {showAnointedHosts ? t('msgbox_hide_anointed_hosts') : t('msgbox_show_anointed_hosts')} ({anointedHosts.length})
                </Button>
                <Collapse in={showAnointedHosts}>
                  <List dense sx={{ bgcolor: 'action.hover', borderRadius: 1, mt: 1 }}>
                    {anointedHosts.map((token, index) => (
                      <ListItem key={`${token.txid}-${token.outputIndex}`}>
                        <ListItemText
                          primary={token.host}
                          secondary={`${t('msgbox_txid_label')}: ${token.txid.slice(0, 8)}...${token.txid.slice(-8)}`}
                          primaryTypographyProps={{ sx: { fontFamily: 'monospace', fontSize: '0.85rem' } }}
                          secondaryTypographyProps={{ sx: { fontFamily: 'monospace', fontSize: '0.7rem' } }}
                        />
                        <ListItemSecondaryAction>
                          <Tooltip title={t('msgbox_revoke_tooltip')}>
                            <IconButton
                              edge="end"
                              size="small"
                              onClick={() => revokeHostAnointment(token)}
                              disabled={anointmentLoading}
                            >
                              {anointmentLoading ? <CircularProgress size={16} /> : <DeleteIcon fontSize="small" />}
                            </IconButton>
                          </Tooltip>
                        </ListItemSecondaryAction>
                      </ListItem>
                    ))}
                  </List>
                </Collapse>
              </Box>
            )}

            <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
              <Button
                variant="outlined"
                onClick={() => setShowMessageBoxDialog(true)}
                disabled={messageBoxLoading || anointmentLoading}
              >
                {t('msgbox_update_url_button')}
              </Button>
              <Button
                variant="outlined"
                color="error"
                onClick={handleRemoveMessageBox}
                disabled={messageBoxLoading || anointmentLoading}
              >
                {t('msgbox_remove_button')}
              </Button>
            </Box>
          </>
        ) : (
          <Button
            variant="contained"
            size="large"
            onClick={() => setShowMessageBoxDialog(true)}
            disabled={messageBoxLoading}
            fullWidth
          >
            {t('msgbox_enter_url_button')}
          </Button>
        )}
      </Box>

      <Dialog open={showMessageBoxDialog} onClose={() => !messageBoxLoading && setShowMessageBoxDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{useMessageBox && messageBoxUrl ? t('msgbox_dialog_update_title') : t('msgbox_dialog_enter_title')}</DialogTitle>
        <DialogContent>
          {useMessageBox && messageBoxUrl && (
            <Alert severity="info" sx={{ mb: 2, mt: 2 }}>
              {t('msgbox_dialog_current')}: {messageBoxUrl}
            </Alert>
          )}
          <TextField
            fullWidth
            label={t('msgbox_url_field_label')}
            placeholder="https://messagebox.example.com"
            value={newMessageBoxUrl}
            onChange={(e) => setNewMessageBoxUrl(e.target.value)}
            disabled={messageBoxLoading}
            sx={{ mt: 2 }}
            autoFocus
          />
          <Alert severity="info" sx={{ mt: 2 }}>
            {t('msgbox_dialog_anoint_info')}
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowMessageBoxDialog(false)} disabled={messageBoxLoading}>
            {t('msgbox_cancel')}
          </Button>
          <Button
            onClick={handleSetupMessageBox}
            variant="contained"
            disabled={messageBoxLoading || !newMessageBoxUrl}
          >
            {messageBoxLoading ? t('msgbox_saving') : t('msgbox_save')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )

  if (embedded) {
    return content
  }

  return (
    <Paper elevation={0} sx={{ p: 3, bgcolor: 'background.paper' }}>
      {content}
    </Paper>
  )
}
