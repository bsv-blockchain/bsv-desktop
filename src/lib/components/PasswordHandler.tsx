import { useState, useEffect, useContext, useCallback } from 'react'
import { DialogActions, DialogContent, Button, DialogContentText, TextField, InputAdornment, IconButton } from '@mui/material'
import CustomDialog from './CustomDialog'
import { UserContext, UserContextValue } from '../UserContext'
import { Visibility, VisibilityOff } from '@mui/icons-material'
import { toast } from 'react-toastify';
import { WalletContext } from '../WalletContext'

const PasswordHandler: React.FC = () => {
  const {
    onFocusRequested,
    onFocusRelinquished,
    isFocused
  } = useContext<UserContextValue>(UserContext)
  const [wasOriginallyFocused, setWasOriginallyFocused] = useState(false)
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [test, setTest] = useState<Function>(() => { })
  const [resolve, setResolve] = useState<Function>(() => { })
  const [reject, setReject] = useState<Function>(() => { })
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const { setPasswordRetriever } = useContext(WalletContext)

  const manageFocus = useCallback(() => {
    isFocused().then(wasOriginallyFocused => {
      setWasOriginallyFocused(wasOriginallyFocused)
      if (!wasOriginallyFocused) {
        onFocusRequested()
      }
    })
  }, [isFocused, onFocusRequested])

  // (reason: string, test: (passwordCandidate: string) => boolean) => Promise<string>

  useEffect(() => {
    setPasswordRetriever((): any => {
      return (reason: string, test: (passwordCandidate: string) => boolean): Promise<string> => {
        return new Promise<string>((resolve: Function, reject: Function) => {
          setReason(() => { return reason })
          setTest(() => { return test })
          setResolve(() => { return resolve })
          setReject(() => { return reject })
          setOpen(true)
          manageFocus()
        })
      }
    })
  }, [manageFocus, setPasswordRetriever])

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault()
    const success = test(password)
    if (success) {
      resolve(password)
      setOpen(false)
      if (!wasOriginallyFocused) {
        await onFocusRelinquished()
      }
    } else {
      toast.error('Incorrect password')
    }
  }

  const handleAbort = async () => {
    reject()
    setOpen(false)
    if (!wasOriginallyFocused) {
      await onFocusRelinquished()
    }
  }

  return (
    <CustomDialog
      open={open}
      onClose={() => {
        reject(new Error('User has closed password dialog'))
        setOpen(false)
      }}
      title='Enter Password'
    >
      <form onSubmit={handleSubmit}>
        <DialogContent>
          <DialogContentText>
            {reason}
          </DialogContentText>
          <br />
          <TextField
            label='Password'
            autoFocus
            fullWidth
            type={showPassword ? 'text' : 'password'}
            onChange={e => setPassword(e.target.value)}
            InputProps={{
              endAdornment: (
                <InputAdornment position='end'>
                  <IconButton
                    aria-label='toggle password visibility'
                    onClick={() => setShowPassword(!showPassword)}
                    edge='end'
                    style={{ color: 'inherit' }}
                  >
                    {showPassword ? <Visibility /> : <VisibilityOff />}
                  </IconButton>
                </InputAdornment>
              )
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button
            color='primary'
            onClick={handleAbort}
          >
            Cancel
          </Button>
          <Button
            color='primary'
            type='submit'
          >
            OK
          </Button>
        </DialogActions>
      </form>
    </CustomDialog>
  )
}

export default PasswordHandler
