import { useState, useContext, useEffect } from 'react'
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
  Alert,
  Link,
  IconButton,
} from '@mui/material'
import CheckIcon from '@mui/icons-material/Check'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import { QRCodeSVG } from 'qrcode.react'
import { PublicKey, P2PKH, Beef, Utils, Script, WalletClient, WalletProtocol, InternalizeActionArgs, InternalizeOutput, PrivateKey } from '@bsv/sdk'
import getBeefForTxid from '../../../utils/getBeefForTxid'
import { wocFetch } from '../../../utils/RateLimitedFetch'
import { toast } from 'react-toastify'

const brc29ProtocolID: WalletProtocol = [2, '3241645161d8']

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

export default function Payments() {
  const { managers, network, adminOriginator } = useContext(WalletContext)
  const [paymentAddress, setPaymentAddress] = useState<string | null>(null)
  const [balance, setBalance] = useState<number>(-1)
  const [recipientAddress, setRecipientAddress] = useState<string>('')
  const [amount, setAmount] = useState<string>('')
  const [transactions, setTransactions] = useState<TransactionRecord[]>([])
  const [isImporting, setIsImporting] = useState<boolean>(false)
  const [isLoadingAddress, setIsLoadingAddress] = useState<boolean>(false)
  const [isSending, setIsSending] = useState<boolean>(false)
  const [copied, setCopied] = useState<boolean>(false)
  const [daysOffset, setDaysOffset] = useState<number>(0)
  const [derivationPrefix, setDerivationPrefix] = useState<string>(Utils.toBase64(Utils.toArray(getCurrentDate(0), 'utf8')))
  const derivationSuffix = Utils.toBase64(Utils.toArray('legacy', 'utf8'))
  const wallet = managers?.walletManager ? new WalletClient(managers.walletManager, adminOriginator) : null

  if (!wallet) {
    return <></>
  }

  const handleCopy = (data: string) => {
    navigator.clipboard.writeText(data)
    setCopied(true)
    setTimeout(() => {
      setCopied(false)
    }, 2000)
  }

  // Derive payment address from wallet public key
  const getPaymentAddress = async (derivationPrefix: string): Promise<string> => {
    if (!wallet) {
      throw new Error('Wallet not initialized')
    }

    const { publicKey } = await wallet.getPublicKey({
      protocolID: brc29ProtocolID,
      keyID: derivationPrefix + ' ' + derivationSuffix, // date rounded to nearest day ISO format with "legacy" suffix
      counterparty: 'anyone',
      forSelf: true,
    })
    console.log({ keyID: derivationPrefix + ' ' + derivationSuffix, counterparty: 'anyone', forSelf: true })
    return PublicKey.fromString(publicKey).toAddress(network === 'mainnet' ? 'mainnet' : 'testnet')
  }

  // Fetch UTXOs for address from WhatsOnChain (rate-limited)
  const getUtxosForAddress = async (address: string): Promise<Utxo[]> => {
    const response = await wocFetch.fetch(
      `https://api.whatsonchain.com/v1/bsv/${network === 'mainnet' ? 'main' : 'test'}/address/${address}/unspent/all`
    )
    const rp: WoCAddressUnspentAll = await response.json()
    const utxos: Utxo[] = rp.result
      .filter((r) => r.isSpentInMempoolTx === false)
      .map((r) => ({ txid: r.tx_hash, vout: r.tx_pos, satoshis: r.value }))
    return utxos
  }

  // Get internalized UTXOs from transaction history
  const getInternalizedUtxos = async (): Promise<Set<string>> => {
    if (!wallet) return new Set()

    try {
      const response = await wallet.listActions({
        labels: ['bsvdesktop', 'inbound'],
        labelQueryMode: 'all',
        includeOutputs: true,
        limit: 1000,
      })

      const internalizedSet = new Set<string>()

      // For each internalized action, track which UTXOs were spent
      for (const action of response.actions) {
        // The action represents receiving funds, but we need to track which
        // UTXOs were internalized. For inbound transactions, we track the
        // source UTXOs that were imported
        if (action.inputs) {
          for (const input of action.inputs) {
            if (input.sourceOutpoint) {
              // sourceOutpoint format is "txid.vout"
              internalizedSet.add(input.sourceOutpoint)
            }
          }
        }
      }

      return internalizedSet
    } catch (error) {
      console.error('Error fetching internalized UTXOs:', error)
      return new Set()
    }
  }

  // Fetch BSV balance for address
  const fetchBSVBalance = async (address: string): Promise<number> => {
    const allUtxos = await getUtxosForAddress(address)
    const internalizedUtxos = await getInternalizedUtxos()

    // Filter out UTXOs that have already been internalized
    const availableUtxos = allUtxos.filter(utxo => {
      const outpoint = `${utxo.txid}.${utxo.vout}`
      return !internalizedUtxos.has(outpoint)
    })

    const balanceInSatoshis = availableUtxos.reduce((acc, r) => acc + r.satoshis, 0)
    return balanceInSatoshis / 100000000
  }

  // Send BSV to recipient address
  const sendBSV = async (to: string, amount: number): Promise<string | undefined> => {
    if (!wallet) {
      throw new Error('Wallet not initialized')
    }

    // Basic network vs. address check
    if (network === 'mainnet' && !to.startsWith('1')) {
      toast.error('You are on mainnet but the recipient address does not look like a mainnet address (starting with 1)!')
      return
    }

    const lockingScript = new P2PKH().lock(to).toHex()
    const { txid } = await wallet.createAction({
      description: 'Send BSV to address',
      outputs: [
        {
          lockingScript,
          satoshis: Math.round(amount * 100000000),
          outputDescription: 'BSV for recipient address',
        },
      ],
      labels: ['legacy', 'outbound'],
    })
    return txid
  }

  // Import funds from payment address into wallet
  const handleImportFunds = async (paymentAddress, derivationPrefix) => {
    if (!paymentAddress || balance < 0) {
      toast.error('Get your address and balance first!')
      return
    }
    if (balance === 0) {
      toast.error('No money to import!')
      return
    }

    if (!wallet) {
      toast.error('Wallet not initialized')
      return
    }

    setIsImporting(true)

    let reference: string | undefined = undefined
    try {
      const allUtxos = await getUtxosForAddress(paymentAddress)
      const internalizedUtxos = await getInternalizedUtxos()

      // Filter out UTXOs that have already been internalized
      const utxos = allUtxos.filter(utxo => {
        const outpoint = `${utxo.txid}.${utxo.vout}`
        return !internalizedUtxos.has(outpoint)
      })

      if (utxos.length === 0) {
        toast.info('All available funds have already been imported')
        setIsImporting(false)
        return
      }

      const outpoints: string[] = utxos.map((x) => `${x.txid}.${x.vout}`)
      const inputs = outpoints.map((outpoint) => ({
        outpoint,
        inputDescription: 'Redeem from Legacy Payments',
        unlockingScriptLength: 108,
      }))

      // Merge BEEF for the inputs
      const beef = new Beef()
      for (let i = 0; i < inputs.length; i++) {
        const txid = inputs[i].outpoint.split('.')[0]
        if (!beef.findTxid(txid)) {
          const b = await getBeefForTxid(txid, network === 'mainnet' ? 'main' : 'test')
          beef.mergeBeef(b)
        }
      }

      console.log({ beef: beef.toLogString() })

      // Verify the derived address matches
      const { publicKey: derivedPubKey } = await wallet.getPublicKey({
        protocolID: brc29ProtocolID,
        keyID: derivationPrefix + ' ' + derivationSuffix,
        counterparty: new PrivateKey(1).toPublicKey().toString(),
        forSelf: true,
      })
      const derivedAddress = PublicKey.fromString(derivedPubKey).toAddress(network === 'mainnet' ? 'mainnet' : 'testnet')
      console.log('Address verification:', {
        paymentAddress,
        derivedAddress,
        match: paymentAddress === derivedAddress,
        keyID: derivationPrefix + ' ' + derivationSuffix
      })

      const txs = beef.txs.map((beefTx) => {
        const tx = beef.findAtomicTransaction(beefTx.txid)
        const relevantUtxos = utxos.filter(o => o.txid === beefTx.txid)
        if (relevantUtxos.length === 0) {
          return null
        }
        console.log({
          txid: tx.id('hex'),
          paymentAddress,
          derivationPrefix,
          derivationSuffix,
          relevantUtxos,
          outputs: relevantUtxos.map((o, i) => ({
            index: o.vout,
            lockingScript: tx.outputs[o.vout].lockingScript.toHex()
          }))
        })
        const outputs: InternalizeOutput[] = relevantUtxos.map(o => ({
          outputIndex: o.vout,
          protocol: 'wallet payment',
          paymentRemittance: {
            senderIdentityKey: new PrivateKey(1).toPublicKey().toString(),
            derivationPrefix,
            derivationSuffix
          }
        }))
        const args: InternalizeActionArgs = {
          tx: tx.toAtomicBEEF(),
          description: 'BSV Desktop Payment',
          outputs,
          labels: ['legacy', 'inbound', 'bsvdesktop'],
        }
        return args
      }).filter((t) => t !== null)

      console.log({ txs })

      // internalize
      for (const t of txs) {
        try {
          console.log('Attempting to internalize:', {
            description: t.description,
            outputCount: t.outputs.length,
            outputs: t.outputs.map(o => ({
              outputIndex: o.outputIndex,
              protocol: o.protocol,
              paymentRemittance: o.paymentRemittance
            }))
          })
          console.log('paymentRemittance senderIdentityKey:', t.outputs[0].paymentRemittance?.senderIdentityKey)
          const response = await wallet.internalizeAction(t)
          console.log('Internalize response:', response)
          if (response?.accepted) {
            toast.success('Payment accepted')
          } else {
            toast.error('Payment was rejected')
          }
        } catch (error: any) {
          console.error('Internalize error:', error)
          console.error('Full error object:', JSON.stringify(error, Object.getOwnPropertyNames(error), 2))
          toast.error(`Payment failed: ${error?.message || 'unknown error'}`)
        }
      }

      // Refresh the balance to show remaining funds (if any)
      if (paymentAddress) {
        const newBalance = await fetchBSVBalance(paymentAddress)
        setBalance(newBalance)
      }

      // Refresh transaction history
      await getPastTransactions()
    } catch (e: any) {
      console.error(e)
      // Abort in case something goes wrong
      if (reference) {
        await wallet.abortAction({ reference })
      }
      const message = `Import failed: ${e.message || 'unknown error'}`
      toast.error(message)
    } finally {
      setIsImporting(false)
    }
  }

  // Get past transactions from wallet
  const getPastTransactions = async () => {
    if (!wallet) return

    try {
      const response = await wallet.listActions({
        labels: ['bsvdesktop', 'legacy'],
        labelQueryMode: 'any', 
        includeOutputLockingScripts: true,
        includeOutputs: true,
        limit: 10,
      })

      setTransactions((txs) => {
        const set = new Set(txs.map((tx) => tx.txid))
        const pastTxs = response.actions.map((action) => {
          let address = ''
          // Try to find BSV recipient output first
          try {
            address = Utils.toBase58Check(
              Script.fromHex(action.outputs![0].lockingScript!).chunks[2].data as number[]
            )
          } catch (error) {
            console.log({ error })
            address = ''
          }

          return {
            txid: action.txid,
            to: address || 'unknown',
            amount: action.satoshis / 100000000,
          }
        })
        const newTxs = pastTxs.filter((tx) => tx.amount !== 0 && !set.has(tx.txid))
        return [...txs, ...newTxs]
      })
    } catch (error) {
      console.error('Error fetching transactions:', error)
    }
  }

  // Handle showing address
  const handleViewAddress = async (offset: number = 0) => {
    setIsLoadingAddress(true)
    try {
      const prefix = Utils.toBase64(Utils.toArray(getCurrentDate(offset), 'utf8'))
      const address = await getPaymentAddress(prefix)
      setDaysOffset(offset)
      setDerivationPrefix(prefix)
      setPaymentAddress(address)
    } catch (error: any) {
      toast.error(`Error generating address: ${error.message || 'unknown error'}`)
    } finally {
      setIsLoadingAddress(false)
    }
  }

  // Handle getting balance
  const handleGetBalance = async () => {
    if (paymentAddress) {
      try {
        const fetchedBalance = await fetchBSVBalance(paymentAddress)
        setBalance(fetchedBalance)
      } catch (error: any) {
        toast.error(`Error fetching balance: ${error.message || 'unknown error'}`)
      }
    } else {
      toast.error('Get your address first!')
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

    setIsSending(true)
    try {
      const txid = await sendBSV(recipientAddress, amt)
      if (txid) {
        toast.success(`Successfully sent ${amt} BSV to ${recipientAddress}`)

        // Record the transaction locally
        setTransactions((prev) => [
          ...prev,
          {
            txid,
            to: recipientAddress,
            amount: amt,
          },
        ])
        setRecipientAddress('')
        setAmount('')
      }
    } catch (error: any) {
      toast.error(`Error sending BSV: ${error.message || 'unknown error'}`)
    } finally {
      setIsSending(false)
    }
  }

  function dateChange (offset: number) {
    setBalance(-1)
    handleViewAddress(offset)
  }

  // Load transactions on mount
  useEffect(() => {
    getPastTransactions()
  }, [])

  return (
    <Box sx={{ p: 3, maxWidth: 800, mx: 'auto' }}>
      <Typography variant="h4" gutterBottom sx={{ fontWeight: 600, color: 'primary.main' }}>
        Legacy Bridge
      </Typography>
      <Typography variant="body1" color="textSecondary" sx={{ mb: 3 }}>
        Address-based BSV payments to and from external wallets.
      </Typography>

      <Alert severity="info" sx={{ mb: 3 }}>
        This feature serves as a bridge to and from legacy wallets, may be removed in future, and relies on free WhatsOnChain services, which may cease without warning.
      </Alert>

      {/* Receive Section */}
      <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 500 }}>
            Receive
          </Typography>
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
        <Divider sx={{ mb: 2 }} />

        <Alert severity="warning" sx={{ mb: 2 }}>
          A unique payment address is generated for each day as a privacy measure. Use the date controls above to view addresses
          from previous days if you need to check for payments sent to an older address.
        </Alert>

        {isLoadingAddress ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
            <CircularProgress />
          </Box>
        ) : !paymentAddress ? (
          <Button variant="contained" onClick={() => handleViewAddress()} fullWidth>
            Show Payment Address
          </Button>
        ) : (
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
                <QRCodeSVG value={paymentAddress || ''} size={200} bgColor="#ffffff" fgColor="#000000" />
              </Box>
            </Box>

            <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
              <Button variant="outlined" onClick={handleGetBalance} fullWidth>
                Check Balance
              </Button>
              <Button
                variant="contained"
                onClick={() => handleImportFunds(paymentAddress, derivationPrefix)}
                disabled={isImporting || balance <= 0}
                fullWidth
              >
                {isImporting ? <CircularProgress size={24} /> : 'Import Funds'}
              </Button>
            </Box>

            <Typography variant="body1" color="textPrimary" sx={{ textAlign: 'center' }}>
              Available Balance:{' '}
              <strong>{balance === -1 ? 'Not checked yet' : `${balance} BSV`}</strong>
            </Typography>
          </>
        )}
      </Paper>

      {/* Send Section */}
      <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom sx={{ fontWeight: 500 }}>
          Send
        </Typography>
        <Divider sx={{ mb: 2 }} />

        <TextField
          fullWidth
          label="Recipient Address"
          placeholder="Enter BSV address"
          value={recipientAddress}
          onChange={(e) => setRecipientAddress(e.target.value)}
          sx={{ mb: 2 }}
        />
        <TextField
          fullWidth
          label="Amount (BSV)"
          placeholder="0.00000000"
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          sx={{ mb: 2 }}
        />
        <Button
          variant="contained"
          onClick={handleSendBSV}
          disabled={isSending || !recipientAddress || !amount}
          fullWidth
        >
          {isSending ? <CircularProgress size={24} /> : 'Send BSV'}
        </Button>
      </Paper>

      {/* Transaction History Section */}
      <Paper elevation={2} sx={{ p: 3 }}>
        <Typography variant="h6" gutterBottom sx={{ fontWeight: 500 }}>
          Transaction History
        </Typography>
        <Divider sx={{ mb: 2 }} />

        <Button variant="outlined" onClick={getPastTransactions} fullWidth sx={{ mb: 2 }}>
          Refresh Transactions
        </Button>

        {transactions.length === 0 ? (
          <Typography variant="body2" color="textSecondary" sx={{ textAlign: 'center', py: 3 }}>
            No transactions yet...
          </Typography>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {transactions.map((tx, index) => (
              <Card key={index} variant="outlined">
                <CardContent>
                  <Typography variant="body2" color="textSecondary">
                    <strong>TXID:</strong>{' '}
                    <Link
                      href={`https://whatsonchain.com/tx/${tx.txid}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {tx.txid}
                    </Link>
                  </Typography>
                  <Typography variant="body2" color="textSecondary">
                    <strong>To:</strong> {tx.to}
                  </Typography>
                  <Typography variant="body2" color="textSecondary">
                    <strong>Amount:</strong> {tx.amount} BSV
                  </Typography>
                </CardContent>
              </Card>
            ))}
          </Box>
        )}
      </Paper>
    </Box>
  )
}
