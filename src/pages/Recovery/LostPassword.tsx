import { useState, useEffect, useContext } from 'react'
import 'react-phone-number-input/style.css'
import {
  Accordion,
  AccordionSummary,
  AccordionDetails,
  AccordionActions,
  Typography,
  Button,
  TextField,
  CircularProgress
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
import { WalletContext } from '../../WalletContext'
import PhoneEntry from '../../components/PhoneEntry.js'
import style from './style.js'
import { Utils } from '@bsv/sdk'

const useStyles = makeStyles(style as any, { name: 'LostPassword' })

const RecoveryLostPassword: React.FC<any> = ({ history }) => {
  const { managers } = useContext(WalletContext)
  const classes = useStyles()
  const [accordianView, setAccordianView] = useState('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [recoveryKey, setRecoveryKey] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [authenticated, setAuthenticated] = useState(false)

  // Ensure the correct authentication mode
  useEffect(() => {
    managers.walletManager!.authenticationMode = 'presentation-key-and-recovery-key'
  }, [])

  useEffect(() => {
    setAuthenticated(managers.walletManager!.authenticated)
  }, [])

  const handleSubmitPhone = async e => {
    e.preventDefault()
    try {
      setLoading(true)
      // TODO
      // await managers.walletManager!.providePhoneNumber(phone)
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
      // TODO
      // await managers.walletManager!.provideCode(code)
      setAccordianView('recovery-key')
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
      // TODO
      // await managers.walletManager!.providePhoneNumber(phone)
      toast.success('A new code has been sent to your phone.')
    } catch (e) {
      console.error(e)
      toast.error(e.message)
    } finally {
      setLoading(false)
    }
  }
  const handleSubmitRecoveryKey = async e => {
    e.preventDefault()
    try {
      setLoading(true)
      await managers.walletManager!.provideRecoveryKey(Utils.toArray(recoveryKey, 'base64'))
      if (managers.walletManager!.authenticated) {
        setAccordianView('new-password')
        localStorage.snap = Utils.toBase64(managers.walletManager!.saveSnapshot())
      } else {
        throw new Error('Not authenticated, was it incorrect?')
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
    try {
      setLoading(true)
      await managers.walletManager!.changePassword(password)
      toast.success('Password changed')
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
      <div>
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
    )
  }

  return (
    <div className={classes.content_wrap}>
      <Typography variant='h2' paragraph fontFamily='Helvetica' fontSize='2em'>
        Reset Password
      </Typography>
      <Accordion
        expanded={accordianView === 'phone'}
      >
        <AccordionSummary
          className={classes.panel_header}
        >
          <PhoneIcon className={classes.expansion_icon} />
          <Typography
            className={classes.panel_heading}
          >
            Phone Number
          </Typography>
          {(accordianView === 'code' || accordianView === 'password') && (
            <CheckCircleIcon className={classes.complete_icon} />
          )}
        </AccordionSummary>
        <form onSubmit={handleSubmitPhone}>
          <AccordionDetails
            className={classes.expansion_body}
          >
            <PhoneEntry
              value={phone}
              onChange={setPhone}
            />
          </AccordionDetails>
          <AccordionActions>
            {loading
              ? <CircularProgress />
              : (
                <Button
                  variant='contained'
                  color='primary'
                  type='submit'
                >
                  Send Code
                </Button>
              )}
          </AccordionActions>
        </form>
      </Accordion>
      <Accordion
        expanded={accordianView === 'code'}
      >
        <AccordionSummary
          className={classes.panel_header}
        >
          <SMSIcon className={classes.expansion_icon} />
          <Typography
            className={classes.panel_heading}
          >
            Enter code
          </Typography>
          {accordianView === 'password' && (
            <CheckCircleIcon className={classes.complete_icon} />
          )}
        </AccordionSummary>
        <form onSubmit={handleSubmitCode}>
          <AccordionDetails
            className={classes.expansion_body}
          >
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
            // align='left'
            >
              Resend Code
            </Button>
            {loading
              ? <CircularProgress />
              : (
                <Button
                  variant='contained'
                  color='primary'
                  type='submit'
                >
                  Next
                </Button>
              )}
          </AccordionActions>
        </form>
      </Accordion>
      <Accordion
        className={classes.accordion}
        expanded={accordianView === 'recovery-key'}
      >
        <AccordionSummary
          className={classes.panel_header}
        >
          <KeyIcon className={classes.expansion_icon} />
          <Typography
            className={classes.panel_heading}
          >
            Recovery Key
          </Typography>
          {(accordianView === 'password') && (
            <CheckCircleIcon className={classes.complete_icon} />
          )}
        </AccordionSummary>
        <form onSubmit={handleSubmitRecoveryKey}>
          <AccordionDetails
            className={classes.expansion_body}
          >
            <TextField
              onChange={e => setRecoveryKey(e.target.value)}
              label='Recovery Key'
              fullWidth
            />
          </AccordionDetails>
          <AccordionActions>
            {loading
              ? <CircularProgress />
              : (
                <Button
                  variant='contained'
                  color='primary'
                  type='submit'
                >
                  Continue
                </Button>
              )}
          </AccordionActions>
        </form>
      </Accordion>
      <Accordion
        expanded={accordianView === 'new-password'}
      >
        <AccordionSummary
          className={classes.panel_header}
        >
          <LockIcon className={classes.expansion_icon} />
          <Typography
            className={classes.panel_heading}
          >
            New Password
          </Typography>
        </AccordionSummary>
        <form onSubmit={handleSubmitPassword}>
          <AccordionDetails
            className={classes.expansion_body}
          >
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
                <Button
                  variant='contained'
                  color='primary'
                  type='submit'
                >
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

export default RecoveryLostPassword
