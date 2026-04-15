import { useState, useEffect, useContext } from 'react'
import { useTranslation } from 'react-i18next'
import style from './style.js'
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
  Lock as LockIcon,
  VpnKey as KeyIcon
} from '@mui/icons-material'
import { makeStyles } from '@mui/styles'
import { toast } from 'react-toastify'
import { WalletContext } from '../../WalletContext.js'
import PhoneEntry from '../../components/PhoneEntry.js'
import { Utils } from '@bsv/sdk'

const useStyles = makeStyles(style as any, { name: 'RecoveryLostPhoneNumber' })

const RecoveryLostPhone: React.FC<any> = ({ history }) => {
  const { t } = useTranslation()
  const { managers, saveEnhancedSnapshot } = useContext(WalletContext)
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
      localStorage.snap = saveEnhancedSnapshot()
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
      toast.error(t('lost_phone_not_yet_supported'))
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
          {t('lost_phone_already_logged_in')}
        </Typography>
        <Button
          color='secondary'
          onClick={async () => {
            if (!window.confirm(t('lost_phone_log_out_confirm'))) return
            await managers.walletManager!.destroy()
            setAuthenticated(false)
          }}
        >
          {t('lost_phone_log_out')}
        </Button>
        <Button
          onClick={() => history.go(-1)}
          className={classes.back_button}
        >
          {t('lost_phone_go_back')}
        </Button>
      </div>
    )
  }

  return (
    <div className={classes.content_wrap}>
      <Typography variant='h2' paragraph fontFamily='Helvetica' fontSize='2em'>
        {t('lost_phone_title')}
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
            {t('lost_phone_recovery_key')}
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
              label={t('lost_phone_recovery_key_label')}
              fullWidth
            />
          </AccordionDetails>
          <AccordionActions>
            <Button
              variant='contained'
              color='primary'
              type='submit'
            >
              {t('lost_phone_next')}
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
            {t('lost_phone_password')}
          </Typography>
        </AccordionSummary>
        <form onSubmit={handleSubmitPassword}>
          <AccordionDetails
            className={classes.expansion_body}
          >
            <TextField
              onChange={e => setPassword(e.target.value)}
              label={t('lost_phone_password_label')}
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
                  {t('lost_phone_continue')}
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
            {t('lost_phone_new_phone')}
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
                    {t('lost_phone_skip_updating')}
                  </Button>
                  <Button
                    variant='contained'
                    color='primary'
                    type='submit'
                  >
                    {t('lost_phone_finish')}
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
        {t('lost_phone_go_back')}
      </Button>
    </div >
  )
}

export default RecoveryLostPhone
