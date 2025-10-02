import { useState, useEffect, useContext } from 'react'
import { DialogContent, DialogActions, Button, Typography, TextField, Box, IconButton, Tooltip } from '@mui/material'
import CustomDialog from './CustomDialog'
import { WalletContext } from '../WalletContext'
import { WalletInterface } from '@bsv/sdk'
import { toast } from 'react-toastify'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'

const FundingHandler: React.FC = () => {
  const { setWalletFunder } = useContext(WalletContext)
  const [open, setOpen] = useState(false)
  const [identityKey, setIdentityKey] = useState('')
  const [paymentTX, setPaymentTX] = useState<string>('')
  const [resolveFn, setResolveFn] = useState<Function>(() => { })
  const [wallet, setWallet] = useState<WalletInterface | null>(null)

  useEffect(() => {
    setWalletFunder((() => {
      return async (_: number[], wallet: WalletInterface, adminOriginator: string): Promise<void> => {
        return new Promise<void>(async resolve => {
          try {
            const identityKey = (await wallet.getPublicKey({ identityKey: true }, adminOriginator)).publicKey
            setIdentityKey(identityKey)
          } catch (e) {
            setIdentityKey('')
          }
          setResolveFn(() => resolve)
          setWallet(wallet)
          setOpen(true)
        })
      }
    }) as any)
  }, [])

  const handleClose = () => {
    setOpen(false)
    resolveFn()
  }

  const handleFunded = async () => {
    try {
      const payment = JSON.parse(paymentTX)
      await wallet.internalizeAction(payment)
    } catch (e) {
      toast.error(e.message)
      console.error(e)
    } finally {
      setOpen(false)
      resolveFn()
    }
  }

  // const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
  //   const file = e.target.files && e.target.files[0]
  //   if (!file) return
  //   const reader = new FileReader()
  //   reader.onload = evt => {
  //     const text = evt.target?.result as string
  //     setPaymentTX(text.trim())
  //   }
  //   reader.readAsText(file)
  //   setFileName(file.name)
  // }


  return (
    <CustomDialog open={open} onClose={handleClose} title="Fund Your Wallet">
      <DialogContent>
        <Typography variant="body1" sx={{ wordBreak: 'break-all' }}>
          Please fund the following root key with satoshis to activate your wallet:
        </Typography>
        <Box sx={{ mt: 2, display: 'flex', alignItems: 'center', bgcolor: 'background.paper', p: 1 }}>
          <Typography variant="body2" sx={{ flexGrow: 1, userSelect: 'all', wordBreak: 'break-all', fontFamily: 'monospace' }}>
            {identityKey}
          </Typography>
          <Tooltip title="Copy to clipboard">
            <IconButton
              size="small"
              onClick={() => {
                navigator.clipboard.writeText(identityKey)
                  .then(() => toast.success('Identity key copied to clipboard'))
                  .catch(err => toast.error('Failed to copy: ' + err.message))
              }}
            >
              <ContentCopyIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
        <TextField
          label="Funding Transaction"
          placeholder="Paste your internalizable transaction JSON here (Can export from WUI)."
          multiline
          fullWidth
          rows={4}
          value={paymentTX}
          onChange={e => setPaymentTX(e.target.value)}
          variant="outlined"
          sx={{
            mt: 2,
            '& .MuiInputBase-input': { fontFamily: 'monospace' },
            '& .MuiOutlinedInput-root': {
              '& fieldset': {
                borderColor: 'rgba(0, 0, 0, 0.1)',
                borderWidth: '1px'
              },
              '&:hover fieldset': {
                borderColor: 'rgba(0, 0, 0, 0.2)'
              },
              '&.Mui-focused fieldset': {
                borderColor: 'rgba(0, 0, 0, 0.3)',
                borderWidth: '1px'
              }
            }
          }}
        />
        {/* <Button component="label" sx={{ mt: 1 }}>
          Upload Transaction File
          <input type="file" hidden accept=".txt,.hex" onChange={handleFileUpload} />
        </Button> */}
        {/* {fileName && (
          <Typography variant="caption" sx={{ display: 'block', mt: 1 }}>
            Uploaded file: {fileName}
          </Typography>
        )} */}
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={handleFunded} disabled={!setPaymentTX}>
          Fund Wallet
        </Button>
      </DialogActions>
    </CustomDialog>
  )
}

export default FundingHandler