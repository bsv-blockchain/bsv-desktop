import { useState, useContext } from 'react'
import { useTranslation } from 'react-i18next'
import style from './style'
import {
  Typography,
  Button,
  TextField,
  Box
} from '@mui/material'
import { makeStyles } from '@mui/styles'
import { toast } from 'react-toastify'
import { WalletContext } from '../../../../WalletContext'
import { Utils } from '@bsv/sdk'
import AppLogo
 from '../../../../components/AppLogo'
const useStyles = makeStyles(style, { name: 'PasswordSettings' })

const PasswordSettings = ({ history }) => {
  const { t } = useTranslation()
  const { managers, saveEnhancedSnapshot } = useContext(WalletContext)
  const classes = useStyles()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmitPassword = async e => {
    e.preventDefault()
    try {
      setLoading(true)
      if (password !== confirmPassword) {
        throw new Error('Passwords do not match.')
      }
      await managers.walletManager.changePassword(password)
      localStorage.snap = saveEnhancedSnapshot()
      toast.dark('Password changed!')
      setPassword('')
      setConfirmPassword('')
    } catch (e) {
      toast.error(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <Typography variant='h4' color='textPrimary' sx={{ mb: 2 }}>{t('settings_password_title')}</Typography>
      <Typography variant='body1' color='textSecondary' sx={{ mb: 2 }}>
        {t('settings_password_description')}
      </Typography>
      <form onSubmit={handleSubmitPassword}>
        <TextField
          style={{ marginTop: '1.5em' }}
          onChange={e => setPassword(e.target.value)}
          placeholder={t('settings_password_new_placeholder')}
          fullWidth
          type='password'
        />
        <br />
        <br />
        <TextField
          onChange={e => setConfirmPassword(e.target.value)}
          placeholder={t('settings_password_retype_placeholder')}
          fullWidth
          type='password'
        />
        <br />
        <br />
        <div className={classes.button_grid}>
          <Button
            color='primary'
            onClick={() => history.push('/recovery/lost-password')}
          >
            {t('settings_password_forgot')}
          </Button>
          <div />
          {loading
            ? <Box p={3} display="flex" justifyContent="center" alignItems="center"><AppLogo rotate size={75} /></Box>
            : (
              <Button
                color='primary'
                variant='contained'
                type='submit'
              >
                {t('settings_password_change_button')}
              </Button>
            )}
        </div>
      </form>
    </div>
  )
}

export default PasswordSettings
