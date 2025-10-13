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
  Alert
} from '@mui/material'
import { WalletContext } from '../../WalletContext'

interface MessageBoxConfigProps {
  showTitle?: boolean
  embedded?: boolean
}

export default function MessageBoxConfig({ showTitle = true, embedded = false }: MessageBoxConfigProps) {
  const { useMessageBox, messageBoxUrl, updateMessageBoxUrl, removeMessageBoxUrl } = useContext(WalletContext)

  const [showMessageBoxDialog, setShowMessageBoxDialog] = useState(false)
  const [newMessageBoxUrl, setNewMessageBoxUrl] = useState('')
  const [messageBoxLoading, setMessageBoxLoading] = useState(false)

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
                borderRadius: 1
              }}>
                {messageBoxUrl}
              </Box>
            </Box>

            <Box sx={{ display: 'flex', gap: 2 }}>
              <Button
                variant="outlined"
                onClick={() => setShowMessageBoxDialog(true)}
                disabled={messageBoxLoading}
              >
                Update URL
              </Button>
              <Button
                variant="outlined"
                color="error"
                onClick={handleRemoveMessageBox}
                disabled={messageBoxLoading}
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
