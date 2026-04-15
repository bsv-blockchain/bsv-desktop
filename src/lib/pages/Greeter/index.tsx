import { useContext, useState, useRef, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
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
  Tooltip,
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
  Settings as SettingsIcon,
  Close as CloseIcon,
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
  const { t } = useTranslation();
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
        {loading ? <CircularProgress size={24} /> : t('phone_continue_button')}
      </Button>
    </form>
  );
};

// Code verification form component
const CodeForm = ({ code, setCode, loading, handleSubmitCode, handleResendCode, codeFieldRef }) => {
  const theme = useTheme();
  const { t } = useTranslation();
  return (
    <>
      <form onSubmit={handleSubmitCode}>
        <TextField
          label={t('code_input_label')}
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
          {loading ? <CircularProgress size={24} /> : t('code_verify_button')}
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
          {t('code_resend_button')}
        </Button>
      </Box>
    </>
  );
};

// Presentation key form component (using mnemonic)
const PresentationKeyForm = ({ mnemonic, setMnemonic, loading, handleSubmitMnemonic, mnemonicFieldRef, onGenerateRandom, isLocked, hideGenerate = false }) => {
  const theme = useTheme();
  const { t } = useTranslation();

  const handleCopy = () => {
    if (mnemonic) {
      navigator.clipboard.writeText(mnemonic)
      toast.success(t('mnemonic_copy_success'))
    }
  }

  return (
    <form onSubmit={handleSubmitMnemonic}>
      <TextField
        label={t('mnemonic_input_label')}
        value={mnemonic}
        onChange={(e) => setMnemonic(e.target.value)}
        variant="outlined"
        fullWidth
        multiline
        rows={3}
        disabled={loading || isLocked}
        placeholder={t('mnemonic_input_placeholder')}
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
          {t('mnemonic_generate_button')}
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
        {loading ? <CircularProgress size={24} /> : t('mnemonic_continue_button')}
      </Button>
    </form>
  );
};

// Password form component
const PasswordForm = ({ password, setPassword, confirmPassword, setConfirmPassword, showPassword, setShowPassword, loading, handleSubmitPassword, accountStatus, passwordFieldRef }) => {
  const theme = useTheme();
  const { t } = useTranslation();
  return (
    <form onSubmit={handleSubmitPassword}>
      <TextField
        label={t('password_input_label')}
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
                  aria-label={t('password_toggle_aria_label')}
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
          label={t('confirm_password_input_label')}
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
                    aria-label={t('password_toggle_aria_label')}
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
        {loading ? <CircularProgress size={24} /> : (accountStatus === 'new-user' ? t('password_create_account_button') : t('password_login_button'))}
      </Button>
    </form>
  );
};

// Direct key form component for SimpleWalletManager login
// keyInput, keyMode, isLocked are lifted to the parent to survive re-renders
const DirectKeyForm = ({ loading, handleSubmitDirectKey, onGenerateRandomMnemonic, hideGenerate = false, keyInput, setKeyInput, isLocked, setIsLocked }) => {
  const theme = useTheme();
  const { t } = useTranslation();

  // Detect whether the input looks like a raw hex private key (exactly 64 hex chars)
  const isHexKey = (val: string) => /^[0-9a-fA-F]{64}$/.test(val.trim())

  const handleCopy = () => {
    if (keyInput) {
      navigator.clipboard.writeText(keyInput)
      toast.success(isHexKey(keyInput) ? t('private_key_copy_success') : t('mnemonic_copy_success'))
    }
  }

  const handleGenerate = async () => {
    const result = await onGenerateRandomMnemonic()
    if (result) {
      setKeyInput(result)
      setIsLocked(true)
    }
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    handleSubmitDirectKey(keyInput)
  }

  const looksLikeHex = isHexKey(keyInput)

  return (
    <form onSubmit={onSubmit}>
      <TextField
        label={t('primary_key_input_label')}
        value={keyInput}
        onChange={(e) => setKeyInput(e.target.value)}
        variant="outlined"
        fullWidth
        multiline={!looksLikeHex}
        rows={!looksLikeHex ? 3 : 1}
        disabled={loading || isLocked}
        placeholder={t('primary_key_input_placeholder')}
        slotProps={{
          input: {
            endAdornment: keyInput && (
              <InputAdornment position="end">
                <IconButton
                  onClick={handleCopy}
                  edge="end"
                  size="small"
                  sx={!looksLikeHex ? { alignSelf: 'flex-start', mt: 1 } : undefined}
                >
                  <CopyIcon />
                </IconButton>
              </InputAdornment>
            )
          }
        }}
        sx={{ mb: 1.5 }}
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
            py: 1,
            mb: 1.5
          }}
        >
          {t('primary_key_create_button')}
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
          py: 1
        }}
      >
        {loading ? <CircularProgress size={24} /> : t('primary_key_login_button')}
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
  const { t } = useTranslation()

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
          description: t('phone_entry_label')
        },
        {
          label: 'Verification Code',
          icon: <SMSIcon />,
          description: t('verification_code_label')
        },
        {
          label: 'Password',
          icon: <LockIcon />,
          description: t('password_step_label')
        }
      ]
    : loginType === 'direct-key'
    ? [
        {
          label: t('privately_managed_key_label'),
          icon: <KeyIcon />,
          description: ''
        }
      ]
    : [
        {
          label: t('presentation_key_label'),
          icon: <KeyIcon />,
          description: t('presentation_key_description')
        },
        {
          label: 'Password',
          icon: <LockIcon />,
          description: t('password_step_label')
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
  const [directKeyLocked, setDirectKeyLocked] = useState(false)

  const [showConfig, setShowConfig] = useState(false)

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
    setShowConfig(false)
  }, [])

  useEffect(() => {
    setStep(getInitialStep())
  }, [loginType])

  // Step 1: The user enters a phone number, we call manager.startAuth(...)
  const handleSubmitPhone = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!walletManager) {
      toast.error(t('phone_error_wallet_not_ready'))
      return
    }
    try {
      setLoading(true)
      await (walletManager as any).startAuth({ phoneNumber: phone })
      setStep('code')
      toast.success(t('phone_success_code_sent'))
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
      toast.error(t('code_error_wallet_not_ready'))
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
      toast.error(err.message || t('code_error_failed'))
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
      toast.success(t('resend_code_success'))
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
        toast.success(t('mnemonic_file_save_success', { path: result.path }))
      } else {
        toast.error(t('mnemonic_file_save_error', { error: result.error }))
      }
      return mnemonicStr
    } catch (err: any) {
      console.error(err)
      toast.error(t('mnemonic_generate_error'))
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
        toast.success(t('private_key_generate_success', { path: result.path }))
      } else {
        toast.error(t('private_key_generate_error', { error: result.error }))
      }
      return hexStr
    } catch (err: any) {
      console.error(err)
      toast.error(t('private_key_generate_fail'))
      return null
    }
  }, [])

  // Step for providing mnemonic when not using WAB
  const handleSubmitMnemonic = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!walletManager) {
      toast.error(t('mnemonic_error_wallet_not_ready'))
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
      toast.error(err.message || t('mnemonic_error_failed'))
    } finally {
      setLoading(false)
    }
  }, [walletManager, mnemonic])

  // Step 3: Provide a password for the final step.
  const handleSubmitPassword = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!walletManager) {
      toast.error(t('password_error_wallet_not_ready'))
      return
    }

    // If new-user, confirm password match
    if (accountStatus === 'new-user' && password !== confirmPassword) {
      toast.error(t('password_error_mismatch'))
      return
    }

    setLoading(true)
    try {
      await (walletManager as any).providePassword(password)
      if (walletManager.authenticated) {
        // Save snapshot to local storage
        localStorage.snap = saveEnhancedSnapshot()
        toast.success(t('password_success_authenticated'))
        history.push('/dashboard/apps')
      } else {
        throw new Error(t('password_error_auth_failed'))
      }
    } catch (err: any) {
      console.error(err)
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }, [walletManager, password, confirmPassword, saveEnhancedSnapshot])

  // Direct key login: provide primary key + disabled privileged manager, no password
  // Auto-detects input type: 64-char hex string = raw private key, otherwise treated as mnemonic
  const handleSubmitDirectKey = useCallback(async (keyInput: string) => {
    if (!walletManager) {
      toast.error(t('direct_key_error_wallet_not_ready'))
      return
    }
    try {
      setLoading(true)

      const trimmed = keyInput.trim()
      const isHexKey = /^[0-9a-fA-F]{64}$/.test(trimmed)

      let keyBytes: number[]
      let keyHex: string
      let mnemonic: string | undefined
      if (isHexKey) {
        keyBytes = Utils.toArray(trimmed, 'hex')
        keyHex = trimmed
      } else {
        const derived = deriveKeyMaterialFromMnemonic(trimmed)
        keyBytes = derived.keyBytes
        keyHex = derived.keyHex
        mnemonic = derived.mnemonic
      }

      if (keyBytes.length !== 32) {
        throw new Error(t('direct_key_error_invalid_length', { bytes: keyBytes.length }))
      }

      // Persist key material so the Security page can reveal it later
      persistKeyMaterial(keyHex, mnemonic)

      // SimpleWalletManager flow: provide primary key then disabled privileged manager
      await (walletManager as any).providePrimaryKey(keyBytes)
      await (walletManager as any).providePrivilegedKeyManager(createDisabledPrivilegedManager())

      if (walletManager.authenticated) {
        localStorage.snap = saveEnhancedSnapshot()
        toast.success(t('password_success_authenticated'))
        history.push('/dashboard/apps')
      } else {
        throw new Error('Authentication failed')
      }
    } catch (err: any) {
      console.error(err)
      toast.error(err.message || t('password_error_direct_key'))
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
    <Container maxWidth="sm" sx={{ height: '100vh', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ my: 'auto', py: 3, width: '100%' }}>
        <Paper elevation={4} sx={{ p: 3, borderRadius: 2, bgcolor: 'background.paper', boxShadow: theme.shadows[3] }}>
          {header}
        </Paper>
      </Box>
    </Container>
    )
  }

  const authStepper = (
    <Stepper activeStep={viewToStepIndex[step]} orientation="vertical">
      {steps.map((stepDef, index) => (
        <Step key={stepDef.label}>
          <StepLabel
            icon={stepDef.icon}
            optional={stepDef.description ? (
              <Typography variant="caption" color="text.secondary">
                {stepDef.description}
              </Typography>
            ) : undefined}
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
                hideGenerate={entryMode === 'login'}
                keyInput={directKeyInput}
                setKeyInput={setDirectKeyInput}
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
    <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2, mb: 1 }}>
      <RouterLink to='/recovery' style={{ textDecoration: 'none', pointerEvents: configStatus !== 'configured' ? 'none' : 'auto' }}>
        <Button
          variant="text"
          color='secondary'
          size="small"
          startIcon={<RestoreIcon />}
          disabled={configStatus !== 'configured'}
        >
          {t('account_recovery_button')}
        </Button>
      </RouterLink>
    </Box>
  )

  const legalFooter = (
    <Typography
      variant='caption'
      color='textSecondary'
      align='center'
      sx={{ display: 'block', px: 5, mt: 3, mb: 0, fontSize: '0.75rem', opacity: 0.7 }}
    >
      {t('legal_footer_text')}{' '}
      <RouterLink to='/privacy' style={{ color: theme.palette.primary.main, textDecoration: 'none' }}>
        {t('legal_privacy_link')}
      </RouterLink> and {' '}
      <RouterLink to='/usage' style={{ color: theme.palette.primary.main, textDecoration: 'none' }}>
        {t('legal_usage_link')}
      </RouterLink> {' '}
      {t('legal_footer_policies')}
    </Typography>
  )

  const mnemonicDialog = (
    <Dialog open={showMnemonicDialog} onClose={() => setShowMnemonicDialog(false)} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <LockIcon color="warning" />
          <Typography variant="h6">{t('mnemonic_dialog_title')}</Typography>
        </Box>
      </DialogTitle>
      <DialogContent>
        <Alert severity="warning" sx={{ mb: 2 }}>
          <AlertTitle>{t('mnemonic_dialog_warning_title')}</AlertTitle>
          {t('mnemonic_dialog_warning_text')}
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
            onClick={() => { navigator.clipboard.writeText(mnemonic); toast.success(t('mnemonic_copy_success')) }}
            fullWidth
          >
            {t('mnemonic_dialog_copy_button')}
          </Button>
        </Box>
        <Alert severity="info">
          <AlertTitle>{t('mnemonic_dialog_info_title')}</AlertTitle>
          <Typography variant="body2" component="div" style={{ whiteSpace: 'pre-line' }}>
            {t('mnemonic_dialog_security_tips')}
          </Typography>
        </Alert>
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={() => setShowMnemonicDialog(false)} variant="contained" fullWidth>
          {t('mnemonic_dialog_confirm_button')}
        </Button>
      </DialogActions>
    </Dialog>
  )

  return (
    <Container maxWidth="sm" sx={{ height: '100vh', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ my: 'auto', py: 3, width: '100%' }}>
      <Paper
        elevation={4}
        sx={{ p: 3, borderRadius: 2, bgcolor: 'background.paper', boxShadow: theme.shadows[3] }}
      >
        {entryMode === 'choose' && header}

        {/* ===== CHOOSE MODE: Initial screen with Create Wallet / Login buttons ===== */}
        {entryMode === 'choose' && (
          <>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 2 }}>
              <Button
                variant="contained"
                size="large"
                startIcon={<WalletIcon />}
                onClick={handleCreateWallet}
                sx={{ textTransform: 'none', py: 1, fontSize: '1rem' }}
              >
                {t('create_wallet_button')}
              </Button>
              <Button
                variant="outlined"
                size="large"
                startIcon={<LoginIcon />}
                onClick={handleLogin}
                sx={{ textTransform: 'none', py: 1, fontSize: '1rem' }}
              >
                {t('login_button')}
              </Button>
            </Box>
          </>
        )}

        {/* ===== CREATE MODE: Direct-key flow with optional advanced config ===== */}
        {entryMode === 'create' && (
          <>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
              <Button size="small" startIcon={<ArrowBackIcon />} onClick={handleBack} sx={{ textTransform: 'none' }}>
                {t('back_button')}
              </Button>
              <Tooltip title={showConfig ? t('config_hide_tooltip') : t('config_show_tooltip')} placement="left">
                <IconButton size="small" onClick={() => setShowConfig(s => !s)} color={showConfig ? 'secondary' : 'default'}>
                  {showConfig ? <CloseIcon fontSize="small" /> : <SettingsIcon fontSize="small" />}
                </IconButton>
              </Tooltip>
            </Box>
            {/* Advanced config for power users (network, storage, message box — no login type) */}
            <WalletConfig hideLoginType open={showConfig} onToggle={() => setShowConfig(s => !s)} />
            {/* Direct key stepper — shown once config is finalized */}
            {!showConfig && configStatus === 'configured' && authStepper}
          </>
        )}

        {/* ===== LOGIN MODE: Stepper shown immediately, config panel available but collapsed ===== */}
        {entryMode === 'login' && (
          <>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
              <Button size="small" startIcon={<ArrowBackIcon />} onClick={handleBack} sx={{ textTransform: 'none' }}>
                {t('back_button')}
              </Button>
              <Tooltip title={showConfig ? t('config_hide_tooltip') : t('config_show_tooltip')} placement="left">
                <IconButton size="small" onClick={() => setShowConfig(s => !s)} color={showConfig ? 'secondary' : 'default'}>
                  {showConfig ? <CloseIcon fontSize="small" /> : <SettingsIcon fontSize="small" />}
                </IconButton>
              </Tooltip>
            </Box>
            <WalletConfig open={showConfig} onToggle={() => setShowConfig(s => !s)} />
            {!showConfig && configStatus === 'configured' && authStepper}
            {!showConfig && accountRecoveryLink}
          </>
        )}

        {legalFooter}
      </Paper>
      </Box>

      {mnemonicDialog}
    </Container>
  )
}

export default Greeter
