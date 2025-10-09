import { useState, useEffect, useContext } from 'react'
import style from './style.js'
import {
  Accordion,
  AccordionSummary,
  AccordionDetails,
  AccordionActions,
  Typography,
  Button,
  TextField,
  CircularProgress,
  Box,
  FormControl,
  FormLabel,
  RadioGroup,
  FormControlLabel,
  Radio
} from '@mui/material'
import {
  SettingsPhone as PhoneIcon,
  CheckCircle as CheckCircleIcon,
  PermPhoneMsg as SMSIcon,
  Lock as LockIcon,
  VpnKey as KeyIcon
} from '@mui/icons-material'
import { makeStyles } from '@mui/styles'
import { toast } from 'react-toastify'
import { WalletContext } from '../../WalletContext.js'
import PhoneEntry from '../../components/PhoneEntry.js'
import { Utils, Mnemonic, HD, LookupResolver, Hash } from '@bsv/sdk'

const useStyles = makeStyles(style as any, { name: 'RecoverPassword' })

const RecoverPassword: React.FC<any> = ({ history }) => {
  const { managers, saveEnhancedSnapshot, useWab } = useContext(WalletContext)
  const classes = useStyles()
  const [accordianView, setAccordianView] = useState('auth-method')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [mnemonic, setMnemonic] = useState('')
  const [recoveryKey, setRecoveryKey] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [authenticated, setAuthenticated] = useState(false)

  // Set authenticated status
  useEffect(() => {
    if (managers.walletManager) {
      setAuthenticated(managers.walletManager.authenticated)
    }
  }, [managers.walletManager])

  const handleConfirmAuthMethod = async (e) => {
    e.preventDefault()

    // Set authentication mode for recovery flow
    managers.walletManager.authenticationFlow = 'existing-user'
    managers.walletManager.authenticationMode = 'presentation-key-and-recovery-key'

    // Move to the appropriate auth method view based on wallet configuration
    setAccordianView(useWab ? 'phone' : 'mnemonic')
  }

  const handleSubmitPhone = async e => {
    e.preventDefault()
    try {
      setLoading(true)
      await managers.walletManager!.startAuth({ phoneNumber: phone })
      setAccordianView('code')
      toast.success('A code has been sent to your phone.')
    } catch (e) {
      console.error(e)
      toast.error(e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmitCode = async e => {
    e.preventDefault()
    try {
      setLoading(true)
      await managers.walletManager!.completeAuth({ phoneNumber: phone, otp: code })
      setAccordianView('recovery-key-final')
    } catch (e) {
      console.error(e)
      toast.error(e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleResendCode = async () => {
    try {
      setLoading(true)
      await managers.walletManager!.startAuth({ phoneNumber: phone })
      toast.success('A new code has been sent to your phone.')
    } catch (e) {
      console.error(e)
      toast.error(e.message)
    } finally {
      await new Promise(resolve => setTimeout(resolve, 2000))
      setLoading(false)
    }
  }

  const handleSubmitMnemonic = async e => {
    e.preventDefault()
    try {
      setLoading(true)

      // Derive presentation key from mnemonic
      const mnemonicObj = Mnemonic.fromString(mnemonic.trim())
      const seed = mnemonicObj.toSeed()
      const hdKey = HD.fromSeed(seed)
      const derivedKey = hdKey.derive("m/0'/0/0")
      const presentationKey = derivedKey.privKey.toArray()

      await managers.walletManager!.providePresentationKey(presentationKey)
      setAccordianView('recovery-key-final')
    } catch (e) {
      console.error(e)
      toast.error(e.message || 'Failed to set presentation key from mnemonic')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmitRecoveryKeyFinal = async e => {
    e.preventDefault()
    try {
      setLoading(true)

      // Provide recovery key stored from first step
      const recoveryKeyBytes = Utils.toArray(recoveryKey, 'base64')
      await managers.walletManager!.provideRecoveryKey(recoveryKeyBytes)

      if (managers.walletManager!.authenticated) {
        setAccordianView('new-password')
        localStorage.snap = saveEnhancedSnapshot()
      } else {
        throw new Error('Not authenticated. Please check your presentation key and recovery key.')
      }
    } catch (e) {
      console.error(e)
      toast.error(e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmitPassword = async e => {
    e.preventDefault()

    if (password !== confirmPassword) {
      toast.error("Passwords don't match.")
      return
    }

    try {
      setLoading(true)
      await managers.walletManager!.changePassword(password)
      localStorage.snap = saveEnhancedSnapshot()
      toast.success('Password changed successfully!')
      history.push('/dashboard/apps')
    } catch (e) {
      console.error(e)
      toast.error(e.message)
    } finally {
      setLoading(false)
    }
  }

  if (authenticated) {
    return (
      <div className={classes.content_wrap}>
        <div className={classes.panel_body}>
          <Typography paragraph>
            You are currently logged in. You must log out in order to reset your password.
          </Typography>
          <Button
            color='secondary'
            onClick={async () => {
              if (!window.confirm('Log out?')) return
              await managers.walletManager!.destroy()
              setAuthenticated(false)
            }}
          >
            Log Out
          </Button>
          <Button
            onClick={() => history.go(-1)}
            className={classes.back_button}
          >
            Go Back
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className={classes.content_wrap}>
      <Typography variant='h2' paragraph fontFamily='Helvetica' fontSize='2em'>
        Recover Password
      </Typography>
      <Typography variant='body2' paragraph color='textSecondary'>
        Use your presentation key (mnemonic or WAB) and recovery key to reset your password.
      </Typography>

      <Accordion expanded={accordianView === 'auth-method'}>
        <AccordionSummary className={classes.panel_header}>
          <KeyIcon className={classes.expansion_icon} />
          <Typography className={classes.panel_heading}>
            Confirm Authentication Method
          </Typography>
          {accordianView !== 'auth-method' && (
            <CheckCircleIcon className={classes.complete_icon} />
          )}
        </AccordionSummary>
        <form onSubmit={handleConfirmAuthMethod}>
          <AccordionDetails className={classes.expansion_body}>
            <Typography variant='body2' color='textSecondary' paragraph>
              Your wallet is configured to use {useWab ? 'WAB (Phone)' : 'Mnemonic'} authentication.
            </Typography>
            <Typography variant='body2' color='textSecondary' paragraph>
              You'll need your {useWab ? 'phone number' : 'mnemonic phrase'} and recovery key to reset your password.
            </Typography>
          </AccordionDetails>
          <AccordionActions>
            <Button variant='contained' color='primary' type='submit'>
              Next
            </Button>
          </AccordionActions>
        </form>
      </Accordion>

      {useWab && (
        <>
          <Accordion expanded={accordianView === 'phone'}>
            <AccordionSummary className={classes.panel_header}>
              <PhoneIcon className={classes.expansion_icon} />
              <Typography className={classes.panel_heading}>
                Phone Number
              </Typography>
              {(accordianView === 'code' || accordianView === 'recovery-key-final' || accordianView === 'new-password') && (
                <CheckCircleIcon className={classes.complete_icon} />
              )}
            </AccordionSummary>
            <form onSubmit={handleSubmitPhone}>
              <AccordionDetails className={classes.expansion_body}>
                <PhoneEntry value={phone} onChange={setPhone} />
              </AccordionDetails>
              <AccordionActions>
                {loading
                  ? <CircularProgress />
                  : (
                    <Button variant='contained' color='primary' type='submit'>
                      Send Code
                    </Button>
                  )}
              </AccordionActions>
            </form>
          </Accordion>

          <Accordion expanded={accordianView === 'code'}>
            <AccordionSummary className={classes.panel_header}>
              <SMSIcon className={classes.expansion_icon} />
              <Typography className={classes.panel_heading}>
                Enter code
              </Typography>
              {(accordianView === 'recovery-key-final' || accordianView === 'new-password') && (
                <CheckCircleIcon className={classes.complete_icon} />
              )}
            </AccordionSummary>
            <form onSubmit={handleSubmitCode}>
              <AccordionDetails className={classes.expansion_body}>
                <TextField
                  onChange={e => setCode(e.target.value)}
                  label='Code'
                  fullWidth
                />
              </AccordionDetails>
              <AccordionActions>
                <Button
                  color='secondary'
                  onClick={handleResendCode}
                  disabled={loading}
                >
                  Resend Code
                </Button>
                {loading
                  ? <CircularProgress />
                  : (
                    <Button variant='contained' color='primary' type='submit'>
                      Next
                    </Button>
                  )}
              </AccordionActions>
            </form>
          </Accordion>
        </>
      )}

      {!useWab && (
        <Accordion expanded={accordianView === 'mnemonic'}>
          <AccordionSummary className={classes.panel_header}>
            <KeyIcon className={classes.expansion_icon} />
            <Typography className={classes.panel_heading}>
              Mnemonic (Presentation Key)
            </Typography>
            {(accordianView === 'recovery-key-final' || accordianView === 'new-password') && (
              <CheckCircleIcon className={classes.complete_icon} />
            )}
          </AccordionSummary>
          <form onSubmit={handleSubmitMnemonic}>
            <AccordionDetails className={classes.expansion_body}>
              <TextField
                value={mnemonic}
                onChange={e => setMnemonic(e.target.value)}
                label='Mnemonic'
                fullWidth
                multiline
                rows={3}
                placeholder="Enter your 12 or 24 word recovery phrase"
              />
            </AccordionDetails>
            <AccordionActions>
              {loading
                ? <CircularProgress />
                : (
                  <Button variant='contained' color='primary' type='submit'>
                    Next
                  </Button>
                )}
            </AccordionActions>
          </form>
        </Accordion>
      )}

      <Accordion expanded={accordianView === 'recovery-key-final'}>
        <AccordionSummary className={classes.panel_header}>
          <KeyIcon className={classes.expansion_icon} />
          <Typography className={classes.panel_heading}>
            Recovery Key
          </Typography>
          {accordianView === 'new-password' && (
            <CheckCircleIcon className={classes.complete_icon} />
          )}
        </AccordionSummary>
        <form onSubmit={handleSubmitRecoveryKeyFinal}>
          <AccordionDetails className={classes.expansion_body}>
            <TextField
              value={recoveryKey}
              onChange={e => setRecoveryKey(e.target.value)}
              label='Recovery Key'
              fullWidth
              helperText="Enter your recovery key to authenticate"
              placeholder="Paste your recovery key here"
            />
          </AccordionDetails>
          <AccordionActions>
            {loading
              ? <CircularProgress />
              : (
                <Button variant='contained' color='primary' type='submit' disabled={!recoveryKey}>
                  Authenticate
                </Button>
              )}
          </AccordionActions>
        </form>
      </Accordion>

      <Accordion expanded={accordianView === 'new-password'}>
        <AccordionSummary className={classes.panel_header}>
          <LockIcon className={classes.expansion_icon} />
          <Typography className={classes.panel_heading}>
            New Password
          </Typography>
        </AccordionSummary>
        <form onSubmit={handleSubmitPassword}>
          <AccordionDetails className={classes.expansion_body}>
            <TextField
              margin='normal'
              onChange={e => setPassword(e.target.value)}
              label='Password'
              fullWidth
              type='password'
            />
            <br />
            <TextField
              margin='normal'
              onChange={e => setConfirmPassword(e.target.value)}
              label='Confirm Password'
              fullWidth
              type='password'
            />
          </AccordionDetails>
          <AccordionActions>
            {loading
              ? <CircularProgress />
              : (
                <Button variant='contained' color='primary' type='submit'>
                  Finish
                </Button>
              )}
          </AccordionActions>
        </form>
      </Accordion>

      <Button
        onClick={() => history.go(-1)}
        className={classes.back_button}
      >
        Go Back
      </Button>
    </div>
  )
}

export default RecoverPassword
