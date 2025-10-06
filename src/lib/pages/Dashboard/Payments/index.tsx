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
} from '@mui/material'
import { QRCodeSVG } from 'qrcode.react'
import { PublicKey, P2PKH, Transaction, Beef, Utils, Script } from '@bsv/sdk'
import Importer from '../../../utils/Importer'
import getBeefForTxid from '../../../utils/getBeefForTxid'
import { wocFetch } from '../../../utils/RateLimitedFetch'
import { toast } from 'react-toastify'

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

export default function Payments() {
  const { managers, network } = useContext(WalletContext)
  const [paymentAddress, setPaymentAddress] = useState<string | null>(null)
  const [balance, setBalance] = useState<number>(-1)
  const [recipientAddress, setRecipientAddress] = useState<string>('')
  const [amount, setAmount] = useState<string>('')
  const [transactions, setTransactions] = useState<TransactionRecord[]>([])
  const [isImporting, setIsImporting] = useState<boolean>(false)
  const [isLoadingAddress, setIsLoadingAddress] = useState<boolean>(false)
  const [isSending, setIsSending] = useState<boolean>(false)

  // Derive payment address from wallet public key
  const getPaymentAddress = async (): Promise<string> => {
    if (!managers?.walletManager) {
      throw new Error('Wallet not initialized')
    }

    const { publicKey } = await managers.walletManager.getPublicKey({
      protocolID: [1, 'legacy address'],
      keyID: new Date().toISOString().split('T')[0], // date rounded to nearest day
      counterparty: 'anyone',
      forSelf: true,
    })
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

  // Fetch BSV balance for address
  const fetchBSVBalance = async (address: string): Promise<number> => {
    const utxos = await getUtxosForAddress(address)
    const balanceInSatoshis = utxos.reduce((acc, r) => acc + r.satoshis, 0)
    return balanceInSatoshis / 100000000
  }

  // Send BSV to recipient address
  const sendBSV = async (to: string, amount: number): Promise<string | undefined> => {
    if (!managers?.walletManager) {
      throw new Error('Wallet not initialized')
    }

    // Basic network vs. address check
    if (network === 'mainnet' && !to.startsWith('1')) {
      toast.error('You are on mainnet but the recipient address does not look like a mainnet address (starting with 1)!')
      return
    }

    const lockingScript = new P2PKH().lock(to).toHex()
    const { txid } = await managers.walletManager.createAction({
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
  const handleImportFunds = async () => {
    if (!paymentAddress || balance < 0) {
      toast.error('Get your address and balance first!')
      return
    }
    if (balance === 0) {
      toast.error('No money to import!')
      return
    }

    if (!managers?.walletManager) {
      toast.error('Wallet not initialized')
      return
    }

    setIsImporting(true)

    let reference: string | undefined = undefined
    try {
      const utxos = await getUtxosForAddress(paymentAddress)

      const outpoints: string[] = utxos.map((x) => `${x.txid}.${x.vout}`)
      const inputs = outpoints.map((outpoint) => ({
        outpoint,
        inputDescription: 'Redeem from Legacy Payments',
        unlockingScriptLength: 108,
      }))

      // Merge BEEF for the inputs
      const inputBEEF = new Beef()
      for (let i = 0; i < inputs.length; i++) {
        const txid = inputs[i].outpoint.split('.')[0]
        if (!inputBEEF.findTxid(txid)) {
          const beef = await getBeefForTxid(txid, network === 'mainnet' ? 'main' : 'test')
          inputBEEF.mergeBeef(beef)
        }
      }

      // Create the action for spending from these inputs
      const { signableTransaction } = await managers.walletManager.createAction({
        inputBEEF: inputBEEF.toBinary(),
        inputs,
        description: 'Import from Legacy Payments',
        labels: ['legacy', 'inbound'],
      })

      reference = signableTransaction!.reference

      // Convert BEEF to a Transaction object
      const tx = Transaction.fromAtomicBEEF(signableTransaction!.tx)
      const importer = new Importer()
      const unlocker = importer.unlock(managers.walletManager)

      const signActionArgs = {
        reference,
        spends: {},
      }

      // Sign each input
      for (let i = 0; i < inputs.length; i++) {
        const script = await unlocker.sign(tx, i)
        signActionArgs.spends[i] = {
          unlockingScript: script.toHex(),
        }
      }

      // Broadcast signatures back to the wallet
      await managers.walletManager.signAction(signActionArgs)

      // Reset the local balance after successful import
      setBalance(0)
      toast.success('Funds successfully imported to your wallet!')

      // Refresh transaction history
      await getPastTransactions()
    } catch (e: any) {
      console.error(e)
      // Abort in case something goes wrong
      if (reference) {
        await managers.walletManager.abortAction({ reference })
      }
      const message = `Import failed: ${e.message || 'unknown error'}`
      toast.error(message)
    } finally {
      setIsImporting(false)
    }
  }

  // Get past transactions from wallet
  const getPastTransactions = async () => {
    if (!managers?.walletManager || !paymentAddress) return

    try {
      const response = await managers.walletManager.listActions({
        labels: ['legacy'],
        includeOutputLockingScripts: true,
        includeOutputs: true,
        limit: 100,
      })

      setTransactions((txs) => {
        const set = new Set(txs.map((tx) => tx.txid))
        const pastTxs = response.actions.map((action) => {
          let address = ''
          // Try to find BSV recipient output first
          let theOutput = action.outputs?.find((o) => o.outputDescription === 'BSV for recipient address')
          if (theOutput) {
            try {
              address = Utils.toBase58Check(
                Script.fromHex(theOutput!.lockingScript!).chunks[2].data as number[]
              )
            } catch (error) {
              console.log({ error })
              address = ''
            }
          } else {
            // Fallback to checking for payment address output
            if (action.description === 'Import from Legacy Payments') {
              address = paymentAddress
            } else {
              return { txid: '', to: '', amount: 0 }
            }
          }

          return {
            txid: action.txid,
            to: address,
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
  const handleViewAddress = async () => {
    setIsLoadingAddress(true)
    try {
      const address = await getPaymentAddress()
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

  // Load address on mount
  useEffect(() => {
    if (managers?.walletManager) {
      handleViewAddress()
    }
  }, [managers?.walletManager])

  return (
    <Box sx={{ p: 3, maxWidth: 800, mx: 'auto' }}>
      <Typography variant="h4" gutterBottom sx={{ fontWeight: 600, color: 'primary.main' }}>
        Legacy Payments
      </Typography>
      <Typography variant="body1" color="textSecondary" sx={{ mb: 3 }}>
        Address-based BSV payments to and from your BRC-100 wallet
      </Typography>

      <Alert severity="info" sx={{ mb: 3 }}>
        This feature allows you to receive BSV at a legacy P2PKH address and import it into your wallet,
        or send BSV from your wallet to any legacy address.
      </Alert>

      {/* Receive Section */}
      <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom sx={{ fontWeight: 500 }}>
          Receive
        </Typography>
        <Divider sx={{ mb: 2 }} />

        {isLoadingAddress ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
            <CircularProgress />
          </Box>
        ) : !paymentAddress ? (
          <Button variant="contained" onClick={handleViewAddress} fullWidth>
            Show Payment Address
          </Button>
        ) : (
          <>
            <Typography variant="body2" color="textSecondary" gutterBottom>
              Your Payment Address:
            </Typography>
            <Paper
              variant="outlined"
              sx={{
                p: 2,
                mb: 2,
                backgroundColor: 'grey.50',
                wordBreak: 'break-all',
                fontFamily: 'monospace',
                fontSize: '0.9rem',
              }}
            >
              {paymentAddress}
            </Paper>

            <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
              <QRCodeSVG value={paymentAddress || ''} size={200} bgColor="#ffffff" fgColor="#1976d2" />
            </Box>

            <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
              <Button variant="outlined" onClick={handleGetBalance} fullWidth>
                Check Balance
              </Button>
              <Button
                variant="contained"
                onClick={handleImportFunds}
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
