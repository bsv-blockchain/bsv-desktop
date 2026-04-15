import { useState, useEffect, useContext } from 'react'
import { useTranslation } from 'react-i18next'
import { DialogContent, DialogActions, Button, Typography, TextField, Box, IconButton, Tooltip, Tabs, Tab } from '@mui/material'
import CustomDialog from './CustomDialog'
import { WalletContext } from '../WalletContext'
import { WalletInterface } from '@bsv/sdk'
import { toast } from 'react-toastify'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import WalletFundingFlow from './WalletFundingFlow'

interface TabPanelProps {
  children?: React.ReactNode
  index: number
  value: number
}

const TabPanel: React.FC<TabPanelProps> = ({ children, value, index }) => {
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`funding-tabpanel-${index}`}
      aria-labelledby={`funding-tab-${index}`}
    >
      {value === index && <Box sx={{ pt: 3 }}>{children}</Box>}
    </div>
  )
}

const FundingHandler: React.FC = () => {
  const { t } = useTranslation()
  const { setWalletFunder, network } = useContext(WalletContext)
  const [open, setOpen] = useState(false)
  const [identityKey, setIdentityKey] = useState('')
  const [paymentTX, setPaymentTX] = useState<string>('')
  const [resolveFn, setResolveFn] = useState<Function>(() => { })
  const [wallet, setWallet] = useState<WalletInterface | null>(null)
  const [adminOriginator, setAdminOriginator] = useState<string>('')
  const [tabValue, setTabValue] = useState(0)

  useEffect(() => {
    setWalletFunder((() => {
      return async (_: number[], wallet: WalletInterface, adminOriginator: string): Promise<void> => {
        return new Promise<void>(async resolve => {
          try {
            const identityKey = (await wallet.getPublicKey({ identityKey: true }, adminOriginator)).publicKey
            setIdentityKey(identityKey)
          } catch (e) {
            setIdentityKey('')
          }
          setResolveFn(() => resolve)
          setWallet(wallet)
          setAdminOriginator(adminOriginator)
          setOpen(true)
        })
      }
    }) as any)
  }, [])

  const handleClose = () => {
    setOpen(false)
    resolveFn()
  }

  const handleFundingComplete = () => {
    setOpen(false)
    resolveFn()
  }

  const handleFunded = async () => {
    try {
      const payment = JSON.parse(paymentTX)
      await wallet.internalizeAction(payment, adminOriginator)
      toast.success(t('funding_success'))
      handleFundingComplete()
    } catch (e: any) {
      toast.error(e.message)
      console.error(e)
    }
  }

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue)
  }

  // const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
  //   const file = e.target.files && e.target.files[0]
  //   if (!file) return
  //   const reader = new FileReader()
  //   reader.onload = evt => {
  //     const text = evt.target?.result as string
  //     setPaymentTX(text.trim())
  //   }
  //   reader.readAsText(file)
  //   setFileName(file.name)
  // }


  return (
    <CustomDialog open={open} onClose={handleClose} title={t('funding_dialog_title')} maxWidth="md" fullWidth>
      <DialogContent>
        <Tabs value={tabValue} onChange={handleTabChange} aria-label={t('funding_aria_label')} sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tab label={t('funding_tab_simple')} id="funding-tab-0" aria-controls="funding-tabpanel-0" />
          <Tab label={t('funding_tab_advanced')} id="funding-tab-1" aria-controls="funding-tabpanel-1" />
        </Tabs>

        <TabPanel value={tabValue} index={0}>
          {wallet && adminOriginator && (
            <WalletFundingFlow
              wallet={wallet}
              adminOriginator={adminOriginator}
              network={network === 'mainnet' ? 'mainnet' : 'testnet'}
              onFundingComplete={handleFundingComplete}
            />
          )}
        </TabPanel>

        <TabPanel value={tabValue} index={1}>
          <Typography variant="body1" sx={{ mb: 2 }}>
            {t('funding_identity_key_label')}
          </Typography>
          <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', bgcolor: 'background.paper', p: 1, borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
            <Typography variant="body2" sx={{ flexGrow: 1, userSelect: 'all', wordBreak: 'break-all', fontFamily: 'monospace' }}>
              {identityKey}
            </Typography>
            <Tooltip title={t('funding_copy_tooltip')}>
              <IconButton
                size="small"
                onClick={() => {
                  navigator.clipboard.writeText(identityKey)
                    .then(() => toast.success(t('funding_copy_success')))
                    .catch(err => toast.error(t('funding_copy_error', { error: err.message })))
                }}
              >
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
          <TextField
            label={t('funding_json_label')}
            placeholder={t('funding_json_placeholder')}
            multiline
            fullWidth
            rows={8}
            value={paymentTX}
            onChange={e => setPaymentTX(e.target.value)}
            variant="outlined"
            sx={{
              '& .MuiInputBase-input': { fontFamily: 'monospace', fontSize: '0.875rem' },
              '& .MuiOutlinedInput-root': {
                '& fieldset': {
                  borderColor: 'rgba(0, 0, 0, 0.1)',
                  borderWidth: '1px'
                },
                '&:hover fieldset': {
                  borderColor: 'rgba(0, 0, 0, 0.2)'
                },
                '&.Mui-focused fieldset': {
                  borderColor: 'rgba(0, 0, 0, 0.3)',
                  borderWidth: '1px'
                }
              }
            }}
          />
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2 }}>
            <Button variant="contained" onClick={handleFunded} disabled={!paymentTX}>
              {t('funding_button')}
            </Button>
          </Box>
        </TabPanel>
      </DialogContent>
    </CustomDialog>
  )
}

export default FundingHandler