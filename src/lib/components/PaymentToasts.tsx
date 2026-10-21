/**
 * App-wide toasts for payments that arrive: live (direct-payment-received, from DirectPayManager
 * and the face-to-face code exchange) and from the message box (messagebox-payment-received, from
 * MessageBoxAutoReceiver). The first arrival shows at once; arrivals within 3 s fold into that
 * toast as a summary (see paymentToastQueue.ts). A
 * direct payment only kept on this device, not yet in the wallet, gets its own warning instead,
 * never a plain success (final review D6).
 */
import { useContext, useEffect, useMemo, useRef } from 'react'
import { toast, type Id } from 'react-toastify'
import { WalletContext } from '../WalletContext'
import { createToastQueue } from '../utils/paymentToastQueue'
import { identityLabel } from '../utils/identityNames'
import { formatSatoshis } from './AmountDisplay/amountFormatHelpers'
import { validAmount } from '../pages/Dashboard/Payments/paymentProtocol'
import { receivedNotice } from '../pages/Dashboard/Payments/directReceipts'

/** How long a toast waits for the sender's name (cached after the first lookup) before using the short key. */
const NAME_WAIT_MS = 300

export default function PaymentToasts() {
  const { managers, adminOriginator, settings } = useContext(WalletContext)
  const latest = useRef({ wallet: managers.permissionsManager, adminOriginator, currency: '' })
  latest.current = { wallet: managers.permissionsManager, adminOriginator, currency: String(settings?.currency || '').toUpperCase() }
  const queue = useMemo(() => createToastQueue((text, replace) => {
    if (replace !== undefined && toast.isActive(replace as Id)) { toast.update(replace as Id, { render: text, type: 'success', autoClose: 5000 }); return replace }
    return toast.success(text, { autoClose: 5000 })
  }, 3000, sats => formatSatoshis(sats, false, true, null, latest.current.currency)), [])

  useEffect(() => {
    const arrival = (live: boolean) => (event: Event) => {
      const detail = ((event as CustomEvent).detail ?? {}) as { amount?: unknown; sender?: unknown; status?: unknown }
      if (live && detail.status !== undefined && detail.status !== 'accepted') { toast.warning(receivedNotice(detail).text); return }
      if (!validAmount(detail.amount)) return
      const amount = detail.amount
      const sender = typeof detail.sender === 'string' ? detail.sender : ''
      const { wallet, adminOriginator: originator } = latest.current
      void (sender ? identityLabel(wallet, originator, sender, NAME_WAIT_MS) : Promise.resolve('someone')).then(from => queue.push({ amount, from, live }))
    }
    const onLive = arrival(true), onMessageBox = arrival(false)
    window.addEventListener('direct-payment-received', onLive)
    window.addEventListener('messagebox-payment-received', onMessageBox)
    return () => { window.removeEventListener('direct-payment-received', onLive); window.removeEventListener('messagebox-payment-received', onMessageBox); queue.flush() }
  }, [queue])

  return null
}
