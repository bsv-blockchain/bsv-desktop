import { useState, useContext } from 'react'
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
            Message Box Configuration
          </Typography>
          <Typography variant="body1" color="textSecondary" sx={{ mb: 3 }}>
            Configure your Message Box URL to enable secure messaging functionality.
          </Typography>
        </>
      )}

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {/* Display current URL if configured */}
        {useMessageBox && messageBoxUrl ? (
          <>
            <Box>
              <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
                Current Message Box URL
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
                  label={isHostAnointed ? "Anointed" : "Not Anointed"}
                  color={isHostAnointed ? "success" : "warning"}
                  size="small"
                />
              </Box>
            </Box>

            {/* Anointment Status and Actions */}
            {!isHostAnointed && (
              <Alert severity="info" sx={{ mt: 1 }}>
                <Typography variant="body2" sx={{ mb: 1 }}>
                  This host is not yet anointed. Anointing broadcasts your identity to the overlay network so others can send you payments and messages.
                </Typography>
                <Button
                  variant="contained"
                  size="small"
                  onClick={handleAnointHost}
                  disabled={anointmentLoading}
                  startIcon={anointmentLoading ? <CircularProgress size={16} /> : null}
                >
                  {anointmentLoading ? 'Anointing...' : 'Anoint Host'}
                </Button>
              </Alert>
            )}

            {isHostAnointed && (
              <Alert severity="success" sx={{ mt: 1 }}>
                <Typography variant="body2">
                  Host is anointed. You can receive payments and messages at this address.
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
                  {showAnointedHosts ? 'Hide' : 'Show'} Anointed Hosts ({anointedHosts.length})
                </Button>
                <Collapse in={showAnointedHosts}>
                  <List dense sx={{ bgcolor: 'action.hover', borderRadius: 1, mt: 1 }}>
                    {anointedHosts.map((token, index) => (
                      <ListItem key={`${token.txid}-${token.outputIndex}`}>
                        <ListItemText
                          primary={token.host}
                          secondary={`TXID: ${token.txid.slice(0, 8)}...${token.txid.slice(-8)}`}
                          primaryTypographyProps={{ sx: { fontFamily: 'monospace', fontSize: '0.85rem' } }}
                          secondaryTypographyProps={{ sx: { fontFamily: 'monospace', fontSize: '0.7rem' } }}
                        />
                        <ListItemSecondaryAction>
                          <Tooltip title="Revoke this anointment">
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
                Update URL
              </Button>
              <Button
                variant="outlined"
                color="error"
                onClick={handleRemoveMessageBox}
                disabled={messageBoxLoading || anointmentLoading}
              >
                Remove
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
            Enter Message Box URL
          </Button>
        )}
      </Box>

      <Dialog open={showMessageBoxDialog} onClose={() => !messageBoxLoading && setShowMessageBoxDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{useMessageBox && messageBoxUrl ? 'Update Message Box URL' : 'Enter Message Box URL'}</DialogTitle>
        <DialogContent>
          {useMessageBox && messageBoxUrl && (
            <Alert severity="info" sx={{ mb: 2, mt: 2 }}>
              Current: {messageBoxUrl}
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
            autoFocus
          />
          <Alert severity="info" sx={{ mt: 2 }}>
            After saving, you will need to anoint the host to enable receiving payments and messages.
          </Alert>
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
            {messageBoxLoading ? 'Saving...' : 'Save'}
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
