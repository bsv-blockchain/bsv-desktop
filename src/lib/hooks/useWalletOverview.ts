import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { WalletContext } from '../WalletContext'
import { readWalletBalance, readRecentActions } from '../utils/walletOverview'
import type { WalletAction } from '@bsv/sdk'

export function useWalletOverview(limit = 30) {
  const { managers, adminOriginator, chain, activeProfile } = useContext(WalletContext)
  const [balance, setBalance] = useState<number | null>(null)
  const [actions, setActions] = useState<WalletAction[]>([])
  const [totalActions, setTotalActions] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const refresh = useCallback(async () => {
    const current = ++generation.current
    const wallet = managers.permissionsManager
    if (!wallet) { setLoading(false); return }
    setLoading(true)
    try {
      const [amount, recent] = await Promise.all([
        readWalletBalance(wallet, adminOriginator),
        readRecentActions(wallet, adminOriginator, limit),
      ])
      if (current !== generation.current) return
      setBalance(amount)
      setActions(recent.actions)
      setTotalActions(recent.totalActions)
      setError('')
    } catch (error) {
      if (current === generation.current) setError(error.message || 'Your wallet could not be refreshed. Try again.')
    } finally { if (current === generation.current) setLoading(false) }
  }, [managers.permissionsManager, adminOriginator, chain, activeProfile?.identityKey, limit])
  useEffect(() => {
    setBalance(null); setActions([]); setTotalActions(0)
    void refresh()
    const update = () => { void refresh() }
    window.addEventListener('balance-changed', update)
    window.addEventListener('tx-status-changed', update)
    return () => {
      generation.current++
      window.removeEventListener('balance-changed', update)
      window.removeEventListener('tx-status-changed', update)
    }
  }, [refresh])
  return { balance, actions, totalActions, loading, error, refresh }
}
