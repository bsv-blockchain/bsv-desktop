import { useState, useContext, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Typography, Button, CircularProgress
} from '@mui/material'
import { toast } from 'react-toastify'
import { makeStyles } from '@mui/styles'
import { WalletContext } from '../../../../WalletContext'
import { Utils } from '@bsv/sdk'

const useStyles = makeStyles(theme => ({
  button_grid: {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr auto',
    gridGap: (theme as any).spacing(2)
  }
}), { name: 'RecoveryKey' })

interface RecoveryKeySettingsProps {
  history: any;
  onViewKey?: (key: string) => void;
}

const RecoveryKeySettings: React.FC<RecoveryKeySettingsProps> = ({ history, onViewKey }) => {
  const { t } = useTranslation()
  const { managers, saveEnhancedSnapshot } = useContext(WalletContext)
  const [recoveryKey, setRecoveryKey] = useState('')
  const [showLoading, setShowLoading] = useState(false)
  const [changeLoading, setChangeLoading] = useState(false)
  const classes = useStyles()

  const handleViewKey = async () => {
    try {
      if (recoveryKey) {
        setRecoveryKey('')
        return
      }
      setShowLoading(true)
      const key = Utils.toBase64(await managers.walletManager.getRecoveryKey())
      setRecoveryKey(key)
      if (onViewKey) {
        onViewKey(key)
        setRecoveryKey('')
      }
    } catch (error) {
      toast.error(error.message)
    } finally {
      setShowLoading(false)
    }
  }

  const handleChangeKey = async () => {
    try {
      setChangeLoading(true)
      await managers.walletManager.changeRecoveryKey()
      setRecoveryKey('')
      localStorage.snap = saveEnhancedSnapshot()
      toast.dark('Recovery key changed!')
    } catch (e) {
      toast.error(e.message)
    } finally {
      setChangeLoading(false)
    }
  }

  return (
    <>
      <Typography variant="h4" sx={{ mb: 2 }}>
        {t('settings_recovery_key_title')}
      </Typography>
      <Typography variant="body1" color="textSecondary" sx={{ mb: 3 }}>
        {t('settings_recovery_key_description')}
      </Typography>
      <br />
      <div className={classes.button_grid}>
        {showLoading
          ? <CircularProgress />
          : (
            <Button
              color='primary'
              onClick={handleViewKey}
            >
              {t('settings_recovery_key_view_button')}
            </Button>
          )}
        <div />
        {changeLoading
          ? <CircularProgress />
          : (
            <Button
              onClick={handleChangeKey}
              color='primary'
              variant='contained'
            >
              {t('settings_recovery_key_change_button')}
            </Button>
          )}
      </div>
    </>
  )
}

export default RecoveryKeySettings
