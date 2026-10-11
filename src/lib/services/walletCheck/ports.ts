/**
 * Real ports for the Troubleshoot wallet check. Each port checks one area and
 * repairs it automatically. Dependencies are injected so the logic is testable.
 */
import { DEFAULT_MESSAGE_BOX_URL } from '../../networkConfig'
import type { WalletService } from '../WalletService'
import { getWalletBackupTime } from './backupMarker'
import type { StepOutcome, WalletCheckPorts } from './runWalletCheck'

export interface PeerPayView { client: { listIncomingPayments(): Promise<Array<{ token: { amount: number } }>>; acceptPayment(p: any): Promise<unknown> } | null; isHostAnointed: boolean }
export interface WalletClassLike {
  listFailedActions(args: { labels: string[]; limit: number; offset?: number }, unfail?: boolean): Promise<{ totalActions: number }>
  reviewSpendableOutputs(all?: boolean, release?: boolean): Promise<{ totalOutputs: number }>
}
export interface WalletCheckDeps {
  wallet: { getHeight(args: object): Promise<{ height: number }> }
  walletClass: WalletClassLike | null // null in remote-storage mode
  peerPay: () => PeerPayView // read live: setting the URL creates the client
  useMessageBox: () => boolean
  setMessageBoxUrl: (url: string) => Promise<void>
  anoint: () => Promise<void> // anoints the current messageBoxUrl
  refreshAppWallet: () => Promise<void>
  repairCertTrust: () => Promise<{ trusted: boolean | null; repaired: boolean }>
  profileId: number[] | null
  fetch: (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number }>
  sleep: (ms: number) => Promise<void>
  storage: Pick<Storage, 'getItem'>
  hasLocalAdvertisement: () => Promise<boolean> // wallet's own overlay advertisement exists
}

const NO_REMOTE: StepOutcome = { status: 'skipped', message: 'Not available with remote storage' }

export function createWalletCheckPorts(deps: WalletCheckDeps): WalletCheckPorts {
  const probeHttp = async (): Promise<boolean> => {
    try {
      await deps.fetch('http://127.0.0.1:3321/getVersion', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(3000)
      })
      return true
    } catch { return false }
  }

  return {
    async network() {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await deps.wallet.getHeight({})
          return { status: 'ok', message: 'Connected to the BSV network' }
        } catch {
          if (attempt < 2) await deps.sleep(attempt === 0 ? 1000 : 2000)
        }
      }
      return { status: 'error', message: "Can't reach the BSV network. Check that you're online, then run again." }
    },

    async connections() {
      const fixed: string[] = []
      let httpUp = await probeHttp()
      if (!httpUp) {
        try { await deps.refreshAppWallet() } catch { /* ignore */ }
        httpUp = await probeHttp()
        if (httpUp) fixed.push('Reconnected apps to your wallet')
      }
      let cert: { trusted: boolean | null; repaired: boolean }
      try { cert = await deps.repairCertTrust() } catch { cert = { trusted: null, repaired: false } }
      if (cert.repaired) fixed.push('Trusted the secure app connection')
      if (!httpUp) return { status: 'error', message: 'Apps cannot reach your wallet. Restart BSV Desktop.', fixed }
      if (cert.trusted === false) return { status: 'error', message: 'Secure app connections are not trusted. Restart BSV Desktop and choose Trust Certificate.', fixed }
      return { status: 'ok', message: fixed.length ? 'Fixed app connections' : 'Apps can reach your wallet', fixed }
    },

    async transactions() {
      const wc = deps.walletClass
      if (!wc) return NO_REMOTE
      const fixed: string[] = []
      const failed = (await wc.listFailedActions({ labels: [], limit: 1000 }, true)).totalActions
      if (failed > 0) fixed.push(`Retried ${failed} failed transaction(s)`)
      return { status: 'ok', message: fixed.length ? 'Fixed transactions' : 'Transactions are fine', fixed }
    },

    async coins() {
      if (!deps.walletClass) return NO_REMOTE
      const n = (await deps.walletClass.reviewSpendableOutputs(true, true)).totalOutputs
      if (n > 0) return { status: 'ok', message: 'Updated coins', fixed: [`Updated ${n} coin(s) that were already spent`] }
      return { status: 'ok', message: 'Coins match the blockchain' }
    },

    async messageBox() {
      const fixed: string[] = []
      if (!deps.useMessageBox()) {
        await deps.setMessageBoxUrl(DEFAULT_MESSAGE_BOX_URL)
        fixed.push('Set up your message box')
      }
      if (!deps.peerPay().client) return { status: 'error', message: 'Message box could not start. Run again in a moment.', fixed }
      // queryAdvertisements swallows overlay errors, so an outage looks like "not anointed"; trust the local basket first
      if (!deps.peerPay().isHostAnointed && !(await deps.hasLocalAdvertisement())) {
        try {
          await deps.anoint()
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          if (/insufficient|not enough|funds/i.test(msg)) {
            return { status: 'attention', message: 'Add a little BSV so others can find you, then run again.', fixed, action: { label: 'Get paid', to: '/dashboard/payments?tab=receive' } }
          }
          throw e
        }
        fixed.push('Made you discoverable for payments')
      }
      return { status: 'ok', message: fixed.length ? 'Message box ready' : 'Others can find you for payments', fixed }
    },

    async payments() {
      const client = deps.peerPay().client
      if (!client) return { status: 'skipped', message: 'No message box' }
      const list = await client.listIncomingPayments()
      let n = 0
      let sats = 0
      for (const p of list) {
        try { await client.acceptPayment(p); n++; sats += p.token.amount } catch { /* ignore */ }
      }
      if (n > 0) return { status: 'ok', message: 'Received payments', fixed: [`Received ${n} payment(s) (${sats} sats)`] }
      return { status: 'ok', message: 'No payments waiting' }
    },

    async backup() {
      if (!deps.profileId) return { status: 'skipped', message: 'No active profile' }
      if (getWalletBackupTime(deps.profileId, deps.storage)) return { status: 'ok', message: 'Wallet backed up' }
      return { status: 'attention', message: 'Back up your wallet so you can recover it if this computer is lost.', action: { label: 'Back up now', to: '/dashboard/settings/backup' } }
    },
  }
}

export function walletCheckDepsFromService(svc: WalletService, refreshAppWallet: () => Promise<void>): WalletCheckDeps {
  const wallet = svc.wallet as any
  if (!wallet) throw new Error('The wallet is not ready yet. Try again in a moment.')
  return {
    wallet,
    walletClass: svc.useRemoteStorage ? null : wallet,
    peerPay: () => { const s = svc.peerPay.getSnapshot(); return { client: s.peerPayClient as any, isHostAnointed: s.isHostAnointed } },
    useMessageBox: () => svc.useMessageBox,
    setMessageBoxUrl: url => svc.updateMessageBoxUrl(url),
    anoint: () => svc.peerPay.anointCurrentHost(svc.messageBoxUrl),
    refreshAppWallet,
    repairCertTrust: async () => window.electronAPI?.cert?.checkAndRepair ? window.electronAPI.cert.checkAndRepair() : { trusted: null, repaired: false },
    profileId: svc.activeProfile?.id?.length ? Array.from(svc.activeProfile.id) : null,
    fetch: (url, init) => window.fetch(url, init),
    sleep: ms => new Promise(r => setTimeout(r, ms)),
    storage: window.localStorage,
    hasLocalAdvertisement: async () => ((await wallet.listOutputs({ basket: 'overlay advertisements', limit: 10 })).outputs ?? []).some((o: any) => o.spendable !== false),
  }
}
