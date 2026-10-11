import { useContext, useEffect, useRef, useState } from 'react'
import { Alert, Box, Button, Checkbox, CircularProgress, Container, FormControlLabel, Link, Paper, Stack, Tab, Tabs, TextField, Typography } from '@mui/material'
import { ArrowBack, ArrowForward, ShieldOutlined, ContentCopy, KeyOutlined, QrCodeScannerOutlined } from '@mui/icons-material'
import { HD, Mnemonic, Utils } from '@bsv/sdk'
import { PrivilegedKeyManager } from '@bsv/wallet-toolbox-client'
import { Link as RouterLink } from 'react-router-dom'
import { WalletContext } from '../../WalletContext'
import { UserContext } from '../../UserContext'
import { DEFAULT_CHAIN, MESSAGEBOX_HOST } from '../../config'
import * as secrets from '../../services/secrets'
import { deriveMnemonicWallet, generateRecoveryPhrase, parseShare, recoverSecretFromShares, verifyMnemonicWallet } from '../../utils/mnemonicRecovery'
import { MnemonicProfileWalletManager } from '../../services/MnemonicProfileWalletManager'
import RecoveryPhrase from '../../components/RecoveryPhrase'
import AppLogo from '../../components/AppLogo'
import { getWalletService } from '../../hooks/useWalletService'
import QrScanner from '../Dashboard/Payments/QrScanner'

type EntryMode = 'welcome' | 'create' | 'import'

/** New wallets use BSV Wallet's mnemonic scheme. Saved legacy identities keep their own unlock flow. */
export default function Greeter({ history, initialMode = 'welcome' }: { history: any; initialMode?: EntryMode }) {
  const { managers, loginType, finalizeConfig, saveEnhancedSnapshot, initializingBackendServices, snapshotLoaded } = useContext(WalletContext)
  const { appVersion } = useContext(UserContext)
  const [mode, setMode] = useState<EntryMode>(initialMode)
  const [phrase, setPhrase] = useState('')
  const [saved, setSaved] = useState(false)
  const [importMethod, setImportMethod] = useState<'phrase' | 'shares'>('phrase')
  const [shareInputs, setShareInputs] = useState(['', '', ''])
  const currentShares = useRef(shareInputs)
  const [scanShares, setScanShares] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const manager: any = managers.walletManager
  const startupError = getWalletService().startupError
  const hasSavedWallet = !!secrets.getSnapshot()
  const legacy = hasSavedWallet && (loginType === 'wab' || loginType === 'mnemonic-advanced')
  useEffect(() => { currentShares.current = shareInputs }, [shareInputs])

  const collectShare = (value: string) => {
    try {
      const nextShare = parseShare(value)
      const existing = currentShares.current.filter(s => s.trim()).map(parseShare)
      if (existing.some(share => share.x === nextShare.x && share.y === nextShare.y)) return
      if (existing.some(share => share.integrity !== nextShare.integrity || share.threshold !== nextShare.threshold)) {
        throw new Error('This share belongs to a different backup. Scan a share from the same set.')
      }
      const position = currentShares.current.findIndex(share => !share.trim())
      if (position < 0) throw new Error('Three shares are already entered. Clear a field to use another share.')
      const next = currentShares.current.map((share, index) => index === position ? nextShare.raw : share)
      currentShares.current = next; setShareInputs(next); setError('')
      if (existing.length + 1 >= nextShare.threshold) setScanShares(false)
    } catch (e: any) { setError(e.message); setScanShares(false) }
  }

  useEffect(() => {
    if (manager?.authenticated && managers.permissionsManager && snapshotLoaded) history.replace('/dashboard')
  }, [manager?.authenticated, managers.permissionsManager, snapshotLoaded, history])

  const configure = () => {
    if (hasSavedWallet) return
    const ok = finalizeConfig({
      wabUrl: '', wabInfo: null, method: '', network: DEFAULT_CHAIN,
      storageUrl: '', messageBoxUrl: MESSAGEBOX_HOST,
      loginType: 'mnemonic', useWab: false, useRemoteStorage: false, useMessageBox: true,
    })
    if (!ok) throw new Error('Could not prepare your wallet. Please try again.')
  }

  useEffect(() => {
    if (initialMode === 'import' && !hasSavedWallet) configure()
  }, [])

  const begin = (next: EntryMode) => {
    setError('')
    try {
      configure()
      setMode(next)
      if (next === 'create') {
        setPhrase(generateRecoveryPhrase())
        setSaved(false)
      }
    } catch (e: any) { setError(e.message) }
  }

  const enterWallet = async () => {
    setError('')
    setBusy(true)
    try {
      if (!manager || loginType !== 'mnemonic') throw new Error('Your wallet is still getting ready. Try again in a moment.')
      let recoveryPhrase = phrase
      if (mode === 'import' && importMethod === 'shares') {
        const recovered = recoverSecretFromShares(shareInputs)
        if (recovered.kind === 'legacy') {
          throw new Error('These shares contain an older private-key backup. They cannot restore a recovery phrase. Use the app that created them to access that wallet; your backup has not been changed.')
        }
        recoveryPhrase = recovered.mnemonic
      }
      // Profile 0 anchors the phrase (the saved key); the snapshot holds the open profile's key.
      const material = deriveMnemonicWallet(recoveryPhrase)
      const profileIndex = manager instanceof MnemonicProfileWalletManager ? manager.activeProfileIndex : 0
      const active = profileIndex === 0 ? material : deriveMnemonicWallet(recoveryPhrase, profileIndex)
      // Saved-wallet recovery may repair missing material only for the same identity.
      if (hasSavedWallet) {
        const snapshotHex = manager.primaryKey ? Utils.toHex(manager.primaryKey) : ''
        const storedHex = secrets.getKeyHex() || ''
        if (!snapshotHex && !storedHex) throw new Error('The saved identity could not be verified. Recover from a wallet data file to preserve the current wallet.')
        if (snapshotHex) verifyMnemonicWallet(active.mnemonic, snapshotHex, undefined, profileIndex)
        if (storedHex) verifyMnemonicWallet(material.mnemonic, storedHex)
      }
      if (manager.authenticated && manager.underlying) {
        verifyMnemonicWallet(active.mnemonic, Utils.toHex(manager.primaryKey), undefined, profileIndex)
      }
      secrets.setKeyHex(material.keyHex)
      secrets.setMnemonic(material.mnemonic)
      if (!manager.authenticated || !manager.underlying) {
        // A failed service build can leave SimpleWalletManager authenticated with
        // no underlying wallet. Reset only that in-memory manager for a retry.
        if (manager.authenticated) manager.destroy()
        if (manager instanceof MnemonicProfileWalletManager) {
          await manager.unlockActiveProfile(active).catch(() => {})
        } else {
          await manager.providePrimaryKey(material.keyBytes)
          await manager.providePrivilegedKeyManager(new PrivilegedKeyManager(async () => material.privilegedKey))
        }
      }
      if (!manager.authenticated || !manager.underlying) throw new Error('Could not open your wallet. Your recovery phrase is still shown here; please try again.')
      secrets.setSnapshot(saveEnhancedSnapshot())
      setPhrase('')
      setShareInputs(['', '', ''])
      history.replace('/dashboard')
    } catch (e: any) { setError(e.message || 'Could not open your wallet.') }
    finally { setBusy(false) }
  }

  const isWorking = busy || initializingBackendServices
  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      <Box sx={{ px: { xs: 3, sm: 5 }, py: 3, display: 'flex', alignItems: 'center', gap: 1.25 }}>
        <Box aria-hidden sx={{ display: 'grid', placeItems: 'center', height: 38, width: 38, flexShrink: 0, color: 'primary.main' }}><AppLogo size={38} color="currentColor" /></Box>
        <Typography fontWeight={750} letterSpacing={-0.4}>BSV Desktop</Typography>
      </Box>
      <Container maxWidth="sm" sx={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', py: 5 }}>
        <Paper elevation={0} sx={{ p: { xs: 3, sm: 4.5 }, border: '1px solid', borderColor: 'divider', borderRadius: 4, boxShadow: '0 20px 70px rgba(15, 23, 42, 0.045)' }}>
          {mode !== 'welcome' && !legacy && <Button size="small" startIcon={<ArrowBack />} onClick={() => { setMode('welcome'); setPhrase(''); setError('') }} disabled={isWorking} sx={{ mb: 3, ml: -1 }}>Back</Button>}
          {legacy ? <LegacyUnlock onReady={() => history.replace('/dashboard')} /> : hasSavedWallet && mode === 'welcome' ? (
            <Stack spacing={2.5} alignItems="center" sx={{ py: 3, textAlign: 'center' }}>
              {!startupError && <CircularProgress size={32} />}<Typography variant="h5">{startupError ? 'Your wallet needs attention' : 'Opening your wallet'}</Typography>
              <Typography color="text.secondary">Your saved wallet and recovery material are kept on this device.</Typography>
              {startupError && <><Alert severity="error">{startupError}</Alert><Button variant="contained" onClick={() => getWalletService().retrySavedWallet()}>Try again</Button>{loginType === 'mnemonic' && <Button onClick={() => setMode('import')}>Recover with phrase or shares</Button>}<Button component={RouterLink} to="/recovery/wallet-data">Open wallet data files</Button></>}
              {error && <Alert severity="error">{error}</Alert>}
            </Stack>
          ) : mode === 'welcome' ? (
            <>
              <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.8, bgcolor: 'action.hover', borderRadius: 20, px: 1.5, py: 0.8, mb: 3, color: 'primary.main' }}><ShieldOutlined sx={{ fontSize: 16 }} /><Typography variant="caption" fontWeight={600}>Your money. Your keys.</Typography></Box>
              <Typography variant="h3" sx={{ fontWeight: 750, fontSize: { xs: 34, sm: 42 }, lineHeight: 1.1, letterSpacing: -1.5, mb: 2 }}>A simpler home<br />for your BSV.</Typography>
              <Typography color="text.secondary" sx={{ lineHeight: 1.75, mb: 4 }}>Pay people, connect with apps, and keep your wallet close. Start with a recovery phrase that works with BSV Wallet.</Typography>
              <Stack spacing={1.5}>
                <Button fullWidth variant="contained" size="large" endIcon={<ArrowForward />} onClick={() => begin('create')} sx={{ py: 1.6 }}>Create a wallet</Button>
                <Button fullWidth variant="outlined" size="large" onClick={() => begin('import')} sx={{ py: 1.5 }}>Import an existing wallet</Button>
              </Stack>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 3, textAlign: 'center' }}>No account or phone number needed.</Typography>
            </>
          ) : (
            <>
              <Box sx={{ display: 'inline-flex', mb: 2, color: 'primary.main' }}><KeyOutlined /></Box>
              <Typography variant="h4" sx={{ fontWeight: 700, letterSpacing: -0.9, mb: 1.2 }}>{mode === 'create' ? 'Your wallet starts here.' : 'Welcome back.'}</Typography>
              <Typography color="text.secondary" sx={{ mb: 3, lineHeight: 1.7 }}>{mode === 'create' ? 'Write down these twelve words in order. They restore your wallet on any device.' : 'Restore with your BSV Wallet recovery phrase or two backup shares.'}</Typography>
              {mode === 'create' ? (
                <Stack spacing={2.5}>
                  <RecoveryPhrase phrase={phrase} />
                  <Button size="small" startIcon={<ContentCopy />} onClick={async () => { try { await navigator.clipboard.writeText(phrase) } catch { setError('Could not copy. You can write the words down instead.') } }} sx={{ alignSelf: 'flex-start' }}>Copy phrase</Button>
                  <Alert severity="warning" icon={<ShieldOutlined />}>Keep these words private. Anyone with your phrase can spend your funds.</Alert>
                  <FormControlLabel control={<Checkbox checked={saved} onChange={e => setSaved(e.target.checked)} />} label={<Typography variant="body2">I saved my recovery phrase somewhere safe.</Typography>} />
                </Stack>
              ) : (
                <Stack spacing={2.5}>
                  <Tabs value={importMethod} onChange={(_, value) => { setImportMethod(value); setError('') }} variant="fullWidth" sx={{ mb: 1, borderBottom: '1px solid', borderColor: 'divider' }}><Tab label="Recovery phrase" value="phrase" /><Tab label="Backup shares" value="shares" /></Tabs>
                  {importMethod === 'phrase' ? <TextField label="Recovery phrase" value={phrase} onChange={e => setPhrase(e.target.value)} multiline minRows={3} fullWidth autoFocus placeholder="Enter your words in order" helperText="12, 15, 18, 21 or 24 words. No BIP39 passphrase." autoComplete="off" inputProps={{ spellCheck: false, autoCapitalize: 'none' }} /> : <>
                    <Button variant="outlined" startIcon={<QrCodeScannerOutlined />} onClick={() => setScanShares(true)}>Scan backup shares</Button>
                    {shareInputs.map((share, index) => <TextField key={index} label={`Backup share ${index + 1}${index === 2 ? ' (optional)' : ''}`} value={share} onChange={e => setShareInputs(values => values.map((v, i) => i === index ? e.target.value : v))} multiline minRows={2} fullWidth autoComplete="off" inputProps={{ spellCheck: false }} />)}
                    <Typography variant="caption" color="text.secondary">Paste complete shares from the same backup. Any two of the three BSV Wallet shares restore your phrase.</Typography>
                  </>}
                </Stack>
              )}
              {error && <Alert severity="error" sx={{ mt: 2.5 }}>{error}</Alert>}
              <Button variant="contained" fullWidth size="large" onClick={enterWallet} disabled={isWorking || !manager || (mode === 'create' && !saved) || (mode === 'import' && importMethod === 'phrase' && !phrase.trim()) || (mode === 'import' && importMethod === 'shares' && shareInputs.filter(v => v.trim()).length < 2)} sx={{ py: 1.6, mt: 3 }} endIcon={isWorking ? undefined : <ArrowForward />}>{isWorking ? <CircularProgress size={22} color="inherit" /> : mode === 'create' ? 'Open my wallet' : 'Restore wallet'}</Button>
              {mode === 'import' && <Button component={RouterLink} to="/recovery/wallet-data" fullWidth sx={{ mt: 1.5 }}>Recover from a wallet data file</Button>}
            </>
          )}
          {mode === 'welcome' && error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
        </Paper>
      </Container>
      <Stack direction="row" spacing={2} justifyContent="center" sx={{ pb: 3, color: 'text.secondary' }}><Typography variant="caption">v{appVersion}</Typography><Link component={RouterLink} to="/privacy" variant="caption" color="inherit">Privacy</Link><Link component={RouterLink} to="/usage" variant="caption" color="inherit">Terms</Link></Stack>
      <QrScanner open={scanShares} onClose={() => setScanShares(false)} onRead={collectShare} continuous title="Scan backup shares" description="Scan the QR code on each of two different backup shares. You can also import an image of a share." progress={`${shareInputs.filter(s => s.trim()).length} shares collected`} />
    </Box>
  )
}

function LegacyUnlock({ onReady }: { onReady: () => void }) {
  const { managers, loginType, saveEnhancedSnapshot } = useContext(WalletContext)
  const manager: any = managers.walletManager
  const startupError = getWalletService().startupError
  const [phrase, setPhrase] = useState('')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [step, setStep] = useState<'key' | 'code' | 'password'>('key')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const wab = loginType === 'wab'
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      if (!manager) throw new Error('The wallet is still getting ready.')
      if (step === 'key') {
        if (wab) { await manager.startAuth({ phoneNumber: phone }); setStep('code') }
        else { await manager.providePresentationKey(HD.fromSeed(Mnemonic.fromString(phrase.trim()).toSeed()).derive("m/0'/0/0").privKey.toArray()); setStep('password') }
      } else if (step === 'code') { await manager.completeAuth({ phoneNumber: phone, otp: code }); setStep('password') }
      else {
        await manager.providePassword(password)
        if (!manager.authenticated) throw new Error('Could not unlock this wallet.')
        secrets.setSnapshot(saveEnhancedSnapshot()); onReady()
      }
    } catch (e: any) { setError(e.message) } finally { setBusy(false) }
  }
  return <Stack component="form" onSubmit={submit} spacing={2.5}>
    <Typography variant="h4" fontWeight={700}>Unlock your saved wallet</Typography>
    <Typography color="text.secondary">This wallet uses an earlier recovery method. Your identity and funds stay available with the credentials you used before.</Typography>
    {step === 'key' && (wab ? <TextField label="Phone number" value={phone} onChange={e => setPhone(e.target.value)} autoComplete="tel" required /> : <TextField label="Presentation recovery phrase" value={phrase} onChange={e => setPhrase(e.target.value)} multiline rows={3} autoComplete="off" required />)}
    {step === 'code' && <TextField label="Verification code" value={code} onChange={e => setCode(e.target.value)} autoComplete="one-time-code" required />}
    {step === 'password' && <TextField label="Wallet password" value={password} onChange={e => setPassword(e.target.value)} type="password" autoComplete="current-password" required />}
    {(error || startupError) && <Alert severity="error">{error || startupError}</Alert>}
    {startupError && <Button onClick={() => getWalletService().retrySavedWallet()} disabled={busy}>Try opening the saved wallet again</Button>}
    <Button variant="contained" type="submit" disabled={busy || !manager} size="large">{busy ? <CircularProgress size={20} /> : step === 'password' ? 'Unlock wallet' : 'Continue'}</Button>
    <Stack direction="row" spacing={1} justifyContent="center"><Button component={RouterLink} to="/recovery/password" size="small">Recover original password</Button><Button component={RouterLink} to="/recovery/presentation-key" size="small">Recover original credentials</Button></Stack>
    <Button component={RouterLink} to="/recovery/wallet-data" size="small">Open wallet data files</Button>
  </Stack>
}
