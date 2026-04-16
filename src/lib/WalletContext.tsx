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
import { DEFAULT_SETTINGS, WalletSettings } from '@bsv/wallet-toolbox-client/out/src/WalletSettingsManager'
import { WalletPermissionsManager, PrivilegedKeyManager } from '@bsv/wallet-toolbox-client'
import { WalletStorageManager, WalletAuthenticationManager } from '@bsv/wallet-toolbox-client'
import { WalletInterface } from '@bsv/sdk'
import { PeerPayClient, AdvertisementToken } from '@bsv/message-box-client'
import { toast } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'

import { DEFAULT_CHAIN, ADMIN_ORIGINATOR, DEFAULT_USE_WAB } from './config'
import { UserContext } from './UserContext'
import { useWalletService, getWalletService } from './hooks/useWalletService'
import { buildPermissionModuleRegistry } from './permissionModules/registry'
import type { PermissionModuleDefinition, PermissionPromptHandler } from './permissionModules/types'
import type { GroupPermissionRequest, CounterpartyPermissionRequest } from './types/GroupedPermissions'
import type { WalletProfile } from './types/WalletProfile'
import { RequestInterceptorWallet } from './RequestInterceptorWallet'
import { updateRecentApp } from './pages/Dashboard/Apps/getApps'
import { Utils } from '@bsv/sdk'

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
  wallet?: WalletInterface;
  storageManager?: WalletStorageManager;
}

export interface WABConfig {
  wabUrl: string;
  wabInfo: any;
  method: string;
  network: 'main' | 'test';
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
  settings: WalletSettings;
  updateSettings: (newSettings: WalletSettings) => Promise<void>;
  network: 'mainnet' | 'testnet';
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

  // ---- Permissions config (load from localStorage once) ----
  useEffect(() => {
    try {
      const stored = localStorage.getItem('permissionsConfig')
      if (stored) {
        const merged = { ...DEFAULT_PERMISSIONS_CONFIG, ...JSON.parse(stored) }
        svc.permissionQueue.permissionsConfig = merged
      }
    } catch (e) {
      console.error('Failed to load permissions config:', e)
    }
  }, [svc])

  // ---- Dark mode for permission prompts ----
  const tokenPromptPaletteMode = useMemo<import('@mui/material').PaletteMode>(() => {
    const pref = (svc.settings as any)?.theme?.mode ?? 'system'
    if (pref === 'system') return prefersDarkMode ? 'dark' : 'light'
    return pref === 'dark' ? 'dark' : 'light'
  }, [(svc.settings as any)?.theme?.mode, prefersDarkMode])

  // ---- React adapter hook — provides all the context values ----
  const walletServiceValues = useWalletService()

  // ---- onWalletReady integration (replaces Effect 14) ----
  // This stays in React because it depends on onWalletReady prop and activeProfile
  const { managers, activeProfile } = walletServiceValues
  const recentOriginsRef = useRef<Map<string, number>>(new Map())
  const DEBOUNCE_TIME_MS = 5000

  useEffect(() => {
    if (!managers?.walletManager?.authenticated || !activeProfile?.id) {
      console.log('[onWalletReady effect] guard failed — wallet ref not updated yet')
      return
    }

    console.log('[onWalletReady effect] guard passed — updating wallet ref')
    const wallet = managers.walletManager

    const updateRecentAppWrapper = async (profileId: string, origin: string): Promise<void> => {
      try {
        const cacheKey = `${profileId}:${origin}`
        const now = Date.now()
        const lastProcessed = recentOriginsRef.current.get(cacheKey)
        if (lastProcessed && (now - lastProcessed) < DEBOUNCE_TIME_MS) return
        recentOriginsRef.current.set(cacheKey, now)
        await updateRecentApp(profileId, origin)
        window.dispatchEvent(new CustomEvent('recentAppsUpdated', { detail: { profileId, origin } }))
      } catch (error) {
        console.debug('Error tracking recent app:', error)
      }
    }

    const interceptorWallet = new RequestInterceptorWallet(wallet, Utils.toBase64(activeProfile.id), updateRecentAppWrapper)
    // onWalletReady registers IPC listener once, subsequent calls just swap wallet ref
    onWalletReady(interceptorWallet)

    // No cleanup — IPC listener is permanent, wallet ref is swapped not re-registered
  }, [managers?.walletManager?.authenticated, managers?.walletManager, activeProfile?.id, onWalletReady])

  // ---- Context value ----
  const contextValue = useMemo<WalletContextValue>(() => ({
    ...walletServiceValues,
  }), [walletServiceValues])

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
