import React, { useContext, useState } from 'react'
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
  Stack
} from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import CheckIcon from '@mui/icons-material/Check'
import DownloadIcon from '@mui/icons-material/Download'
import { useHistory } from 'react-router-dom'
import ChangePassword from '../Settings/Password'
import RecoveryKey from '../Settings/RecoveryKey'
import { UserContext } from '../../../UserContext'
import PageLoading from '../../../components/PageLoading.js'
import { downloadFile } from '../../../utils/exportDataToFile.js'
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
  const [copied, setCopied] = useState(false)

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
    const success = await downloadFile('Metanet Recovery Key.txt', Utils.toArray(recoveryKeyData, 'utf8'))
    if (success) {
      toast.success('Recovery key downloaded successfully')
    } else {
      toast.error('Failed to download recovery key')
    }
  }

  if (!pageLoaded) {
    return <PageLoading />
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
