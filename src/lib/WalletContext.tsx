/**
 * WalletContext — thin React provider wrapping WalletService.
 *
 * All business logic lives in:
 *   src/lib/services/WalletService.ts        — lifecycle state machine
 *   src/lib/services/PermissionQueueManager.ts — permission queues + group gating
 *   src/lib/services/PeerPayManager.ts        — PeerPay client lifecycle
 *
 * This file is intentionally minimal: context type definitions, default context
 * value, the provider component, and permission-module prompt rendering.
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from 'react'
import { useMediaQuery } from '@mui/material'
import { WalletSettings } from '@bsv/wallet-toolbox-client'
import { WalletPermissionsManager, PrivilegedKeyManager, WalletStorageManager, WalletAuthenticationManager } from '@bsv/wallet-toolbox-client'
import { WalletInterface, Utils } from '@bsv/sdk'
import { PeerPayClient, AdvertisementToken } from '@bsv/message-box-client'
import 'react-toastify/dist/ReactToastify.css'

import { ADMIN_ORIGINATOR, DEFAULT_SETTINGS, MESSAGEBOX_HOST } from './config'
import { UserContext } from './UserContext'
import { useWalletService, getWalletService } from './hooks/useWalletService'
import type { StasServices } from './services/WalletService'
import { buildPermissionModuleRegistry } from './permissionModules/registry'
import type { PermissionModuleDefinition, PermissionPromptHandler } from './permissionModules/types'
import type { GroupPermissionRequest, CounterpartyPermissionRequest } from './types/GroupedPermissions'
import type { WalletProfile } from './types/WalletProfile'
import { clearWalletForHttpRoute, setStasForHttpRoute, setStasTransferEnqueuer, setBsv21DiscoveryForHttpRoute, setPeerTokensForHttpRoute } from '../onWalletReady'
import { getReadyAppWalletSnapshot, isAppWalletSnapshotCurrent } from './services/appWalletBridge'
import type { StasTransferRequest } from './types/StasTransferRequest'
import { RequestInterceptorWallet } from './RequestInterceptorWallet'
import { updateRecentApp } from './pages/Dashboard/Apps/getApps'
import { defaultNetworkSettingsMap, type NetworkSettings, type NetworkSettingsMap, type WalletNetwork } from './networkConfig'

// -----
// Permission Configuration Types (preserved for backward compatibility)
// -----

export interface PermissionsConfig {
  differentiatePrivilegedOperations: boolean;
  seekBasketInsertionPermissions: boolean;
  seekBasketListingPermissions: boolean;
  seekBasketRemovalPermissions: boolean;
  seekCertificateAcquisitionPermissions: boolean;
  seekCertificateDisclosurePermissions: boolean;
  seekCertificateRelinquishmentPermissions: boolean;
  seekCertificateListingPermissions: boolean;
  seekGroupedPermission: boolean;
  seekPermissionsForIdentityKeyRevelation: boolean;
  seekPermissionsForIdentityResolution: boolean;
  seekPermissionsForKeyLinkageRevelation: boolean;
  seekPermissionsForPublicKeyRevelation: boolean;
  seekPermissionWhenApplyingActionLabels: boolean;
  seekPermissionWhenListingActionsByLabel: boolean;
  seekProtocolPermissionsForEncrypting: boolean;
  seekProtocolPermissionsForHMAC: boolean;
  seekProtocolPermissionsForSigning: boolean;
  seekSpendingPermissions: boolean;
}

export const DEFAULT_PERMISSIONS_CONFIG: PermissionsConfig = {
  differentiatePrivilegedOperations: true,
  seekBasketInsertionPermissions: false,
  seekBasketListingPermissions: false,
  seekBasketRemovalPermissions: false,
  seekCertificateAcquisitionPermissions: false,
  seekCertificateDisclosurePermissions: false,
  seekCertificateRelinquishmentPermissions: false,
  seekCertificateListingPermissions: false,
  seekGroupedPermission: true,
  seekPermissionsForIdentityKeyRevelation: false,
  seekPermissionsForIdentityResolution: false,
  seekPermissionsForKeyLinkageRevelation: false,
  seekPermissionsForPublicKeyRevelation: false,
  seekPermissionWhenApplyingActionLabels: false,
  seekPermissionWhenListingActionsByLabel: false,
  seekProtocolPermissionsForEncrypting: false,
  seekProtocolPermissionsForHMAC: false,
  seekProtocolPermissionsForSigning: false,
  seekSpendingPermissions: true,
}

// -----
// Context Types
// -----

export type LoginType = 'wab' | 'direct-key' | 'mnemonic-advanced' | 'mnemonic'
type ConfigStatus = 'editing' | 'configured' | 'initial'

interface ManagerState {
  walletManager?: WalletAuthenticationManager;
  permissionsManager?: WalletPermissionsManager;
  settingsManager?: any;
  storageManager?: WalletStorageManager;
}

export interface WABConfig {
  wabUrl: string;
  wabInfo: any;
  method: string;
  network: WalletNetwork;
  storageUrl: string;
  messageBoxUrl: string;
  loginType?: LoginType;
  useWab?: boolean;
  useRemoteStorage?: boolean;
  useMessageBox?: boolean;
}

export interface WalletContextValue {
  managers: ManagerState;
  updateManagers: (newManagers: ManagerState) => void;
  /**
   * Raw, unwrapped `Wallet` from `@bsv/wallet-toolbox`. Standalone — kept
   * outside `managers` so it is never confused with `permissionsManager`.
   * Internal/first-party use only (e.g. diagnostic UI, BRC-103 handshake
   * plumbing). App-originated requests must go through `managers.permissionsManager`.
   */
  wallet?: WalletInterface;
  /** STAS BRC-42 services + discovery loop (Tasks 3/4). */
  stas?: StasServices;
  settings: WalletSettings;
  updateSettings: (newSettings: WalletSettings) => Promise<void>;
  network: 'mainnet' | 'testnet';
  /** Raw selected chain. Distinguishes TeraTestNet ('ttn') from plain testnet,
   *  which `network` collapses to 'testnet'. Use for picking service endpoints. */
  chain: WalletNetwork;
  networkSettings: NetworkSettingsMap;
  switchingNetwork: boolean;
  applyNetworkSettings: (network: WalletNetwork, settings: NetworkSettings) => Promise<void>;
  activeProfile: WalletProfile | null;
  setActiveProfile: (profile: WalletProfile | null) => void;
  logout: () => void;
  adminOriginator: string;
  setPasswordRetriever: (retriever: (reason: string, test: (passwordCandidate: string) => boolean) => Promise<string>) => void;
  setRecoveryKeySaver: (saver: (key: number[]) => Promise<true>) => void;
  snapshotLoaded: boolean;
  basketRequests: any[];
  certificateRequests: any[];
  protocolRequests: any[];
  spendingRequests: any[];
  /**
   * Pending STAS transfer authorization requests from external apps
   * calling `POST /stas/transfer`. Surfaced by `StasTransferPermissionHandler`.
   * Resolves the awaiting route handler when the user clicks Approve/Deny.
   */
  stasTransferRequests: StasTransferRequest[];
  /** Resolves the head of `stasTransferRequests` and removes it from the queue. */
  advanceStasTransferQueue: (approved: boolean) => void;
  groupPermissionRequests: GroupPermissionRequest[];
  counterpartyPermissionRequests: CounterpartyPermissionRequest[];
  startPactCooldownForCounterparty: (originator: string, counterparty: string) => void;
  advanceBasketQueue: () => void;
  advanceCertificateQueue: () => void;
  advanceProtocolQueue: () => void;
  advanceSpendingQueue: () => void;
  setWalletFunder: (funder: (presentationKey: number[], wallet: WalletInterface, adminOriginator: string) => Promise<void>) => void;
  setUseWab: (use: boolean) => void;
  useWab: boolean;
  loginType: LoginType;
  setLoginType: (type: LoginType) => void;
  advanceGroupQueue: () => void;
  advanceCounterpartyPermissionQueue: () => void;
  recentApps: any[];
  /** Refresh the HTTP bridge from the current service snapshot after a profile change. */
  refreshAppWallet: () => Promise<void>;
  finalizeConfig: (wabConfig: WABConfig) => boolean;
  setConfigStatus: (status: ConfigStatus) => void;
  configStatus: ConfigStatus;
  wabUrl: string;
  setWabUrl: (url: string) => void;
  storageUrl: string;
  messageBoxUrl: string;
  useRemoteStorage: boolean;
  useMessageBox: boolean;
  saveEnhancedSnapshot: (configOverrides?: { backupStorageUrls?: string[]; messageBoxUrl?: string; useMessageBox?: boolean }) => string;
  backupStorageUrls: string[];
  addBackupStorageUrl: (url: string) => Promise<void>;
  removeBackupStorageUrl: (url: string) => Promise<void>;
  syncBackupStorage: (progressCallback?: (message: string) => void) => Promise<void>;
  setPrimaryStorage: (target: string, progressCallback?: (message: string) => void) => Promise<void>;
  updateMessageBoxUrl: (url: string) => Promise<void>;
  removeMessageBoxUrl: () => Promise<void>;
  initializingBackendServices: boolean;
  permissionsConfig: PermissionsConfig;
  updatePermissionsConfig: (config: PermissionsConfig) => Promise<void>;
  peerPayClient: PeerPayClient | null;
  isHostAnointed: boolean;
  anointedHosts: AdvertisementToken[];
  anointmentLoading: boolean;
  anointCurrentHost: () => Promise<void>;
  revokeHostAnointment: (token: AdvertisementToken) => Promise<void>;
  checkAnointmentStatus: () => Promise<void>;
}

export const WalletContext = createContext<WalletContextValue>({
  managers: {},
  updateManagers: () => {},
  settings: DEFAULT_SETTINGS,
  updateSettings: async () => {},
  network: 'mainnet',
  chain: 'main',
  networkSettings: defaultNetworkSettingsMap(),
  switchingNetwork: false,
  applyNetworkSettings: async () => {},
  activeProfile: null,
  setActiveProfile: () => {},
  logout: () => {},
  adminOriginator: ADMIN_ORIGINATOR,
  setPasswordRetriever: () => {},
  setRecoveryKeySaver: () => {},
  snapshotLoaded: false,
  basketRequests: [],
  certificateRequests: [],
  protocolRequests: [],
  spendingRequests: [],
  stasTransferRequests: [],
  advanceStasTransferQueue: () => {},
  groupPermissionRequests: [],
  counterpartyPermissionRequests: [],
  startPactCooldownForCounterparty: () => {},
  advanceBasketQueue: () => {},
  advanceCertificateQueue: () => {},
  advanceProtocolQueue: () => {},
  advanceSpendingQueue: () => {},
  setWalletFunder: () => {},
  setUseWab: () => {},
  useWab: false,
  loginType: 'mnemonic',
  setLoginType: () => {},
  advanceGroupQueue: () => {},
  advanceCounterpartyPermissionQueue: () => {},
  recentApps: [],
  refreshAppWallet: async () => {},
  finalizeConfig: () => false,
  setConfigStatus: () => {},
  configStatus: 'initial',
  wabUrl: '',
  setWabUrl: () => {},
  storageUrl: '',
  messageBoxUrl: MESSAGEBOX_HOST,
  useRemoteStorage: false,
  useMessageBox: true,
  saveEnhancedSnapshot: () => { throw new Error('Not initialized') },
  backupStorageUrls: [],
  addBackupStorageUrl: async () => {},
  removeBackupStorageUrl: async () => {},
  syncBackupStorage: async () => {},
  setPrimaryStorage: async () => {},
  updateMessageBoxUrl: async () => {},
  removeMessageBoxUrl: async () => {},
  initializingBackendServices: false,
  permissionsConfig: DEFAULT_PERMISSIONS_CONFIG,
  updatePermissionsConfig: async () => {},
  peerPayClient: null,
  isHostAnointed: false,
  anointedHosts: [],
  anointmentLoading: false,
  anointCurrentHost: async () => {},
  revokeHostAnointment: async () => {},
  checkAnointmentStatus: async () => {},
})

export const createDisabledPrivilegedManager = () =>
  new PrivilegedKeyManager(async () => {
    throw new Error('Privileged operations are not available in direct-key mode')
  })

const PermissionPromptHost: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <>{children}</>
)

// -----
// Provider
// -----

interface WalletContextProps {
  children?: React.ReactNode;
  onWalletReady: (wallet: WalletInterface) => Promise<(() => void) | undefined>;
  permissionModules?: PermissionModuleDefinition[];
}

export const WalletContextProvider: React.FC<WalletContextProps> = ({
  children,
  onWalletReady,
  permissionModules = [],
}) => {
  const { isFocused, onFocusRequested, onFocusRelinquished } = useContext(UserContext)
  const prefersDarkMode = useMediaQuery('(prefers-color-scheme: dark)')

  // ---- Permission module registry (prop-driven, stays in React) ----
  const permissionModuleRegistryState = useMemo(
    () => buildPermissionModuleRegistry(permissionModules),
    [permissionModules]
  )
  const { registry: permissionModuleRegistry, getPermissionModuleById, normalizeEnabledPermissionModules, restoreEnabledPermissionModules } = permissionModuleRegistryState

  // ---- Permission prompt handlers (registered by module Prompt components) ----
  const permissionPromptHandlersRef = useRef<Map<string, PermissionPromptHandler>>(new Map())

  // An app that fires several identical requests at once (e.g. parallel
  // listOutputs calls before the first approval lands) would otherwise stack
  // copies of the same prompt, so each approve click only revealed the next
  // copy. While a prompt is unanswered, an identical request (same module,
  // app and message) joins it and receives the same answer. Prompts that
  // differ (e.g. spends with different amounts) are never merged.
  const registerPermissionPromptHandler = useCallback((id: string, handler: PermissionPromptHandler) => {
    const pending = new Map<string, Promise<boolean>>()
    const deduped: PermissionPromptHandler = (app, message) => {
      const key = `${app}\u0000${message}`
      let prompt = pending.get(key)
      if (prompt === undefined) {
        prompt = handler(app, message).finally(() => { pending.delete(key) })
        pending.set(key, prompt)
      }
      return prompt
    }
    permissionPromptHandlersRef.current.set(id, deduped)
  }, [])
  const unregisterPermissionPromptHandler = useCallback((id: string) => {
    permissionPromptHandlersRef.current.delete(id)
  }, [])

  // ---- Enabled permission modules (persisted to localStorage) ----
  const [enabledPermissionModules, setEnabledPermissionModules] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('enabledPermissionModules')
      const known = localStorage.getItem('knownPermissionModules')
      return restoreEnabledPermissionModules(saved ? JSON.parse(saved) : undefined, known ? JSON.parse(known) : undefined)
    } catch (error) {
      console.warn('Failed to load enabled permission modules:', error)
      return normalizeEnabledPermissionModules()
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem('enabledPermissionModules', JSON.stringify(enabledPermissionModules))
      localStorage.setItem('knownPermissionModules', JSON.stringify(permissionModuleRegistry.map(module => module.id)))
    } catch (error) {
      console.warn('Failed to persist enabled permission modules:', error)
    }
  }, [enabledPermissionModules, permissionModuleRegistry])

  useEffect(() => {
    setEnabledPermissionModules(prev => normalizeEnabledPermissionModules(prev))
  }, [normalizeEnabledPermissionModules])

  // Sync module helpers into the PermissionQueueManager
  const svc = getWalletService()
  useEffect(() => {
    svc.permissionQueue.enabledPermissionModules = enabledPermissionModules
    svc.permissionQueue.setPermissionsModuleHelpers(getPermissionModuleById as any, permissionPromptHandlersRef.current)
  }, [enabledPermissionModules, getPermissionModuleById, svc])

  // Permissions config is loaded from localStorage inside getWalletService()
  // before React mounts, so the primed _queueSnapshot already reflects the
  // saved value. Loading here in a useEffect creates a race against
  // useSyncExternalStore's subscribe phase and the snapshot update is lost.

  // ---- Dark mode for permission prompts ----
  const tokenPromptPaletteMode = useMemo<import('@mui/material').PaletteMode>(() => {
    const pref = (svc.settings as any)?.theme?.mode ?? 'system'
    if (pref === 'system') return prefersDarkMode ? 'dark' : 'light'
    return pref === 'dark' ? 'dark' : 'light'
  }, [(svc.settings as any)?.theme?.mode, prefersDarkMode])

  // ---- React adapter hook — provides all the context values ----
  const walletServiceValues = useWalletService()

  // ---- STAS transfer authorization queue (Apps API permission prompts) ----
  // External apps hitting POST /stas/transfer get gated by a user prompt
  // here. enqueueStasTransferRequest is exposed to the HTTP route handler
  // via setStasTransferEnqueuer (parallel to setStasForHttpRoute).
  const [stasTransferRequests, setStasTransferRequests] = useState<StasTransferRequest[]>([])

  const enqueueStasTransferRequest = useCallback(
    (
      args: Omit<StasTransferRequest, 'requestId' | 'resolve'>
    ): Promise<boolean> => {
      return new Promise<boolean>((resolve) => {
        const requestId = Math.random().toString(36).slice(2) + Date.now().toString(36)
        setStasTransferRequests((q) => [
          ...q,
          { ...args, requestId, resolve },
        ])
      })
    },
    []
  )

  const advanceStasTransferQueue = useCallback((approved: boolean) => {
    setStasTransferRequests((q) => {
      if (q.length === 0) return q
      const [head, ...rest] = q
      try { head.resolve(approved) } catch { /* ignore */ }
      return rest
    })
  }, [])

  useEffect(() => {
    setStasTransferEnqueuer(enqueueStasTransferRequest)
    return () => setStasTransferEnqueuer(null)
  }, [enqueueStasTransferRequest])

  // ---- HTTP bridge integration ----
  const { managers, activeProfile } = walletServiceValues
  const recentOriginsRef = useRef<Map<string, number>>(new Map())
  const profileStorageKey = activeProfile?.id ? Utils.toBase64(activeProfile.id) : ''
  const updateRecentAppWrapper = useCallback(async (profileId: string, origin: string): Promise<void> => {
    try {
      const cacheKey = `${profileId}:${origin}`
      const now = Date.now()
      const lastProcessed = recentOriginsRef.current.get(cacheKey)
      if (lastProcessed && now - lastProcessed < 5000) return
      recentOriginsRef.current.set(cacheKey, now)
      await updateRecentApp(profileId, origin)
      window.dispatchEvent(new CustomEvent('recentAppsUpdated', { detail: { profileId, origin } }))
    } catch (error) { console.debug('Error tracking recent app:', error) }
  }, [])

  // Read the imperative snapshot instead of the render closure: profile
  // transitions must update the app bridge before accepting another request.
  const refreshAppWallet = useCallback(async (): Promise<void> => {
    const initial = svc.getSnapshot()
    let interceptorWallet: RequestInterceptorWallet | undefined
    try {
      const current = await getReadyAppWalletSnapshot(svc)
      const permissionsManager = current.managers.permissionsManager
      const profile = current.activeProfile
      if (!permissionsManager || !profile?.id) throw new Error('The wallet is not ready for app requests.')
      interceptorWallet = new RequestInterceptorWallet(permissionsManager, Utils.toBase64(profile.id), updateRecentAppWrapper)
      await onWalletReady(interceptorWallet)
      if (!isAppWalletSnapshotCurrent(svc, current)) {
        throw new Error('The wallet changed while reconnecting apps. Try again when it is ready.')
      }
      const stas = current.stas
      setStasForHttpRoute(stas?.keyDeriver && stas.discovery && stas.transfer ? {
        discovery: stas.discovery,
        transfer: stas.transfer,
        keyDeriver: stas.keyDeriver,
        identityKey: stas.keyDeriver.identityKey,
        chain: stas.keyDeriver.chain,
      } : null)
      setBsv21DiscoveryForHttpRoute(stas?.bsv21Discovery ?? null)
      setPeerTokensForHttpRoute(stas?.peerTokens && stas.keyDeriver ? {
        client: stas.peerTokens,
        wallet: permissionsManager,
        identityKey: stas.keyDeriver.identityKey,
        chain: stas.keyDeriver.chain,
        originator: current.adminOriginator,
        tokens: stas.tokens,
      } : null)
    } catch (error) {
      // A superseded refresh must not disconnect the newer profile's bridge.
      const latest = svc.getSnapshot()
      if (interceptorWallet) clearWalletForHttpRoute(interceptorWallet)
      else if (latest.wallet === initial.wallet && latest.managers.permissionsManager === initial.managers.permissionsManager) clearWalletForHttpRoute()
      throw error
    }
  }, [svc, onWalletReady, updateRecentAppWrapper])

  useEffect(() => {
    if (!managers.permissionsManager || !profileStorageKey) return
    void refreshAppWallet().catch(error => console.error('[WalletContext] App bridge refresh failed:', error))
  }, [managers.permissionsManager, profileStorageKey, refreshAppWallet])

  // ---- Context value ----
  const contextValue = useMemo<WalletContextValue>(() => ({
    ...walletServiceValues,
    stasTransferRequests,
    advanceStasTransferQueue,
    refreshAppWallet,
  }), [walletServiceValues, stasTransferRequests, advanceStasTransferQueue, refreshAppWallet])

  return (
    <WalletContext.Provider value={contextValue}>
      {children}
      <PermissionPromptHost>
        {permissionModuleRegistry.map(module => {
          if (!enabledPermissionModules.includes(module.id) || !module.Prompt) return null
          const Prompt = module.Prompt
          return (
            <Prompt
              key={module.id}
              id={module.id}
              paletteMode={tokenPromptPaletteMode}
              isFocused={isFocused}
              onFocusRequested={onFocusRequested}
              onFocusRelinquished={onFocusRelinquished}
              onRegister={registerPermissionPromptHandler}
              onUnregister={unregisterPermissionPromptHandler}
            />
          )
        })}
      </PermissionPromptHost>
    </WalletContext.Provider>
  )
}
