import { useContext, useState } from 'react'
import { Alert, Box, Button, Chip, Paper, Stack, Typography } from '@mui/material'
import { ContentCopy, DownloadOutlined, ShieldOutlined, VisibilityOffOutlined, VisibilityOutlined } from '@mui/icons-material'
import { QRCodeSVG } from 'qrcode.react'
import { Link as RouterLink, useHistory } from 'react-router-dom'
import { PrivateKey, Utils } from '@bsv/sdk'
import { WalletContext } from '../../../WalletContext'
import * as secrets from '../../../services/secrets'
import { verifyMnemonicWallet, generateEntropyShares } from '../../../utils/mnemonicRecovery'
import { useExportDataToFile } from '../../../utils/exportDataToFile'
import RecoveryPhrase from '../../../components/RecoveryPhrase'
import ChangePassword from '../Settings/Password'
import RecoveryKey from '../Settings/RecoveryKey'

export default function Security() {
  const history = useHistory()
  const { loginType, activeProfile } = useContext(WalletContext)
  const [revealed, setRevealed] = useState(false)
  const [shares, setShares] = useState<string[]>([])
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')
  const exportFile = useExportDataToFile()
  const modern = loginType === 'mnemonic'
  const direct = loginType === 'direct-key'
  // Read only: viewing a backup must never rewrite keys or change the wallet identity.
  const mnemonic = secrets.getMnemonic()?.trim() || ''
  const keyHex = secrets.getKeyHex()?.trim() || ''
  // The saved key is the phrase's first profile, whichever profile is open now.
  const identityKey = (keyHex ? new PrivateKey(Utils.toArray(keyHex, 'hex')).toPublicKey().toString() : '') || activeProfile?.identityKey || ''
  const profilesNote = modern ? '\n\nThis phrase also restores every wallet profile created from it. On a new device, add profiles in the same order to bring them back.' : ''
  const wordCount = mnemonic ? mnemonic.split(/\s+/).length : 0

  const copy = async (text: string, label: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(label) }
    catch { setError('Could not copy to the clipboard. You can save the backup to a file instead.') }
  }
  const createShares = () => {
    setError('')
    try {
      if (!modern) throw new Error('This wallet uses an earlier key scheme. Keep its original recovery material.')
      verifyMnemonicWallet(mnemonic, keyHex, identityKey)
      setShares(generateEntropyShares(mnemonic))
      setRevealed(true)
    } catch (e: any) { setError(e.message) }
  }
  const savePhrase = async () => {
    const data = `${modern ? 'BSV Wallet recovery phrase' : 'BSV Desktop original recovery material'}\n\n${mnemonic || keyHex}\n\nWallet identity: ${identityKey}${profilesNote}\n\nKeep this file private. Anyone with this recovery material can spend your funds.`
    if (!await exportFile({ data, filename: 'BSV Wallet recovery phrase.txt', type: 'text/plain' })) setError('The recovery file was not saved.')
  }
  const saveShare = async (share: string, index: number) => {
    const data = `BSV Wallet backup share ${index + 1} of 3\n\n${share}\n\nWallet identity: ${identityKey}\n\nAny two different shares from this set recover your twelve-word phrase and wallet. Store each share in a separate secure location.\nRestore in BSV Wallet: Import existing wallet > Backup shares.`
    if (!await exportFile({ data, filename: `BSV Wallet backup share ${index + 1}.txt`, type: 'text/plain' })) setError('The backup share was not saved.')
  }

  return <Box sx={{ maxWidth: 900, mx: 'auto', p: { xs: 2.5, md: 4 } }}>
    <Button component={RouterLink} to="/dashboard/settings" sx={{ mb: 2 }}>← Settings</Button>
    <Typography variant="h4" fontWeight={750} letterSpacing={-1} sx={{ mb: 1 }}>Back up your wallet</Typography>
    <Typography color="text.secondary" sx={{ mb: 3, maxWidth: 650, lineHeight: 1.7 }}>A recovery phrase brings your wallet to a new device. Backup shares give you another way to keep that same phrase safe.</Typography>
    {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}
    {modern || direct ? <Stack spacing={3}>
      {!modern && <Alert severity="info">This is an existing wallet with an earlier key scheme. Keep using its original backup; creating a new mnemonic wallet creates a different identity.</Alert>}
      <Paper variant="outlined" sx={{ p: { xs: 2.5, md: 3.5 }, borderRadius: 3 }}>
        <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 1.5 }}><ShieldOutlined color="primary" /><Typography variant="h6" fontWeight={700}>{mnemonic ? 'Recovery phrase' : 'Original private key'}</Typography>{mnemonic && <Chip size="small" label={`${wordCount} words`} />}</Stack>
        <Typography color="text.secondary" sx={{ mb: 2.5 }}>Keep your recovery material private and offline. Anyone who has it can access your wallet.</Typography>
        {revealed ? <>
          {mnemonic ? <RecoveryPhrase phrase={mnemonic} /> : keyHex ? <Box sx={{ p: 2, bgcolor: 'action.hover', fontFamily: 'monospace', overflowWrap: 'anywhere', borderRadius: 2 }}>{keyHex}</Box> : <Alert severity="error">Recovery material is unavailable. Export a wallet data file before changing devices.</Alert>}
          <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mt: 2 }}>
            <Button startIcon={<ContentCopy />} onClick={() => copy(mnemonic || keyHex, 'phrase')} disabled={!mnemonic && !keyHex}>{copied === 'phrase' ? 'Copied' : 'Copy'}</Button>
            <Button startIcon={<DownloadOutlined />} onClick={savePhrase} disabled={!mnemonic && !keyHex}>Save recovery file</Button>
            <Button startIcon={<VisibilityOffOutlined />} onClick={() => { setRevealed(false); setShares([]); setCopied('') }}>Hide</Button>
          </Stack>
        </> : <Button startIcon={<VisibilityOutlined />} variant="outlined" onClick={() => setRevealed(true)} disabled={!mnemonic && !keyHex}>Show recovery material</Button>}
      </Paper>
      {modern && <Paper variant="outlined" sx={{ p: { xs: 2.5, md: 3.5 }, borderRadius: 3 }}>
        <Typography variant="h6" fontWeight={700} sx={{ mb: 1 }}>Three shares. Any two restore your wallet.</Typography>
        <Typography color="text.secondary" sx={{ mb: 2.5, lineHeight: 1.7 }}>Keep one share in each of three separate places. Losing one is okay; any two recreate your phrase. These shares also work in BSV Wallet.</Typography>
        {wordCount !== 12 ? <Alert severity="info">Backup shares support twelve-word phrases. Keep your {wordCount}-word phrase as your backup.</Alert> : shares.length === 0 ? <Button variant="contained" onClick={createShares}>Create backup shares</Button> : <>
          <Alert severity="warning" sx={{ mb: 3 }}>Store each share separately. Two shares together grant full access to your wallet. A new set does not cancel an older set.</Alert>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'repeat(3, 1fr)' }, gap: 2 }}>
            {shares.map((share, index) => <Paper key={share} variant="outlined" sx={{ p: 2.5, borderRadius: 2.5 }}>
              <Typography fontWeight={700} sx={{ mb: 2 }}>Share {index + 1} of 3</Typography>
              <Box sx={{ p: 1.5, bgcolor: '#fff', borderRadius: 2, width: 'fit-content', mx: 'auto' }}><QRCodeSVG value={share} size={144} level="M" /></Box>
              <Typography sx={{ fontFamily: 'monospace', fontSize: 11, overflowWrap: 'anywhere', mt: 2, lineHeight: 1.7 }}>{share}</Typography>
              <Stack spacing={0.5} sx={{ mt: 1.5 }}><Button size="small" startIcon={<DownloadOutlined />} onClick={() => saveShare(share, index)}>Save share {index + 1}</Button><Button size="small" startIcon={<ContentCopy />} onClick={() => copy(share, `share-${index}`)}>{copied === `share-${index}` ? 'Copied' : 'Copy share'}</Button></Stack>
            </Paper>)}
          </Box>
        </>}
      </Paper>}
    </Stack> : <Stack spacing={3}>
      <Alert severity="info">This saved wallet uses an earlier account and password recovery method. Keep its original recovery key and password. New wallets use a single recovery phrase.</Alert>
      <Paper variant="outlined" sx={{ p: 3, borderRadius: 3 }}><RecoveryKey history={history} /></Paper>
      <Paper variant="outlined" sx={{ p: 3, borderRadius: 3 }}><ChangePassword history={history} /></Paper>
    </Stack>}
    <Paper variant="outlined" sx={{ p: 3, mt: 3, borderRadius: 3 }}>
      <Typography variant="h6" fontWeight={700} sx={{ mb: 1 }}>Keep your wallet data, too.</Typography>
      <Typography color="text.secondary" sx={{ mb: 2, lineHeight: 1.7 }}>Your phrase recovers your keys. A wallet data file also preserves transaction history and local wallet records.</Typography>
      <Button component={RouterLink} to="/recovery/wallet-data" variant="outlined">Export wallet data</Button>
    </Paper>
  </Box>
}
