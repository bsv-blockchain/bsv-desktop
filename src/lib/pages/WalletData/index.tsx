import { useContext, useEffect, useRef, useState } from 'react'
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Paper, TextField, Typography } from '@mui/material'
import { Link } from 'react-router-dom'
import { WalletContext } from '../../WalletContext'
import { getWalletService } from '../../hooks/useWalletService'
import { walletDataCall } from '../../walletPortability/session'
import type { ArchiveJob } from '../../../../electron/wallet-portability/repository'

export default function WalletData() {
  const { chain: selectedNetwork } = useContext(WalletContext)
  const service = getWalletService(), session = service.walletData
  const [jobs, setJobs] = useState<ArchiveJob[]>([]), [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState('')
  const [status, setStatus] = useState(''), [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<{ title: string; body: string; action: () => Promise<void> }>()
  const active = useRef(false), mounted = useRef(true)
  const refresh = async () => { const rows = await walletDataCall('list'); if (mounted.current) setJobs(rows) }
  useEffect(() => {
    mounted.current = true
    void refresh().catch(() => setStatus('Saved recovery files could not be read. They have not been removed.'))
    const unsubscribe = window.electronAPI.walletData.onProgress(message => { if (mounted.current) setStatus(message) })
    return () => { mounted.current = false; unsubscribe(); if (active.current) { session?.cancel(); void walletDataCall('cancel') } }
  }, [session])
  const run = async (action: () => Promise<void>) => {
    if (active.current) return
    active.current = true; setBusy(true); setPassword(''); setConfirmation(''); setStatus('Preparing…')
    try { await action() }
    catch (error) { if (mounted.current) setStatus(error instanceof Error ? error.message : 'Operation stopped. Original files and recovery copies are retained.') }
    finally { active.current = false; if (mounted.current) { setBusy(false); await refresh().catch(() => {}) } }
  }
  const match = (job: ArchiveJob) => job.summary?.chain === selectedNetwork && (!session || job.summary.identityKey === session.identityKey)
  const exportReady = password.length >= 12 && password === confirmation
  return <Box sx={{ maxWidth: 820, mx: 'auto', p: 3 }}>
    <Typography variant="h4" gutterBottom>Wallet data files</Typography>
    <Typography paragraph>Export an encrypted BRC-39 file, or open a BRC-38 or BRC-39 file from another wallet. Data files do not contain signing keys. Keep your account recovery material separately.</Typography>
    <Typography paragraph>Current network: {selectedNetwork}. {session ? (session.local ? 'Using device storage.' : 'Export first synchronizes a separate device copy of your remote wallet.') : 'You can validate files and restore a separate copy before signing in.'}</Typography>
    <TextField fullWidth type="password" label="Wallet file passphrase" value={password} onChange={e => setPassword(e.target.value)} disabled={busy} autoComplete="off" sx={{ mb: 2 }} />
    <Typography variant="body2" paragraph>Use the existing passphrase when opening a file. Plaintext BRC-38 files need no passphrase. Use at least 12 characters for a new encrypted export.</Typography>
    <Button disabled={busy} onClick={() => { const pass = password; void run(async () => { const job = await walletDataCall('import', { password: pass }); setStatus(job ? `Verified ${job.summary.totalRecords.toLocaleString()} records. Review the identity and network below.` : 'No file selected.') }) }}>Open and validate wallet file</Button>
    <TextField fullWidth type="password" label="Confirm export passphrase" value={confirmation} onChange={e => setConfirmation(e.target.value)} disabled={busy} autoComplete="off" sx={{ my: 2 }} />
    <Button disabled={busy || !session || !exportReady} onClick={() => { const pass = password; void run(async () => { const saved = await session!.export(pass); setStatus(saved ? 'Encrypted wallet export saved.' : 'Export cancelled; wallet data is unchanged.') }) }}>Export current wallet</Button>
    {busy && <><CircularProgress size={20} /><Button onClick={() => { session?.cancel(); void walletDataCall('cancel'); setStatus('Stopping after the current safe checkpoint…') }}>Stop safely</Button></>}
    {!!status && <Alert severity="info" role="status" sx={{ my: 2 }}>{status}</Alert>}
    <Typography variant="h5" sx={{ my: 2 }}>Saved imports and recovery</Typography>
    {jobs.length === 0 && <Typography>No imported files yet.</Typography>}
    {jobs.map(job => <Paper key={job.id} variant="outlined" sx={{ p: 2, mb: 2 }}>
      <Typography variant="h6">{job.fileName}</Typography>
      <Typography>{new Date(job.createdAt).toLocaleString()} · {job.state}</Typography>
      {job.summary && <>
        <Typography>{job.summary.chain} · {job.summary.totalRecords.toLocaleString()} records · {job.summary.pendingTransactions} pending transactions</Typography>
        <Typography sx={{ overflowWrap: 'anywhere' }}>Identity: {job.summary.identityKey}</Typography>
        <Box component="pre" sx={{ whiteSpace: 'pre-wrap' }}>{Object.entries(job.summary.counts).map(([name, count]) => `${name}: ${count}`).join('\n')}</Box>
        {!match(job) && <Alert severity="warning">This file belongs to a different wallet or network. It can still be restored separately.</Alert>}
      </>}
      {job.error && <Alert severity="warning">{job.error}</Alert>}
      <Button disabled={busy} onClick={() => void run(async () => { const saved = await walletDataCall('saveOriginal', { id: job.id }); setStatus(saved ? 'Original wallet file saved.' : 'Save cancelled. The original remains retained.') })}>Save original file</Button>
      {job.summary && <Button disabled={busy || !exportReady} onClick={() => { const pass = password; void run(async () => { const saved = await walletDataCall('exportImport', { id: job.id, password: pass }); setStatus(saved ? 'Encrypted recovery file saved.' : 'Save cancelled. The recovery copy remains retained.') }) }}>Save encrypted copy</Button>}
      {job.beforeId && <Button disabled={busy || !exportReady} onClick={() => { const pass = password; void run(async () => { const saved = await walletDataCall('exportBefore', { id: job.id, password: pass }); setStatus(saved ? 'Encrypted before-merge recovery point saved.' : 'Save cancelled. The recovery point remains retained.') }) }}>Export before-merge recovery point</Button>}
      {['preparing', 'interrupted'].includes(job.state) ? <Button disabled={busy} onClick={() => { const pass = password; void run(async () => { await walletDataCall('retry', { id: job.id, password: pass }); setStatus('File verified. Earlier attempts are retained.') }) }}>Retry validation</Button> : <>
        <Button disabled={busy || ['merging', 'activating'].includes(job.state)} onClick={() => void run(async () => { await walletDataCall('restore', { id: job.id }); setStatus('Separate copy restored and verified. Your current wallet is unchanged.') })}>Restore a separate copy</Button>
        <Button disabled={busy || !session || !match(job) || !['ready', 'restored', 'merging', 'merged'].includes(job.state)} onClick={() => setConfirm({ title: 'Merge into your current wallet?', body: 'A complete recovery point is retained first. Records are reconciled in a separate copy before verified pages reach your current storage. Interrupted merges can be resumed.', action: async () => { await session!.merge(job.id); setStatus('Merge complete. Original and recovery point retained.') } })}>{job.state === 'merging' ? 'Resume merge' : 'Merge into current wallet'}</Button>
        <Button disabled={busy || !match(job) || job.state === 'merging'} onClick={() => setConfirm({ title: 'Use this device copy as your main wallet?', body: 'This changes storage for the file’s exact identity and network. Earlier storage and your keys are retained. The wallet restarts to close old sessions; sign in with the matching keys.', action: async () => { if (session) await session.activate(job.id); else await walletDataCall('activate', { id: job.id, chain: selectedNetwork }); setStatus('Device copy selected. Restarting the wallet…'); await window.electronAPI.app.restart() } })}>Use as main device copy</Button>
      </>}
    </Paper>)}
    <Button component={Link} to={session ? '/dashboard/settings' : '/recovery'} disabled={busy}>Back</Button>
    <Dialog open={!!confirm} onClose={() => setConfirm(undefined)}><DialogTitle>{confirm?.title}</DialogTitle><DialogContent>{confirm?.body}</DialogContent><DialogActions><Button onClick={() => setConfirm(undefined)}>Cancel</Button><Button onClick={() => { const action = confirm!.action; setConfirm(undefined); void run(action) }}>Continue</Button></DialogActions></Dialog>
  </Box>
}
