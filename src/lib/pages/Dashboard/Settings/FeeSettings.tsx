import { useEffect, useRef, useState } from 'react'
import { Alert, Box, Button, LinearProgress, Paper, TextField, Typography } from '@mui/material'
import { useTranslation } from 'react-i18next'
import type { FeeSettingsView } from '../../../../global'

interface Props {
  chain: 'main' | 'test' | 'ttn'
  remote: boolean
}

export default function FeeSettings({ chain, remote }: Props) {
  const { t } = useTranslation()
  const api = window.electronAPI?.fees
  const [view, setView] = useState<FeeSettingsView | null>(null)
  const [rate, setRate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const requestId = useRef(0)

  useEffect(() => {
    return () => { requestId.current++ }
  }, [])

  async function refresh() {
    if (!api) return
    const id = ++requestId.current
    setBusy(true)
    setError('')
    try {
      const next = await api.get(chain)
      if (id !== requestId.current) return
      setView(next)
      setRate(String(next.effectiveRate))
    } catch (e) {
      if (id === requestId.current) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (id === requestId.current) setBusy(false)
    }
  }

  useEffect(() => {
    if (!remote) void refresh()
    return () => { requestId.current++ }
  }, [chain, remote])

  async function save(value: number | null) {
    if (!api) return
    const id = ++requestId.current
    setBusy(true)
    setError('')
    try {
      const result = await api.set(chain, value)
      if (id !== requestId.current) return
      if (!result.success || !result.settings) {
        setError(result.error || t('fees_save_failed'))
        return
      }
      setView(result.settings)
      setRate(String(result.settings.effectiveRate))
    } catch (e) {
      if (id === requestId.current) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (id === requestId.current) setBusy(false)
    }
  }

  if (!api) return null
  const parsed = Number(rate)
  const invalid = !rate.trim() || !Number.isSafeInteger(parsed) || parsed <= 0
  const belowFloor = !invalid && view?.floorRate != null && parsed < view.floorRate
  const network = chain === 'main' ? 'Mainnet' : chain === 'ttn' ? 'TeraTestNet' : 'Testnet'

  return (
    <Paper elevation={0} sx={{ p: 3, mb: 4, bgcolor: 'background.paper' }}>
      <Typography variant="h4" sx={{ mb: 2 }}>{t('fees_title')}</Typography>
      {remote ? (
        <Typography color="textSecondary">{t('fees_remote')}</Typography>
      ) : (
        <>
          <Typography color="textSecondary" sx={{ mb: 2 }}>
            {t('fees_scope', { network })}
          </Typography>
          {busy && <LinearProgress aria-label={t('fees_loading')} sx={{ mb: 2 }} />}
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          {view && (
            <>
              <Typography sx={{ mb: 1 }}>
                {t('fees_configured', { rate: view.effectiveRate.toLocaleString() })}
              </Typography>
              <Typography color="textSecondary" sx={{ mb: 1 }}>
                {view.floorRate == null
                  ? t('fees_floor_unavailable')
                  : t('fees_floor', { rate: view.floorRate.toLocaleString() })}
              </Typography>
              <Typography variant="body2" color="textSecondary" sx={{ mb: 2, overflowWrap: 'anywhere' }}>
                {view.policyUrl}
              </Typography>
              {view.policyError && (
                <Alert severity="warning" sx={{ mb: 2 }}>{t('fees_policy_unavailable')}</Alert>
              )}
              {view.restartRequired && (
                <Alert severity="info" sx={{ mb: 2 }}>{t('fees_restart')}</Alert>
              )}
              <TextField
                fullWidth
                label={t('fees_rate_label')}
                type="number"
                value={rate}
                disabled={busy}
                onChange={event => setRate(event.target.value)}
                inputProps={{ min: Math.max(1, view.floorRate ?? 1), step: 1 }}
                error={invalid || belowFloor}
                helperText={invalid ? t('fees_invalid') : belowFloor ? t('fees_below_floor') : t('fees_units')}
                sx={{ mb: 2 }}
              />
              <Alert severity="info" sx={{ mb: 2 }}>{t('fees_ancestors')}</Alert>
            </>
          )}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            <Button variant="contained" onClick={() => void save(parsed)}
              disabled={busy || !view || invalid || belowFloor || view.floorRate == null || parsed === view.customRate}>
              {t('fees_save')}
            </Button>
            <Button onClick={() => void refresh()} disabled={busy}>{t('fees_refresh')}</Button>
            {view?.customRate != null && (
              <Button onClick={() => void save(null)} disabled={busy}>{t('fees_reset')}</Button>
            )}
          </Box>
        </>
      )}
    </Paper>
  )
}
