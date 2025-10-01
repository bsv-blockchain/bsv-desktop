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
    })
    if (valid) setShowWalletConfig(false)
  }, [wabUrl, wabInfo, method, network, storageUrl, messageBoxUrl, useWab, finalizeConfig, setShowWalletConfig])

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
      useWab
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
    finalizeConfig(backupConfig)
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
                <Typography variant="body2" gutterBottom>
                  Wallet Authentication Backend (WAB) provides 2 of 3 backup and recovery functionality for your root key.
                </Typography>
                <TextField
                  label="WAB URL"
                  fullWidth
                  variant="outlined"
                  value={wabUrl}
                  onChange={(e) => setWabUrl(e.target.value)}
                  margin="normal"
                  size="small"
                />
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={fetchWalletConfig}
                    disabled={isLoadingConfig}
                  >
                    Refresh Info
                  </Button>
                </Box>
                <Divider />
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

                <Box sx={{ mt: 2 }}>
                  <Typography variant="body2" gutterBottom>
                    BSV Network:
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
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

                <Typography variant="body2" gutterBottom>
                  Wallet Storage Provider to use for your transactions and metadata:
                </Typography>
                <TextField
                  label="Storage URL"
                  fullWidth
                  variant="outlined"
                  value={storageUrl}
                  onChange={(e) => setStorageUrl(e.target.value)}
                  margin="normal"
                  size="small"
                />

                <Typography variant="body2" gutterBottom>
                  Message Box Provider to use for receiving messages and payments while offline.
                </Typography>
                <TextField
                  label="Message Box URL"
                  fullWidth
                  variant="outlined"
                  value={messageBoxUrl}
                  onChange={(e) => setMessageBoxUrl(e.target.value)}
                  margin="normal"
                  size="small"
                />

                <Box sx={{ mt: 3 }}>
                  <FormControl component="fieldset">
                    <FormLabel component="legend">
                      <Typography variant="body2" gutterBottom>
                        WAB Configuration:
                      </Typography>
                    </FormLabel>
                    <RadioGroup
                      value={useWab.toString()}
                      onChange={(e) => setUseWab(e.target.value === 'true')}
                    >
                      <FormControlLabel
                        value="true"
                        control={<Radio size="small" />}
                        label={
                          <Typography variant="body2">
                            Use WAB (Recommended) - Easy access with phone number without compromising security.
                          </Typography>
                        }
                      />
                      <FormControlLabel
                        value="false"
                        control={<Radio size="small" />}
                        label={
                          <Typography variant="body2" sx={{ color: 'error.main' }}>
                            <strong>At your own risk!</strong> Advanced: Don't use WAB - Manage all three keys yourself.
                          </Typography>
                        }
                      />
                    </RadioGroup>
                  </FormControl>
                </Box>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2 }}>
                <Button
                  variant="contained"
                  size="small"
                  color="primary"
                  onClick={applyWalletConfig}
                  disabled={!wabInfo || !method}
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
