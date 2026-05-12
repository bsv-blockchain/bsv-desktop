/**
 * useWalletService — React adapter hook for WalletService.
 *
 * Bridges the plain-TypeScript WalletService to React:
 * - Subscribes to WalletService events via useSyncExternalStore
 * - Handles focus management: reacts to focusNeeded/focusReleasable events
 * - Manages modal open/close state derived from queue snapshots
 * - Provides the full WalletContextValue interface for backward compatibility
 */

import { useContext, useEffect, useRef, useSyncExternalStore, useCallback } from 'react'
import { UserContext } from '../UserContext'
import { WalletService, WalletServiceSnapshot } from '../services/WalletService'
import type { QueueSnapshot } from '../services/PermissionQueueManager'
import type { PeerPaySnapshot } from '../services/PeerPayManager'
import { DEFAULT_PERMISSIONS_CONFIG } from '../WalletContext'

// Module-level singleton — survives React re-renders and hot reloads
let _walletServiceInstance: WalletService | null = null

// Cached snapshots — useSyncExternalStore requires getSnapshot() to return the
// SAME reference between events, otherwise React detects an infinite loop.
// We update these only when an event fires, so the reference is stable between renders.
let _walletSnapshot: WalletServiceSnapshot | null = null
let _queueSnapshot: QueueSnapshot | null = null
let _peerPaySnapshot: PeerPaySnapshot | null = null

export function getWalletService(): WalletService {
  if (!_walletServiceInstance) {
    _walletServiceInstance = new WalletService()
    // Restore config from snapshot synchronously before first render
    _walletServiceInstance.restoreConfigFromSnapshot()
    // Restore permissions config from localStorage BEFORE priming snapshot cache.
    // Doing this in a React useEffect creates a race: the useEffect's emit fires
    // before useSyncExternalStore's subscribe has registered, so the snapshot
    // update is lost and React keeps reading the DEFAULT-primed cache.
    try {
      const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('permissionsConfig') : null
      if (stored) {
        const merged = { ...DEFAULT_PERMISSIONS_CONFIG, ...JSON.parse(stored) }
        _walletServiceInstance.permissionQueue.permissionsConfig = merged
      }
    } catch (e) {
      console.error('[getWalletService] Failed to load permissionsConfig from localStorage:', e)
    }
    // Prime the caches so getSnapshot functions never return null on first call
    _walletSnapshot = _walletServiceInstance.getSnapshot()
    _queueSnapshot = _walletServiceInstance.permissionQueue.getSnapshot()
    _peerPaySnapshot = _walletServiceInstance.peerPay.getSnapshot()
  }
  return _walletServiceInstance
}

/** Reset the singleton (for testing or logout-triggered full reset). */
export function resetWalletServiceInstance() {
  _walletServiceInstance = null
  _walletSnapshot = null
  _queueSnapshot = null
  _peerPaySnapshot = null
}

// ------------------------------------------------------------------
// useSyncExternalStore subscriptions
// Each subscribe fn registers a React callback; each getSnapshot fn
// returns the cached reference (stable between events).
// ------------------------------------------------------------------

function subscribeToWalletService(callback: () => void): () => void {
  const svc = getWalletService()
  const handler = (snap: WalletServiceSnapshot) => { _walletSnapshot = snap; callback() }
  svc.on('stateChanged', handler)
  return () => svc.off('stateChanged', handler)
}

function getWalletServiceSnapshot(): WalletServiceSnapshot {
  // Ensure singleton is initialized (primes cache on first call)
  getWalletService()
  return _walletSnapshot!
}

function subscribeToQueue(callback: () => void): () => void {
  const svc = getWalletService()
  const handler = (snap: QueueSnapshot) => { _queueSnapshot = snap; callback() }
  svc.permissionQueue.on('snapshot', handler)
  return () => svc.permissionQueue.off('snapshot', handler)
}

function getQueueSnapshot(): QueueSnapshot {
  getWalletService()
  return _queueSnapshot!
}

function subscribeToPeerPay(callback: () => void): () => void {
  const svc = getWalletService()
  const handler = (snap: PeerPaySnapshot) => { _peerPaySnapshot = snap; callback() }
  svc.peerPay.on('changed', handler)
  return () => svc.peerPay.off('changed', handler)
}

function getPeerPaySnapshot(): PeerPaySnapshot {
  getWalletService()
  return _peerPaySnapshot!
}

// ------------------------------------------------------------------
// Hook
// ------------------------------------------------------------------

export function useWalletService() {
  const {
    isFocused,
    onFocusRequested,
    onFocusRelinquished,
    setBasketAccessModalOpen,
    setCertificateAccessModalOpen,
    setProtocolAccessModalOpen,
    setSpendingAuthorizationModalOpen,
    setGroupPermissionModalOpen,
    setCounterpartyPermissionModalOpen,
  } = useContext(UserContext)

  const svc = getWalletService()

  // Subscribe to service state via useSyncExternalStore for tear-safe reads
  const walletState = useSyncExternalStore(subscribeToWalletService, getWalletServiceSnapshot)
  const queueState = useSyncExternalStore(subscribeToQueue, getQueueSnapshot)
  const peerPayState = useSyncExternalStore(subscribeToPeerPay, getPeerPaySnapshot)

  // Track previous queue lengths to detect first-item-arrival and queue-drain
  const prevQueueLengths = useRef({
    basket: 0,
    certificate: 0,
    protocol: 0,
    spending: 0,
    group: 0,
    counterparty: 0,
  })

  // ------------------------------------------------------------------
  // Focus management: react to focusNeeded / focusReleasable events
  // ------------------------------------------------------------------
  useEffect(() => {
    const handleFocusNeeded = async () => {
      const currentlyFocused = await isFocused()
      svc.permissionQueue.setWasOriginallyFocused(currentlyFocused)
      if (!currentlyFocused) {
        await onFocusRequested()
      }
    }

    const handleFocusReleasable = (wasOriginallyFocused: boolean) => {
      if (!wasOriginallyFocused) {
        onFocusRelinquished()
      }
    }

    svc.permissionQueue.on('focusNeeded', handleFocusNeeded)
    svc.permissionQueue.on('focusReleasable', handleFocusReleasable)

    return () => {
      svc.permissionQueue.off('focusNeeded', handleFocusNeeded)
      svc.permissionQueue.off('focusReleasable', handleFocusReleasable)
    }
  }, [isFocused, onFocusRequested, onFocusRelinquished, svc])

  // ------------------------------------------------------------------
  // Modal management: open/close modals based on queue state changes
  // ------------------------------------------------------------------
  useEffect(() => {
    const prev = prevQueueLengths.current
    const {
      basketRequests,
      certificateRequests,
      protocolRequests,
      spendingRequests,
      groupPermissionRequests,
      counterpartyPermissionRequests,
      groupPhase,
    } = queueState

    // Open modals when queues become non-empty (from empty)
    if (basketRequests.length > 0 && prev.basket === 0) setBasketAccessModalOpen(true)
    if (certificateRequests.length > 0 && prev.certificate === 0) setCertificateAccessModalOpen(true)
    if (protocolRequests.length > 0 && prev.protocol === 0) setProtocolAccessModalOpen(true)
    if (spendingRequests.length > 0 && prev.spending === 0) setSpendingAuthorizationModalOpen(true)
    if (groupPermissionRequests.length > 0 && prev.group === 0) setGroupPermissionModalOpen(true)
    if (counterpartyPermissionRequests.length > 0 && prev.counterparty === 0) setCounterpartyPermissionModalOpen(true)

    // Close modals when queues drain to empty
    if (basketRequests.length === 0 && prev.basket > 0) setBasketAccessModalOpen(false)
    if (certificateRequests.length === 0 && prev.certificate > 0) setCertificateAccessModalOpen(false)
    if (protocolRequests.length === 0 && prev.protocol > 0) setProtocolAccessModalOpen(false)
    if (spendingRequests.length === 0 && prev.spending > 0) setSpendingAuthorizationModalOpen(false)
    if (groupPermissionRequests.length === 0 && prev.group > 0) setGroupPermissionModalOpen(false)
    if (counterpartyPermissionRequests.length === 0 && prev.counterparty > 0) setCounterpartyPermissionModalOpen(false)

    // When group phase becomes pending, close individual modals (group gating)
    if (groupPhase === 'pending') {
      if (prev.basket > 0) setBasketAccessModalOpen(false)
      if (prev.certificate > 0) setCertificateAccessModalOpen(false)
      if (prev.protocol > 0) setProtocolAccessModalOpen(false)
      if (prev.spending > 0) setSpendingAuthorizationModalOpen(false)
      if (prev.counterparty > 0) setCounterpartyPermissionModalOpen(false)
    }

    prevQueueLengths.current = {
      basket: basketRequests.length,
      certificate: certificateRequests.length,
      protocol: protocolRequests.length,
      spending: spendingRequests.length,
      group: groupPermissionRequests.length,
      counterparty: counterpartyPermissionRequests.length,
    }
  }, [
    queueState,
    setBasketAccessModalOpen,
    setCertificateAccessModalOpen,
    setCounterpartyPermissionModalOpen,
    setGroupPermissionModalOpen,
    setProtocolAccessModalOpen,
    setSpendingAuthorizationModalOpen,
  ])

  // ------------------------------------------------------------------
  // Auto-dismiss group requests during cooldown (replaces Effect 15)
  // ------------------------------------------------------------------
  useEffect(() => {
    svc.permissionQueue.checkGroupCooldownDismissal()
  }, [queueState.groupPermissionRequests, svc])

  // ------------------------------------------------------------------
  // Stable callbacks for context value
  // ------------------------------------------------------------------

  const advanceBasketQueue = useCallback(() => svc.permissionQueue.advanceBasketQueue(), [svc])
  const advanceCertificateQueue = useCallback(() => svc.permissionQueue.advanceCertificateQueue(), [svc])
  const advanceProtocolQueue = useCallback(() => svc.permissionQueue.advanceProtocolQueue(), [svc])
  const advanceSpendingQueue = useCallback(() => svc.permissionQueue.advanceSpendingQueue(), [svc])
  const advanceGroupQueue = useCallback(() => svc.permissionQueue.advanceGroupQueue(), [svc])
  const advanceCounterpartyPermissionQueue = useCallback(() => svc.permissionQueue.advanceCounterpartyPermissionQueue(), [svc])
  const startPactCooldownForCounterparty = useCallback(
    (originator: string, counterparty: string) => svc.permissionQueue.startPactCooldownForCounterparty(originator, counterparty),
    [svc]
  )

  const setPasswordRetriever = useCallback(
    (fn: any) => svc.setPasswordRetriever(fn),
    [svc]
  )
  const setRecoveryKeySaver = useCallback(
    (fn: any) => svc.setRecoveryKeySaver(fn),
    [svc]
  )
  const setWalletFunder = useCallback(
    (fn: any) => svc.setWalletFunder(fn),
    [svc]
  )

  const logout = useCallback(() => svc.logout(), [svc])
  const finalizeConfig = useCallback((wabConfig: any) => svc.configure(wabConfig), [svc])
  const saveEnhancedSnapshot = useCallback(
    (overrides?: any) => svc.saveEnhancedSnapshot(overrides),
    [svc]
  )
  const addBackupStorageUrl = useCallback((url: string) => svc.addBackupStorageUrl(url), [svc])
  const removeBackupStorageUrl = useCallback((url: string) => svc.removeBackupStorageUrl(url), [svc])
  const syncBackupStorage = useCallback((cb?: any) => svc.syncBackupStorage(cb), [svc])
  const setPrimaryStorage = useCallback(
    (target: string, cb?: (message: string) => void) => svc.setPrimaryStorage(target, cb),
    [svc]
  )
  const updateMessageBoxUrl = useCallback((url: string) => svc.updateMessageBoxUrl(url), [svc])
  const removeMessageBoxUrl = useCallback(() => svc.removeMessageBoxUrl(), [svc])
  const updateSettings = useCallback((s: any) => svc.updateSettings(s), [svc])
  const updatePermissionsConfig = useCallback(async (config: any) => {
    // Persist first — if storage fails we don't want to silently update the
    // in-memory config and have the change disappear on reload.
    try {
      localStorage.setItem('permissionsConfig', JSON.stringify(config))
    } catch (e) {
      console.error('[useWalletService] failed to persist permissionsConfig:', e)
      throw e
    }
    // Apply to queue + live WalletPermissionsManager and re-emit snapshot.
    svc.permissionQueue.setPermissionsConfig(config)
  }, [svc])

  const anointCurrentHost = useCallback(
    () => svc.peerPay.anointCurrentHost(walletState.messageBoxUrl),
    [svc, walletState.messageBoxUrl]
  )
  const revokeHostAnointment = useCallback(
    (token: any) => svc.peerPay.revokeHostAnointment(token, walletState.messageBoxUrl),
    [svc, walletState.messageBoxUrl]
  )
  const checkAnointmentStatus = useCallback(
    () => svc.peerPay.checkAnointmentStatus(walletState.messageBoxUrl),
    [svc, walletState.messageBoxUrl]
  )

  const setConfigStatus = useCallback((status: any) => {
    // Bridging shim: some UI still calls setConfigStatus directly.
    // Map to the service lifecycle as closely as possible.
    if (status === 'configured') {
      ;(svc as any)._lifecycle = 'configured'
      ;(svc as any)._emitState()
    } else if (status === 'editing' || status === 'initial') {
      ;(svc as any)._lifecycle = 'unconfigured'
      ;(svc as any)._emitState()
    }
  }, [svc])

  const setUseWab = useCallback((use: boolean) => {
    ;(svc as any)._loginType = use ? 'wab' : 'mnemonic-advanced'
    ;(svc as any)._emitState()
  }, [svc])

  const setLoginType = useCallback((type: any) => {
    ;(svc as any)._loginType = type
    ;(svc as any)._emitState()
  }, [svc])

  const setWabUrl = useCallback((url: string) => {
    ;(svc as any)._wabUrl = url
    ;(svc as any)._emitState()
  }, [svc])

  const setActiveProfile = useCallback((profile: any) => {
    ;(svc as any)._activeProfile = profile
    ;(svc as any)._emitState()
  }, [svc])

  const updateManagers = useCallback((newManagers: any) => {
    ;(svc as any)._managers = { ...(svc as any)._managers, ...newManagers }
    ;(svc as any)._emitState()
  }, [svc])

  // Map service lifecycle to legacy configStatus string
  const configStatus: 'editing' | 'configured' | 'initial' = (() => {
    switch (walletState.lifecycle) {
      case 'unconfigured': return 'initial'
      case 'configured':
      case 'initializing':
      case 'authenticated':
      case 'ready': return 'configured'
      case 'error': return 'editing'
      default: return 'initial'
    }
  })()

  return {
    // Managers
    managers: walletState.managers,
    updateManagers,
    // Raw, unwrapped Wallet — for internal first-party use only. App-originated
    // requests must go through managers.permissionsManager.
    wallet: walletState.wallet,
    // Settings
    settings: walletState.settings,
    updateSettings,
    network: walletState.selectedNetwork === 'test' ? 'testnet' as const : 'mainnet' as const,
    // Profile
    activeProfile: walletState.activeProfile,
    setActiveProfile,
    // Auth
    logout,
    adminOriginator: walletState.adminOriginator,
    setPasswordRetriever,
    setRecoveryKeySaver,
    snapshotLoaded: walletState.snapshotLoaded,
    // Permission queues
    basketRequests: queueState.basketRequests,
    certificateRequests: queueState.certificateRequests,
    protocolRequests: queueState.protocolRequests,
    spendingRequests: queueState.spendingRequests,
    groupPermissionRequests: queueState.groupPermissionRequests,
    counterpartyPermissionRequests: queueState.counterpartyPermissionRequests,
    startPactCooldownForCounterparty,
    advanceBasketQueue,
    advanceCertificateQueue,
    advanceProtocolQueue,
    advanceSpendingQueue,
    advanceGroupQueue,
    advanceCounterpartyPermissionQueue,
    // Wallet funder
    setWalletFunder,
    // Config
    setUseWab,
    useWab: walletState.loginType === 'wab',
    loginType: walletState.loginType,
    setLoginType,
    recentApps: [] as any[],
    finalizeConfig,
    setConfigStatus,
    configStatus,
    wabUrl: walletState.wabUrl,
    setWabUrl,
    storageUrl: walletState.selectedStorageUrl,
    messageBoxUrl: walletState.messageBoxUrl,
    useRemoteStorage: walletState.useRemoteStorage,
    useMessageBox: walletState.useMessageBox,
    saveEnhancedSnapshot,
    backupStorageUrls: walletState.backupStorageUrls,
    addBackupStorageUrl,
    removeBackupStorageUrl,
    syncBackupStorage,
    setPrimaryStorage,
    updateMessageBoxUrl,
    removeMessageBoxUrl,
    initializingBackendServices: walletState.initializingBackendServices,
    // Permissions config
    permissionsConfig: queueState.permissionsConfig,
    updatePermissionsConfig,
    // PeerPay
    peerPayClient: peerPayState.peerPayClient,
    isHostAnointed: peerPayState.isHostAnointed,
    anointedHosts: peerPayState.anointedHosts,
    anointmentLoading: peerPayState.anointmentLoading,
    anointCurrentHost,
    revokeHostAnointment,
    checkAnointmentStatus,
    // Service instance for advanced use
    walletService: svc,
  }
}
