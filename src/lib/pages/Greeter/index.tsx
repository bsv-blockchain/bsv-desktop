import { useContext, useState, useRef, useCallback, useEffect } from 'react'
import {
  Typography,
  Button,
  TextField,
  CircularProgress,
  Divider,
  InputAdornment,
  IconButton,
  Paper,
  Box,
  Container,
  useTheme,
  Stepper,
  Step,
  StepLabel,
  StepContent,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  AlertTitle,
} from '@mui/material'
import {
  SettingsPhone as PhoneIcon,
  PermPhoneMsg as SMSIcon,
  Lock as LockIcon,
  Restore as RestoreIcon,
  VpnKey as KeyIcon,
  Visibility,
  VisibilityOff,
  CheckCircle as CheckCircleIcon,
  Casino as RandomIcon,
  ContentCopy as CopyIcon,
} from '@mui/icons-material'
import PhoneEntry from '../../components/PhoneEntry.js'
import AppLogo from '../../components/AppLogo.js'
import { toast } from 'react-toastify'
import { saveMnemonic } from '../../../electronFunctions.js'
import { WalletContext } from '../../WalletContext.js'
import { UserContext } from '../../UserContext.js'
import PageLoading from '../../components/PageLoading.js'
import { Utils, Mnemonic, HD } from '@bsv/sdk'
import { Link as RouterLink } from 'react-router-dom'
import WalletConfig from '../../components/WalletConfig.js'

// Helper functions for the Stepper will be defined inside the component

// Phone form component to reduce cognitive complexity
const PhoneForm = ({ phone, setPhone, loading, handleSubmitPhone, phoneFieldRef }) => {
  const theme = useTheme();
  return (
    <form onSubmit={handleSubmitPhone}>
      <PhoneEntry
        value={phone}
        onChange={setPhone}
        ref={phoneFieldRef}
        sx={{
          width: '100%',
          mb: 2
        }}
      />
      <Button
        variant='contained'
        type='submit'
        disabled={loading || !phone || phone.length < 10}
        fullWidth
        sx={{ 
          mt: 2,
          borderRadius: theme.shape.borderRadius,
          textTransform: 'none',
          py: 1.2
        }}
      >
        {loading ? <CircularProgress size={24} /> : 'Continue'}
      </Button>
    </form>
  );
};

// Code verification form component
const CodeForm = ({ code, setCode, loading, handleSubmitCode, handleResendCode, codeFieldRef }) => {
  const theme = useTheme();
  return (
    <>
      <form onSubmit={handleSubmitCode}>
        <TextField
          label="6-digit code"
          onChange={(e) => setCode(e.target.value)}
          variant="outlined"
          fullWidth
          disabled={loading}
          slotProps={{
            input: {
              ref: codeFieldRef,
              endAdornment: (
                <InputAdornment position="end">
                  {code.length === 6 && <CheckCircleIcon color='success' />}
                </InputAdornment>
              ),
            }
          }}
          sx={{ 
            mb: 2   
          }}
        />
        <Button
          variant='contained'
          type='submit'
          disabled={loading || code.length !== 6}
          fullWidth
          sx={{ 
            mt: 2,
            borderRadius: theme.shape.borderRadius,
            textTransform: 'none',
            py: 1.2
          }}
        >
          {loading ? <CircularProgress size={24} /> : 'Verify Code'}
        </Button>
      </form>
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
        <Button
          disabled={loading}
          onClick={handleResendCode}
          size="small"
          color="secondary"
          sx={{ textTransform: 'none' }}
        >
          Resend Code
        </Button>
      </Box>
    </>
  );
};

// Presentation key form component (using mnemonic)
const PresentationKeyForm = ({ mnemonic, setMnemonic, loading, handleSubmitMnemonic, mnemonicFieldRef, onGenerateRandom, isLocked }) => {
  const theme = useTheme();
  
  const handleCopy = () => {
    if (mnemonic) {
      navigator.clipboard.writeText(mnemonic)
      toast.success('Mnemonic copied to clipboard')
    }
  }
  
  return (
    <form onSubmit={handleSubmitMnemonic}>
      <TextField
        label="Mnemonic"
        value={mnemonic}
        onChange={(e) => setMnemonic(e.target.value)}
        variant="outlined"
        fullWidth
        multiline
        rows={3}
        disabled={loading || isLocked}
        placeholder="Enter your 12 or 24 word recovery phrase"
        slotProps={{
          input: { 
            ref: mnemonicFieldRef,
            endAdornment: mnemonic && (
              <InputAdornment position="end">
                <IconButton
                  onClick={handleCopy}
                  edge="end"
                  size="small"
                  sx={{ alignSelf: 'flex-start', mt: 1 }}
                >
                  <CopyIcon />
                </IconButton>
              </InputAdornment>
            )
          }
        }}
        sx={{ mb: 2 }}
      />
      {!isLocked && (
        <Button
          variant='outlined'
          onClick={onGenerateRandom}
          disabled={loading}
          fullWidth
          startIcon={<RandomIcon />}
          sx={{
            borderRadius: theme.shape.borderRadius,
            textTransform: 'none',
            py: 1.2,
            mb: 2
          }}
        >
          Generate Random Mnemonic
        </Button>
      )}
      <Button
        variant='contained'
        type='submit'
        disabled={loading || !mnemonic}
        fullWidth
        sx={{
          borderRadius: theme.shape.borderRadius,
          textTransform: 'none',
          py: 1.2
        }}
      >
        {loading ? <CircularProgress size={24} /> : 'Continue'}
      </Button>
    </form>
  );
};

// Password form component
const PasswordForm = ({ password, setPassword, confirmPassword, setConfirmPassword, showPassword, setShowPassword, loading, handleSubmitPassword, accountStatus, passwordFieldRef }) => {
  const theme = useTheme();
  return (
    <form onSubmit={handleSubmitPassword}>
      <TextField
        label="Password"
        onChange={(e) => setPassword(e.target.value)}
        type={showPassword ? 'text' : 'password'}
        variant="outlined"
        fullWidth
        disabled={loading}
        slotProps={{
          input: {
            ref: passwordFieldRef,
            endAdornment: (
              <InputAdornment position="end">
                <IconButton
                  aria-label="toggle password visibility"
                  onClick={() => setShowPassword(!showPassword)}
                  edge="end"
                >
                  {showPassword ? <VisibilityOff /> : <Visibility />}
                </IconButton>
              </InputAdornment>
            ),
          }
        }}
        sx={{ 
          mb: 2
        }}
      />

      {accountStatus === 'new-user' && (
        <TextField
          label="Confirm Password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          type={showPassword ? 'text' : 'password'}
          variant="outlined"
          fullWidth
          disabled={loading}
          slotProps={{
            input: {
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    aria-label="toggle password visibility"
                    onClick={() => setShowPassword(!showPassword)}
                    edge="end"
                  >
                    {showPassword ? <VisibilityOff /> : <Visibility />}
                  </IconButton>
                </InputAdornment>
              ),
            }
          }}
          sx={{ 
            mb: 2
          }}
        />
      )}

      <Button
        variant='contained'
        type='submit'
        disabled={loading || !password || (accountStatus === 'new-user' && !confirmPassword)}
        fullWidth
        sx={{
          borderRadius: theme.shape.borderRadius,
          mt: 2,
          textTransform: 'none',
          py: 1.2
        }}
      >
        {loading ? <CircularProgress size={24} /> : (accountStatus === 'new-user' ? 'Create Account' : 'Login')}
      </Button>
    </form>
  );
};

// Main Greeter component with reduced complexity
const Greeter: React.FC<any> = ({ history }) => {
  const { managers, configStatus, useWab, saveEnhancedSnapshot, initializingBackendServices } = useContext(WalletContext)
  const { appVersion, appName, pageLoaded } = useContext(UserContext)
  const theme = useTheme()

  const viewToStepIndex = useWab ? { phone: 0, code: 1, password: 2 } : { presentation: 0, password: 1 }
  const steps = useWab
    ? [
        {
          label: 'Phone Number',
          icon: <PhoneIcon />,
          description: 'Enter your phone number for verification'
        },
        {
          label: 'Verification Code',
          icon: <SMSIcon />,
          description: 'Enter the code you received via SMS'
        },
        {
          label: 'Password',
          icon: <LockIcon />,
          description: 'Enter your password'
        }
      ]
    : [
        {
          label: 'Presentation Key',
          icon: <KeyIcon />,
          description: 'Paste your presentation key'
        },
        {
          label: 'Password',
          icon: <LockIcon />,
          description: 'Enter your password'
        }
      ]

  const [step, setStep] = useState(useWab ? 'phone' : 'presentation')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [mnemonic, setMnemonic] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [accountStatus, setAccountStatus] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showMnemonicDialog, setShowMnemonicDialog] = useState(false)
  const [mnemonicLocked, setMnemonicLocked] = useState(false)

  const phoneFieldRef = useRef(null)
  const codeFieldRef = useRef(null)
  const mnemonicFieldRef = useRef(null)
  const passwordFieldRef = useRef(null)

  const walletManager = managers?.walletManager

  useEffect(() => {
    setStep(useWab ? 'phone' : 'presentation')
  }, [useWab])

  // Step 1: The user enters a phone number, we call manager.startAuth(...)
  const handleSubmitPhone = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!walletManager) {
      toast.error("Wallet Manager not ready yet.")
      return
    }
    try {
      setLoading(true)
      await walletManager?.startAuth({ phoneNumber: phone })
      setStep('code')
      toast.success('A code has been sent to your phone.')
      // Move focus to code field
      if (codeFieldRef.current) {
        codeFieldRef.current.focus()
      }
    } catch (err: any) {
      console.error(err)
      toast.error(err.message || "Failed to send code")
    } finally {
      setLoading(false)
    }
  }, [walletManager, phone])

  // Step 2: The user enters the OTP code, we call manager.completeAuth(...)
  const handleSubmitCode = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!walletManager) {
      toast.error("Wallet Manager not ready yet.")
      return
    }
    try {
      setLoading(true)
      await walletManager.completeAuth({ phoneNumber: phone, otp: code })

      if (walletManager.authenticationFlow === 'new-user') {
        setAccountStatus('new-user')
      } else {
        setAccountStatus('existing-user')
      }

      setStep('password')
      if (passwordFieldRef.current) {
        passwordFieldRef.current.focus()
      }
    } catch (err: any) {
      console.error(err)
      toast.error(err.message || "Failed to verify code")
    } finally {
      setLoading(false)
    }
  }, [walletManager, phone, code])

  // Optional "resend code" that just calls startAuth again
  const handleResendCode = useCallback(async () => {
    if (!walletManager) return
    try {
      setLoading(true)
      await walletManager.startAuth({ phoneNumber: phone })
      toast.success('A new code has been sent to your phone.')
    } catch (e: any) {
      console.error(e)
      toast.error(e.message)
    } finally {
      // small delay to avoid spam
      await new Promise(resolve => setTimeout(resolve, 2000))
      setLoading(false)
    }
  }, [walletManager, phone])

  // Generate random mnemonic
  const handleGenerateRandomMnemonic = useCallback(async () => {
    try {
      const randomMnemonic = Mnemonic.fromRandom(256)
      const mnemonicStr = randomMnemonic.toString()
      setMnemonic(mnemonicStr)
      
      // Save mnemonic to file
      const result = await saveMnemonic(mnemonicStr)
      if (result.success) {
        toast.success(`Mnemonic saved to ${result.path}`)
        setMnemonicLocked(true)
        setShowMnemonicDialog(true)
      } else {
        toast.error(`Failed to save mnemonic: ${result.error}`)
      }
    } catch (err: any) {
      console.error(err)
      toast.error('Failed to generate random mnemonic')
    }
  }, [])

  // Step for providing mnemonic when not using WAB
  const handleSubmitMnemonic = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!walletManager) {
      toast.error('Wallet Manager not ready yet.')
      return
    }
    try {
      setLoading(true)
      
      // Derive presentation key from mnemonic using HD path m/0'/0/0
      const mnemonicObj = Mnemonic.fromString(mnemonic.trim())
      const seed = mnemonicObj.toSeed()
      const hdKey = HD.fromSeed(seed)
      const derivedKey = hdKey.derive("m/0'/0/0")
      const presentationKey = derivedKey.privKey.toArray()
      
      await walletManager.providePresentationKey(presentationKey)
      if (walletManager.authenticationFlow === 'new-user') {
        setAccountStatus('new-user')
      } else {
        setAccountStatus('existing-user')
      }
      setStep('password')
      if (passwordFieldRef.current) {
        passwordFieldRef.current.focus()
      }
    } catch (err: any) {
      console.error(err)
      toast.error(err.message || 'Failed to set presentation key from mnemonic')
    } finally {
      setLoading(false)
    }
  }, [walletManager, mnemonic])

  // Step 3: Provide a password for the final step.
  const handleSubmitPassword = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!walletManager) {
      toast.error("Wallet Manager not ready yet.")
      return
    }

    // If new-user, confirm password match
    if (accountStatus === 'new-user' && password !== confirmPassword) {
      toast.error("Passwords don't match.")
      return
    }

    setLoading(true)
    try {
      await walletManager.providePassword(password)
      if (walletManager.authenticated) {
        // Save snapshot to local storage
        localStorage.snap = saveEnhancedSnapshot()
        toast.success("Authenticated successfully!")
        history.push('/dashboard/apps')
      } else {
        throw new Error('Authentication failed, maybe password is incorrect?')
      }
    } catch (err: any) {
      console.error(err)
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }, [walletManager, password, confirmPassword, saveEnhancedSnapshot])

  if (!pageLoaded) {
    return <PageLoading />
  }

  const Header = () => <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mb: 4 }}>
    <Box sx={{ mb: 2, width: '100px', height: '100px' }}>
      <AppLogo
        rotate
        size="100px"
        color="#2196F3"
      />
    </Box>
    <Typography
      variant='h2'
      fontFamily='Helvetica'
      fontSize='2em'
      sx={{
        mb: 1,
        fontWeight: 'bold',
        background: theme.palette.mode === 'dark'
          ? 'linear-gradient(90deg, #FFFFFF 0%, #F5F5F5 100%)'
          : 'linear-gradient(90deg, #2196F3 0%, #4569E5 100%)',
        backgroundClip: 'text',
        WebkitTextFillColor: 'transparent'
      }}
    >
      {appName}
    </Typography>
    <Typography
      variant="caption"
      color="text.secondary"
      align="center"
    >
      <i>v{appVersion}</i>
    </Typography>
  </Box>

  // Show simplified non-interactive version when initializing backend services
  if (initializingBackendServices) {
    return (
      <Container maxWidth="sm" sx={{ height: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <Paper
          elevation={4}
          sx={{
            p: 4,
            borderRadius: 2,
            bgcolor: 'background.paper',
            boxShadow: theme.shadows[3]
          }}
        >
          <Header />
        </Paper>
      </Container>
    )
  }

  return (
    <Container maxWidth="sm" sx={{ height: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <Paper
        elevation={4}
        sx={{
          p: 4,
          borderRadius: 2,
          bgcolor: 'background.paper',
          boxShadow: theme.shadows[3]
        }}
      >
        <Header />
        <WalletConfig />
        
        {/* Authentication Stepper - replaces Accordions for clearer progression */}
        {configStatus === 'configured' && (
          <Stepper activeStep={viewToStepIndex[step]} orientation="vertical">
          {steps.map((step, index) => (
            <Step key={step.label}>
              <StepLabel 
                icon={step.icon}
                optional={
                  <Typography variant="caption" color="text.secondary">
                    {step.description}
                  </Typography>
                }
              >
                <Typography variant="body2" fontWeight={500}>
                  {step.label}
                </Typography>
              </StepLabel>
              <StepContent>
                {index === 0 && (
                  useWab ? (
                    <PhoneForm
                      phone={phone}
                      setPhone={setPhone}
                      loading={loading}
                      handleSubmitPhone={handleSubmitPhone}
                      phoneFieldRef={phoneFieldRef}
                    />
                  ) : (
                    <PresentationKeyForm
                      mnemonic={mnemonic}
                      setMnemonic={setMnemonic}
                      loading={loading}
                      handleSubmitMnemonic={handleSubmitMnemonic}
                      mnemonicFieldRef={mnemonicFieldRef}
                      onGenerateRandom={handleGenerateRandomMnemonic}
                      isLocked={mnemonicLocked}
                    />
                  )
                )}

                {useWab && index === 1 && (
                  <CodeForm
                    code={code}
                    setCode={setCode}
                    loading={loading}
                    handleSubmitCode={handleSubmitCode}
                    handleResendCode={handleResendCode}
                    codeFieldRef={codeFieldRef}
                  />
                )}

                {(useWab ? index === 2 : index === 1) && (
                  <PasswordForm
                    password={password}
                    setPassword={setPassword}
                    confirmPassword={confirmPassword}
                    setConfirmPassword={setConfirmPassword}
                    showPassword={showPassword}
                    setShowPassword={setShowPassword}
                    loading={loading}
                    handleSubmitPassword={handleSubmitPassword}
                    accountStatus={accountStatus}
                    passwordFieldRef={passwordFieldRef}
                  />
                )}
              </StepContent>
            </Step>
          ))}
          </Stepper>
        )}

        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4, mb: 2 }}>
          <RouterLink to='/recovery' style={{ textDecoration: 'none', pointerEvents: configStatus !== 'configured' ? 'none' : 'auto' }}>
            <Button
              variant="text"
              color='secondary'
              size="small"
              startIcon={<RestoreIcon />}
              disabled={configStatus !== 'configured'}
            >
              Account Recovery
            </Button>
          </RouterLink>
        </Box>

        <Typography
          variant='caption'
          color='textSecondary'
          align='center'
          sx={{ 
            display: 'block',
            px: 5,
            mt: 3,
            mb: 1,
            fontSize: '0.75rem',
            opacity: 0.7
          }}
        >
          By using this software, you acknowledge that you have read, understood and accepted the terms of the{' '}
          <RouterLink
            to='/privacy'
            style={{ color: theme.palette.primary.main, textDecoration: 'none' }}
          >
            Privacy
          </RouterLink> and {' '}
          <RouterLink
            to='/usage'
            style={{ color: theme.palette.primary.main, textDecoration: 'none' }}
          >
            Usage
          </RouterLink> {' '}
          policies.
        </Typography>
      </Paper>

      {/* Mnemonic Security Dialog */}
      <Dialog
        open={showMnemonicDialog}
        onClose={() => setShowMnemonicDialog(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <LockIcon color="warning" />
            <Typography variant="h6">Secure Your Recovery Mnemonic</Typography>
          </Box>
        </DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            <AlertTitle>Important: Save This Mnemonic</AlertTitle>
            Your mnemonic is the ONLY way to recover your presentation key. Store it in a safe place indefinitely.
          </Alert>
          
          <Paper
            elevation={0}
            sx={{
              p: 2,
              bgcolor: theme.palette.mode === 'dark' ? 'grey.900' : 'grey.100',
              border: 1,
              borderColor: 'divider',
              borderRadius: 1,
              mb: 2
            }}
          >
            <Typography
              variant="body2"
              sx={{
                fontFamily: 'monospace',
                wordBreak: 'break-word',
                userSelect: 'all'
              }}
            >
              {mnemonic}
            </Typography>
          </Paper>

          <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
            <Button
              variant="outlined"
              size="small"
              startIcon={<CopyIcon />}
              onClick={() => {
                navigator.clipboard.writeText(mnemonic)
                toast.success('Mnemonic copied to clipboard')
              }}
              fullWidth
            >
              Copy to Clipboard
            </Button>
          </Box>

          <Alert severity="info">
            <AlertTitle>Security Tips</AlertTitle>
            <Typography variant="body2" component="div">
              • Write it down on paper and store it securely
              <br />
              • Never share it with anyone
              <br />
              • Keep multiple backups in different locations
              <br />
              • Do not store it digitally (photos, cloud, etc.)
            </Typography>
          </Alert>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button
            onClick={() => setShowMnemonicDialog(false)}
            variant="contained"
            fullWidth
          >
            I Have Saved My Mnemonic Securely
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  )
}

export default Greeter
