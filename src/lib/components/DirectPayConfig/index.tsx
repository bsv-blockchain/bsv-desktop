import { useState, useContext, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Typography,
  Box,
  Paper,
  Button,
  Chip,
  TextField,
  MenuItem,
  Switch,
  FormControlLabel,
  Alert,
  CircularProgress,
  Collapse
} from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import { toast } from 'react-toastify'
import { WalletContext } from '../../WalletContext'
import { beginUserWalletOperation } from '../../services/httpBridgeSession'
import { loadDirectPaySettings } from '../../utils/directPaySettings'
import { followStoredSettings, formFromSettings, saveDirectPayForm, type DirectPayForm } from './form'
import { DIRECT_PAY_STATE_COLOR, directPayState } from './status'

interface DirectPayConfigProps {
  showTitle?: boolean
  embedded?: boolean
}

export default function DirectPayConfig({ showTitle = true, embedded = false }: DirectPayConfigProps) {
  const { t } = useTranslation()
  const { directPay, applyDirectPaySettings, switchingNetwork } = useContext(WalletContext)

  const [form, setForm] = useState<DirectPayForm>(() => formFromSettings(loadDirectPaySettings()))
  const [showTurn, setShowTurn] = useState(() => !!form.turnUrls)
  const [saving, setSaving] = useState(false)
  const [operationError, setOperationError] = useState('')
  const mutationLock = useRef(false)
  const busy = saving || switchingNetwork

  useEffect(() => followStoredSettings(setForm), [])

  const state = directPayState(directPay)
  const stateLabel = {
    off: t('directpay_status_off'),
    starting: t('directpay_status_starting'),
    online_messagebox: t('directpay_status_online_messagebox'),
    online_relay: t('directpay_status_online_relay'),
    not_set_up: t('directpay_status_not_set_up'),
    failed: t('directpay_status_failed')
  }[state]

  const change = <K extends keyof DirectPayForm>(key: K, value: DirectPayForm[K]) => {
    setForm(current => ({ ...current, [key]: value }))
  }

  const mutate = async (operation: () => Promise<void>) => {
    if (mutationLock.current || switchingNetwork) return
    mutationLock.current = true
    setSaving(true)
    setOperationError('')
    let release: (() => void) | undefined
    try {
      release = beginUserWalletOperation()
      await operation()
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error))
    } finally {
      release?.()
      mutationLock.current = false
      setSaving(false)
    }
  }

  const handleSave = () => mutate(async () => {
    const saved = await saveDirectPayForm(form, applyDirectPaySettings)
    setForm(formFromSettings(saved))
    toast.success(t('directpay_saved'))
  })

  const content = (
    <>
      {showTitle && (
        <>
          <Typography variant="h4" sx={{ mb: 2 }}>
            {t('directpay_title')}
          </Typography>
          <Typography variant="body1" color="textSecondary" sx={{ mb: 3 }}>
            {t('directpay_description')}
          </Typography>
        </>
      )}

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <Typography variant="body2" color="textSecondary">
          {t('directpay_status_label')}
        </Typography>
        <Chip label={stateLabel} color={DIRECT_PAY_STATE_COLOR[state]} size="small" />
      </Box>
      {directPay.error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {directPay.error}
        </Alert>
      )}
      {directPay.notice && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {directPay.notice}
        </Alert>
      )}

      {operationError && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setOperationError('')}>{operationError}</Alert>}

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box>
          <FormControlLabel
            control={
              <Switch
                checked={form.receiveEnabled}
                onChange={(e) => change('receiveEnabled', e.target.checked)}
                disabled={busy}
              />
            }
            label={t('directpay_receive_label')}
          />
          <Alert severity="warning" sx={{ mt: 1 }}>
            {t('directpay_receive_warning')}
          </Alert>
        </Box>

        <TextField
          select
          fullWidth
          label={t('directpay_signaling_label')}
          value={form.signaling}
          onChange={(e) => change('signaling', e.target.value as DirectPayForm['signaling'])}
          helperText={t('directpay_signaling_helper')}
          disabled={busy}
        >
          <MenuItem value="messagebox">{t('directpay_signaling_messagebox')}</MenuItem>
          <MenuItem value="relay">{t('directpay_signaling_relay')}</MenuItem>
        </TextField>

        <TextField
          fullWidth
          label={t('directpay_relay_url_label')}
          placeholder="wss://relay.example.com"
          value={form.relayUrl}
          onChange={(e) => change('relayUrl', e.target.value)}
          helperText={t('directpay_relay_url_helper')}
          disabled={busy}
        />

        <TextField
          fullWidth
          label={t('directpay_stun_label')}
          placeholder="stun:stun.example.com:3478"
          value={form.stunUrls}
          onChange={(e) => change('stunUrls', e.target.value)}
          helperText={t('directpay_stun_helper')}
          disabled={busy}
        />

        <Box>
          <Button
            size="small"
            onClick={() => setShowTurn(!showTurn)}
            endIcon={showTurn ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          >
            {t('directpay_turn_title')}
          </Button>
          <Collapse in={showTurn}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
              <TextField
                fullWidth
                label={t('directpay_turn_url_label')}
                placeholder="turn:turn.example.com:3478"
                value={form.turnUrls}
                onChange={(e) => change('turnUrls', e.target.value)}
                disabled={busy}
              />
              <TextField
                fullWidth
                label={t('directpay_turn_username_label')}
                value={form.turnUsername}
                onChange={(e) => change('turnUsername', e.target.value)}
                autoComplete="off"
                disabled={busy}
              />
              <TextField
                fullWidth
                type="password"
                label={t('directpay_turn_credential_label')}
                value={form.turnCredential}
                onChange={(e) => change('turnCredential', e.target.value)}
                autoComplete="new-password"
                disabled={busy}
              />
            </Box>
          </Collapse>
        </Box>

        <Box>
          <Button
            variant="contained"
            onClick={() => void handleSave()}
            disabled={busy}
            startIcon={saving ? <CircularProgress size={16} /> : null}
          >
            {saving ? t('directpay_saving') : t('directpay_save')}
          </Button>
        </Box>
      </Box>
    </>
  )

  if (embedded) {
    return content
  }

  return (
    <Paper elevation={0} sx={{ p: 3, bgcolor: 'background.paper' }}>
      {content}
    </Paper>
  )
}
