import React, { useCallback, useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Typography,
  TextField,
  Button,
  Divider,
  CircularProgress,
  Collapse,
  RadioGroup,
  FormControlLabel,
  Radio,
  FormControl,
  FormLabel,
  IconButton,
  Tooltip
} from '@mui/material';
import SettingsIcon from '@mui/icons-material/Settings';
import CloseIcon from '@mui/icons-material/Close';
import { toast } from 'react-toastify';
import { DEFAULT_CHAIN } from '../config';
import { WalletContext, WABConfig, LoginType } from '../WalletContext';

interface WalletConfigProps {
  /** When true, the config panel starts expanded and immediately enters editing mode. */
  autoExpand?: boolean
  /** When true, the Wallet Login Type radio group is hidden (login type is controlled externally). */
  hideLoginType?: boolean
  /** Controlled open state — when provided the component hides its own toggle button. */
  open?: boolean
  /** Called when the component would toggle itself — used with `open` for external control. */
  onToggle?: () => void
}

const WalletConfig: React.FC<WalletConfigProps> = ({ autoExpand = false, hideLoginType = false, open, onToggle }) => {
  const { t } = useTranslation()
  const { managers, finalizeConfig, setConfigStatus, loginType: contextLoginType } = useContext(WalletContext)

  // Wallet configuration state
  const [showWalletConfig, setShowWalletConfig] = useState(autoExpand)
  const isControlled = open !== undefined
  const configVisible = isControlled ? open : showWalletConfig
  const [wabUrl, setWabUrl] = useState<string>('')
  const [messageBoxUrl, setMessageBoxUrl] = useState<string>('')
  const [wabInfo, setWabInfo] = useState<{
    supportedAuthMethods: string[];
    faucetEnabled: boolean;
    faucetAmount: number;
  } | null>(null)
  const [method, setMethod] = useState<string>("")
  const [network, setNetwork] = useState<'main' | 'test'>(DEFAULT_CHAIN)
  const [storageUrl, setStorageUrl] = useState<string>('')
  const [loginType, setLoginType] = useState<LoginType>(contextLoginType)
  const [useRemoteStorage, setUseRemoteStorage] = useState<boolean>(false)
  const [useMessageBox, setUseMessageBox] = useState<boolean>(false)
  const [isLoadingConfig, setIsLoadingConfig] = useState(false)
  const [backupConfig, setBackupConfig] = useState<WABConfig>()

  // Access the manager:
  const walletManager = managers.walletManager

  // Auto-fetch wallet configuration info when component mounts
  useEffect(() => {
    if (!wabInfo && !walletManager?.authenticated) {
      fetchWalletConfig()
    }
  }, [])

  // When autoExpand is true, enter editing mode on mount
  useEffect(() => {
    if (autoExpand) {
      setConfigStatus('editing')
      layAwayCurrentConfig()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync loginType with context when component mounts
  useEffect(() => {
    setLoginType(contextLoginType)
  }, [contextLoginType])

  // Fetch wallet configuration info
  const fetchWalletConfig = async () => {
    // Don't fetch if wabUrl is empty or not using WAB
    if (!wabUrl || loginType !== 'wab') {
      return
    }

    setIsLoadingConfig(true)
    try {
      const res = await fetch(`${wabUrl}/info`)
      if (!res.ok) {
        throw new Error(`Failed to fetch info: ${res.status}`)
      }
      const info = await res.json()
      setWabInfo(info)

      // Auto-select the first supported authentication method
      if (info.supportedAuthMethods && info.supportedAuthMethods.length > 0) {
        setMethod(info.supportedAuthMethods[0])
      }
    } catch (error: any) {
      console.error("Error fetching wallet config:", error)
      toast.error(t('wallet_config_fetch_error') + error.message)
    } finally {
      setIsLoadingConfig(false)
    }
  }

  // Apply wallet configuration
  const applyWalletConfig = useCallback(() => {
    const valid = finalizeConfig({
      wabUrl,
      wabInfo,
      method,
      network,
      storageUrl,
      messageBoxUrl,
      loginType,
      useWab: loginType === 'wab',
      useRemoteStorage,
      useMessageBox,
    })
    if (valid) setShowWalletConfig(false)
  }, [wabUrl, wabInfo, method, network, storageUrl, messageBoxUrl, loginType, useRemoteStorage, useMessageBox, finalizeConfig, setShowWalletConfig])

  // Force the manager to use the "presentation-key-and-password" flow (only for WAB/CWIStyle managers):
  useEffect(() => {
    if (walletManager && 'authenticationMode' in walletManager) {
      (walletManager as any).authenticationMode = 'presentation-key-and-password'
    }
  }, [walletManager])

  const layAwayCurrentConfig = () => {
    setBackupConfig({
      wabUrl,
      wabInfo,
      method,
      network,
      storageUrl,
      messageBoxUrl,
      loginType,
      useWab: loginType === 'wab',
      useRemoteStorage,
      useMessageBox
    })
    if (managers?.walletManager) {
      delete managers.walletManager
    }
    if (managers?.permissionsManager) {
      delete managers.permissionsManager
    }
    if (managers?.settingsManager) {
      delete managers.settingsManager
    }
  }

  const resetCurrentConfig = useCallback(() => {
    if (backupConfig) {
      setWabUrl(backupConfig.wabUrl)
      setWabInfo(backupConfig.wabInfo)
      setMethod(backupConfig.method)
      setNetwork(backupConfig.network)
      setStorageUrl(backupConfig.storageUrl)
      setMessageBoxUrl(backupConfig.messageBoxUrl)
      setLoginType(backupConfig.loginType || (backupConfig.useWab !== false ? 'wab' : 'mnemonic-advanced'))
      setUseRemoteStorage(backupConfig.useRemoteStorage || false)
      setUseMessageBox(backupConfig.useMessageBox || false)
      finalizeConfig(backupConfig)
    }
  }, [backupConfig, finalizeConfig])

  const toggle = () => {
    if (isControlled) {
      // Side-effects only; parent owns open state
      if (open) {
        setConfigStatus('configured')
        resetCurrentConfig()
      } else {
        setConfigStatus('editing')
        layAwayCurrentConfig()
      }
      onToggle?.()
    } else {
      setShowWalletConfig(s => {
        if (s) {
          setConfigStatus('configured')
          resetCurrentConfig()
        } else {
          setConfigStatus('editing')
          layAwayCurrentConfig()
        }
        return !s
      })
    }
  }

  return <Box sx={{ mb: configVisible ? 2 : 0 }}>
    <Box>
      {!isControlled && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', mb: 1 }}>
          <Tooltip title={configVisible ? t('wallet_config_hide_tooltip') : t('wallet_config_show_tooltip')} placement="left">
            <IconButton onClick={toggle} size="small" color={configVisible ? 'secondary' : 'default'}>
              {configVisible ? <CloseIcon fontSize="small" /> : <SettingsIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        </Box>
      )}
      {isLoadingConfig ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
          <CircularProgress size={24} />
        </Box>
      ) : (
            <Collapse in={configVisible}>
              <Typography variant="h4" color="primary">
                {t('wallet_config_title')}
              </Typography>
              <Box sx={{ py: 2 }}>
                {/* BSV Network Selection */}
                <Box sx={{ mb: 3 }}>
                  <Typography variant="body2" gutterBottom>
                    {t('wallet_config_network_label')}
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button
                      variant={network === 'main' ? "contained" : "outlined"}
                      size="small"
                      onClick={() => setNetwork('main')}
                      sx={{ textTransform: 'none' }}
                    >
                      {t('wallet_config_mainnet')}
                    </Button>
                    <Button
                      variant={network === 'test' ? "contained" : "outlined"}
                      size="small"
                      onClick={() => setNetwork('test')}
                      sx={{ textTransform: 'none' }}
                    >
                      {t('wallet_config_testnet')}
                    </Button>
                  </Box>
                </Box>

                {!hideLoginType && (
                  <>
                    <Divider sx={{ my: 3 }} />

                    {/* Wallet Login Type Section */}
                    <Box sx={{ mb: 3 }}>
                      <FormControl component="fieldset">
                        <FormLabel component="legend">
                          <Typography variant="body2" gutterBottom sx={{ fontWeight: 'bold' }}>
                            {t('wallet_config_login_type_label')}
                          </Typography>
                        </FormLabel>
                        <Typography variant="body2" gutterBottom sx={{ mt: 1, mb: 2 }}>
                          {t('wallet_config_login_type_description')}
                        </Typography>
                        <RadioGroup
                          value={loginType}
                          onChange={(e) => setLoginType(e.target.value as LoginType)}
                        >
                          <FormControlLabel
                            value="wab"
                            control={<Radio size="small" />}
                            label={
                              <Typography variant="body2">
                                {t('wallet_config_login_wab')}
                              </Typography>
                            }
                          />
                          <FormControlLabel
                            value="direct-key"
                            control={<Radio size="small" />}
                            label={
                              <Typography variant="body2">
                                {t('wallet_config_login_direct_key')}
                              </Typography>
                            }
                          />
                          <FormControlLabel
                            value="mnemonic-advanced"
                            control={<Radio size="small" />}
                            label={
                              <Typography variant="body2">
                                {t('wallet_config_login_mnemonic')}
                              </Typography>
                            }
                          />
                        </RadioGroup>
                      </FormControl>

                      {loginType === 'wab' && (
                        <Box sx={{ mt: 2, ml: 3, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                          <TextField
                            label={t('wallet_config_wab_url_label')}
                            fullWidth
                            variant="outlined"
                            value={wabUrl}
                            onChange={(e) => setWabUrl(e.target.value)}
                            margin="normal"
                            size="small"
                          />
                          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1, mb: 2 }}>
                            <Button
                              variant="outlined"
                              size="small"
                              onClick={fetchWalletConfig}
                              disabled={isLoadingConfig}
                            >
                              {t('wallet_config_refresh_info')}
                            </Button>
                          </Box>
                          {wabInfo && wabInfo.supportedAuthMethods && wabInfo.supportedAuthMethods.length > 0 && (
                            <Box sx={{ mt: 2 }}>
                              <Typography variant="body2" gutterBottom>
                                {t('wallet_config_auth_method_description')}
                              </Typography>
                              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                                {wabInfo.supportedAuthMethods.map((methodOption) => (
                                  <Button
                                    key={methodOption}
                                    variant={method === methodOption ? "contained" : "outlined"}
                                    size="small"
                                    onClick={() => setMethod(methodOption)}
                                    sx={{ textTransform: 'none' }}
                                  >
                                    {methodOption}
                                  </Button>
                                ))}
                              </Box>
                            </Box>
                          )}
                        </Box>
                      )}
                    </Box>

                    <Divider sx={{ my: 3 }} />
                  </>
                )}

                {hideLoginType && <Divider sx={{ my: 3 }} />}

                {/* Remote Storage Configuration Section */}
                <Box sx={{ mb: 3 }}>
                  <FormControl component="fieldset">
                    <FormLabel component="legend">
                      <Typography variant="body2" gutterBottom sx={{ fontWeight: 'bold' }}>
                        {t('wallet_config_remote_storage_label')}
                      </Typography>
                    </FormLabel>
                    <Typography variant="body2" gutterBottom sx={{ mt: 1, mb: 2 }}>
                      {t('wallet_config_remote_storage_description')}
                    </Typography>
                    <RadioGroup
                      value={useRemoteStorage.toString()}
                      onChange={(e) => setUseRemoteStorage(e.target.value === 'true')}
                    >
                      <FormControlLabel
                        value="false"
                        control={<Radio size="small" />}
                        label={
                          <Typography variant="body2">
                            {t('wallet_config_remote_storage_off')}
                          </Typography>
                        }
                      />
                      <FormControlLabel
                        value="true"
                        control={<Radio size="small" />}
                        label={
                          <Typography variant="body2">
                            {t('wallet_config_remote_storage_on')}
                          </Typography>
                        }
                      />
                    </RadioGroup>
                  </FormControl>

                  {useRemoteStorage && (
                    <Box sx={{ mt: 2, ml: 3, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                      <TextField
                        label={t('wallet_config_storage_url_label')}
                        fullWidth
                        variant="outlined"
                        value={storageUrl}
                        onChange={(e) => setStorageUrl(e.target.value)}
                        margin="normal"
                        size="small"
                        required
                      />
                    </Box>
                  )}
                </Box>

                <Divider sx={{ my: 3 }} />

                {/* Message Box Configuration Section */}
                <Box sx={{ mb: 3 }}>
                  <FormControl component="fieldset">
                    <FormLabel component="legend">
                      <Typography variant="body2" gutterBottom sx={{ fontWeight: 'bold' }}>
                        {t('wallet_config_message_box_label')}
                      </Typography>
                    </FormLabel>
                    <Typography variant="body2" gutterBottom sx={{ mt: 1, mb: 2 }}>
                      {t('wallet_config_message_box_description')}
                    </Typography>
                    <RadioGroup
                      value={useMessageBox.toString()}
                      onChange={(e) => setUseMessageBox(e.target.value === 'true')}
                    >
                      <FormControlLabel
                        value="false"
                        control={<Radio size="small" />}
                        label={
                          <Typography variant="body2">
                            {t('wallet_config_message_box_off')}
                          </Typography>
                        }
                      />
                      <FormControlLabel
                        value="true"
                        control={<Radio size="small" />}
                        label={
                          <Typography variant="body2">
                            {t('wallet_config_message_box_on')}
                          </Typography>
                        }
                      />
                    </RadioGroup>
                  </FormControl>

                  {useMessageBox && (
                    <Box sx={{ mt: 2, ml: 3, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                      <TextField
                        label={t('wallet_config_message_box_url_label')}
                        fullWidth
                        variant="outlined"
                        value={messageBoxUrl}
                        onChange={(e) => setMessageBoxUrl(e.target.value)}
                        margin="normal"
                        size="small"
                        helperText={t('wallet_config_message_box_url_helper')}
                      />
                    </Box>
                  )}
                </Box>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2 }}>
                <Button
                  variant="contained"
                  size="small"
                  color="primary"
                  onClick={applyWalletConfig}
                  disabled={
                    (loginType === 'wab' && (!wabInfo || !method || !wabUrl)) ||
                    (useRemoteStorage && !storageUrl)
                  }
                >
                  {t('wallet_config_apply_button')}
                </Button>
              </Box>
            </Collapse>
      )}
    </Box>
  </Box>
}


export default WalletConfig;
