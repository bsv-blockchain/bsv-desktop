import { useState, useEffect, useContext } from 'react'
import { DialogContent, DialogActions, Button, Typography } from '@mui/material'
import CustomDialog from './CustomDialog'
import { WalletContext } from '../WalletContext'

const FundingHandler: React.FC = () => {
  const { setWalletFunder } = useContext(WalletContext)
  const [open, setOpen] = useState(false)
  const [rootKey, setRootKey] = useState('')
  const [resolveFn, setResolveFn] = useState<Function>(() => {})

  useEffect(() => {
    setWalletFunder((presentationKey: number[], wallet: any, adminOriginator: string): Promise<void> => {
      return new Promise<void>(resolve => {
        try {
          const keyHex = wallet.signer.keyDeriver.rootKey.toString()
          setRootKey(keyHex)
        } catch (e) {
          setRootKey('')
        }
        setResolveFn(() => resolve)
        setOpen(true)
      })
    })
  }, [setWalletFunder])

  const handleClose = () => {
    setOpen(false)
    resolveFn()
  }

  return (
    <CustomDialog open={open} onClose={handleClose} title='Fund Your Wallet'>
      <DialogContent>
        <Typography variant='body1' sx={{ wordBreak: 'break-all' }}>
          Please fund the following root key with satoshis to activate your wallet:
        </Typography>
        <Typography variant='body2' sx={{ mt: 2, userSelect: 'all', wordBreak: 'break-all' }}>
          {rootKey}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button variant='contained' onClick={handleClose}>OK</Button>
      </DialogActions>
    </CustomDialog>
  )
}

export default FundingHandler
