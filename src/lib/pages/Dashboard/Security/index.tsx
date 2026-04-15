import React, { useContext, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
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
    revealType === 'hex' ? 'your private key' : 'your recovery phrase and private key'

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
      toast.success(t('security_toast_download_success'))
    } else {
      toast.error(t('security_toast_download_error'))
    }
  }

  if (!pageLoaded) {
    return <PageLoading />
  }

  if (isDirectKey) {
    return (
      <div className={classes.root}>
        <Typography variant="h1" color="textPrimary" sx={{ mb: 2 }}>
          {t('security_page_title')}
        </Typography>
        <Typography variant="body1" color="textSecondary" sx={{ mb: 2 }}>
          {t('security_page_description_direct_key')}
        </Typography>

        <Paper elevation={0} className={classes.section} sx={{ p: 3, bgcolor: 'background.paper' }}>
          <Typography variant="h4" sx={{ mb: 2 }}>
            {t('security_section_title_private_key')}
          </Typography>
          <Typography variant="body1" color="textSecondary" sx={{ mb: 2 }}>
            {t('security_private_key_description')}
          </Typography>
          <Alert severity="warning" sx={{ mb: 3 }}>
            {t('security_alert_warning_private_key')}
          </Alert>
          <Stack spacing={2} direction={{ xs: 'column', sm: 'row' }}>
            <Button
              variant="outlined"
              disabled={!hasMnemonic}
              onClick={() => handleReveal('mnemonic')}
              sx={{ textTransform: 'none', flex: 1 }}
            >
              {t('security_button_reveal_phrase')}
            </Button>
            <Button
              variant="outlined"
              disabled={!hasHex}
              onClick={() => handleReveal('hex')}
              sx={{ textTransform: 'none', flex: 1 }}
            >
              {t('security_button_reveal_private_key')}
            </Button>
            <Button
              variant="contained"
              disabled={!hasMnemonic && !hasHex}
              onClick={() => handleReveal('both')}
              sx={{ textTransform: 'none', flex: 1 }}
            >
              {t('security_button_reveal_both')}
            </Button>
          </Stack>
          <Button
            onClick={loadStoredKeys}
            size="small"
            sx={{ mt: 2, textTransform: 'none' }}
          >
            {t('security_button_refresh_keys')}
          </Button>
          {!hasMnemonic && !hasHex && (
            <Typography variant="body2" color="textSecondary" sx={{ mt: 1 }}>
              {t('security_no_keys_message')}
            </Typography>
          )}
        </Paper>

        <Dialog
          open={warningOpen}
          onClose={handleCloseWarning}
          fullWidth
          maxWidth="sm"
        >
          <DialogTitle>{t('security_dialog_title_keep_private')}</DialogTitle>
          <DialogContent dividers>
            <Alert severity="warning" sx={{ mb: 2 }}>
              {t('security_dialog_alert_warning')}
            </Alert>
            <Typography variant="body1">
              {t('security_dialog_message_reveal', { selectionLabel })}
            </Typography>

            {showSecrets && (
              <Box sx={{ display: 'grid', gap: 2, mt: 2 }}>
                {revealType !== 'hex' && (
                  <Box>
                    <Typography variant="subtitle1" sx={{ mb: 1 }}>
                      {t('security_recovery_phrase_title')}{phraseWordCount ? ` (${phraseWordCount} words)` : ''}
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
                        {t('security_recovery_phrase_no_words')}
                      </Typography>
                    )}
                  </Box>
                )}

                {revealType !== 'mnemonic' && (
                  <Box>
                    <Typography variant="subtitle1" sx={{ mb: 1 }}>
                      {t('security_private_key_title')}
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
                        {t('security_private_key_no_saved')}
                      </Typography>
                    )}
                  </Box>
                )}
              </Box>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={handleCloseWarning}>{t('security_button_close')}</Button>
            {!showSecrets && (
              <Button variant="contained" onClick={() => setShowSecrets(true)}>
                {t('security_button_reveal_now')}
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
        {t('security_page_title')}
      </Typography>
      <Typography variant="body1" color="textSecondary" sx={{ mb: 2 }}>
        {t('security_page_description_recovery')}
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
          {t('security_dialog_recovery_key_title')}
        </DialogTitle>
        <DialogContent>
          <DialogContentText color="textSecondary" sx={{ mb: 2 }}>
            {t('security_dialog_recovery_key_description')}
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
            {t('security_button_save_as_file')}
          </Button>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog} color="primary">
            {t('security_button_close')}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  )
}

export default Security
