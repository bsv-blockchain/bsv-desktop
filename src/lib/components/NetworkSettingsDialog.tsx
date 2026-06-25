import React, { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  Typography
} from '@mui/material'
import { toast } from 'react-toastify'

interface ProxySettings {
  mode: 'direct' | 'fixed_servers';
  proxyRules: string;
  lastProxyRules?: string;
}

const DEFAULT_PROXY_URL = 'http://127.0.0.1:7890'

const NetworkSettingsDialog: React.FC = () => {
  const [open, setOpen] = useState(false)
  const [proxyEnabled, setProxyEnabled] = useState(false)
  const [proxyUrl, setProxyUrl] = useState(DEFAULT_PROXY_URL)
  const [saving, setSaving] = useState(false)
  const [restartAvailable, setRestartAvailable] = useState(false)

  const hasElectronNetworkApi = Boolean(window.electronAPI?.network)

  const loadSettings = useCallback(async () => {
    if (!hasElectronNetworkApi) return

    const settings = await window.electronAPI.network.getProxySettings()
    setProxyEnabled(settings.mode === 'fixed_servers' && Boolean(settings.proxyRules))
    setProxyUrl(settings.proxyRules || settings.lastProxyRules || DEFAULT_PROXY_URL)
    setRestartAvailable(false)
  }, [hasElectronNetworkApi])

  useEffect(() => {
    if (!hasElectronNetworkApi) return

    const handleOpenSettings = () => {
      setOpen(true)
      void loadSettings()
    }

    window.electronAPI.network.onOpenSettings(handleOpenSettings)
    return () => {
      window.electronAPI.network.removeOpenSettingsListener(handleOpenSettings)
    }
  }, [hasElectronNetworkApi, loadSettings])

  const handleSave = async () => {
    if (!hasElectronNetworkApi) return

    setSaving(true)

    const settings: ProxySettings = proxyEnabled
      ? { mode: 'fixed_servers', proxyRules: proxyUrl.trim() }
      : { mode: 'direct', proxyRules: '', lastProxyRules: proxyUrl.trim() }

    try {
      const result = await window.electronAPI.network.setProxySettings(settings)

      if (!result.success) {
        toast.error(result.error || 'Failed to save network settings.')
        return
      }

      setRestartAvailable(Boolean(result.restartRequired))
      toast.success('Network settings saved.')
    } catch {
      toast.error('Failed to save network settings.')
    } finally {
      setSaving(false)
    }
  }

  const handleRestart = async () => {
    if (!hasElectronNetworkApi) return
    await window.electronAPI.app.restart()
  }

  return (
    <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
      <DialogTitle>Network</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Configure an application-wide HTTP proxy for BSV Desktop network requests.
          </Typography>

          <Alert severity="info">
            Changes take effect after restarting BSV Desktop.
          </Alert>

          <FormControlLabel
            control={
              <Switch
                checked={proxyEnabled}
                onChange={(event) => setProxyEnabled(event.target.checked)}
              />
            }
            label="Use HTTP proxy"
          />

          <TextField
            fullWidth
            disabled={!proxyEnabled}
            label="HTTP proxy URL"
            placeholder="http://host:port"
            value={proxyUrl}
            onChange={(event) => setProxyUrl(event.target.value)}
            helperText="Only HTTP proxy URLs are supported."
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setOpen(false)} disabled={saving}>Close</Button>
        {restartAvailable && (
          <Button onClick={handleRestart} color="warning" disabled={saving}>
            Restart
          </Button>
        )}
        <Button onClick={handleSave} variant="contained" disabled={saving}>
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default NetworkSettingsDialog
