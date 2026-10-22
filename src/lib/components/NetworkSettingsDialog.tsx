import React, { useCallback, useContext, useEffect, useState } from 'react'
import {
  Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button,
  CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, Stack, Switch, TextField, Typography,
} from '@mui/material'
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded'
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded'
import { toast } from 'react-toastify'
import { PublicKey } from '@bsv/sdk'
import { WalletContext } from '../WalletContext'
import { defaultNetworkSettings, NETWORKS, normalizeNetworkSettings, type NetworkSettings, type WalletNetwork } from '../networkConfig'

/**
 * The dialog edits mandalaOverlays[0]. Both fields empty clears it; both set
 * must pass the shared validator and lie on the curve. Throws a user-facing message.
 */
function withMandalaOverlay(network: WalletNetwork, form: NetworkSettings, url: string, identityKey: string): NetworkSettings {
  const rest = (form.mandalaOverlays || []).slice(1)
  const trimmedUrl = url.trim()
  const trimmedKey = identityKey.trim()
  if (!trimmedUrl && !trimmedKey) return { ...form, mandalaOverlays: rest }
  if (!trimmedUrl || !trimmedKey) throw new Error('Mandala overlay URL and identity key must be set together')
  const normalized = normalizeNetworkSettings(network, { ...form, mandalaOverlays: [{ url: trimmedUrl, identityKey: trimmedKey }, ...rest] })
  try { PublicKey.fromString(normalized.mandalaOverlays[0].identityKey) } catch {
    throw new Error('Mandala overlay identity key is not a valid public key')
  }
  return normalized
}

/** Opened by Settings or the native Network menu. */
const NetworkSettingsDialog: React.FC = () => {
  const { chain, managers, networkSettings, switchingNetwork, applyNetworkSettings } = useContext(WalletContext)
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<WalletNetwork>(chain)
  const [form, setForm] = useState<NetworkSettings>(networkSettings[chain])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [overlayUrl, setOverlayUrl] = useState(networkSettings[chain]?.mandalaOverlays?.[0]?.url ?? '')
  const [overlayKey, setOverlayKey] = useState(networkSettings[chain]?.mandalaOverlays?.[0]?.identityKey ?? '')
  const [proxyEnabled, setProxyEnabled] = useState(false)
  const [proxyUrl, setProxyUrl] = useState('')
  const [restartRequired, setRestartRequired] = useState(false)
  const [proxySaving, setProxySaving] = useState(false)
  const busy = saving || switchingNetwork
  const loadForm = useCallback((settings: NetworkSettings) => {
    setForm(settings)
    setOverlayUrl(settings.mandalaOverlays?.[0]?.url ?? '')
    setOverlayKey(settings.mandalaOverlays?.[0]?.identityKey ?? '')
  }, [])

  const openSettings = useCallback(() => {
    setSelected(chain)
    loadForm(networkSettings[chain])
    setError('')
    setOpen(true)
    if (window.electronAPI?.network) {
      void window.electronAPI.network.getProxySettings().then(settings => {
        setProxyEnabled(settings.mode === 'fixed_servers')
        setProxyUrl(settings.proxyRules || settings.lastProxyRules || '')
        setRestartRequired(Boolean(settings.restartRequired))
      }).catch(() => setError('Proxy settings could not be loaded.'))
    }
  }, [chain, networkSettings, loadForm])

  useEffect(() => {
    window.addEventListener('open-network-settings', openSettings)
    window.electronAPI?.network?.onOpenSettings(openSettings)
    return () => {
      window.removeEventListener('open-network-settings', openSettings)
      window.electronAPI?.network?.removeOpenSettingsListener(openSettings)
    }
  }, [openSettings])

  const choose = (network: WalletNetwork) => {
    setSelected(network)
    loadForm(networkSettings[network])
    setError('')
  }
  const update = (field: keyof NetworkSettings, value: string) => {
    setForm(previous => ({ ...previous, [field]: value }))
    setError('')
  }
  const save = async () => {
    if (busy) return
    let settings: NetworkSettings
    try { settings = withMandalaOverlay(selected, form, overlayUrl, overlayKey) } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Mandala overlay settings are invalid')
      return
    }
    setSaving(true)
    setError('')
    try {
      await applyNetworkSettings(selected, settings)
      toast.success(`${NETWORKS.find(network => network.id === selected)?.label} is ready.`)
      setOpen(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Network settings could not be applied.')
    } finally { setSaving(false) }
  }
  const saveProxy = async () => {
    setProxySaving(true)
    try {
      const result = await window.electronAPI.network.setProxySettings({
        mode: proxyEnabled ? 'fixed_servers' : 'direct',
        proxyRules: proxyEnabled ? proxyUrl.trim() : '',
        lastProxyRules: proxyUrl.trim(),
      })
      if (!result.success) throw new Error(result.error || 'Proxy settings could not be saved.')
      setRestartRequired(Boolean(result.restartRequired))
      toast.success(result.restartRequired ? 'Proxy saved. Restart to update background services.' : 'Proxy applied.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Proxy settings could not be saved.') }
    finally { setProxySaving(false) }
  }

  return (
    <Dialog open={open} onClose={() => { if (!busy) setOpen(false) }} fullWidth maxWidth="sm">
      <DialogTitle sx={{ pb: 1 }}>Network & services</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Keep your wallet identity and switch between separate balances and payment histories.
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.2 }}>
            {NETWORKS.map(network => (
              <Button key={network.id} disabled={busy} onClick={() => choose(network.id)}
                aria-pressed={selected === network.id}
                sx={{ textTransform: 'none', textAlign: 'left', justifyContent: 'flex-start', p: 1.6,
                  border: '1px solid', borderColor: selected === network.id ? 'primary.main' : 'divider',
                  bgcolor: selected === network.id ? 'action.selected' : 'transparent', borderRadius: 3 }}>
                <Stack sx={{ flex: 1 }} spacing={0.3}>
                  <Typography fontWeight={750} color="text.primary">{network.label}</Typography>
                  <Typography variant="caption" color="text.secondary">{network.description}</Typography>
                </Stack>
                {selected === network.id && <CheckCircleRounded fontSize="small" />}
              </Button>
            ))}
          </Box>
          {selected !== 'main' && <Alert severity="info">This network uses test coins. They have no monetary value.</Alert>}
          {selected === 'tstn' && <Alert severity="info">Add your TSTN Arcade and ChainTracks URLs below before switching. Add an address explorer API to receive address payments.</Alert>}
          {error && <Alert severity="error">{error}</Alert>}
          <Accordion defaultExpanded={selected === 'tstn'} key={`services-${selected}`} disableGutters elevation={0}
            sx={{ border: '1px solid', borderColor: 'divider', borderRadius: '16px !important', '&:before': { display: 'none' } }}>
            <AccordionSummary expandIcon={<ExpandMoreRounded />}><Typography fontWeight={650}>Wallet services</Typography></AccordionSummary>
            <AccordionDetails>
              <Stack spacing={2}>
                <Typography variant="body2" color="text.secondary">Saved separately for each network. Mainnet, Testnet and TeraTestNet use the same defaults as BSV Wallet.</Typography>
                <TextField label="Arcade URL" value={form.arcadeUrl} onChange={event => update('arcadeUrl', event.target.value)} disabled={busy} fullWidth />
                <TextField label="ChainTracks URL" value={form.chaintracksUrl} onChange={event => update('chaintracksUrl', event.target.value)} disabled={busy} fullWidth helperText="Blockchain headers and payment verification" />
                <TextField label="Address explorer API URL" value={form.whatsOnChainUrl} onChange={event => update('whatsOnChainUrl', event.target.value)} disabled={busy} fullWidth helperText="WhatsOnChain compatible API, including its /v1/bsv/network path" />
                <FormControlLabel label="Use Message Box for identity payments" control={<Switch checked={form.useMessageBox !== false} onChange={event => setForm(previous => ({ ...previous, useMessageBox: event.target.checked }))} disabled={busy} />} />
                <TextField label="Message Box URL" value={form.messageBoxUrl} onChange={event => update('messageBoxUrl', event.target.value)} disabled={busy || form.useMessageBox === false} fullWidth helperText="Leave empty to use https://messagebox.bsvblockchain.tech" />
                <TextField label="Mandala overlay URL (optional)" value={overlayUrl} onChange={event => { setOverlayUrl(event.target.value); setError('') }} disabled={busy} fullWidth helperText="Overlay that admits Mandala tokens on this network. Leave both Mandala fields empty to refuse Mandala tokens." />
                <TextField label="Mandala overlay identity key" value={overlayKey} onChange={event => { setOverlayKey(event.target.value); setError('') }} disabled={busy} fullWidth helperText="The overlay operator's 66-character compressed public key" inputProps={{ spellCheck: false, autoCapitalize: 'off' }} />
                <TextField label="Remote wallet storage URL (optional)" value={form.storageUrl} onChange={event => update('storageUrl', event.target.value)} disabled={busy} fullWidth helperText="Leave empty to keep your wallet data on this device." />
                <Button size="small" onClick={() => loadForm(defaultNetworkSettings(selected))} disabled={busy} sx={{ alignSelf: 'flex-start' }}>Restore defaults</Button>
              </Stack>
            </AccordionDetails>
          </Accordion>
          {window.electronAPI?.network && <Accordion disableGutters elevation={0} sx={{ bgcolor: 'transparent', '&:before': { display: 'none' } }}>
            <AccordionSummary expandIcon={<ExpandMoreRounded />}><Typography variant="body2" color="text.secondary">Connection proxy</Typography></AccordionSummary>
            <AccordionDetails><Stack spacing={2}>
              <FormControlLabel label="Use HTTP proxy" control={<Switch checked={proxyEnabled} onChange={event => setProxyEnabled(event.target.checked)} disabled={proxySaving || busy} />} />
              <TextField label="HTTP proxy URL" placeholder="http://127.0.0.1:8080" value={proxyUrl} onChange={event => setProxyUrl(event.target.value)} disabled={!proxyEnabled || proxySaving || busy} fullWidth />
              {restartRequired && <Alert severity="warning">Restart to apply this proxy to background wallet services.</Alert>}
              <Stack direction="row" spacing={1}>
                <Button onClick={saveProxy} disabled={proxySaving || busy}>Save proxy</Button>
                {restartRequired && <Button color="warning" onClick={() => window.electronAPI.app.restart()} disabled={busy}>Restart</Button>}
              </Stack>
            </Stack></AccordionDetails>
          </Accordion>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
        <Button variant="contained" disabled={busy || !managers.permissionsManager} onClick={save}
          startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}>
          {busy ? 'Opening wallet…' : selected === chain ? 'Save services' : 'Switch network'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
export default NetworkSettingsDialog
