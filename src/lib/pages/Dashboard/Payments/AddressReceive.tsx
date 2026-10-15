import React, { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { Alert, Box, Button, CircularProgress, Stack, TextField, Typography } from '@mui/material'
import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined'
import RefreshOutlined from '@mui/icons-material/RefreshOutlined'
import { P2PKH, PrivateKey, PublicKey, Utils } from '@bsv/sdk'
import { QRCodeSVG } from 'qrcode.react'
import { WalletContext } from '../../../WalletContext'
import { beginUserWalletOperation } from '../../../services/httpBridgeSession'
import getBeefForTxid from '../../../utils/getBeefForTxid'
import { wocApiBase } from '../../../utils/woc'
import { wocFetch } from '../../../utils/RateLimitedFetch'
import { PAYMENT_PROTOCOL } from './nearbyProtocol'

const SUFFIX = Utils.toBase64(Utils.toArray('legacy', 'utf8'))
/** Preserve the original date derivation so existing desktop/mobile deposits remain recoverable. */
export const addressDate = (offset = 0) => { const date = new Date(); date.setDate(date.getDate() - offset); return date.toISOString().slice(0, 10) }
const prefixFor = (date: string) => Utils.toBase64(Utils.toArray(date, 'utf8'))

export default function AddressReceive({ identity, onSuccess }: { identity: string; onSuccess: (message: string) => void }) {
  const { managers, chain, adminOriginator, switchingNetwork } = useContext(WalletContext)
  const wallet = managers.permissionsManager
  const storageKey = `payment-address-dates-v1:${identity}:${chain}`
  const [date, setDate] = useState(addressDate())
  const [address, setAddress] = useState('')
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(false)
  const [checked, setChecked] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const inFlight = useRef(false)
  const mounted = useRef(true)
  const derive = useCallback(async (value: string) => {
    if (!wallet) throw new Error('Unlock your wallet to receive payments.')
    const { publicKey } = await wallet.getPublicKey({ protocolID: PAYMENT_PROTOCOL, keyID: `${prefixFor(value)} ${SUFFIX}`, counterparty: 'anyone', forSelf: true }, adminOriginator)
    return PublicKey.fromString(publicKey).toAddress(chain === 'main' ? 'mainnet' : 'testnet')
  }, [wallet, chain, adminOriginator])
  useEffect(() => {
    let alive = true
    setAddress(''); setLoading(true); setError(''); setChecked(false)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > addressDate()) { setError('Choose today or an earlier date.'); setLoading(false); return }
    derive(date).then(value => {
      if (!alive) return
      // Persist before displaying an address. A payer can use an old QR months later.
      const dates = JSON.parse(localStorage.getItem(storageKey) || '[]')
      if (!Array.isArray(dates)) throw new Error('The address history could not be read.')
      localStorage.setItem(storageKey, JSON.stringify([...new Set([...dates.filter((item: unknown) => typeof item === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item)), date])]))
      setAddress(value)
    }).catch(error => { if (alive) setError((error as Error).message) }).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [date, derive, storageKey])
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  const check = useCallback(async (manual = false) => {
    if (!wallet || switchingNetwork || inFlight.current) return
    inFlight.current = true; setChecking(true)
    if (manual) setError('')
    let release: (() => void) | undefined
    try {
      release = beginUserWalletOperation()
      const remembered = JSON.parse(localStorage.getItem(storageKey) || '[]')
      const dates = [...new Set([date, ...Array.from({ length: 4 }, (_, i) => addressDate(i)), ...(Array.isArray(remembered) ? remembered : [])])] as string[]
      let count = 0
      for (const value of dates) {
        if (!mounted.current) return
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) continue
        const paymentAddress = await derive(value)
        const response = await wocFetch.fetch(`${wocApiBase(chain)}/address/${paymentAddress}/unspent/all`)
        if (!response.ok) throw new Error(`The address service could not check payments (${response.status}). Try again shortly.`)
        const result = await response.json()
        if (!Array.isArray(result.result)) throw new Error('The address service returned an unexpected response.')
        const actions = await wallet.listActions({ labels: [paymentAddress], labelQueryMode: 'all', includeOutputs: true, limit: 1000 }, adminOriginator)
        const recorded = new Set(actions.actions.flatMap(action => (action.outputs || []).map(output => `${action.txid}.${output.outputIndex}`)))
        const utxos = result.result.filter((output: any) => output.isSpentInMempoolTx === false && /^[a-f0-9]{64}$/i.test(output.tx_hash) && Number.isSafeInteger(output.tx_pos) && output.tx_pos >= 0 && !recorded.has(`${output.tx_hash}.${output.tx_pos}`))
        for (const txid of [...new Set(utxos.map((output: any) => output.tx_hash))] as string[]) {
          const beef = await getBeefForTxid(txid, chain)
          const tx = beef.findAtomicTransaction(txid)
          if (!tx) throw new Error('The transaction proof did not contain this payment.')
          const relevant = utxos.filter((output: any) => output.tx_hash === txid)
          const expectedScript = new P2PKH().lock(paymentAddress).toHex()
          if (relevant.some((output: any) => tx.outputs[output.tx_pos]?.lockingScript.toHex() !== expectedScript || tx.outputs[output.tx_pos]?.satoshis !== output.value)) throw new Error('The address service returned an inconsistent payment.')
          const accepted = await wallet.internalizeAction({ tx: tx.toAtomicBEEF(), description: 'Received BSV at address', outputs: relevant.map((output: any) => ({ outputIndex: output.tx_pos, protocol: 'wallet payment' as const, paymentRemittance: { senderIdentityKey: new PrivateKey(1).toPublicKey().toString(), derivationPrefix: prefixFor(value), derivationSuffix: SUFFIX } })), labels: ['legacy', 'inbound', paymentAddress, `ts:${Date.now()}`] }, adminOriginator)
          if (!accepted.accepted) throw new Error('The wallet could not accept this payment. Try checking again.')
          count++
        }
      }
      if (!mounted.current) return
      setChecked(true)
      if (count) { window.dispatchEvent(new CustomEvent('balance-changed')); onSuccess(`Received ${count} address payment${count === 1 ? '' : 's'}.`) }
    } catch (error) { if (mounted.current) setError((error as Error).message || 'Payments could not be checked.') } finally { release?.(); inFlight.current = false; if (mounted.current) setChecking(false) }
  }, [wallet, switchingNetwork, storageKey, date, derive, chain, adminOriginator, onSuccess])
  useEffect(() => { if (!address) return; void check(); const timer = setInterval(() => { if (!document.hidden) void check() }, 30_000); return () => clearInterval(timer) }, [address, check])

  return <Stack spacing={2.5}>
    <Box><Typography variant="h6" sx={{ fontWeight: 700 }}>Receive from any BSV wallet</Typography><Typography color="text.secondary" variant="body2" sx={{ mt: .5 }}>Share this address. Incoming funds are checked and added to your wallet automatically while this screen is open.</Typography></Box>
    {error && <Alert severity="error">{error}</Alert>}
    <Box sx={{ textAlign: 'center', py: 2 }}>{loading ? <CircularProgress size={32} /> : address && <Box sx={{ display: 'inline-flex', p: 2, bgcolor: '#fff', border: '1px solid', borderColor: 'divider', borderRadius: 3 }}><QRCodeSVG value={address} size={220} level="M" marginSize={1} /></Box>}</Box>
    {address && <Box sx={{ p: 2, bgcolor: 'action.hover', borderRadius: 2 }}><Typography sx={{ fontFamily: 'monospace', wordBreak: 'break-all', textAlign: 'center', fontSize: 13 }}>{address}</Typography><Button fullWidth startIcon={<ContentCopyOutlined />} onClick={async () => { try { await navigator.clipboard.writeText(address); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { setError('Copy failed. Select the address above and copy it.') } }}>{copied ? 'Copied' : 'Copy address'}</Button></Box>}
    <Button variant="outlined" startIcon={checking ? <CircularProgress size={17} /> : <RefreshOutlined />} onClick={() => void check(true)} disabled={checking || loading || switchingNetwork}>{checking ? 'Checking for payments…' : 'Check for payments'}</Button>
    {checked && !checking && <Typography variant="body2" color="text.secondary" textAlign="center">All shown and previously shared addresses have been checked.</Typography>}
    <TextField type="date" size="small" label="Recover a payment sent to an older address" value={date} onChange={event => setDate(event.target.value)} InputLabelProps={{ shrink: true }} inputProps={{ max: addressDate(), min: '2009-01-03' }} helperText="Choose the date you originally shared the address." />
  </Stack>
}
