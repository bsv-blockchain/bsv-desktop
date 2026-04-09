import { useState, useContext, useCallback } from 'react'
import {
  Typography, Box, Paper, Button, Chip, Alert,
  Collapse, Divider, LinearProgress, Dialog,
  DialogTitle, DialogContent, DialogActions
} from '@mui/material'
import { toast } from 'react-toastify'
import { WalletContext } from '../../../WalletContext.js'
import type { ListActionsArgs, ListOutputsResult } from '@bsv/sdk'
import { Wallet } from '@bsv/wallet-toolbox-client'

interface DiagnosisResults {
  failedCount: number
  unsignedCount: number
  unprocessedCount: number
  nosendCount: number
  totalOutputs: number
  spendableOutputs: number
}

interface ActionItem {
  txid: string
  description: string
  status: string
  satoshis: number
  labels: string[]
}

interface ConfirmationState {
  open: boolean
  title: string
  message: string
  onConfirm: () => void
}

const WalletDiagnosis = () => {
  const { managers } = useContext(WalletContext)

  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [diagnosis, setDiagnosis] = useState<DiagnosisResults | null>(null)
  const [actions, setActions] = useState<ActionItem[]>([])
  const [outputs, setOutputs] = useState<ListOutputsResult | null>(null)
  const [operationLog, setOperationLog] = useState<string[]>([])
  const [confirmation, setConfirmation] = useState<ConfirmationState>({
    open: false, title: '', message: '', onConfirm: () => {}
  })

  const addLog = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString()
    setOperationLog(prev => [...prev, `[${timestamp}] ${message}`])
  }, [])

  const getWallet = useCallback(() => {
    const wallet = managers.wallet
    if (!wallet) throw new Error('Wallet not available. Please ensure you are logged in.')
    return wallet
  }, [managers.wallet])

  const getWalletClass = useCallback((): Wallet => {
    const wallet = getWallet()
    if (!(wallet instanceof Wallet)) {
      throw new Error('Advanced wallet diagnosis is not available in this mode. Some features require direct wallet access.')
    }
    return wallet
  }, [getWallet])

  const confirm = useCallback((title: string, message: string, onConfirm: () => void) => {
    setConfirmation({ open: true, title, message, onConfirm })
  }, [])

  const closeConfirmation = useCallback(() => {
    setConfirmation({ open: false, title: '', message: '', onConfirm: () => {} })
  }, [])

  // --- Run Diagnosis ---
  const runDiagnosis = useCallback(async () => {
    setLoading(true)
    addLog('Starting wallet diagnosis...')
    try {
      const wallet = getWallet()

      // List all actions and count by status client-side
      let failedCount = 0
      let unsignedCount = 0
      let unprocessedCount = 0
      let nosendCount = 0

      try {
        const allActions = await wallet.listActions({
          labels: [],
          limit: 10000,
          offset: 0,
        })
        for (const action of allActions.actions) {
          if (action.status === 'failed') failedCount++
          else if (action.status === 'unsigned') unsignedCount++
          else if (action.status === 'unprocessed') unprocessedCount++
          else if (action.status === 'nosend') nosendCount++
        }
      } catch (e: any) {
        addLog(`Warning: Could not list actions - ${e?.message || String(e)}`)
      }

      // Also try Wallet class methods for more accurate counts
      try {
        const walletClass = getWalletClass()
        const failedRes = await walletClass.listFailedActions({ labels: [], limit: 1, offset: 0 })
        failedCount = failedRes.totalActions
      } catch { /* use client-side count */ }

      try {
        const walletClass = getWalletClass()
        const nosendRes = await walletClass.listNoSendActions({ labels: [], limit: 1, offset: 0 })
        nosendCount = nosendRes.totalActions
      } catch { /* use client-side count */ }

      // Query outputs
      let totalOutputs = 0
      let spendableOutputs = 0
      try {
        const outputRes = await wallet.listOutputs({
          basket: 'default',
          include: 'locking scripts',
          limit: 10000,
          offset: 0
        })
        totalOutputs = outputRes.totalOutputs
        spendableOutputs = outputRes.outputs.filter(o => o.spendable).length
      } catch (e) {
        addLog(`Warning: Could not query outputs - ${e instanceof Error ? e.message : String(e)}`)
      }

      const results: DiagnosisResults = {
        failedCount,
        unsignedCount,
        unprocessedCount,
        nosendCount,
        totalOutputs,
        spendableOutputs,
      }

      setDiagnosis(results)
      addLog(`Diagnosis complete: ${results.failedCount} failed, ${results.unsignedCount} unsigned, ${results.unprocessedCount} unprocessed, ${results.nosendCount} nosend`)
      addLog(`Outputs: ${results.spendableOutputs} spendable of ${results.totalOutputs} total`)
      toast.success('Diagnosis complete')
    } catch (e: any) {
      const msg = e?.message || String(e)
      addLog(`Diagnosis failed: ${msg}`)
      toast.error(`Diagnosis failed: ${msg}`)
    } finally {
      setLoading(false)
    }
  }, [getWallet, getWalletClass, addLog])

  // --- Load Failed & Stuck Transactions ---
  const loadProblematicActions = useCallback(async () => {
    setLoading(true)
    addLog('Loading problematic transactions...')
    try {
      const wallet = getWallet()
      const problematicStatuses = ['failed', 'unsigned', 'unprocessed', 'nosend']

      const results = await wallet.listActions({
        labels: [],
        limit: 1000,
        offset: 0,
      })

      const filteredActions = (results.actions || []).filter(
        a => problematicStatuses.includes(a.status || '')
      )

      const items: ActionItem[] = filteredActions.map(a => ({
        txid: a.txid || 'unknown',
        description: a.description || 'No description',
        status: a.status || 'unknown',
        satoshis: a.satoshis || 0,
        labels: a.labels || [],
      }))

      setActions(items)
      addLog(`Found ${items.length} problematic transaction(s)`)
    } catch (e: any) {
      const msg = e?.message || String(e)
      addLog(`Failed to load transactions: ${msg}`)
      toast.error(`Failed to load transactions: ${msg}`)
    } finally {
      setLoading(false)
    }
  }, [getWallet, addLog])

  // --- Abort a stuck (unsigned/unprocessed) transaction ---
  const abortStuckAction = useCallback((txid: string) => {
    confirm(
      'Abort Stuck Transaction',
      `Are you sure you want to abort transaction ${txid.substring(0, 16)}...? This action cannot be undone.`,
      async () => {
        closeConfirmation()
        setLoading(true)
        addLog(`Aborting stuck transaction ${txid.substring(0, 16)}...`)
        try {
          const wallet = getWallet()
          await wallet.abortAction({ reference: txid })
          addLog(`Successfully aborted transaction ${txid.substring(0, 16)}...`)
          toast.success('Transaction aborted')
          setActions(prev => prev.filter(a => a.txid !== txid))
        } catch (e: any) {
          const msg = e?.message || String(e)
          addLog(`Failed to abort transaction: ${msg}`)
          toast.error(`Abort failed: ${msg}`)
        } finally {
          setLoading(false)
        }
      }
    )
  }, [confirm, closeConfirmation, getWallet, addLog])

  // --- Attempt recovery of failed actions ---
  const attemptRecovery = useCallback(() => {
    confirm(
      'Attempt Recovery',
      'This will attempt to recover all failed transactions by queuing them for reprocessing. Continue?',
      async () => {
        closeConfirmation()
        setLoading(true)
        addLog('Attempting recovery of failed actions...')
        try {
          const walletClass = getWalletClass()
          const baseArgs: ListActionsArgs = { labels: [], limit: 100, offset: 0 }
          const result = await walletClass.listFailedActions(baseArgs, true)
          const count = result.totalActions || 0
          addLog(`Recovery queued for ${count} failed action(s)`)
          toast.success(`Recovery queued for ${count} failed action(s)`)
        } catch (e: any) {
          const msg = e?.message || String(e)
          addLog(`Recovery attempt failed: ${msg}`)
          toast.error(`Recovery failed: ${msg}`)
        } finally {
          setLoading(false)
        }
      }
    )
  }, [confirm, closeConfirmation, getWalletClass, addLog])

  // --- Abort nosend actions ---
  const abortNosendActions = useCallback(() => {
    confirm(
      'Abort NoSend Transactions',
      'This will abort all nosend transactions. These are transactions that were created but never broadcast. Continue?',
      async () => {
        closeConfirmation()
        setLoading(true)
        addLog('Aborting nosend actions...')
        try {
          const walletClass = getWalletClass()
          const baseArgs: ListActionsArgs = { labels: [], limit: 100, offset: 0 }
          const result = await walletClass.listNoSendActions(baseArgs, true)
          const count = result.totalActions || 0
          addLog(`Aborted ${count} nosend action(s)`)
          toast.success(`Aborted ${count} nosend action(s)`)
          setActions(prev => prev.filter(a => a.status !== 'nosend'))
        } catch (e: any) {
          const msg = e?.message || String(e)
          addLog(`Failed to abort nosend actions: ${msg}`)
          toast.error(`Abort nosend failed: ${msg}`)
        } finally {
          setLoading(false)
        }
      }
    )
  }, [confirm, closeConfirmation, getWalletClass, addLog])

  // --- Load Outputs ---
  const loadOutputs = useCallback(async () => {
    setLoading(true)
    addLog('Scanning outputs...')
    try {
      const wallet = getWallet()
      const result = await wallet.listOutputs({
        basket: 'default',
        include: 'locking scripts',
        limit: 10000,
        offset: 0
      })
      setOutputs(result)
      const spendable = result.outputs.filter(o => o.spendable).length
      addLog(`Found ${result.totalOutputs} output(s), ${spendable} spendable`)
    } catch (e: any) {
      const msg = e?.message || String(e)
      addLog(`Failed to load outputs: ${msg}`)
      toast.error(`Failed to load outputs: ${msg}`)
    } finally {
      setLoading(false)
    }
  }, [getWallet, addLog])

  // --- Relinquish Output ---
  const relinquishOutput = useCallback((outpoint: string) => {
    confirm(
      'Relinquish Output',
      `Are you sure you want to relinquish output ${outpoint.substring(0, 20)}...? This removes it from tracking and cannot be undone.`,
      async () => {
        closeConfirmation()
        setLoading(true)
        addLog(`Relinquishing output ${outpoint.substring(0, 20)}...`)
        try {
          const wallet = getWallet()
          await wallet.relinquishOutput({ basket: 'default', output: outpoint })
          addLog(`Successfully relinquished output ${outpoint.substring(0, 20)}...`)
          toast.success('Output relinquished')
          if (outputs) {
            setOutputs({
              ...outputs,
              totalOutputs: outputs.totalOutputs - 1,
              outputs: outputs.outputs.filter(o => `${o.outpoint}` !== outpoint),
            })
          }
        } catch (e: any) {
          const msg = e?.message || String(e)
          addLog(`Failed to relinquish output: ${msg}`)
          toast.error(`Relinquish failed: ${msg}`)
        } finally {
          setLoading(false)
        }
      }
    )
  }, [confirm, closeConfirmation, getWallet, addLog, outputs])

  // --- Data Cleanup ---
  const runCleanup = useCallback(() => {
    confirm(
      'Data Cleanup',
      'This will abort all stuck (unsigned + unprocessed) and nosend transactions. This cannot be undone. Continue?',
      async () => {
        closeConfirmation()
        setLoading(true)
        addLog('Starting data cleanup...')
        try {
          const wallet = getWallet()

          // Abort stuck transactions (unsigned + unprocessed)
          const stuckRes = await wallet.listActions({
            labels: [],
            limit: 1000,
            offset: 0,
          })
          const stuckTxs = (stuckRes.actions || []).filter(
            a => a.status === 'unsigned' || a.status === 'unprocessed'
          )

          let abortedCount = 0
          for (const action of stuckTxs) {
            if (action.txid) {
              try {
                await wallet.abortAction({ reference: action.txid })
                abortedCount++
              } catch (e: any) {
                addLog(`Warning: Could not abort ${action.txid?.substring(0, 16)}... - ${e?.message || String(e)}`)
              }
            }
          }
          addLog(`Aborted ${abortedCount} stuck transaction(s)`)

          // Abort nosend actions
          try {
            const walletClass = getWalletClass()
            const nosendRes = await walletClass.listNoSendActions({ labels: [], limit: 1000, offset: 0 }, true)
            addLog(`Aborted ${nosendRes.totalActions || 0} nosend action(s)`)
          } catch (e: any) {
            addLog(`Warning: Could not abort nosend actions - ${e?.message || String(e)}`)
          }

          toast.success('Cleanup complete')
          addLog('Data cleanup finished')
          setActions([])
        } catch (e: any) {
          const msg = e?.message || String(e)
          addLog(`Cleanup failed: ${msg}`)
          toast.error(`Cleanup failed: ${msg}`)
        } finally {
          setLoading(false)
        }
      }
    )
  }, [confirm, closeConfirmation, getWallet, getWalletClass, addLog])

  // --- Review Spendable Outputs (deep chain sync) ---
  const [reviewResults, setReviewResults] = useState<{ total: number, invalid: number } | null>(null)

  const reviewSpendableOutputs = useCallback((release: boolean) => {
    const action = release
      ? 'review all spendable outputs and release (mark unspendable) any that are no longer valid UTXOs on-chain'
      : 'review all spendable outputs against the blockchain to find invalid ones'
    confirm(
      release ? 'Review & Release Invalid Outputs' : 'Review Spendable Outputs',
      `This will ${action}. ${release ? 'This cannot be undone. ' : ''}Continue?`,
      async () => {
        closeConfirmation()
        setLoading(true)
        addLog(`Reviewing spendable outputs (all=true, release=${release})...`)
        try {
          const walletClass = getWalletClass()
          const result = await walletClass.reviewSpendableOutputs(true, release)
          const invalidCount = result.totalOutputs
          setReviewResults({ total: invalidCount, invalid: invalidCount })
          if (invalidCount === 0) {
            addLog('All spendable outputs verified successfully — no invalid outputs found')
            toast.success('All outputs are valid!')
          } else {
            addLog(`Found ${invalidCount} invalid output(s)${release ? ' — marked as unspendable' : ''}`)
            toast[release ? 'success' : 'warning'](
              release
                ? `Released ${invalidCount} invalid output(s)`
                : `Found ${invalidCount} invalid output(s) — use "Review & Release" to fix`
            )
          }
        } catch (e: any) {
          const msg = e?.message || String(e)
          addLog(`Review failed: ${msg}`)
          toast.error(`Review failed: ${msg}`)
        } finally {
          setLoading(false)
        }
      }
    )
  }, [confirm, closeConfirmation, getWalletClass, addLog])

  // --- Reset Change Parameters ---
  const resetChangeParams = useCallback(async () => {
    try {
      setLoading(true)
      addLog('Resetting wallet change parameters to defaults (count=144, satoshis=32)...')
      const walletClass = getWalletClass()
      await walletClass.setWalletChangeParams(144, 32)
      addLog('Change parameters reset successfully')
      toast.success('Wallet change parameters reset to defaults')
    } catch (e: any) {
      const msg = e?.message || String(e)
      addLog(`Failed to reset change parameters: ${msg}`)
      toast.error(`Failed to reset change parameters: ${msg}`)
    } finally {
      setLoading(false)
    }
  }, [getWalletClass, addLog])

  const getStatusColor = (status: string): 'error' | 'warning' | 'info' | 'default' => {
    switch (status) {
      case 'failed': return 'error'
      case 'unsigned': return 'warning'
      case 'unprocessed': return 'warning'
      case 'nosend': return 'info'
      default: return 'default'
    }
  }

  return (
    <Paper elevation={0} sx={{ p: 3, bgcolor: 'background.paper', mb: 4 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h4">
          Wallet Diagnosis
        </Typography>
        <Button
          size="small"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Hide' : 'Show'} Diagnosis Tools
        </Button>
      </Box>

      <Alert severity="info" sx={{ mb: 2 }}>
        Diagnose and repair wallet issues including failed transactions, stuck actions, and orphaned outputs.
        Use these tools if your wallet balance seems incorrect or transactions are stuck.
      </Alert>

      {loading && (
        <Box sx={{ width: '100%', mb: 2 }}>
          <LinearProgress />
        </Box>
      )}

      <Collapse in={expanded}>
        {/* --- Run Diagnosis --- */}
        <Box sx={{ mt: 2 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>Quick Scan</Typography>
          <Button
            variant="contained"
            onClick={runDiagnosis}
            disabled={loading}
            sx={{ mb: 2 }}
          >
            {loading ? 'Scanning...' : 'Run Diagnosis'}
          </Button>

          {diagnosis && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1 }}>
              <Chip
                label={`Failed: ${diagnosis.failedCount}`}
                color={diagnosis.failedCount > 0 ? 'error' : 'default'}
                variant="outlined"
              />
              <Chip
                label={`Unsigned: ${diagnosis.unsignedCount}`}
                color={diagnosis.unsignedCount > 0 ? 'warning' : 'default'}
                variant="outlined"
              />
              <Chip
                label={`Unprocessed: ${diagnosis.unprocessedCount}`}
                color={diagnosis.unprocessedCount > 0 ? 'warning' : 'default'}
                variant="outlined"
              />
              <Chip
                label={`NoSend: ${diagnosis.nosendCount}`}
                color={diagnosis.nosendCount > 0 ? 'info' : 'default'}
                variant="outlined"
              />
              <Chip
                label={`Outputs: ${diagnosis.spendableOutputs} spendable / ${diagnosis.totalOutputs} total`}
                color="primary"
                variant="outlined"
              />
            </Box>
          )}
        </Box>

        <Divider sx={{ my: 3 }} />

        {/* --- Failed & Stuck Transactions --- */}
        <Box>
          <Typography variant="h6" sx={{ mb: 2 }}>Failed &amp; Stuck Transactions</Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
            <Button
              variant="outlined"
              onClick={loadProblematicActions}
              disabled={loading}
              size="small"
            >
              Load Transactions
            </Button>
            {actions.some(a => a.status === 'failed') && (
              <Button
                variant="outlined"
                color="warning"
                onClick={attemptRecovery}
                disabled={loading}
                size="small"
              >
                Attempt Recovery ({actions.filter(a => a.status === 'failed').length} Failed)
              </Button>
            )}
            {actions.some(a => a.status === 'nosend') && (
              <Button
                variant="outlined"
                color="error"
                onClick={abortNosendActions}
                disabled={loading}
                size="small"
              >
                Abort All NoSend ({actions.filter(a => a.status === 'nosend').length})
              </Button>
            )}
          </Box>

          {actions.length > 0 && (
            <Box sx={{
              maxHeight: 300,
              overflowY: 'auto',
              border: 1,
              borderColor: 'divider',
              borderRadius: 1,
              p: 1,
            }}>
              {actions.map((action, idx) => (
                <Box
                  key={`${action.txid}-${idx}`}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    py: 0.5,
                    px: 1,
                    '&:not(:last-child)': { borderBottom: 1, borderColor: 'divider' },
                  }}
                >
                  <Chip
                    label={action.status}
                    color={getStatusColor(action.status)}
                    size="small"
                    sx={{ minWidth: 90 }}
                  />
                  <Typography
                    variant="body2"
                    sx={{ fontFamily: 'monospace', minWidth: 120 }}
                  >
                    {action.txid.substring(0, 16)}...
                  </Typography>
                  <Typography variant="body2" sx={{ flex: 1 }} noWrap>
                    {action.description}
                  </Typography>
                  <Typography variant="body2" sx={{ minWidth: 80, textAlign: 'right' }}>
                    {action.satoshis} sat
                  </Typography>
                  {(action.status === 'unsigned' || action.status === 'unprocessed') && (
                    <Button
                      size="small"
                      color="error"
                      variant="text"
                      onClick={() => abortStuckAction(action.txid)}
                      disabled={loading}
                    >
                      Abort
                    </Button>
                  )}
                </Box>
              ))}
            </Box>
          )}

          {actions.length === 0 && (
            <Typography variant="body2" color="textSecondary" sx={{ fontStyle: 'italic' }}>
              Click "Load Transactions" to scan for problematic transactions.
            </Typography>
          )}
        </Box>

        <Divider sx={{ my: 3 }} />

        {/* --- Output Validation --- */}
        <Box>
          <Typography variant="h6" sx={{ mb: 2 }}>Output Validation</Typography>
          <Button
            variant="outlined"
            onClick={loadOutputs}
            disabled={loading}
            size="small"
            sx={{ mb: 2 }}
          >
            Scan Outputs
          </Button>

          {outputs && (
            <>
              <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
                <Chip
                  label={`Spendable: ${outputs.outputs.filter(o => o.spendable).length}`}
                  color="success"
                  variant="outlined"
                  size="small"
                />
                <Chip
                  label={`Locked: ${outputs.outputs.filter(o => !o.spendable).length}`}
                  color="warning"
                  variant="outlined"
                  size="small"
                />
                <Chip
                  label={`Total: ${outputs.totalOutputs}`}
                  color="primary"
                  variant="outlined"
                  size="small"
                />
              </Box>

              <Box sx={{
                maxHeight: 200,
                overflowY: 'auto',
                border: 1,
                borderColor: 'divider',
                borderRadius: 1,
                p: 1,
              }}>
                {outputs.outputs.map((output, idx) => (
                  <Box
                    key={`${output.outpoint}-${idx}`}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1,
                      py: 0.5,
                      px: 1,
                      '&:not(:last-child)': { borderBottom: 1, borderColor: 'divider' },
                    }}
                  >
                    <Chip
                      label={output.spendable ? 'spendable' : 'locked'}
                      color={output.spendable ? 'success' : 'warning'}
                      size="small"
                      sx={{ minWidth: 80 }}
                    />
                    <Typography
                      variant="body2"
                      sx={{ fontFamily: 'monospace', flex: 1 }}
                      noWrap
                    >
                      {String(output.outpoint).substring(0, 24)}...
                    </Typography>
                    <Typography variant="body2" sx={{ minWidth: 80, textAlign: 'right' }}>
                      {output.satoshis} sat
                    </Typography>
                    <Button
                      size="small"
                      color="error"
                      variant="text"
                      onClick={() => relinquishOutput(String(output.outpoint))}
                      disabled={loading}
                    >
                      Relinquish
                    </Button>
                  </Box>
                ))}
              </Box>
            </>
          )}

          {!outputs && (
            <Typography variant="body2" color="textSecondary" sx={{ fontStyle: 'italic' }}>
              Click "Scan Outputs" to inspect wallet outputs in the default basket.
            </Typography>
          )}
        </Box>

        <Divider sx={{ my: 3 }} />

        {/* --- Review Spendable Outputs --- */}
        <Box>
          <Typography variant="h6" sx={{ mb: 1 }}>Review Spendable Outputs</Typography>
          <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
            Verify all spendable outputs against the blockchain. Identifies outputs your wallet considers spendable
            but that are no longer valid UTXOs on-chain (e.g. spent elsewhere, double-spent, or from orphaned blocks).
          </Typography>

          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
            <Button
              variant="outlined"
              onClick={() => reviewSpendableOutputs(false)}
              disabled={loading}
              size="small"
            >
              Scan Only
            </Button>
            <Button
              variant="contained"
              color="warning"
              onClick={() => reviewSpendableOutputs(true)}
              disabled={loading}
              size="small"
            >
              Review & Release Invalid
            </Button>
          </Box>

          {reviewResults && (
            <Alert severity={reviewResults.invalid > 0 ? 'warning' : 'success'} sx={{ mb: 1 }}>
              {reviewResults.invalid === 0
                ? 'All spendable outputs are valid on-chain.'
                : `${reviewResults.invalid} invalid output(s) found${reviewResults.invalid > 0 ? '.' : ''}`}
            </Alert>
          )}
        </Box>

        <Divider sx={{ my: 3 }} />

        {/* --- Data Cleanup --- */}
        <Box>
          <Typography variant="h6" sx={{ mb: 2 }}>Data Cleanup</Typography>
          <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
            One-click cleanup of all stuck (unsigned + unprocessed) and nosend transactions.
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button
              variant="contained"
              color="error"
              onClick={runCleanup}
              disabled={loading}
            >
              {loading ? 'Cleaning...' : 'Run Cleanup'}
            </Button>
            <Button
              variant="outlined"
              color="warning"
              onClick={resetChangeParams}
              disabled={loading}
            >
              Reset Change Parameters
            </Button>
          </Box>
          <Typography variant="body2" color="textSecondary" sx={{ mt: 1, fontStyle: 'italic' }}>
            "Reset Change Parameters" fixes the "changeInitialSatoshis must be at least 1" error by
            restoring default change output settings (count: 144, value: 32 sats).
          </Typography>
        </Box>

        <Divider sx={{ my: 3 }} />

        {/* --- Operation Log --- */}
        <Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
            <Typography variant="h6">Operation Log</Typography>
            {operationLog.length > 0 && (
              <Button
                size="small"
                onClick={() => setOperationLog([])}
              >
                Clear Log
              </Button>
            )}
          </Box>
          <Box sx={{
            maxHeight: 200,
            overflowY: 'auto',
            bgcolor: 'action.hover',
            p: 2,
            borderRadius: 1,
            fontFamily: 'monospace',
            fontSize: '0.8rem',
          }}>
            {operationLog.length === 0 ? (
              <Typography variant="body2" color="textSecondary">
                No operations performed yet.
              </Typography>
            ) : (
              operationLog.map((log, idx) => (
                <Box key={idx} sx={{ mb: 0.25 }}>
                  {log}
                </Box>
              ))
            )}
          </Box>
        </Box>
      </Collapse>

      {/* --- Confirmation Dialog --- */}
      <Dialog open={confirmation.open} onClose={closeConfirmation}>
        <DialogTitle>{confirmation.title}</DialogTitle>
        <DialogContent>
          <Typography variant="body1">
            {confirmation.message}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeConfirmation}>
            Cancel
          </Button>
          <Button
            onClick={confirmation.onConfirm}
            color="error"
            variant="contained"
          >
            Confirm
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  )
}

export default WalletDiagnosis
