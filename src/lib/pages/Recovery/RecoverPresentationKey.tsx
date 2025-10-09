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
  CircularProgress
} from '@mui/material'
import {
  CheckCircle as CheckCircleIcon,
  Lock as LockIcon,
  VpnKey as KeyIcon
} from '@mui/icons-material'
import { makeStyles } from '@mui/styles'
import { toast } from 'react-toastify'
import { WalletContext } from '../../WalletContext.js'
import { Utils, LookupResolver, Hash, Transaction } from '@bsv/sdk'
import { OverlayUMPTokenInteractor } from '@bsv/wallet-toolbox-client'

const useStyles = makeStyles(style as any, { name: 'RecoverPresentationKey' })

const RecoverPresentationKey: React.FC<any> = ({ history }) => {
  const { managers, saveEnhancedSnapshot, network } = useContext(WalletContext)
  const classes = useStyles()
  const [accordianView, setAccordianView] = useState('recovery-key')
  const [password, setPassword] = useState('')
  const [recoveryKey, setRecoveryKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [authenticated, setAuthenticated] = useState(false)

  // Set authenticated status
  useEffect(() => {
    if (managers.walletManager) {
      setAuthenticated(managers.walletManager.authenticated)
    }
  }, [managers.walletManager])

  const handleSubmitRecoveryKey = async e => {
    e.preventDefault()
    try {
      setLoading(true)

      // Convert recovery key from base64 to bytes
      const recoveryKeyBytes = Utils.toArray(recoveryKey, 'base64')
      
      managers.walletManager.authenticationFlow = 'existing-user'
      managers.walletManager.authenticationMode = 'recovery-key-and-password'
      await managers.walletManager!.provideRecoveryKey(recoveryKeyBytes)

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

      // Provide password to complete authentication
      await managers.walletManager!.providePassword(password)

      if (managers.walletManager!.authenticated) {
        localStorage.snap = saveEnhancedSnapshot()
        toast.success('Presentation key recovered successfully!')
        history.push('/dashboard/apps')
      } else {
        throw new Error('Authentication failed. Please check your password.')
      }
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
            You are currently logged in. You must log out in order to recover your presentation key.
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
        Recover Presentation Key
      </Typography>
      <Typography variant='body2' paragraph color='textSecondary'>
        Use your password and recovery key to regain access to your wallet.
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
          {accordianView === 'password' && (
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
                  Next
                </Button>
              )}
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
                  Recover
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

export default RecoverPresentationKey
