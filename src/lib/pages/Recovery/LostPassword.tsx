import { useState, useEffect, useContext } from 'react'
import { useTranslation } from 'react-i18next'
// import 'react-phone-number-input/style.css'
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
import { WalletContext } from '../../WalletContext.js'
import PhoneEntry from '../../components/PhoneEntry.js'
import style from './style.js'
import { Utils } from '@bsv/sdk'

const useStyles = makeStyles(style as any, { name: 'LostPassword' })

const RecoveryLostPassword: React.FC<any> = ({ history }) => {
  const { t } = useTranslation()
  const { managers, saveEnhancedSnapshot } = useContext(WalletContext)
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
      toast.success(t('lost_password_code_sent'))
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
      toast.success(t('lost_password_code_resent'))
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
        localStorage.snap = saveEnhancedSnapshot()
      } else {
        throw new Error(t('lost_password_not_authenticated'))
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
      toast.success(t('lost_password_changed'))
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
          {t('lost_password_already_logged_in')}
        </Typography>
        <Button
          color='secondary'
          onClick={async () => {
            if (!window.confirm(t('lost_password_log_out_confirm'))) return
            await managers.walletManager!.destroy()
            setAuthenticated(false)
          }}
        >
          {t('lost_password_log_out')}
        </Button>
        <Button
          onClick={() => history.go(-1)}
          className={classes.back_button}
        >
          {t('lost_password_go_back')}
        </Button>
      </div>
    )
  }

  return (
    <div className={classes.content_wrap}>
      <Typography variant='h2' paragraph fontFamily='Helvetica' fontSize='2em'>
        {t('lost_password_title')}
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
            {t('lost_password_phone_number')}
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
                  {t('lost_password_send_code')}
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
            {t('lost_password_enter_code')}
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
              label={t('lost_password_code_label')}
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
              {t('lost_password_resend_code')}
            </Button>
            {loading
              ? <CircularProgress />
              : (
                <Button
                  variant='contained'
                  color='primary'
                  type='submit'
                >
                  {t('lost_password_next')}
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
            {t('lost_password_recovery_key')}
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
              label={t('lost_password_recovery_key_label')}
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
                  {t('lost_password_continue')}
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
            {t('lost_password_new_password')}
          </Typography>
        </AccordionSummary>
        <form onSubmit={handleSubmitPassword}>
          <AccordionDetails
            className={classes.expansion_body}
          >
            <TextField
              margin='normal'
              onChange={e => setPassword(e.target.value)}
              label={t('lost_password_password_label')}
              fullWidth
              type='password'
            />
            <br />
            <TextField
              margin='normal'
              onChange={e => setConfirmPassword(e.target.value)}
              label={t('lost_password_confirm_password_label')}
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
                  {t('lost_password_finish')}
                </Button>
              )}
          </AccordionActions>
        </form>
      </Accordion>
      <Button
        onClick={() => history.go(-1)}
        className={classes.back_button}
      >
        {t('lost_password_go_back')}
      </Button>
    </div>
  )
}

export default RecoveryLostPassword
