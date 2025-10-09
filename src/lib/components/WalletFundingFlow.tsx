import React, { useState, useEffect, useCallback } from 'react'
import {
  Box,
  Typography,
  Button,
  CircularProgress,
  Alert,
  IconButton,
  Tooltip,
  Paper
} from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import CheckIcon from '@mui/icons-material/Check'
import RefreshIcon from '@mui/icons-material/Refresh'
import { QRCodeSVG } from 'qrcode.react'
import {
  PublicKey,
  WalletInterface,
  WalletProtocol,
  Beef,
  InternalizeActionArgs,
  InternalizeOutput,
  PrivateKey,
  Utils
} from '@bsv/sdk'
import { toast } from 'react-toastify'
import getBeefForTxid from '../utils/getBeefForTxid'
import { wocFetch } from '../utils/RateLimitedFetch'

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

interface WalletFundingFlowProps {
  wallet: WalletInterface
  adminOriginator: string
  network: 'mainnet' | 'testnet'
  onFundingComplete: () => void
}

const WalletFundingFlow: React.FC<WalletFundingFlowProps> = ({
  wallet,
  adminOriginator,
  network,
  onFundingComplete
}) => {
  const [paymentAddress, setPaymentAddress] = useState<string | null>(null)
  const [derivationPrefix, setDerivationPrefix] = useState<string>('')
  const [isGeneratingAddress, setIsGeneratingAddress] = useState(false)
  const [isCheckingPayment, setIsCheckingPayment] = useState(false)
  const [isProcessingPayment, setIsProcessingPayment] = useState(false)
  const [copied, setCopied] = useState(false)
  const [balance, setBalance] = useState<number>(0)
  const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(null)

  const derivationSuffix = Utils.toBase64(Utils.toArray('wallet-funding', 'utf8'))

  // Generate payment address from wallet identity key
  const generatePaymentAddress = useCallback(async () => {
    setIsGeneratingAddress(true)
    try {
      // Use a fixed derivation prefix for wallet funding
      const prefix = Utils.toBase64(Utils.toArray('initial-funding', 'utf8'))
      setDerivationPrefix(prefix)

      const { publicKey } = await wallet.getPublicKey({
        protocolID: brc29ProtocolID,
        keyID: prefix + ' ' + derivationSuffix,
        counterparty: 'anyone',
        forSelf: true
      }, adminOriginator)

      const address = PublicKey.fromString(publicKey).toAddress(network)
      setPaymentAddress(address)
      toast.success('Payment address generated')
    } catch (error: any) {
      console.error('Error generating payment address:', error)
      toast.error(`Failed to generate address: ${error.message || 'unknown error'}`)
    } finally {
      setIsGeneratingAddress(false)
    }
  }, [wallet, adminOriginator, network, derivationSuffix])

  // Fetch UTXOs for the payment address
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

  // Check for payment on the address
  const checkForPayment = useCallback(async () => {
    if (!paymentAddress) return

    setIsCheckingPayment(true)
    try {
      const utxos = await getUtxosForAddress(paymentAddress)
      const totalBalance = utxos.reduce((acc, utxo) => acc + utxo.satoshis, 0)
      setBalance(totalBalance)

      if (totalBalance > 0) {
        toast.info(`Payment detected: ${totalBalance / 100000000} BSV`)
      }
    } catch (error: any) {
      console.error('Error checking for payment:', error)
      toast.error(`Failed to check payment: ${error.message || 'unknown error'}`)
    } finally {
      setIsCheckingPayment(false)
    }
  }, [paymentAddress, network])

  // Process the payment and internalize
  const processPayment = useCallback(async () => {
    if (!paymentAddress || balance === 0) {
      toast.error('No payment to process')
      return
    }

    setIsProcessingPayment(true)

    try {
      const utxos = await getUtxosForAddress(paymentAddress)

      if (utxos.length === 0) {
        toast.error('No UTXOs found')
        setIsProcessingPayment(false)
        return
      }

      const txids = Array.from(new Set(utxos.map(o => o.txid)))

      // Merge BEEF for all inputs
      const beef = new Beef()
      for (const txid of txids) {
        const b = await getBeefForTxid(txid, network === 'mainnet' ? 'main' : 'test')
        beef.mergeBeef(b)
      }

      console.log({ beef: beef.toLogString() })

      // Verify the derived address matches
      const { publicKey: derivedPubKey } = await wallet.getPublicKey({
        protocolID: brc29ProtocolID,
        keyID: derivationPrefix + ' ' + derivationSuffix,
        counterparty: new PrivateKey(1).toPublicKey().toString(),
        forSelf: true
      }, adminOriginator)

      const derivedAddress = PublicKey.fromString(derivedPubKey).toAddress(network)
      console.log('Address verification:', {
        paymentAddress,
        derivedAddress,
        match: paymentAddress === derivedAddress,
        keyID: derivationPrefix + ' ' + derivationSuffix
      })

      // Create InternalizeActionArgs for each transaction
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
          outputs: relevantUtxos.map((o) => ({
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
          description: 'Wallet Initial Funding',
          outputs,
          labels: ['wallet-funding', 'inbound'],
        }

        return args
      }).filter((t) => t !== null)

      console.log({ txs })

      // Internalize each transaction
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

          const response = await wallet.internalizeAction(t, adminOriginator)
          console.log('Internalize response:', response)

          if (response?.accepted) {
            toast.success('Payment accepted and wallet funded!')
          } else {
            toast.error('Payment was rejected')
          }
        } catch (error: any) {
          console.error('Internalize error:', error)
          console.error('Full error object:', JSON.stringify(error, Object.getOwnPropertyNames(error), 2))
          toast.error(`Payment failed: ${error?.message || 'unknown error'}`)
          throw error
        }
      }

      // Funding complete
      onFundingComplete()
    } catch (e: any) {
      console.error(e)
      toast.error(`Failed to process payment: ${e.message || 'unknown error'}`)
    } finally {
      setIsProcessingPayment(false)
    }
  }, [paymentAddress, balance, wallet, adminOriginator, network, derivationPrefix, derivationSuffix, onFundingComplete])

  // Auto-generate address on mount
  useEffect(() => {
    if (!paymentAddress) {
      generatePaymentAddress()
    }
  }, [])

  // Start polling when address is available
  useEffect(() => {
    if (paymentAddress && !pollingInterval) {
      // Check immediately
      checkForPayment()

      // Then poll every 10 seconds
      const interval = setInterval(() => {
        checkForPayment()
      }, 10000)

      setPollingInterval(interval)

      return () => {
        clearInterval(interval)
      }
    }
  }, [paymentAddress, checkForPayment])

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingInterval) {
        clearInterval(pollingInterval)
      }
    }
  }, [pollingInterval])

  const handleCopy = () => {
    if (paymentAddress) {
      navigator.clipboard.writeText(paymentAddress)
      setCopied(true)
      setTimeout(() => {
        setCopied(false)
      }, 2000)
      toast.success('Address copied to clipboard')
    }
  }

  return (
    <Box>
      <Alert severity="info" sx={{ mb: 3 }}>
        Send BSV to the address below to fund your wallet. The payment will be detected automatically.
      </Alert>

      {isGeneratingAddress ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
          <CircularProgress />
        </Box>
      ) : paymentAddress ? (
        <>
          <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
            <strong>Your Payment Address:</strong>
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
              onClick={handleCopy}
              disabled={copied}
              sx={{ ml: 1 }}
            >
              {copied ? <CheckIcon /> : <ContentCopyIcon fontSize="small" />}
            </IconButton>
          </Box>

          <Box sx={{ display: 'flex', justifyContent: 'center', mb: 3 }}>
            <Paper elevation={0} sx={{ p: 1, backgroundColor: '#ffffff', display: 'inline-block' }}>
              <QRCodeSVG value={paymentAddress} size={200} bgColor="#ffffff" fgColor="#000000" />
            </Paper>
          </Box>

          <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
            <Button
              variant="outlined"
              onClick={checkForPayment}
              disabled={isCheckingPayment}
              startIcon={isCheckingPayment ? <CircularProgress size={20} /> : <RefreshIcon />}
              fullWidth
            >
              Check for Payment
            </Button>
            <Button
              variant="contained"
              onClick={processPayment}
              disabled={isProcessingPayment || balance === 0}
              fullWidth
            >
              {isProcessingPayment ? <CircularProgress size={24} /> : 'Complete Funding'}
            </Button>
          </Box>

          <Typography variant="body1" color="textPrimary" sx={{ textAlign: 'center' }}>
            Detected Balance: <strong>{balance === 0 ? 'Waiting for payment...' : `${balance / 100000000} BSV`}</strong>
          </Typography>

          {balance > 0 && (
            <Alert severity="success" sx={{ mt: 2 }}>
              Payment detected! Click "Complete Funding" to finalize.
            </Alert>
          )}
        </>
      ) : (
        <Alert severity="error">
          Failed to generate payment address. Please try again.
        </Alert>
      )}
    </Box>
  )
}

export default WalletFundingFlow
