import { useState, useEffect, useContext } from 'react'
import style from './style.js'
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
  Lock as LockIcon,
  VpnKey as KeyIcon
} from '@mui/icons-material'
import { makeStyles } from '@mui/styles'
import { toast } from 'react-toastify'
import { WalletContext } from '../../WalletContext'
import PhoneEntry from '../../components/PhoneEntry'
import { Utils } from '@bsv/sdk'

const useStyles = makeStyles(style as any, { name: 'RecoveryLostPhoneNumber' })

const RecoveryLostPhone: React.FC<any> = ({ history }) => {
  const { managers } = useContext(WalletContext)
  const classes = useStyles()
  const [accordianView, setAccordianView] = useState('recovery-key')
  const [recoveryKey, setRecoveryKey] = useState('')
  const [password, setPassword] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [loading, setLoading] = useState(true)
  const [authenticated, setAuthenticated] = useState(false)

  // Ensure the correct authentication mode
  useEffect(() => {
    managers.walletManager!.authenticationMode = 'recovery-key-and-password'
  }, [])

  useEffect(() => {
    setAuthenticated(managers.walletManager!.authenticated)
  }, [])

  const handleSubmitRecoveryKey = async e => {
    e.preventDefault()
    try {
      setLoading(true)
      await managers.walletManager!.provideRecoveryKey(Utils.toArray(recoveryKey, 'base64'))
      setAccordianView('password')
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
      await managers.walletManager!.providePassword(password)
      setAccordianView('new-phone')
      localStorage.snap = Utils.toBase64(managers.walletManager!.saveSnapshot())
    } catch (e) {
      console.error(e)
      toast.error(e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmitNewPhone = async e => {
    e.preventDefault()
    try {
      setLoading(true)
      // const result = await managers.walletManager!.changePhoneNumber(newPhone)
      // if (result === true) {
      // TODO support this in the example wallet manager, get a code, etc.
      toast.error('Phone is not changed (not yet supported)')
      history.push('/dashboard/apps')
      // }
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
        Reset Phone Number
      </Typography>
      <Accordion
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
            <Button
              variant='contained'
              color='primary'
              type='submit'
            >
              Next
            </Button>
          </AccordionActions>
        </form>
      </Accordion>
      <Accordion
        expanded={accordianView === 'password'}
      >
        <AccordionSummary
          className={classes.panel_header}
        >
          <LockIcon className={classes.expansion_icon} />
          <Typography
            className={classes.panel_heading}
          >
            Password
          </Typography>
        </AccordionSummary>
        <form onSubmit={handleSubmitPassword}>
          <AccordionDetails
            className={classes.expansion_body}
          >
            <TextField
              onChange={e => setPassword(e.target.value)}
              label='Password'
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
                  Continue
                </Button>
              )}
          </AccordionActions>
        </form>
      </Accordion>
      <Accordion
        expanded={accordianView === 'new-phone'}
      >
        <AccordionSummary
          className={classes.panel_header}
        >
          <PhoneIcon className={classes.expansion_icon} />
          <Typography
            className={classes.panel_heading}
          >
            New Phone
          </Typography>
        </AccordionSummary>
        <form onSubmit={handleSubmitNewPhone}>
          <AccordionDetails
            className={classes.expansion_body}
          >
            <PhoneEntry
              value={newPhone}
              onChange={setNewPhone}
            />
          </AccordionDetails>
          <AccordionActions>
            {loading
              ? <CircularProgress />
              : (
                <div>
                  <Button
                    onClick={() => history.push('/dashboard/apps')}
                  >
                    Skip Updating Phone
                  </Button>
                  <Button
                    variant='contained'
                    color='primary'
                    type='submit'
                  >
                    Finish
                  </Button>
                </div>
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
    </div >
  )
}

export default RecoveryLostPhone
