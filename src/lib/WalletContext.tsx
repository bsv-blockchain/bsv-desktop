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
import { WalletSettings } from '@bsv/wallet-toolbox-client/out/src/WalletSettingsManager'
import { WalletPermissionsManager, PrivilegedKeyManager, WalletStorageManager, WalletAuthenticationManager } from '@bsv/wallet-toolbox-client'
import { WalletInterface, Utils } from '@bsv/sdk'
import { PeerPayClient, AdvertisementToken } from '@bsv/message-box-client'
import 'react-toastify/dist/ReactToastify.css'

import { ADMIN_ORIGINATOR, DEFAULT_SETTINGS } from './config'
import { UserContext } from './UserContext'
import { useWalletService, getWalletService } from './hooks/useWalletService'
import type { StasServices } from './services/WalletService'
import { buildPermissionModuleRegistry } from './permissionModules/registry'
import type { PermissionModuleDefinition, PermissionPromptHandler } from './permissionModules/types'
import type { GroupPermissionRequest, CounterpartyPermissionRequest } from './types/GroupedPermissions'
import type { WalletProfile } from './types/WalletProfile'
import { setStasForHttpRoute, setStasTransferEnqueuer, setBsv21DiscoveryForHttpRoute, setPeerTokensForHttpRoute } from '../onWalletReady'
import type { StasTransferRequest } from './types/StasTransferRequest'
import { RequestInterceptorWallet } from './RequestInterceptorWallet'
import { updateRecentApp } from './pages/Dashboard/Apps/getApps'

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

export type LoginType = 'wab' | 'direct-key' | 'mnemonic-advanced'
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
  network: 'main' | 'test' | 'ttn';
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
  chain: 'main' | 'test' | 'ttn';
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
  useWab: true,
  loginType: 'wab',
  setLoginType: () => {},
  advanceGroupQueue: () => {},
  advanceCounterpartyPermissionQueue: () => {},
  recentApps: [],
  finalizeConfig: () => false,
  setConfigStatus: () => {},
  configStatus: 'initial',
  wabUrl: '',
  setWabUrl: () => {},
  storageUrl: '',
  messageBoxUrl: '',
  useRemoteStorage: false,
  useMessageBox: false,
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
  const { registry: permissionModuleRegistry, getPermissionModuleById, normalizeEnabledPermissionModules } = permissionModuleRegistryState

  // ---- Permission prompt handlers (registered by module Prompt components) ----
  const permissionPromptHandlersRef = useRef<Map<string, PermissionPromptHandler>>(new Map())

  const registerPermissionPromptHandler = useCallback((id: string, handler: PermissionPromptHandler) => {
    permissionPromptHandlersRef.current.set(id, handler)
  }, [])
  const unregisterPermissionPromptHandler = useCallback((id: string) => {
    permissionPromptHandlersRef.current.delete(id)
  }, [])

  // ---- Enabled permission modules (persisted to localStorage) ----
  const [enabledPermissionModules, setEnabledPermissionModules] = useState<string[]>(() =>
    normalizeEnabledPermissionModules()
  )

  const updateEnabledPermissionModules = useCallback((modules: string[]) => {
    const normalized = normalizeEnabledPermissionModules(modules)
    setEnabledPermissionModules(normalized)
    try {
      localStorage.setItem('enabledPermissionModules', JSON.stringify(normalized))
    } catch (error) {
      console.warn('Failed to persist enabled permission modules:', error)
    }
  }, [normalizeEnabledPermissionModules])

  useEffect(() => {
    try {
      const stored = localStorage.getItem('enabledPermissionModules')
      if (stored) updateEnabledPermissionModules(JSON.parse(stored))
    } catch (error) {
      console.warn('Failed to load enabled permission modules:', error)
    }
  }, [updateEnabledPermissionModules])

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

  // ---- onWalletReady integration (replaces Effect 14) ----
  // This stays in React because it depends on onWalletReady prop and activeProfile
  const { managers, activeProfile } = walletServiceValues
  const recentOriginsRef = useRef<Map<string, number>>(new Map())
  const DEBOUNCE_TIME_MS = 5000

  useEffect(() => {
    // External BRC-100 traffic (port 3321) hits permissionsManager so app-originated
    // requests pass through permission prompts. The standalone raw `wallet` (separate
    // from `managers`) is reserved for internal wallet-toolbox plumbing that
    // intentionally bypasses permissions (e.g. StorageClient BRC-103 handshake).
    const walletReady = !!managers?.permissionsManager
    console.log('[onWalletReady effect] check:', {
      walletReady,
      profileId: activeProfile?.id ? `[${activeProfile.id.length} bytes]` : null,
      lifecycle: getWalletService().lifecycle,
    })
    if (!walletReady || !activeProfile?.id) {
      return
    }

    console.log('[onWalletReady effect] guard passed — registering wallet ref')

    const updateRecentAppWrapper = async (profileId: string, origin: string): Promise<void> => {
      try {
        const cacheKey = `${profileId}:${origin}`
        const now = Date.now()
        const lastProcessed = recentOriginsRef.current.get(cacheKey)
        if (lastProcessed && (now - lastProcessed) < DEBOUNCE_TIME_MS) return
        recentOriginsRef.current.set(cacheKey, now)
        await updateRecentApp(profileId, origin)
        globalThis.dispatchEvent(new CustomEvent('recentAppsUpdated', { detail: { profileId, origin } }))
      } catch (error) {
        console.debug('Error tracking recent app:', error)
      }
    }

    const interceptorWallet = new RequestInterceptorWallet(managers.permissionsManager, Utils.toBase64(activeProfile.id), updateRecentAppWrapper)
    // onWalletReady registers IPC listener once, subsequent calls just swap
    // wallet ref. The STAS service bundle (for the Apps API routes
    // /stas/list, /stas/tokens, /stas/transfer, /stas/receive-address,
    // /stas/register-by-txid — Task 7a) is injected via a separate setter so
    // the prop interface stays single-arg.
    onWalletReady(interceptorWallet)
    const stas = walletServiceValues.stas
    if (stas?.keyDeriver && stas.discovery && stas.transfer) {
      setStasForHttpRoute({
        discovery: stas.discovery,
        transfer: stas.transfer,
        keyDeriver: stas.keyDeriver,
        identityKey: stas.keyDeriver.identityKey,
        chain: stas.keyDeriver.chain,
      })
    } else {
      setStasForHttpRoute(null)
    }

    // Parallel injection for the BSV-21 register-by-txid demo fast-path.
    // The primary discovery mechanism is bsv21Discovery.scan() — fired by
    // the AssetsPage Refresh button — which queries the 1Sat overlay's
    // per-address SSE stream and covers organic receive end-to-end.
    setBsv21DiscoveryForHttpRoute(stas?.bsv21Discovery ?? null)

    // Peer-token routes (Phase B) — the standalone web page drives this
    // wallet over /peerToken/*. The page references holdings by outpoint;
    // source resolution + key derivation stay here behind the HTTP boundary.
    if (stas?.peerTokens && stas.keyDeriver) {
      setPeerTokensForHttpRoute({
        client: stas.peerTokens,
        wallet: managers.permissionsManager,
        identityKey: stas.keyDeriver.identityKey,
        chain: stas.keyDeriver.chain,
        originator: ADMIN_ORIGINATOR,
        // TokenProtocolRegistry — powers the /dstas/transfer + /bsv-21/transfer
        // legacy address-send routes (same adapters the Assets page Send uses).
        tokens: stas.tokens,
      })
    } else {
      setPeerTokensForHttpRoute(null)
    }

    // No cleanup — IPC listener is permanent, wallet ref is swapped not re-registered
  }, [managers?.permissionsManager, activeProfile?.id, onWalletReady])

  // STAS auto-scan: one shot when the raw wallet + STAS services first appear.
  // The dev-only Dashboard panel exposes a manual re-scan.
  useEffect(() => {
    const stas = walletServiceValues.stas
    const wallet = walletServiceValues.wallet
    if (!wallet || !stas?.discovery) return

    let cancelled = false
    ;(async () => {
      try {
        console.log('[STAS Discovery] auto-scan starting')
        const result = await stas.discovery.scan()
        if (cancelled) return
        console.log('[STAS Discovery] auto-scan result:', result)
      } catch (err) {
        if (!cancelled) console.error('[STAS Discovery] auto-scan error:', err)
      }
    })()
    return () => { cancelled = true }
  }, [walletServiceValues.wallet, walletServiceValues.stas])

  // ---- Context value ----
  const contextValue = useMemo<WalletContextValue>(() => ({
    ...walletServiceValues,
    stasTransferRequests,
    advanceStasTransferQueue,
  }), [walletServiceValues, stasTransferRequests, advanceStasTransferQueue])

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
