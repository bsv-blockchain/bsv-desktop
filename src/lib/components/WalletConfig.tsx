import React, { useCallback, useContext, useEffect, useState } from 'react';
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
  FormLabel
} from '@mui/material';
import SettingsIcon from '@mui/icons-material/Settings';
import { toast } from 'react-toastify';
import { DEFAULT_CHAIN, DEFAULT_USE_WAB } from '../config';
import { WalletContext, WABConfig } from '../WalletContext';

const WalletConfig: React.FC = () => {
  const { managers, finalizeConfig, setConfigStatus, useWab: contextUseWab } = useContext(WalletContext)

  // Wallet configuration state
  const [showWalletConfig, setShowWalletConfig] = useState(false)
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
  const [useWab, setUseWab] = useState<boolean>(DEFAULT_USE_WAB)
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

  // Sync useWab with context when component mounts
  useEffect(() => {
    setUseWab(contextUseWab)
  }, [contextUseWab])

  // Fetch wallet configuration info
  const fetchWalletConfig = async () => {
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
      toast.error("Could not fetch wallet configuration: " + error.message)
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
      useWab,
      useRemoteStorage,
      useMessageBox,
    })
    if (valid) setShowWalletConfig(false)
  }, [wabUrl, wabInfo, method, network, storageUrl, messageBoxUrl, useWab, useRemoteStorage, useMessageBox, finalizeConfig, setShowWalletConfig])

  // Force the manager to use the "presentation-key-and-password" flow:
  useEffect(() => {
    if (walletManager) {
      walletManager.authenticationMode = 'presentation-key-and-password'
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
      useWab,
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
      setUseWab(backupConfig.useWab !== false)
      setUseRemoteStorage(backupConfig.useRemoteStorage || false)
      setUseMessageBox(backupConfig.useMessageBox || false)
      finalizeConfig(backupConfig)
    }
  }, [backupConfig, finalizeConfig])

  const toggle = () => {
    setShowWalletConfig(s => {
      if (s) {
        // we're closing the dialogue
        setConfigStatus('configured')
        resetCurrentConfig()
      } else {
        // we're opening the dialogue to edit so don't autobuild anything
        setConfigStatus('editing')
        layAwayCurrentConfig()
      }
      return !s
    })
  }

  return <Box sx={{ mb: 3 }}>
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
        <Button
          startIcon={<SettingsIcon />}
          onClick={toggle}
          variant="text"
          color='secondary'
          size="small"
        >
          {showWalletConfig ? 'Hide Details' : 'Show Config'}
        </Button>
      </Box>
      {isLoadingConfig ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
          <CircularProgress size={24} />
        </Box>
      ) : (
            <Collapse in={showWalletConfig}>
              <Typography variant="h4" color="primary">
                Configuration
              </Typography>
              <Box sx={{ py: 2 }}>
                {/* BSV Network Selection */}
                <Box sx={{ mb: 3 }}>
                  <Typography variant="body2" gutterBottom>
                    BSV Network:
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button
                      variant={network === 'main' ? "contained" : "outlined"}
                      size="small"
                      onClick={() => setNetwork('main')}
                      sx={{ textTransform: 'none' }}
                    >
                      Mainnet
                    </Button>
                    <Button
                      variant={network === 'test' ? "contained" : "outlined"}
                      size="small"
                      onClick={() => setNetwork('test')}
                      sx={{ textTransform: 'none' }}
                    >
                      Testnet
                    </Button>
                  </Box>
                </Box>

                <Divider sx={{ my: 3 }} />

                {/* WAB Configuration Section */}
                <Box sx={{ mb: 3 }}>
                  <FormControl component="fieldset">
                    <FormLabel component="legend">
                      <Typography variant="body2" gutterBottom sx={{ fontWeight: 'bold' }}>
                        Presentation Key
                      </Typography>
                    </FormLabel>
                    <Typography variant="body2" gutterBottom sx={{ mt: 1, mb: 2 }}>
                      This wallet uses a 2 of 3 backup and recovery scheme for your root key. One factor is called the presentation key, and can either be provided by you, or stored in a Wallet Authentication Backend (WAB) for convenience.
                    </Typography>
                    <RadioGroup
                      value={useWab.toString()}
                      onChange={(e) => setUseWab(e.target.value === 'true')}
                    >
                      <FormControlLabel
                        value="false"
                        control={<Radio size="small" />}
                        label={
                          <Typography variant="body2">
                            I will provide my own presentation key.
                          </Typography>
                        }
                      />
                      <FormControlLabel
                        value="true"
                        control={<Radio size="small" />}
                        label={
                          <Typography variant="body2">
                            I want to use WAB.
                          </Typography>
                        }
                      />
                      
                    </RadioGroup>
                  </FormControl>

                  {useWab && (
                    <Box sx={{ mt: 2, ml: 3, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                      <TextField
                        label="WAB URL"
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
                          Refresh Info
                        </Button>
                      </Box>
                      {wabInfo && wabInfo.supportedAuthMethods && wabInfo.supportedAuthMethods.length > 0 && (
                        <Box sx={{ mt: 2 }}>
                          <Typography variant="body2" gutterBottom>
                            Service which will be used to verify your phone number:
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

                {/* Remote Storage Configuration Section */}
                <Box sx={{ mb: 3 }}>
                  <FormControl component="fieldset">
                    <FormLabel component="legend">
                      <Typography variant="body2" gutterBottom sx={{ fontWeight: 'bold' }}>
                        Remote Storage:
                      </Typography>
                    </FormLabel>
                    <Typography variant="body2" gutterBottom sx={{ mt: 1, mb: 2 }}>
                      Use a remote storage provider for your transactions and metadata.
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
                            Off - Store locally only
                          </Typography>
                        }
                      />
                      <FormControlLabel
                        value="true"
                        control={<Radio size="small" />}
                        label={
                          <Typography variant="body2">
                            On - Use remote storage provider
                          </Typography>
                        }
                      />
                    </RadioGroup>
                  </FormControl>

                  {useRemoteStorage && (
                    <Box sx={{ mt: 2, ml: 3, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                      <TextField
                        label="Storage URL"
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
                        Message Box:
                      </Typography>
                    </FormLabel>
                    <Typography variant="body2" gutterBottom sx={{ mt: 1, mb: 2 }}>
                      Use a message box provider for receiving messages while offline.
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
                            Off - No message box
                          </Typography>
                        }
                      />
                      <FormControlLabel
                        value="true"
                        control={<Radio size="small" />}
                        label={
                          <Typography variant="body2">
                            On - Use message box provider
                          </Typography>
                        }
                      />
                    </RadioGroup>
                  </FormControl>

                  {useMessageBox && (
                    <Box sx={{ mt: 2, ml: 3, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                      <TextField
                        label="Message Box URL"
                        fullWidth
                        variant="outlined"
                        value={messageBoxUrl}
                        onChange={(e) => setMessageBoxUrl(e.target.value)}
                        margin="normal"
                        size="small"
                        required
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
                    (useWab && (!wabInfo || !method || !wabUrl)) ||
                    (useRemoteStorage && !storageUrl) ||
                    (useMessageBox && !messageBoxUrl)
                  }
                >
                  Apply Configuration
                </Button>
              </Box>
            </Collapse>
      )}
    </Box>
  </Box>
}


export default WalletConfig;
