import { useContext, useState, useRef, useCallback, useEffect } from 'react'
import {
  Typography,
  Button,
  TextField,
  CircularProgress,
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
  ToggleButtonGroup,
  ToggleButton,
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
  AccountBalanceWallet as WalletIcon,
  Login as LoginIcon,
  ArrowBack as ArrowBackIcon,
} from '@mui/icons-material'
import PhoneEntry from '../../components/PhoneEntry.js'
import AppLogo from '../../components/AppLogo.js'
import { toast } from 'react-toastify'
import { saveMnemonic, savePrivateKey } from '../../../electronFunctions.js'
import { WalletContext, createDisabledPrivilegedManager } from '../../WalletContext.js'
import { UserContext } from '../../UserContext.js'
import PageLoading from '../../components/PageLoading.js'
import { Utils, Mnemonic, HD, PrivateKey } from '@bsv/sdk'
import { Link as RouterLink } from 'react-router-dom'
import WalletConfig from '../../components/WalletConfig.js'
import { DEFAULT_CHAIN } from '../../config.js'
import { deriveKeyMaterialFromMnemonic, persistKeyMaterial } from '../../utils/keyMaterial.js'

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
const PresentationKeyForm = ({ mnemonic, setMnemonic, loading, handleSubmitMnemonic, mnemonicFieldRef, onGenerateRandom, isLocked, hideGenerate = false }) => {
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
        placeholder="Enter recovery phrase"
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
      {!isLocked && !hideGenerate && (
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

// Direct key form component for SimpleWalletManager login
// keyInput, keyMode, isLocked are lifted to the parent to survive re-renders
const DirectKeyForm = ({ loading, handleSubmitDirectKey, onGenerateRandomMnemonic, onGenerateRandomHex, hideGenerate = false, keyInput, setKeyInput, keyMode, setKeyMode, isLocked, setIsLocked }) => {
  const theme = useTheme();

  const handleCopy = () => {
    if (keyInput) {
      navigator.clipboard.writeText(keyInput)
      toast.success(`${keyMode === 'mnemonic' ? 'Mnemonic' : 'Private key'} copied to clipboard`)
    }
  }

  const handleGenerate = async () => {
    if (keyMode === 'mnemonic') {
      const result = await onGenerateRandomMnemonic()
      if (result) {
        setKeyInput(result)
        setIsLocked(true)
      }
    } else {
      const result = await onGenerateRandomHex()
      if (result) {
        setKeyInput(result)
        setIsLocked(true)
      }
    }
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    handleSubmitDirectKey(keyInput, keyMode)
  }

  return (
    <form onSubmit={onSubmit}>
      <ToggleButtonGroup
        value={keyMode}
        exclusive
        onChange={(_, val) => { if (val) { setKeyMode(val); setKeyInput(''); setIsLocked(false) } }}
        size="small"
        fullWidth
        sx={{ mb: 2 }}
      >
        <ToggleButton value="mnemonic" sx={{ textTransform: 'none' }}>
          Mnemonic
        </ToggleButton>
        <ToggleButton value="hex" sx={{ textTransform: 'none' }}>
          Private Key (Hex)
        </ToggleButton>
      </ToggleButtonGroup>

      <TextField
        label={keyMode === 'mnemonic' ? 'Mnemonic phrase' : 'Private key (hex)'}
        value={keyInput}
        onChange={(e) => setKeyInput(e.target.value)}
        variant="outlined"
        fullWidth
        multiline={keyMode === 'mnemonic'}
        rows={keyMode === 'mnemonic' ? 3 : 1}
        disabled={loading || isLocked}
        placeholder={keyMode === 'mnemonic' ? 'Enter your mnemonic phrase' : 'Enter 64-character hex key'}
        slotProps={{
          input: {
            endAdornment: keyInput && (
              <InputAdornment position="end">
                <IconButton
                  onClick={handleCopy}
                  edge="end"
                  size="small"
                  sx={keyMode === 'mnemonic' ? { alignSelf: 'flex-start', mt: 1 } : undefined}
                >
                  <CopyIcon />
                </IconButton>
              </InputAdornment>
            )
          }
        }}
        sx={{ mb: 2 }}
      />

      {!isLocked && !hideGenerate && (
        <Button
          variant='outlined'
          onClick={handleGenerate}
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
          {keyMode === 'mnemonic' ? 'Generate Random Mnemonic' : 'Generate Random Key'}
        </Button>
      )}

      <Button
        variant='contained'
        type='submit'
        disabled={loading || !keyInput}
        fullWidth
        sx={{
          borderRadius: theme.shape.borderRadius,
          textTransform: 'none',
          py: 1.2
        }}
      >
        {loading ? <CircularProgress size={24} /> : 'Login'}
      </Button>
    </form>
  );
};

// Main Greeter component with reduced complexity
type EntryMode = 'choose' | 'create' | 'login'

const Greeter: React.FC<any> = ({ history }) => {
  const { managers, configStatus, useWab, loginType, saveEnhancedSnapshot, initializingBackendServices, finalizeConfig } = useContext(WalletContext)
  const { appVersion, appName, pageLoaded } = useContext(UserContext)
  const theme = useTheme()

  // Entry mode: 'choose' shows Create Wallet / Login buttons,
  // 'create' auto-configures for direct-key and shows the key form,
  // 'login' shows the full WalletConfig with all options.
  const [entryMode, setEntryMode] = useState<EntryMode>('choose')

  const viewToStepIndex = loginType === 'wab'
    ? { phone: 0, code: 1, password: 2 }
    : loginType === 'direct-key'
    ? { directkey: 0 }
    : { presentation: 0, password: 1 }

  const steps = loginType === 'wab'
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
    : loginType === 'direct-key'
    ? [
        {
          label: 'Private Key',
          icon: <KeyIcon />,
          description: 'Enter your private key or mnemonic'
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

  const getInitialStep = () => {
    if (loginType === 'wab') return 'phone'
    if (loginType === 'direct-key') return 'directkey'
    return 'presentation'
  }

  const [step, setStep] = useState(getInitialStep())
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

  // DirectKeyForm state lifted to Greeter level to survive re-renders
  // (AuthStepper is an inline component; internal state resets on every Greeter re-render)
  const [directKeyInput, setDirectKeyInput] = useState('')
  const [directKeyMode, setDirectKeyMode] = useState<'mnemonic' | 'hex'>('mnemonic')
  const [directKeyLocked, setDirectKeyLocked] = useState(false)

  const phoneFieldRef = useRef(null)
  const codeFieldRef = useRef(null)
  const mnemonicFieldRef = useRef(null)
  const passwordFieldRef = useRef(null)

  const walletManager = managers?.walletManager

  // When the user clicks "Create Wallet", auto-finalize with direct-key defaults
  const handleCreateWallet = useCallback(() => {
    setEntryMode('create')
    finalizeConfig({
      wabUrl: '',
      wabInfo: null,
      method: '',
      network: DEFAULT_CHAIN as 'main' | 'test',
      storageUrl: '',
      messageBoxUrl: '',
      loginType: 'direct-key',
      useWab: false,
      useRemoteStorage: false,
      useMessageBox: false,
    })
  }, [finalizeConfig])

  // When the user clicks "Login", auto-finalize with mnemonic-advanced defaults and go straight to stepper
  const handleLogin = useCallback(() => {
    setEntryMode('login')
    finalizeConfig({
      wabUrl: '',
      wabInfo: null,
      method: '',
      network: DEFAULT_CHAIN as 'main' | 'test',
      storageUrl: '',
      messageBoxUrl: '',
      loginType: 'direct-key',
      useWab: false,
      useRemoteStorage: false,
      useMessageBox: false,
    })
  }, [finalizeConfig])

  // Go back to the choose screen
  const handleBack = useCallback(() => {
    setEntryMode('choose')
  }, [])

  useEffect(() => {
    setStep(getInitialStep())
  }, [loginType])

  // Step 1: The user enters a phone number, we call manager.startAuth(...)
  const handleSubmitPhone = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!walletManager) {
      toast.error("Wallet Manager not ready yet.")
      return
    }
    try {
      setLoading(true)
      await (walletManager as any).startAuth({ phoneNumber: phone })
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
      await (walletManager as any).completeAuth({ phoneNumber: phone, otp: code })

      if ((walletManager as any).authenticationFlow === 'new-user') {
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
      await (walletManager as any).startAuth({ phoneNumber: phone })
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

  // Generate random mnemonic — saves to file and returns the string.
  // Callers are responsible for updating their own state from the return value.
  const handleGenerateRandomMnemonic = useCallback(async () => {
    try {
      const randomMnemonic = Mnemonic.fromRandom(256)
      const mnemonicStr = randomMnemonic.toString()

      // Save mnemonic to file
      const result = await saveMnemonic(mnemonicStr)
      if (result.success) {
        toast.success(`Mnemonic saved to ${result.path}`)
      } else {
        toast.error(`Failed to save mnemonic: ${result.error}`)
      }
      return mnemonicStr
    } catch (err: any) {
      console.error(err)
      toast.error('Failed to generate random mnemonic')
      return null
    }
  }, [])

  // Wrapper used by PresentationKeyForm: generates, sets Greeter-level mnemonic state, and shows the dialog
  const handleGenerateRandomMnemonicForPresentation = useCallback(async () => {
    const mnemonicStr = await handleGenerateRandomMnemonic()
    if (mnemonicStr) {
      setMnemonic(mnemonicStr)
      setMnemonicLocked(true)
      setShowMnemonicDialog(true)
    }
    return mnemonicStr
  }, [handleGenerateRandomMnemonic])

  // Generate random hex key for direct-key mode
  const handleGenerateRandomHex = useCallback(async () => {
    try {
      const randomKey = PrivateKey.fromRandom()
      const hexStr = randomKey.toHex()

      // Save private key to file
      const result = await savePrivateKey(hexStr)
      if (result.success) {
        toast.success(`Private key saved to ${result.path}`)
      } else {
        toast.error(`Failed to save private key: ${result.error}`)
      }
      return hexStr
    } catch (err: any) {
      console.error(err)
      toast.error('Failed to generate random key')
      return null
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

      await (walletManager as any).providePresentationKey(presentationKey)
      if ((walletManager as any).authenticationFlow === 'new-user') {
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
      await (walletManager as any).providePassword(password)
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

  // Direct key login: provide primary key + disabled privileged manager, no password
  const handleSubmitDirectKey = useCallback(async (keyInput: string, keyMode: 'mnemonic' | 'hex') => {
    if (!walletManager) {
      toast.error('Wallet Manager not ready yet.')
      return
    }
    try {
      setLoading(true)

      let keyBytes: number[]
      let keyHex: string
      let mnemonic: string | undefined
      if (keyMode === 'mnemonic') {
        const derived = deriveKeyMaterialFromMnemonic(keyInput)
        keyBytes = derived.keyBytes
        keyHex = derived.keyHex
        mnemonic = derived.mnemonic
      } else {
        keyBytes = Utils.toArray(keyInput.trim(), 'hex')
        keyHex = keyInput.trim()
      }

      if (keyBytes.length !== 32) {
        throw new Error(`Key must be exactly 32 bytes (64 hex characters), but got ${keyBytes.length} bytes. Make sure you are entering a private key, not a public key.`)
      }

      // Persist key material so the Security page can reveal it later
      persistKeyMaterial(keyHex, mnemonic)

      // SimpleWalletManager flow: provide primary key then disabled privileged manager
      await (walletManager as any).providePrimaryKey(keyBytes)
      await (walletManager as any).providePrivilegedKeyManager(createDisabledPrivilegedManager())

      if (walletManager.authenticated) {
        localStorage.snap = saveEnhancedSnapshot()
        toast.success('Authenticated successfully!')
        history.push('/dashboard/apps')
      } else {
        throw new Error('Authentication failed')
      }
    } catch (err: any) {
      console.error(err)
      toast.error(err.message || 'Failed to login with direct key')
    } finally {
      setLoading(false)
    }
  }, [walletManager, saveEnhancedSnapshot])

  if (!pageLoaded) {
    return <PageLoading />
  }

  // JSX variables (not component functions) so React never treats them as new
  // component types on re-render, which would unmount/remount and wipe field state.

  const header = (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mb: 4 }}>
      <Box sx={{ mb: 2, width: '100px', height: '100px' }}>
        <AppLogo rotate size="100px" color="#2196F3" />
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
      <Typography variant="caption" color="text.secondary" align="center">
        <i>v{appVersion}</i>
      </Typography>
    </Box>
  )

  // Show simplified non-interactive version when initializing backend services
  if (initializingBackendServices) {
    return (
      <Container maxWidth="sm" sx={{ height: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <Paper elevation={4} sx={{ p: 4, borderRadius: 2, bgcolor: 'background.paper', boxShadow: theme.shadows[3] }}>
          {header}
        </Paper>
      </Container>
    )
  }

  const authStepper = (
    <Stepper activeStep={viewToStepIndex[step]} orientation="vertical">
      {steps.map((stepDef, index) => (
        <Step key={stepDef.label}>
          <StepLabel
            icon={stepDef.icon}
            optional={
              <Typography variant="caption" color="text.secondary">
                {stepDef.description}
              </Typography>
            }
          >
            <Typography variant="body2" fontWeight={500}>
              {stepDef.label}
            </Typography>
          </StepLabel>
          <StepContent>
            {/* WAB flow: Phone -> Code -> Password */}
            {loginType === 'wab' && index === 0 && (
              <PhoneForm
                phone={phone}
                setPhone={setPhone}
                loading={loading}
                handleSubmitPhone={handleSubmitPhone}
                phoneFieldRef={phoneFieldRef}
              />
            )}
            {loginType === 'wab' && index === 1 && (
              <CodeForm
                code={code}
                setCode={setCode}
                loading={loading}
                handleSubmitCode={handleSubmitCode}
                handleResendCode={handleResendCode}
                codeFieldRef={codeFieldRef}
              />
            )}
            {loginType === 'wab' && index === 2 && (
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
            {/* Direct key flow: single step */}
            {loginType === 'direct-key' && index === 0 && (
              <DirectKeyForm
                loading={loading}
                handleSubmitDirectKey={handleSubmitDirectKey}
                onGenerateRandomMnemonic={handleGenerateRandomMnemonic}
                onGenerateRandomHex={handleGenerateRandomHex}
                hideGenerate={entryMode === 'login'}
                keyInput={directKeyInput}
                setKeyInput={setDirectKeyInput}
                keyMode={directKeyMode}
                setKeyMode={setDirectKeyMode}
                isLocked={directKeyLocked}
                setIsLocked={setDirectKeyLocked}
              />
            )}
            {/* Mnemonic-advanced flow: Presentation Key -> Password */}
            {loginType === 'mnemonic-advanced' && index === 0 && (
              <PresentationKeyForm
                mnemonic={mnemonic}
                setMnemonic={setMnemonic}
                loading={loading}
                handleSubmitMnemonic={handleSubmitMnemonic}
                mnemonicFieldRef={mnemonicFieldRef}
                onGenerateRandom={handleGenerateRandomMnemonicForPresentation}
                isLocked={mnemonicLocked}
                hideGenerate={entryMode === 'login'}
              />
            )}
            {loginType === 'mnemonic-advanced' && index === 1 && (
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
  )

  const accountRecoveryLink = (
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
  )

  const legalFooter = (
    <Typography
      variant='caption'
      color='textSecondary'
      align='center'
      sx={{ display: 'block', px: 5, mt: 3, mb: 1, fontSize: '0.75rem', opacity: 0.7 }}
    >
      By using this software, you acknowledge that you have read, understood and accepted the terms of the{' '}
      <RouterLink to='/privacy' style={{ color: theme.palette.primary.main, textDecoration: 'none' }}>
        Privacy
      </RouterLink> and {' '}
      <RouterLink to='/usage' style={{ color: theme.palette.primary.main, textDecoration: 'none' }}>
        Usage
      </RouterLink> {' '}
      policies.
    </Typography>
  )

  const mnemonicDialog = (
    <Dialog open={showMnemonicDialog} onClose={() => setShowMnemonicDialog(false)} maxWidth="sm" fullWidth>
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
          <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-word', userSelect: 'all' }}>
            {mnemonic}
          </Typography>
        </Paper>
        <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
          <Button
            variant="outlined"
            size="small"
            startIcon={<CopyIcon />}
            onClick={() => { navigator.clipboard.writeText(mnemonic); toast.success('Mnemonic copied to clipboard') }}
            fullWidth
          >
            Copy to Clipboard
          </Button>
        </Box>
        <Alert severity="info">
          <AlertTitle>Security Tips</AlertTitle>
          <Typography variant="body2" component="div">
            • Write it down on paper and store it securely<br />
            • Never share it with anyone<br />
            • Keep multiple backups in different locations<br />
            • Do not store it digitally (photos, cloud, etc.)
          </Typography>
        </Alert>
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={() => setShowMnemonicDialog(false)} variant="contained" fullWidth>
          I Have Saved My Mnemonic Securely
        </Button>
      </DialogActions>
    </Dialog>
  )

  return (
    <Container maxWidth="sm" sx={{ height: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <Paper
        elevation={4}
        sx={{ p: 4, borderRadius: 2, bgcolor: 'background.paper', boxShadow: theme.shadows[3] }}
      >
        {header}

        {/* ===== CHOOSE MODE: Initial screen with Create Wallet / Login buttons ===== */}
        {entryMode === 'choose' && (
          <>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 2 }}>
              <Button
                variant="contained"
                size="large"
                startIcon={<WalletIcon />}
                onClick={handleCreateWallet}
                sx={{ textTransform: 'none', py: 1.5, fontSize: '1rem' }}
              >
                Create Wallet
              </Button>
              <Button
                variant="outlined"
                size="large"
                startIcon={<LoginIcon />}
                onClick={handleLogin}
                sx={{ textTransform: 'none', py: 1.5, fontSize: '1rem' }}
              >
                Login
              </Button>
            </Box>
            {accountRecoveryLink}
          </>
        )}

        {/* ===== CREATE MODE: Direct-key flow with optional advanced config ===== */}
        {entryMode === 'create' && (
          <>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
              <Button size="small" startIcon={<ArrowBackIcon />} onClick={handleBack} sx={{ textTransform: 'none' }}>
                Back
              </Button>
            </Box>
            {/* Advanced config for power users (network, storage, message box — no login type) */}
            <WalletConfig hideLoginType />
            {/* Direct key stepper — shown once config is finalized */}
            {configStatus === 'configured' && authStepper}
            {accountRecoveryLink}
          </>
        )}

        {/* ===== LOGIN MODE: Stepper shown immediately, config panel available but collapsed ===== */}
        {entryMode === 'login' && (
          <>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
              <Button size="small" startIcon={<ArrowBackIcon />} onClick={handleBack} sx={{ textTransform: 'none' }}>
                Back
              </Button>
            </Box>
            <WalletConfig />
            {configStatus === 'configured' && authStepper}
            {accountRecoveryLink}
          </>
        )}

        {legalFooter}
      </Paper>

      {mnemonicDialog}
    </Container>
  )
}

export default Greeter
