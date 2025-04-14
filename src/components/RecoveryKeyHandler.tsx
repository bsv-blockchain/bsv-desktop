import { useState, useEffect, FC, useContext } from 'react'
import {
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
  FormControlLabel,
  Checkbox,
  Typography,
  useTheme,
  Box,
  IconButton,
  Grid2,
  Stack
} from '@mui/material'
import CustomDialog from './CustomDialog/index.jsx'
import LockIcon from '@mui/icons-material/Lock'
import DownloadIcon from '@mui/icons-material/Download'
import exportDataToFile, { downloadFile } from '../utils/exportDataToFile'
import { Utils } from '@bsv/sdk';
import { WalletContext } from '../WalletContext'
import CheckIcon from '@mui/icons-material/Check'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { toast } from 'react-toastify'

const RecoveryKeyHandler: FC = () => {
  const { managers, setRecoveryKeySaver } = useContext(WalletContext)
  const [open, setOpen] = useState(false)
  const [recoveryKey, setRecoveryKey] = useState<string>('')
  const [affirmative1, setAffirmative1] = useState(false)
  const [affirmative2, setAffirmative2] = useState(false)
  const [affirmative3, setAffirmative3] = useState(false)

  const [resolve, setResolve] = useState<Function>(() => { })
  const [reject, setReject] = useState<Function>(() => { })
  const [copied, setCopied] = useState(false)

  const handleCopy = (data) => {
    navigator.clipboard.writeText(data)
    setCopied(true)
    setTimeout(() => {
      setCopied(false)
    }, 2000)
  }

  useEffect(() => {
    setRecoveryKeySaver((): any => {
      return (key: number[]): Promise<true> => {
        return new Promise((resolve, reject) => {
          const keyAsStr = Utils.toBase64(key)
          setResolve(() => { return resolve })
          setReject(() => { return reject })
          setRecoveryKey(keyAsStr)
          setOpen(true)
        })
      }
    })
  }, [managers])

  const onKeySaved = async (): Promise<void> => {
    resolve(true)
    setOpen(false)
  }

  const onAbandon = async (): Promise<void> => {
    reject(new Error('User abandoned the backup process'))
    setOpen(false)
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


  const theme = useTheme()

  return (
    <CustomDialog
      open={open}
      title='Secure Access Backup and Recovery'
    >
      <DialogContent>
        { !affirmative1 && <>
          <DialogContentText variant='body1' sx={{ mt: 3, mb: 1, color: theme.palette.getContrastText(theme.palette.background.default) }}>
            Save Your Recovery Key Now:
          </DialogContentText>
          <Grid2 container spacing={2} width='100%'>
            <Stack sx={{ my: 3 }} direction="row" alignItems="center" justifyContent="space-between">
            <Typography 
                variant='body1'
                sx={{
                  userSelect: 'all',
                  overflow: 'hidden',
                  wordBreak: 'break-all'
                }}
                color={theme.palette.getContrastText(theme.palette.background.default)}>
              {recoveryKey}
            </Typography>
            <Stack>
              <IconButton size='large' onClick={() => handleCopy(recoveryKey)} disabled={copied} sx={{ ml: 1 }}>
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
          </Grid2>
          <Box my={3}>
            <DialogContentText>Take a screenshot, email it to yourself, print it out and put it in a safe, or save it to secure cloud storage.</DialogContentText>
          </Box>
        </>}
        <DialogContentText sx={{ color: theme.palette.getContrastText(theme.palette.background.default) }}>
          <FormControlLabel
            control={<Checkbox
              checked={affirmative1}
              onChange={() => setAffirmative1(x => !x)}
            />}
            label={'I have saved my recovery key in a secure location'}
            labelPlacement="start"
            sx={{ m: 0, p: 0 }}
          />
        </DialogContentText>
        { affirmative1 && <>
        <DialogContentText variant='body1' sx={{ mt: 3, mb: 1 }}>
          Any 2 of 3 factors are required to access your data:
        </DialogContentText>
        <DialogContentText sx={{ mb: 3, textAlign: 'center', fontWeight: 'bold', color: theme.palette.getContrastText(theme.palette.background.default) }}>
          Phone, Password, Recovery Key
        </DialogContentText>
        <DialogContentText variant='body1' sx={{ mt: 3, mb: 1 }}>
          When you lose your phone or forget your password, you must use the other factors to re-establish secure control. This is a perfectly normal and unavoidable fact of life. However -
        </DialogContentText>
        <DialogContentText>
          <Typography 
            variant="body2" 
            color="error" 
            sx={{ 
              mt: 2, 
              mb: 2, 
              fontWeight: 'bold',
              textAlign: 'center',
              border: '1px solid',
              borderColor: 'error.main',
              p: 2,
              borderRadius: 1
             }}
          >
            Loss of more than one factor will result in TOTAL LOSS of access to all assets, encrypted data, and certificates.
          </Typography>
        </DialogContentText>
        <DialogContentText sx={{ color: theme.palette.getContrastText(theme.palette.background.default) }}>
          <FormControlLabel
            control={<Checkbox
              checked={affirmative3}
              onChange={() => setAffirmative3(x => !x)}
            />}
            label={'I will immediately recover lost factors using the other two'}
            labelPlacement="start"
            sx={{ m: 0, p: 0 }}
          />
        </DialogContentText>
        <DialogContentText sx={{ color: theme.palette.getContrastText(theme.palette.background.default) }}>
          <FormControlLabel
            control={<Checkbox
              checked={affirmative2}
              onChange={() => setAffirmative2(x => !x)}
            />}
            label={'I am solely responsible for maintaining access to my own data'}
            labelPlacement="start"
            sx={{ m: 0, p: 0 }}
          />
        </DialogContentText>
        </>}
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'space-between' }}>
        <Button
          onClick={onAbandon}
          variant='text'
        >
          Abandon
        </Button>
        <Button
          onClick={onKeySaved}
          sx={{ backgroundColor: '#006600' }}
          endIcon={<LockIcon />}
          variant='contained'
          disabled={(!affirmative1) || (!affirmative2) || (!affirmative3)}
        >
          Securely Saved
        </Button>
      </DialogActions>
    </CustomDialog>
  )
}

export default RecoveryKeyHandler
