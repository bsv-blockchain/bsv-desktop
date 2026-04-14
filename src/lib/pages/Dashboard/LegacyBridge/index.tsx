import { useState, useContext, useEffect, useRef } from 'react'
import { WalletContext } from '../../../WalletContext'
import {
  Box,
  Typography,
  Button,
  TextField,
  Paper,
  CircularProgress,
  Card,
  CardContent,
  Divider,
  Link,
  IconButton,
  Switch,
  FormControlLabel,
  Chip,
  Tabs,
  Tab,
  Alert,
  AlertTitle,
} from '@mui/material'
import CheckIcon from '@mui/icons-material/Check'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import { QRCodeSVG } from 'qrcode.react'
import { PublicKey, P2PKH, Beef, Utils, Script, WalletProtocol, InternalizeActionArgs, InternalizeOutput, PrivateKey, AtomicBEEF } from '@bsv/sdk'
import getBeefForTxid from '../../../utils/getBeefForTxid'
import { wocFetch } from '../../../utils/RateLimitedFetch'
import { toast } from 'react-toastify'

const brc29ProtocolID: WalletProtocol = [2, '3241645161d8']
const DAYS_TO_SCAN = 3 // how many past days to auto-scan in addition to today

interface Utxo {
  txid: string
  vout: number
  satoshis: number
}

interface WoCAddressUnspentAll {
  error: string
  address: string
  script: string
  result: {
    height?: number
    tx_pos: number
    tx_hash: string
    value: number
    isSpentInMempoolTx: boolean
    status: string
  }[]
}

interface ProcessedTx {
  txid: string
  satoshis: number
  importedAt: number // unix ms timestamp from ts: label
  address: string
}

interface TransactionRecord {
  txid: string
  to: string
  amount: number
}

const getCurrentDate = (daysOffset: number) => {
  const today = new Date()
  today.setDate(today.getDate() - daysOffset)
  return today.toISOString().split('T')[0]
}

const timeAgo = (ms: number): string => {
  const diff = Date.now() - ms
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default function Payments() {
  const { managers, network, adminOriginator } = useContext(WalletContext)
  const [paymentAddress, setPaymentAddress] = useState<string | null>(null)
  const [balance, setBalance] = useState<number>(-1)
  const [recipientAddress, setRecipientAddress] = useState<string>('')
  const [amount, setAmount] = useState<string>('')
  const [transactions, setTransactions] = useState<TransactionRecord[]>([])
  const [processedTxs, setProcessedTxs] = useState<ProcessedTx[]>([])
  const [isImporting, setIsImporting] = useState<boolean>(false)
  const [isLoadingAddress, setIsLoadingAddress] = useState<boolean>(false)
  const [isSending, setIsSending] = useState<boolean>(false)
  const [sweepMax, setSweepMax] = useState<boolean>(false)
  const [copied, setCopied] = useState<boolean>(false)
  const [tab, setTab] = useState<0 | 1>(0)
  const [daysOffset, setDaysOffset] = useState<number>(0)
  const [derivationPrefix, setDerivationPrefix] = useState<string>(Utils.toBase64(Utils.toArray(getCurrentDate(0), 'utf8')))
  const derivationSuffix = Utils.toBase64(Utils.toArray('legacy', 'utf8'))
  const wallet = managers?.permissionsManager || null
  const isImportingRef = useRef(false)
  const internalizedCacheRef = useRef<Map<string, Set<string>>>(new Map())

  if (!wallet) {
    return <></>
  }

  const handleCopy = (data: string) => {
    navigator.clipboard.writeText(data)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Derive payment address for a given derivation prefix
  const getPaymentAddress = async (prefix: string): Promise<string> => {
    const { publicKey } = await wallet.getPublicKey({
      protocolID: brc29ProtocolID,
      keyID: prefix + ' ' + derivationSuffix,
      counterparty: 'anyone',
      forSelf: true,
    }, adminOriginator)
    return PublicKey.fromString(publicKey).toAddress(network === 'mainnet' ? 'mainnet' : 'testnet')
  }

  // Fetch UTXOs for address from WhatsOnChain (rate-limited)
  const getUtxosForAddress = async (address: string): Promise<Utxo[]> => {
    const url = `https://api.whatsonchain.com/v1/bsv/${network === 'mainnet' ? 'main' : 'test'}/address/${address}/unspent/all`
    const response = await wocFetch.fetch(url)
    const rp: WoCAddressUnspentAll = await response.json()
    if (!rp.result) return []
    return rp.result
      .filter((r) => r.isSpentInMempoolTx === false)
      .map((r) => ({ txid: r.tx_hash, vout: r.tx_pos, satoshis: r.value }))
  }

  // Get internalized UTXOs for a specific address, cached for the lifetime of the page
  const getInternalizedUtxosForAddress = async (address: string): Promise<Set<string>> => {
    if (internalizedCacheRef.current.has(address)) {
      return internalizedCacheRef.current.get(address)!
    }
    try {
      const response = await wallet.listActions({
        labels: [address],
        labelQueryMode: 'all',
        includeOutputs: true,
        limit: 1000,
      }, adminOriginator)

      const internalizedSet = new Set<string>()
      for (const action of response.actions) {
        if (action.outputs) {
          for (const output of action.outputs) {
            internalizedSet.add(`${action.txid}.${output.outputIndex}`)
          }
        }
      }
      internalizedCacheRef.current.set(address, internalizedSet)
      return internalizedSet
    } catch (error) {
      console.error('Error fetching internalized UTXOs:', error)
      return new Set()
    }
  }

  // Invalidate the internalized cache (called after a successful import)
  const invalidateInternalizedCache = () => {
    internalizedCacheRef.current.clear()
  }

  // Fetch uninternalized balance for a single address
  const fetchBSVBalance = async (address: string): Promise<number> => {
    const allUtxos = await getUtxosForAddress(address)
    const internalizedUtxos = await getInternalizedUtxosForAddress(address)
    const availableUtxos = allUtxos.filter(utxo => !internalizedUtxos.has(`${utxo.txid}.${utxo.vout}`))
    return availableUtxos.reduce((acc, r) => acc + r.satoshis, 0) / 100000000
  }

  // Fetch already-processed transactions for a specific address
  const getProcessedTxsForAddress = async (address: string): Promise<ProcessedTx[]> => {
    try {
      const response = await wallet.listActions({
        labels: [address],
        labelQueryMode: 'all',
        includeLabels: true,
        includeOutputs: true,
        limit: 1000,
      }, adminOriginator)

      return response.actions.map((action: any) => {
        const tsLabel = (action.labels as string[] ?? []).find((l: string) => l.startsWith('ts:'))
        const importedAt = tsLabel ? parseInt(tsLabel.slice(3), 10) : action.createdAt ?? Date.now()
        return {
          txid: action.txid,
          satoshis: Math.abs(action.satoshis ?? 0),
          importedAt,
          address,
        }
      })
    } catch (error) {
      console.error('Error fetching processed txs for address:', address, error)
      return []
    }
  }

  // Refresh all processed transactions across today + past DAYS_TO_SCAN days
  const refreshProcessedTxs = async () => {
    const allProcessed: ProcessedTx[] = []
    for (let i = 0; i <= DAYS_TO_SCAN; i++) {
      const prefix = Utils.toBase64(Utils.toArray(getCurrentDate(i), 'utf8'))
      const address = await getPaymentAddress(prefix)
      const txs = await getProcessedTxsForAddress(address)
      allProcessed.push(...txs)
    }
    // Deduplicate by txid and sort newest first
    const seen = new Set<string>()
    const deduped = allProcessed.filter(tx => {
      if (seen.has(tx.txid)) return false
      seen.add(tx.txid)
      return true
    })
    deduped.sort((a, b) => b.importedAt - a.importedAt)
    setProcessedTxs(deduped)
  }

  // Import uninternalized UTXOs for a single address+prefix pair
  const importFundsForAddress = async (address: string, prefix: string): Promise<number> => {
    const allUtxos = await getUtxosForAddress(address)
    const internalizedUtxos = await getInternalizedUtxosForAddress(address)
    const utxos = allUtxos.filter(utxo => !internalizedUtxos.has(`${utxo.txid}.${utxo.vout}`))

    if (utxos.length === 0) return 0

    const beef = new Beef()
    for (const utxo of utxos) {
      if (!beef.findTxid(utxo.txid)) {
        const b = await getBeefForTxid(utxo.txid, network === 'mainnet' ? 'main' : 'test')
        beef.mergeBeef(b)
      }
    }

    const txs = beef.txs.map((beefTx) => {
      const tx = beef.findAtomicTransaction(beefTx.txid)
      const relevantUtxos = utxos.filter(o => o.txid === beefTx.txid)
      if (relevantUtxos.length === 0) return null

      const outputs: InternalizeOutput[] = relevantUtxos.map(o => ({
        outputIndex: o.vout,
        protocol: 'wallet payment',
        paymentRemittance: {
          senderIdentityKey: new PrivateKey(1).toPublicKey().toString(),
          derivationPrefix: prefix,
          derivationSuffix,
        }
      }))
      const args: InternalizeActionArgs = {
        tx: tx.toAtomicBEEF(),
        description: 'BSV Desktop Payment',
        outputs,
        labels: ['legacy', 'inbound', 'bsvdesktop', address, `ts:${Date.now()}`],
      }
      return args
    }).filter((t) => t !== null)

    let imported = 0
    for (const t of txs) {
      try {
        const response = await wallet.internalizeAction(t, adminOriginator)
        if (response?.accepted) imported++
        else toast.error('A payment was rejected by the wallet')
      } catch (error: any) {
        console.error('Internalize error:', error)
        toast.error(`Import failed: ${error?.message || 'unknown error'}`)
      }
    }
    return imported
  }

  // Scan today + past DAYS_TO_SCAN days and import any uninternalized funds
  const handleImportAllDays = async () => {
    if (isImportingRef.current) return
    isImportingRef.current = true
    setIsImporting(true)

    let totalImported = 0
    try {
      for (let i = 0; i <= DAYS_TO_SCAN; i++) {
        const prefix = Utils.toBase64(Utils.toArray(getCurrentDate(i), 'utf8'))
        const address = await getPaymentAddress(prefix)
        const count = await importFundsForAddress(address, prefix)
        totalImported += count
      }

      if (totalImported > 0) {
        invalidateInternalizedCache()
        toast.success(`Imported ${totalImported} payment${totalImported > 1 ? 's' : ''}`)
        window.dispatchEvent(new CustomEvent('balance-changed'))
      }

      if (paymentAddress) {
        const newBalance = await fetchBSVBalance(paymentAddress)
        setBalance(newBalance)
      }
      await refreshProcessedTxs()
    } catch (e: any) {
      console.error('Import error:', e)
      toast.error(`Import error: ${e.message || 'unknown error'}`)
    } finally {
      isImportingRef.current = false
      setIsImporting(false)
    }
  }

  // Get past outbound transactions from wallet
  const getPastTransactions = async () => {
    try {
      const response = await wallet.listActions({
        labels: ['legacy', 'outbound'],
        labelQueryMode: 'all',
        includeOutputLockingScripts: true,
        includeOutputs: true,
        limit: 10,
      }, adminOriginator)

      setTransactions(() => {
        const pastTxs = response.actions.map((action: any) => {
          let address = ''
          try {
            address = Utils.toBase58Check(
              Script.fromHex(action.outputs![0].lockingScript!).chunks[2].data as number[]
            )
          } catch {
            address = ''
          }
          return {
            txid: action.txid,
            to: address || 'unknown',
            amount: action.satoshis / 100000000,
          }
        })
        return pastTxs.filter((tx: TransactionRecord) => tx.amount !== 0)
      })
    } catch (error) {
      console.error('Error fetching transactions:', error)
    }
  }

  // Handle showing address for a given day offset
  const handleViewAddress = async (offset: number = 0) => {
    setIsLoadingAddress(true)
    try {
      const prefix = Utils.toBase64(Utils.toArray(getCurrentDate(offset), 'utf8'))
      const address = await getPaymentAddress(prefix)
      setDaysOffset(offset)
      setDerivationPrefix(prefix)
      setPaymentAddress(address)
      // Also update the displayed balance for this address
      setBalance(-1)
    } catch (error: any) {
      toast.error(`Error generating address: ${error.message || 'unknown error'}`)
    } finally {
      setIsLoadingAddress(false)
    }
  }

  // Handle sending BSV
  const handleSendBSV = async () => {
    if (!recipientAddress || !amount) {
      toast.error('Please enter a recipient address AND an amount first!')
      return
    }
    const amt = Number(amount)
    if (isNaN(amt) || amt <= 0) {
      toast.error('Please enter a valid amount > 0.')
      return
    }

    if (network === 'mainnet' && !recipientAddress.startsWith('1')) {
      toast.error('You are on mainnet but the recipient address does not look like a mainnet address (starting with 1)!')
      return
    }

    setIsSending(true)
    try {
      const lockingScript = new P2PKH().lock(recipientAddress).toHex()
      const { txid, tx } = await wallet.createAction({
        description: 'Send BSV to address',
        outputs: [{
          lockingScript,
          satoshis: Math.round(amt * 100000000),
          outputDescription: 'BSV for recipient address',
        }],
        labels: ['legacy', 'outbound'],
      }, adminOriginator)

      let displayAmount = amt
      if (sweepMax && tx) {
        try {
          const beef = Beef.fromBinary(tx)
          const transaction = beef.findAtomicTransaction(txid)
          displayAmount = transaction.outputs[0].satoshis / 100000000
        } catch (e) {
          console.error('Failed to parse tx for actual amount:', e)
        }
      }

      toast.success(`Successfully sent ${displayAmount} BSV to ${recipientAddress}`)
      setTransactions((prev) => [...prev, { txid, to: recipientAddress, amount: displayAmount }])
      setRecipientAddress('')
      setAmount('')
      if (sweepMax) setSweepMax(false)
      window.dispatchEvent(new CustomEvent('balance-changed'))
    } catch (error: any) {
      toast.error(`Error sending BSV: ${error.message || 'unknown error'}`)
    } finally {
      setIsSending(false)
    }
  }

  function dateChange(offset: number) {
    setBalance(-1)
    handleViewAddress(offset)
  }

  // On mount: load today's address, scan all days for funds, load processed txs
  useEffect(() => {
    handleViewAddress(0)
    getPastTransactions()
    refreshProcessedTxs()
  }, [])

  // Poll ALL days' addresses every 3s. As soon as any has a balance, trigger import.
  useEffect(() => {
    if (!paymentAddress || isImporting) return
    const interval = setInterval(async () => {
      if (isImportingRef.current) return
      try {
        let totalBalance = 0
        for (let i = 0; i <= DAYS_TO_SCAN; i++) {
          const prefix = Utils.toBase64(Utils.toArray(getCurrentDate(i), 'utf8'))
          const address = await getPaymentAddress(prefix)
          const b = await fetchBSVBalance(address)
          totalBalance += b
        }
        setBalance(totalBalance)
      } catch {
        // ignore poll errors
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [paymentAddress, isImporting])

  // Auto-import as soon as any day's balance > 0 is detected
  useEffect(() => {
    if (balance > 0 && !isImporting) {
      handleImportAllDays()
    }
  }, [balance])

  return (
    <Box sx={{ p: 3, maxWidth: 800, mx: 'auto' }}>
      <Typography variant="h4" gutterBottom sx={{ fontWeight: 600, color: 'primary.main' }}>
        Legacy Bridge
      </Typography>

      {/* Receive / Send tabbed panel */}
      <Paper elevation={2} sx={{ mb: 3 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="fullWidth">
          <Tab label="Receive" />
          <Tab label="Send" />
        </Tabs>
        <Divider />

        {/* Receive tab */}
        {tab === 0 && (
          <Box sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', mb: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <IconButton
                  size="small"
                  onClick={() => dateChange(daysOffset + 1)}
                  title="Previous day's address"
                >
                  <ArrowBackIcon />
                </IconButton>
                <Typography variant="body2" sx={{ minWidth: 90, textAlign: 'center', fontFamily: 'monospace' }}>
                  {getCurrentDate(daysOffset)}
                </Typography>
                <IconButton
                  size="small"
                  onClick={() => dateChange(Math.max(0, daysOffset - 1))}
                  disabled={daysOffset === 0}
                  title="Next day's address"
                >
                  <ArrowForwardIcon />
                </IconButton>
              </Box>
            </Box>

            {isLoadingAddress ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
                <CircularProgress />
              </Box>
            ) : paymentAddress ? (
              <>
                <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
                  <b>Your Payment Address:</b>
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                  <Typography
                    variant="body2"
                    sx={{
                      fontFamily: 'monospace',
                      bgcolor: 'action.hover',
                      py: 1,
                      px: 2,
                      borderRadius: 1,
                      flexGrow: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {paymentAddress}
                  </Typography>
                  <IconButton
                    size="small"
                    onClick={() => handleCopy(paymentAddress)}
                    disabled={copied}
                    sx={{ ml: 1 }}
                  >
                    {copied ? <CheckIcon /> : <ContentCopyIcon fontSize="small" />}
                  </IconButton>
                </Box>

                <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
                  <Box sx={{ padding: '8px', backgroundColor: '#ffffff', display: 'inline-block', width: '216px', height: '216px' }}>
                    <QRCodeSVG value={paymentAddress} size={200} bgColor="#ffffff" fgColor="#000000" />
                  </Box>
                </Box>

                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, mb: 2 }}>
                  <Typography variant="body1" color="textPrimary" sx={{ textAlign: 'center' }}>
                    Available Balance:{' '}
                    <strong>{balance === -1 ? 'Checking...' : `${balance} BSV`}</strong>
                  </Typography>
                  {balance === -1 && <CircularProgress size={14} />}
                </Box>

                <Alert severity="info">
                  A unique address is derived from your wallet keys each day. Funds sent to any of the last {DAYS_TO_SCAN} days' addresses are automatically detected and imported. Change the date at the top right to look back further.
                </Alert>
              </>
            ) : null}
          </Box>
        )}

        {/* Send tab */}
        {tab === 1 && (
          <Box sx={{ p: 3 }}>
            <TextField
              fullWidth
              label="Recipient Address"
              placeholder="Enter BSV address"
              value={recipientAddress}
              onChange={(e) => setRecipientAddress(e.target.value)}
              sx={{ mb: 2 }}
            />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <TextField
                fullWidth
                label="Amount (BSV)"
                placeholder={sweepMax ? 'Sweeping entire wallet balance to external address' : '0.00000000'}
                type={sweepMax ? 'text' : 'number'}
                value={sweepMax ? '' : amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={sweepMax}
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={sweepMax}
                    onChange={(e) => {
                      const checked = e.target.checked
                      setSweepMax(checked)
                      setAmount(checked ? '20999999.99999999' : '')
                    }}
                    size="small"
                  />
                }
                label="MAX"
                labelPlacement="top"
                sx={{ ml: 0, minWidth: 'fit-content' }}
              />
            </Box>
            <Button
              variant="contained"
              onClick={handleSendBSV}
              disabled={isSending || !recipientAddress || (!sweepMax && !amount)}
              fullWidth
            >
              {isSending ? <CircularProgress size={24} /> : (sweepMax ? 'Sweep whole wallet' : 'Send BSV')}
            </Button>
          </Box>
        )}
      </Paper>

      {/* Processed Inbound Transactions */}
      {tab === 0 && processedTxs.length > 0 && (
        <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
          <Typography variant="h6" gutterBottom sx={{ fontWeight: 500 }}>
            Received
          </Typography>
          <Divider sx={{ mb: 2 }} />
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {processedTxs.map((tx) => (
              <Card key={tx.txid} variant="outlined">
                <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                    <Typography variant="body2" color="textPrimary" fontWeight={600}>
                      +{(tx.satoshis / 100000000).toFixed(8)} BSV
                    </Typography>
                    <Chip label={timeAgo(tx.importedAt)} size="small" variant="outlined" />
                  </Box>
                  <Typography variant="caption" color="textSecondary" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                    <Link href={`https://whatsonchain.com/tx/${tx.txid}`} target="_blank" rel="noopener noreferrer">
                      {tx.txid}
                    </Link>
                  </Typography>
                </CardContent>
              </Card>
            ))}
          </Box>
        </Paper>
      )}

      {/* Outbound Transaction History */}
      {tab === 1 && <Paper elevation={2} sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Typography variant="h6" sx={{ fontWeight: 500 }}>
            Sent
          </Typography>
          <Button size="small" variant="outlined" onClick={getPastTransactions}>
            Refresh
          </Button>
        </Box>
        <Divider sx={{ mb: 2 }} />

        {transactions.length === 0 ? (
          <Typography variant="body2" color="textSecondary" sx={{ textAlign: 'center', py: 3 }}>
            No outbound transactions yet.
          </Typography>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {transactions.map((tx, index) => (
              <Card key={index} variant="outlined">
                <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                    <Typography variant="body2" color="textPrimary" fontWeight={600}>
                      -{Math.abs(tx.amount).toFixed(8)} BSV
                    </Typography>
                    <Typography variant="caption" color="textSecondary" sx={{ fontFamily: 'monospace' }}>
                      {tx.to}
                    </Typography>
                  </Box>
                  <Typography variant="caption" color="textSecondary" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                    <Link href={`https://whatsonchain.com/tx/${tx.txid}`} target="_blank" rel="noopener noreferrer">
                      {tx.txid}
                    </Link>
                  </Typography>
                </CardContent>
              </Card>
            ))}
          </Box>
        )}
      </Paper>}

      <Alert severity="warning" sx={{ mt: 3 }}>
        <AlertTitle>Deprecated</AlertTitle>
        Address-based payments are supported here for initial funding and onboarding, but are otherwise deprecated because they rely on central global listening services by design rather than being transmitted directly between you and your counterparty.
      </Alert>
    </Box>
  )
}
