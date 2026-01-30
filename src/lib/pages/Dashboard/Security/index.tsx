import React, { useContext, useState, useEffect } from 'react'
import { makeStyles } from '@mui/styles'
import { Theme } from '@mui/material/styles'
import {
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
  Paper,
  IconButton,
  Stack,
  Box,
  Alert
} from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import CheckIcon from '@mui/icons-material/Check'
import DownloadIcon from '@mui/icons-material/Download'
import { useHistory } from 'react-router-dom'
import ChangePassword from '../Settings/Password/index.js'
import RecoveryKey from '../Settings/RecoveryKey/index.js'
import { UserContext } from '../../../UserContext.js'
import { WalletContext } from '../../../WalletContext.js'
import PageLoading from '../../../components/PageLoading.js'
import { useExportDataToFile } from '../../../utils/exportDataToFile.js'
import { reconcileStoredKeyMaterial } from '../../../utils/keyMaterial.js'
import { Utils } from '@bsv/sdk'
import { toast } from 'react-toastify'

const useStyles = makeStyles((theme: Theme) => ({
  root: {
    padding: theme.spacing(3),
    maxWidth: '800px',
    margin: '0 auto'
  },
  section: {
    marginBottom: theme.spacing(4)
  },
  key: {
    userSelect: 'all',
    cursor: 'pointer',
    fontFamily: 'monospace',
    fontSize: '1.1em',
    padding: theme.spacing(2),
    width: '100%',
    background: theme.palette.action.hover,
    borderRadius: theme.shape.borderRadius,
    textAlign: 'center'
  }
}))

const Security: React.FC = () => {
  const classes = useStyles()
  const history = useHistory()
  const [showKeyDialog, setShowKeyDialog] = useState(false)
  const [recoveryKey, setRecoveryKey] = useState('')
  const { pageLoaded } = useContext(UserContext)
  const { loginType } = useContext(WalletContext)
  const isDirectKey = loginType === 'direct-key'
  const [copied, setCopied] = useState(false)
  // Move the hook to component level where it belongs
  const exportData = useExportDataToFile()

  // Private Key Management state (direct-key mode)
  const [savedMnemonic, setSavedMnemonic] = useState('')
  const [privateKeyHex, setPrivateKeyHex] = useState('')
  const [warningOpen, setWarningOpen] = useState(false)
  const [revealType, setRevealType] = useState<'mnemonic' | 'hex' | 'both'>('both')
  const [showSecrets, setShowSecrets] = useState(false)

  const hasMnemonic = savedMnemonic.trim().length > 0
  const hasHex = privateKeyHex.trim().length > 0
  const phraseWordCount = hasMnemonic ? savedMnemonic.trim().split(/\s+/).length : 0

  const selectionLabel =
    revealType === 'mnemonic' ? 'your recovery phrase' :
    revealType === 'hex' ? 'your hex key' : 'your recovery phrase and hex key'

  const loadStoredKeys = () => {
    const { keyHex, mnemonic } = reconcileStoredKeyMaterial()
    setPrivateKeyHex(keyHex)
    setSavedMnemonic(mnemonic)
  }

  useEffect(() => {
    if (isDirectKey) {
      loadStoredKeys()
    }
  }, [isDirectKey])

  const handleReveal = (type: 'mnemonic' | 'hex' | 'both') => {
    setRevealType(type)
    setShowSecrets(false)
    setWarningOpen(true)
  }

  const handleCloseWarning = () => {
    setWarningOpen(false)
    setShowSecrets(false)
  }

  const handleCopy = (data: string) => {
    navigator.clipboard.writeText(data)
    setCopied(true)
    setTimeout(() => {
      setCopied(false)
    }, 2000)
  }

  const handleViewKey = (key: string) => {
    setRecoveryKey(key)
    setShowKeyDialog(true)
  }

  const handleCloseDialog = () => {
    setShowKeyDialog(false)
    setRecoveryKey('')
  }

  const handleDownload = async (): Promise<void> => {
    const recoveryKeyData = `Metanet Recovery Key:\n\n${recoveryKey}\n\nSaved: ${new Date()}`
    // Use the hook's returned function that we defined at the component level
    const success = await exportData({ data: recoveryKeyData, filename: 'Metanet Recovery Key.txt', type: 'text/plain' })
    if (success) {
      toast.success('Recovery key downloaded successfully')
    } else {
      toast.error('Failed to download recovery key')
    }
  }

  if (!pageLoaded) {
    return <PageLoading />
  }

  if (isDirectKey) {
    return (
      <div className={classes.root}>
        <Typography variant="h1" color="textPrimary" sx={{ mb: 2 }}>
          Security
        </Typography>
        <Typography variant="body1" color="textSecondary" sx={{ mb: 2 }}>
          Manage your private key material.
        </Typography>

        <Paper elevation={0} className={classes.section} sx={{ p: 3, bgcolor: 'background.paper' }}>
          <Typography variant="h4" sx={{ mb: 2 }}>
            Private Key Management
          </Typography>
          <Typography variant="body1" color="textSecondary" sx={{ mb: 2 }}>
            Export the key material saved during sign-in. Only reveal this information when you are sure nobody else can see your screen.
          </Typography>
          <Alert severity="warning" sx={{ mb: 3 }}>
            Anyone with these words or your hex key can move your funds and impersonate you. Keep them offline and out of sight.
          </Alert>
          <Stack spacing={2} direction={{ xs: 'column', sm: 'row' }}>
            <Button
              variant="outlined"
              disabled={!hasMnemonic}
              onClick={() => handleReveal('mnemonic')}
              sx={{ textTransform: 'none', flex: 1 }}
            >
              Reveal recovery phrase
            </Button>
            <Button
              variant="outlined"
              disabled={!hasHex}
              onClick={() => handleReveal('hex')}
              sx={{ textTransform: 'none', flex: 1 }}
            >
              Reveal hex key
            </Button>
            <Button
              variant="contained"
              disabled={!hasMnemonic && !hasHex}
              onClick={() => handleReveal('both')}
              sx={{ textTransform: 'none', flex: 1 }}
            >
              Reveal both
            </Button>
          </Stack>
          <Button
            onClick={loadStoredKeys}
            size="small"
            sx={{ mt: 2, textTransform: 'none' }}
          >
            Refresh saved keys
          </Button>
          {!hasMnemonic && !hasHex && (
            <Typography variant="body2" color="textSecondary" sx={{ mt: 1 }}>
              No keys available yet. Unlock your wallet through the greeter to save your phrase or hex key locally.
            </Typography>
          )}
        </Paper>

        <Dialog
          open={warningOpen}
          onClose={handleCloseWarning}
          fullWidth
          maxWidth="sm"
        >
          <DialogTitle>Keep your keys private</DialogTitle>
          <DialogContent dividers>
            <Alert severity="warning" sx={{ mb: 2 }}>
              Make sure no one is watching your screen or recording it before you proceed.
            </Alert>
            <Typography variant="body1">
              You are about to reveal {selectionLabel}. Treat it like cash — anyone who sees it can take your funds.
            </Typography>

            {showSecrets && (
              <Box sx={{ display: 'grid', gap: 2, mt: 2 }}>
                {revealType !== 'hex' && (
                  <Box>
                    <Typography variant="subtitle1" sx={{ mb: 1 }}>
                      Recovery phrase{phraseWordCount ? ` (${phraseWordCount} words)` : ''}
                    </Typography>
                    {hasMnemonic ? (
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {savedMnemonic.trim().split(/\s+/).map((word, idx) => (
                          <Box
                            key={`${word}-${idx}`}
                            sx={{
                              px: 1.1,
                              py: 0.6,
                              borderRadius: 1,
                              bgcolor: 'action.hover',
                              fontSize: '0.9rem'
                            }}
                          >
                            {idx + 1}. {word}
                          </Box>
                        ))}
                      </Box>
                    ) : (
                      <Typography variant="body2" color="textSecondary">
                        No phrase saved on this device.
                      </Typography>
                    )}
                  </Box>
                )}

                {revealType !== 'mnemonic' && (
                  <Box>
                    <Typography variant="subtitle1" sx={{ mb: 1 }}>
                      Hex key
                    </Typography>
                    {hasHex ? (
                      <Box
                        sx={{
                          fontFamily: 'monospace',
                          p: 2,
                          borderRadius: 1,
                          bgcolor: 'action.hover',
                          wordBreak: 'break-all'
                        }}
                      >
                        {privateKeyHex}
                      </Box>
                    ) : (
                      <Typography variant="body2" color="textSecondary">
                        No hex key saved on this device.
                      </Typography>
                    )}
                  </Box>
                )}
              </Box>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={handleCloseWarning}>Close</Button>
            {!showSecrets && (
              <Button variant="contained" onClick={() => setShowSecrets(true)}>
                Reveal now
              </Button>
            )}
          </DialogActions>
        </Dialog>
      </div>
    )
  }

  return (
    <div className={classes.root}>
      <Typography variant="h1" color="textPrimary" sx={{ mb: 2 }}>
        Security
      </Typography>
      <Typography variant="body1" color="textSecondary" sx={{ mb: 2 }}>
        Manage your password and recovery key settings.
      </Typography>

      <Paper elevation={0} className={classes.section} sx={{ p: 3, bgcolor: 'background.paper' }}>
        <ChangePassword history={history} />
      </Paper>

      <Paper elevation={0} className={classes.section} sx={{ p: 3, bgcolor: 'background.paper' }}>
        <RecoveryKey history={history} onViewKey={handleViewKey} />
      </Paper>

      <Dialog
        open={showKeyDialog}
        onClose={handleCloseDialog}
        aria-labelledby="recovery-key-dialog-title"
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle id="recovery-key-dialog-title">
          Your Recovery Key
        </DialogTitle>
        <DialogContent>
          <DialogContentText color="textSecondary" sx={{ mb: 2 }}>
            Please save this key in a secure location. You will need it to recover your account if you forget your password.
          </DialogContentText>
          <Stack sx={{ my: 3 }} direction="row" alignItems="center" justifyContent="space-between">
            <Typography className={classes.key}>
              {recoveryKey}
            </Typography>
            <Stack><IconButton size='large' onClick={() => handleCopy(recoveryKey)} disabled={copied} sx={{ ml: 1 }}>
              {copied ? <CheckIcon /> : <ContentCopyIcon fontSize='small' />}
            </IconButton></Stack>
          </Stack>
          <Button
            variant='contained'
            color='primary'
            startIcon={<DownloadIcon />}
            onClick={handleDownload}
            fullWidth
            sx={{ p: 2 }}
          >
            Save as a File
          </Button>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog} color="primary">
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  )
}

export default Security
