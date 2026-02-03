import React, { useState, useEffect, createContext, useMemo, useCallback, useContext, useRef } from 'react'
import {
  Wallet,
  WalletPermissionsManager,
  PrivilegedKeyManager,
  WalletStorageManager,
  WalletAuthenticationManager,
  CWIStyleWalletManager,
  OverlayUMPTokenInteractor,
  WalletSigner,
  Services,
  StorageClient,
  TwilioPhoneInteractor,
  DevConsoleInteractor,
  WABClient,
  PermissionRequest,
  SimpleWalletManager,
} from '@bsv/wallet-toolbox-client'
import { StorageElectronIPC } from './StorageElectronIPC'
import {
  PrivateKey,
  SHIPBroadcaster,
  Utils,
  LookupResolver,
  WalletInterface,
  CachedKeyDeriver,
  WalletClient,
} from '@bsv/sdk'
import { DEFAULT_SETTINGS, WalletSettings, WalletSettingsManager } from '@bsv/wallet-toolbox/src/WalletSettingsManager'
import { PeerPayClient, AdvertisementToken } from '@bsv/message-box-client'
import { toast } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'
import { DEFAULT_CHAIN, ADMIN_ORIGINATOR, DEFAULT_USE_WAB } from './config'
import { UserContext } from './UserContext'
import { CounterpartyPermissionRequest, GroupPermissionRequest, GroupedPermissions } from './types/GroupedPermissions'
import { updateRecentApp } from './pages/Dashboard/Apps/getApps'
import { RequestInterceptorWallet } from './RequestInterceptorWallet'
import { WalletProfile } from './types/WalletProfile'

// -----
// Permission Configuration Types
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
  seekBasketInsertionPermissions: true,
  seekBasketListingPermissions: true,
  seekBasketRemovalPermissions: true,
  seekCertificateAcquisitionPermissions: true,
  seekCertificateDisclosurePermissions: true,
  seekCertificateRelinquishmentPermissions: true,
  seekCertificateListingPermissions: true,
  seekGroupedPermission: true,
  seekPermissionsForIdentityKeyRevelation: true,
  seekPermissionsForIdentityResolution: true,
  seekPermissionsForKeyLinkageRevelation: true,
  seekPermissionsForPublicKeyRevelation: true,
  seekPermissionWhenApplyingActionLabels: true,
  seekPermissionWhenListingActionsByLabel: true,
  seekProtocolPermissionsForEncrypting: true,
  seekProtocolPermissionsForHMAC: false,
  seekProtocolPermissionsForSigning: true,
  seekSpendingPermissions: true,
};

// -----
// Context Types
// -----

export type LoginType = 'wab' | 'direct-key' | 'mnemonic-advanced'

export const createDisabledPrivilegedManager = () =>
  new PrivilegedKeyManager(async () => {
    throw new Error('Privileged operations are not available in direct-key mode')
  })

interface ManagerState {
  walletManager?: WalletAuthenticationManager;
  permissionsManager?: WalletPermissionsManager;
  settingsManager?: WalletSettingsManager;
  wallet?: WalletInterface;
  storageManager?: WalletStorageManager;
}

type ConfigStatus = 'editing' | 'configured' | 'initial'

export interface WalletContextValue {
  // Managers:
  managers: ManagerState;
  updateManagers: (newManagers: ManagerState) => void;
  // Settings
  settings: WalletSettings;
  updateSettings: (newSettings: WalletSettings) => Promise<void>;
  network: 'mainnet' | 'testnet';
  // Active Profile
  activeProfile: WalletProfile | null;
  setActiveProfile: (profile: WalletProfile | null) => void;
  // Logout
  logout: () => void;
  adminOriginator: string;
  setPasswordRetriever: (retriever: (reason: string, test: (passwordCandidate: string) => boolean) => Promise<string>) => void
  setRecoveryKeySaver: (saver: (key: number[]) => Promise<true>) => void
  snapshotLoaded: boolean
  basketRequests: BasketAccessRequest[]
  certificateRequests: CertificateAccessRequest[]
  protocolRequests: ProtocolAccessRequest[]
  spendingRequests: SpendingRequest[]
  groupPermissionRequests: GroupPermissionRequest[]
  counterpartyPermissionRequests: CounterpartyPermissionRequest[]
  startPactCooldownForCounterparty: (originator: string, counterparty: string) => void
  advanceBasketQueue: () => void
  advanceCertificateQueue: () => void
  advanceProtocolQueue: () => void
  advanceSpendingQueue: () => void
  setWalletFunder: (funder: (presentationKey: number[], wallet: WalletInterface, adminOriginator: string) => Promise<void>) => void
  setUseWab: (use: boolean) => void
  useWab: boolean
  loginType: LoginType
  setLoginType: (type: LoginType) => void
  advanceGroupQueue: () => void
  advanceCounterpartyPermissionQueue: () => void
  recentApps: any[]
  finalizeConfig: (wabConfig: WABConfig) => boolean
  setConfigStatus: (status: ConfigStatus) => void
  configStatus: ConfigStatus
  wabUrl: string
  setWabUrl: (url: string) => void
  storageUrl: string
  messageBoxUrl: string
  useRemoteStorage: boolean
  useMessageBox: boolean
  saveEnhancedSnapshot: (configOverrides?: { backupStorageUrls?: string[], messageBoxUrl?: string, useMessageBox?: boolean }) => string
  backupStorageUrls: string[]
  addBackupStorageUrl: (url: string) => Promise<void>
  removeBackupStorageUrl: (url: string) => Promise<void>
  syncBackupStorage: (progressCallback?: (message: string) => void) => Promise<void>
  updateMessageBoxUrl: (url: string) => Promise<void>
  removeMessageBoxUrl: () => Promise<void>
  initializingBackendServices: boolean
  permissionsConfig: PermissionsConfig
  updatePermissionsConfig: (config: PermissionsConfig) => Promise<void>
  // PeerPay Client
  peerPayClient: PeerPayClient | null
  // Anointment state and functions
  isHostAnointed: boolean
  anointedHosts: AdvertisementToken[]
  anointmentLoading: boolean
  anointCurrentHost: () => Promise<void>
  revokeHostAnointment: (token: AdvertisementToken) => Promise<void>
  checkAnointmentStatus: () => Promise<void>
}

export const WalletContext = createContext<WalletContextValue>({
  managers: {},
  updateManagers: () => { },
  settings: DEFAULT_SETTINGS,
  updateSettings: async () => { },
  network: 'mainnet',
  activeProfile: null,
  setActiveProfile: () => { },
  logout: () => { },
  adminOriginator: ADMIN_ORIGINATOR,
  setPasswordRetriever: () => { },
  setRecoveryKeySaver: () => { },
  snapshotLoaded: false,
  basketRequests: [],
  certificateRequests: [],
  protocolRequests: [],
  spendingRequests: [],
  groupPermissionRequests: [],
  counterpartyPermissionRequests: [],
  startPactCooldownForCounterparty: () => { },
  advanceBasketQueue: () => { },
  advanceCertificateQueue: () => { },
  advanceProtocolQueue: () => { },
  advanceSpendingQueue: () => { },
  setWalletFunder: () => { },
  setUseWab: () => { },
  useWab: true,
  loginType: 'wab',
  setLoginType: () => { },
  advanceGroupQueue: () => { },
  advanceCounterpartyPermissionQueue: () => { },
  recentApps: [],
  finalizeConfig: () => false,
  setConfigStatus: () => { },
  configStatus: 'initial',
  wabUrl: '',
  setWabUrl: () => { },
  storageUrl: '',
  messageBoxUrl: '',
  useRemoteStorage: false,
  useMessageBox: false,
  saveEnhancedSnapshot: () => { throw new Error('Not initialized') },
  backupStorageUrls: [],
  addBackupStorageUrl: async () => { },
  removeBackupStorageUrl: async () => { },
  syncBackupStorage: async () => { },
  updateMessageBoxUrl: async () => { },
  removeMessageBoxUrl: async () => { },
  initializingBackendServices: false,
  permissionsConfig: DEFAULT_PERMISSIONS_CONFIG,
  updatePermissionsConfig: async () => { },
  peerPayClient: null,
  isHostAnointed: false,
  anointedHosts: [],
  anointmentLoading: false,
  anointCurrentHost: async () => { },
  revokeHostAnointment: async () => { },
  checkAnointmentStatus: async () => { }
})

// ---- Group-gating types ----
type GroupPhase = 'idle' | 'pending';

type GroupDecision = {
  allow: {
    // permissive model; we build this from the granted payload
    protocols?: Set<string> | 'all';
    baskets?: Set<string>;
    certificates?: Array<{ type: string; fields?: Set<string> }>;
    spendingUpTo?: number; // satoshis
  };
};

type PermissionType = 'identity' | 'protocol' | 'renewal' | 'basket';

type BasketAccessRequest = {
  requestID: string
  basket?: string
  originator: string
  reason?: string
  renewal?: boolean
}

type CertificateAccessRequest = {
  requestID: string
  certificate?: {
    certType?: string
    fields?: Record<string, any>
    verifier?: string
  }
  originator: string
  reason?: string
  renewal?: boolean
}

type ProtocolAccessRequest = {
  requestID: string
  protocolSecurityLevel: number
  protocolID: string
  counterparty?: string
  originator?: string
  description?: string
  renewal?: boolean
  type?: PermissionType
}

type SpendingRequest = {
  requestID: string
  originator: string
  description?: string
  transactionAmount: number
  totalPastSpending: number
  amountPreviouslyAuthorized: number
  authorizationAmount: number
  renewal?: boolean
  lineItems: any[]
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

interface WalletContextProps {
  children?: React.ReactNode;
  onWalletReady: (wallet: WalletInterface) => Promise<(() => void) | undefined>;
}

export const WalletContextProvider: React.FC<WalletContextProps> = ({
  children,
  onWalletReady
}) => {
  const [managers, setManagers] = useState<ManagerState>({});
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [adminOriginator, setAdminOriginator] = useState(ADMIN_ORIGINATOR);
  const [recentApps, setRecentApps] = useState([])
  const [activeProfile, setActiveProfile] = useState<WalletProfile | null>(null)
  const [messageBoxUrl, setMessageBoxUrl] = useState('')
  const [backupStorageUrls, setBackupStorageUrls] = useState<string[]>([])

  const { isFocused, onFocusRequested, onFocusRelinquished, setBasketAccessModalOpen, setCertificateAccessModalOpen, setProtocolAccessModalOpen, setSpendingAuthorizationModalOpen, setGroupPermissionModalOpen, setCounterpartyPermissionModalOpen } = useContext(UserContext);

  // Track if we were originally focused
  const [wasOriginallyFocused, setWasOriginallyFocused] = useState(false)

  // Separate request queues for basket and certificate access
  const [basketRequests, setBasketRequests] = useState<BasketAccessRequest[]>([])
  const [certificateRequests, setCertificateRequests] = useState<CertificateAccessRequest[]>([])
  const [protocolRequests, setProtocolRequests] = useState<ProtocolAccessRequest[]>([])
  const [spendingRequests, setSpendingRequests] = useState<SpendingRequest[]>([])
  const [walletFunder, setWalletFunder] = useState<
    (presentationKey: number[], wallet: WalletInterface, adminOriginator: string) => Promise<void>
  >()
  const [loginType, setLoginType] = useState<LoginType>(DEFAULT_USE_WAB ? 'wab' : 'mnemonic-advanced')
  const useWab = loginType === 'wab'
  const setUseWab = (use: boolean) => setLoginType(use ? 'wab' : 'mnemonic-advanced')
  const [useRemoteStorage, setUseRemoteStorage] = useState<boolean>(false)
  const [useMessageBox, setUseMessageBox] = useState<boolean>(false)
  const [groupPermissionRequests, setGroupPermissionRequests] = useState<GroupPermissionRequest[]>([])
  const [counterpartyPermissionRequests, setCounterpartyPermissionRequests] = useState<CounterpartyPermissionRequest[]>([])
  const [initializingBackendServices, setInitializingBackendServices] = useState<boolean>(false)
  const [permissionsConfig, setPermissionsConfig] = useState<PermissionsConfig>(DEFAULT_PERMISSIONS_CONFIG)
  const [peerPayClient, setPeerPayClient] = useState<PeerPayClient | null>(null)
  const [isHostAnointed, setIsHostAnointed] = useState<boolean>(false)
  const [anointedHosts, setAnointedHosts] = useState<AdvertisementToken[]>([])
  const [anointmentLoading, setAnointmentLoading] = useState<boolean>(false)

  // Load permissions config from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem('permissionsConfig');
      if (stored) {
        const parsed = JSON.parse(stored);
        const merged = { ...DEFAULT_PERMISSIONS_CONFIG, ...parsed };
        merged.seekBasketInsertionPermissions = true
        merged.seekBasketListingPermissions = true
        merged.seekBasketRemovalPermissions = true
        merged.seekCertificateAcquisitionPermissions = true
        merged.seekCertificateDisclosurePermissions = true
        merged.seekCertificateRelinquishmentPermissions = true
        merged.seekCertificateListingPermissions = true
        merged.seekSpendingPermissions = true
        setPermissionsConfig(merged);
      }
    } catch (e) {
      console.error('Failed to load permissions config from localStorage:', e);
    }
  }, []);

  // ---- Group gate & deferred buffers ----
  const [groupPhase, setGroupPhase] = useState<GroupPhase>('idle');
  const groupDecisionRef = useRef<GroupDecision | null>(null);
  const groupTimerRef = useRef<number | null>(null);
  const permissionsManagerRef = useRef<any>(null);
  const walletManagerInitInFlightRef = useRef(false)
  const pendingGroupFocusRequestIdRef = useRef<string | null>(null);
  const groupDidRequestFocusRef = useRef(false);
  const groupRequestCooldownKeyByIdRef = useRef<Map<string, string>>(new Map());
  const groupCooldownUntilRef = useRef<Record<string, number>>({});
  const pactCooldownUntilRef = useRef<Record<string, number>>({});
  const GROUP_GRACE_MS = 20000; // release if no answer within 20s (tweak as desired)
  const GROUP_COOLDOWN_MS = 5 * 60 * 1000;
  const PACT_COOLDOWN_MS = 5 * 60 * 1000;
  const [deferred, setDeferred] = useState<{
    basket: BasketAccessRequest[],
    certificate: CertificateAccessRequest[],
    protocol: ProtocolAccessRequest[],
    spending: SpendingRequest[],
    counterparty: CounterpartyPermissionRequest[],
  }>({ basket: [], certificate: [], protocol: [], spending: [], counterparty: [] });

  const normalizeOriginator = useCallback((o: string) => o.replace(/^https?:\/\//, ''), []);

  const getGroupCooldownKey = useCallback((originator: string, permissions?: GroupedPermissions) => {
    const normalizedOriginator = normalizeOriginator(originator);
    const protocolPermissions = permissions?.protocolPermissions ?? [];
    const hasOnlyProtocols =
      !!protocolPermissions.length &&
      !(permissions?.basketAccess?.length) &&
      !(permissions?.certificateAccess?.length) &&
      !permissions?.spendingAuthorization;

    if (!hasOnlyProtocols) {
      return normalizedOriginator;
    }

    const allLevel2 = protocolPermissions.every(p => (p.protocolID?.[0] ?? 0) === 2);
    if (!allLevel2) {
      return normalizedOriginator;
    }

    const cps = new Set(protocolPermissions.map(p => p.counterparty ?? 'self'));
    if (cps.size !== 1) {
      return normalizedOriginator;
    }

    const counterparty = protocolPermissions[0]?.counterparty ?? 'self';
    return `${normalizedOriginator}|${counterparty}`;
  }, [normalizeOriginator]);

  const isGroupCooldownActive = useCallback((key: string) => {
    const until = groupCooldownUntilRef.current[key] ?? 0;
    return Date.now() < until;
  }, []);

  const startGroupCooldown = useCallback((key: string) => {
    groupCooldownUntilRef.current[key] = Date.now() + GROUP_COOLDOWN_MS;
  }, []);

  const isPactCooldownActive = useCallback((key: string) => {
    const until = pactCooldownUntilRef.current[key] ?? 0;
    return Date.now() < until;
  }, []);

  const startPactCooldown = useCallback((key: string) => {
    pactCooldownUntilRef.current[key] = Date.now() + PACT_COOLDOWN_MS;
  }, []);

  const startPactCooldownForCounterparty = useCallback((originator: string, counterparty: string) => {
    const key = `${normalizeOriginator(originator)}|${counterparty}`
    startPactCooldown(key)
  }, [normalizeOriginator, startPactCooldown])

  useEffect(() => {
    permissionsManagerRef.current = managers.permissionsManager;
  }, [managers.permissionsManager]);

  const deferRequest = <T,>(key: keyof typeof deferred, item: T) => {
    setDeferred(prev => ({ ...prev, [key]: [...(prev as any)[key], item] as any }));
  };

  // Decide if an item is covered by the group decision (conservative, adapt if needed)
  const isCoveredByDecision = (d: GroupDecision | null, req: any): boolean => {
    if (!d) return false;
    // Basket
    if ('basket' in req) {
      return !!d.allow.baskets && !!req.basket && d.allow.baskets.has(req.basket);
    }
    // Certificate
    if ('certificateType' in req || 'type' in req) {
      const type = (req.certificateType ?? req.type) as string | undefined;
      const fields = new Set<string>(req.fieldsArray ?? req.fields ?? []);
      if (!type) return false;
      const rule = d.allow.certificates?.find(c => c.type === type);
      if (!rule) return false;
      if (!rule.fields || rule.fields.size === 0) return true;
      for (const f of fields) if (!rule.fields.has(f)) return false;
      return true;
    }
    // Protocol
    if ('protocolID' in req) {
      if (d.allow.protocols === 'all') return true;
      if (!(d.allow.protocols instanceof Set)) return false;
      const key = req.protocolSecurityLevel === 2
        ? `${req.protocolID}|${req.counterparty ?? 'self'}`
        : req.protocolID;
      return d.allow.protocols.has(key);
    }
    // Spending
    if ('authorizationAmount' in req) {
      return d.allow.spendingUpTo != null && req.authorizationAmount <= (d.allow.spendingUpTo as number);
    }
    return false;
  };

  // Build decision object from the "granted" payload used by grantGroupedPermission
  const decisionFromGranted = (granted: any): GroupDecision => {
    const protocols = (() => {
      const arr = granted?.protocolPermissions ?? granted?.protocols ?? [];
      const names = new Set<string>();
      for (const p of arr) {
        const id = p?.protocolID;
        if (Array.isArray(id) && id.length > 1 && typeof id[1] === 'string') {
          const sec = id[0];
          const name = id[1];
          const counterparty = p?.counterparty ?? 'self';
          const key = sec === 2 ? `${name}|${counterparty}` : name;
          names.add(key);
        }
        else if (typeof id === 'string') names.add(id);
        else if (typeof p?.name === 'string') names.add(p.name);
      }
      return names;
    })();
    const baskets = (() => {
      const arr = granted?.basketAccess ?? granted?.baskets ?? [];
      const set = new Set<string>();
      for (const b of arr) {
        if (typeof b === 'string') set.add(b);
        else if (typeof b?.basket === 'string') set.add(b.basket);
      }
      return set;
    })();
    const certificates = (() => {
      const arr = granted?.certificateAccess ?? granted?.certificates ?? [];
      const out: Array<{ type: string; fields?: Set<string> }> = [];
      for (const c of arr) {
        const type = c?.type ?? c?.certificateType;
        if (typeof type === 'string') {
          const fields = new Set<string>((c?.fields ?? []).filter((x: any) => typeof x === 'string'));
          out.push({ type, fields: fields.size ? fields : undefined });
        }
      }
      return out;
    })();
    const spendingUpTo = (() => {
      const s = granted?.spendingAuthorization ?? granted?.spending ?? null;
      if (!s) return undefined;
      if (typeof s === 'number') return s;
      if (typeof s?.satoshis === 'number') return s.satoshis;
      return undefined;
    })();
    return { allow: { protocols, baskets, certificates, spendingUpTo } };
  };

  // Release buffered requests after group decision (or on timeout/deny)
  const releaseDeferredAfterGroup = async (decision: GroupDecision | null) => {
    if (groupTimerRef.current) { window.clearTimeout(groupTimerRef.current); groupTimerRef.current = null; }
    groupDecisionRef.current = decision;


    const requeue = {
      basket: [] as BasketAccessRequest[],
      certificate: [] as CertificateAccessRequest[],
      protocol: [] as ProtocolAccessRequest[],
      spending: [] as SpendingRequest[],
      counterparty: [] as CounterpartyPermissionRequest[],
    };

    const maybeHandle = async (list: any[], key: keyof typeof requeue) => {
      for (const r of list) {
        if (isCoveredByDecision(decision, r)) {
          // Covered by grouped decision — do not requeue; grouped grant should satisfy it.
          // If you need explicit per-request approval, call it here against permissionsManager.
          // Example (adjust to your API):
          // await managers.permissionsManager?.respondToRequest(r.requestID, { approved: true });
        } else {
          (requeue as any)[key].push(r);
        }
      }
    };

    await maybeHandle(deferred.basket, 'basket');
    await maybeHandle(deferred.certificate, 'certificate');
    await maybeHandle(deferred.protocol, 'protocol');
    await maybeHandle(deferred.spending, 'spending');

    await maybeHandle(deferred.counterparty, 'counterparty');

    setDeferred({ basket: [], certificate: [], protocol: [], spending: [], counterparty: [] });
    setGroupPhase('idle');

    // Re-open the uncovered ones via your existing flows
    if (requeue.basket.length) { setBasketRequests(requeue.basket); setBasketAccessModalOpen(true); }
    if (requeue.certificate.length) { setCertificateRequests(requeue.certificate); setCertificateAccessModalOpen(true); }
    if (requeue.protocol.length) { setProtocolRequests(requeue.protocol); setProtocolAccessModalOpen(true); }
    if (requeue.spending.length) { setSpendingRequests(requeue.spending); setSpendingAuthorizationModalOpen(true); }
    if (requeue.counterparty.length) { setCounterpartyPermissionRequests(requeue.counterparty); setCounterpartyPermissionModalOpen(true); }
  };

  const advanceCounterpartyPermissionQueue = () => {
    setCounterpartyPermissionRequests(prev => prev.slice(1))
  }

  useEffect(() => {
    if (counterpartyPermissionRequests.length === 0) {
      setCounterpartyPermissionModalOpen(false)
      if (!wasOriginallyFocused) {
        onFocusRelinquished()
      }
    }
  }, [counterpartyPermissionRequests.length, onFocusRelinquished, setCounterpartyPermissionModalOpen, wasOriginallyFocused])

  const counterpartyPermissionCallback = useCallback(async (args: CounterpartyPermissionRequest): Promise<void> => {
    if (!args?.requestID || !args?.permissions) {
      return Promise.resolve()
    }

    const newItem: CounterpartyPermissionRequest = {
      requestID: args.requestID,
      originator: args.originator,
      counterparty: args.counterparty,
      counterpartyLabel: args.counterpartyLabel,
      permissions: args.permissions,
    }

    const cooldownKey = `${normalizeOriginator(args.originator)}|${args.counterparty}`
    if (isPactCooldownActive(cooldownKey)) {
      try {
        await (permissionsManagerRef.current as any)?.grantCounterpartyPermission?.({
          requestID: args.requestID,
          granted: { protocols: [] },
          expiry: 0
        })
      } catch (error) {
        console.debug('Failed to auto-dismiss counterparty permission during cooldown:', error)
      }
      return Promise.resolve()
    }

    if (groupPhase === 'pending') {
      deferRequest('counterparty', newItem)
      return Promise.resolve()
    }

    return new Promise<void>(resolve => {
      setCounterpartyPermissionRequests(prev => {
        const wasEmpty = prev.length === 0

        if (wasEmpty) {
          isFocused().then(currentlyFocused => {
            setWasOriginallyFocused(currentlyFocused)
            if (!currentlyFocused) {
              onFocusRequested()
            }
            setCounterpartyPermissionModalOpen(true)
          })
        }

        resolve()
        return [...prev, newItem]
      })
    })
  }, [deferRequest, groupPhase, isFocused, isPactCooldownActive, normalizeOriginator, onFocusRequested, setCounterpartyPermissionModalOpen])

  const updateSettings = useCallback(async (newSettings: WalletSettings) => {
    if (!managers.settingsManager) {
      throw new Error('The user must be logged in to update settings!')
    }
    await managers.settingsManager.set(newSettings);
    setSettings(newSettings);
  }, [managers.settingsManager]);

  // ---- Callbacks for password/recovery/etc.
  const [passwordRetriever, setPasswordRetriever] = useState<
    (reason: string, test: (passwordCandidate: string) => boolean) => Promise<string>
  >();
  const [recoveryKeySaver, setRecoveryKeySaver] = useState<
    (key: number[]) => Promise<true>
  >();


  // Provide a handler for basket-access requests that enqueues them
  const basketAccessCallback = useCallback((incomingRequest: PermissionRequest & {
    requestID: string
    basket?: string
    originator: string
    reason?: string
    renewal?: boolean
  }) => {
    // Gate while group is pending
    if (groupPhase === 'pending') {
      if (incomingRequest?.requestID) {
        deferRequest('basket', {
          requestID: incomingRequest.requestID,
          basket: incomingRequest.basket,
          originator: incomingRequest.originator,
          reason: incomingRequest.reason,
          renewal: incomingRequest.renewal
        });
      }
      return;
    }
    // Enqueue the new request
    if (incomingRequest?.requestID) {
      setBasketRequests(prev => {
        const wasEmpty = prev.length === 0

        // If no requests were queued, handle focusing logic right away
        if (wasEmpty) {
          isFocused().then(currentlyFocused => {
            setWasOriginallyFocused(currentlyFocused)
            if (!currentlyFocused) {
              onFocusRequested()
            }
            setBasketAccessModalOpen(true)
          })
        }

        return [
          ...prev,
          {
            requestID: incomingRequest.requestID,
            basket: incomingRequest.basket,
            originator: incomingRequest.originator,
            reason: incomingRequest.reason,
            renewal: incomingRequest.renewal
          }
        ]
      })
    }
  }, [groupPhase, isFocused, onFocusRequested])

  // Provide a handler for certificate-access requests that enqueues them
  const certificateAccessCallback = useCallback((incomingRequest: PermissionRequest & {
    requestID: string
    certificate?: {
      certType?: string
      fields?: Record<string, any>
      verifier?: string
    }
    originator: string
    reason?: string
    renewal?: boolean
  }) => {
    // Gate while group is pending
    if (groupPhase === 'pending') {
      const certificate = incomingRequest.certificate as any
      deferRequest('certificate', {
        requestID: incomingRequest.requestID,
        originator: incomingRequest.originator,
        verifierPublicKey: certificate?.verifier || '',
        certificateType: certificate?.certType || '',
        fieldsArray: Object.keys(certificate?.fields || {}),
        description: incomingRequest.reason,
        renewal: incomingRequest.renewal
      } as any)
      return
    }

    // Enqueue the new request
    if (incomingRequest?.requestID) {
      setCertificateRequests(prev => {
        const wasEmpty = prev.length === 0

        // If no requests were queued, handle focusing logic right away
        if (wasEmpty) {
          isFocused().then(currentlyFocused => {
            setWasOriginallyFocused(currentlyFocused)
            if (!currentlyFocused) {
              onFocusRequested()
            }
            setCertificateAccessModalOpen(true)
          })
        }

        // Extract certificate data, safely handling potentially undefined values
        const certificate = incomingRequest.certificate as any
        const certType = certificate?.certType || ''
        const fields = certificate?.fields || {}

        // Extract field names as an array for the CertificateChip component
        const fieldsArray = fields ? Object.keys(fields) : []

        const verifier = certificate?.verifier || ''

        return [
          ...prev,
          {
            requestID: incomingRequest.requestID,
            originator: incomingRequest.originator,
            verifierPublicKey: verifier,
            certificateType: certType,
            fieldsArray,
            description: incomingRequest.reason,
            renewal: incomingRequest.renewal
          } as any
        ]
      })
    }
  }, [groupPhase, isFocused, onFocusRequested])

  // Provide a handler for protocol permission requests that enqueues them
  const protocolPermissionCallback = useCallback((args: PermissionRequest & { requestID: string }): Promise<void> => {
    const {
      requestID,
      counterparty,
      originator,
      reason,
      renewal,
      protocolID
    } = args

    if (!requestID || !protocolID) {
      return Promise.resolve()
    }

    const [protocolSecurityLevel, protocolNameString] = protocolID

    // Determine type of permission
    let permissionType: PermissionType = 'protocol'
    if (protocolNameString === 'identity resolution') {
      permissionType = 'identity'
    } else if (renewal) {
      permissionType = 'renewal'
    } else if (protocolNameString.includes('basket')) {
      permissionType = 'basket'
    }

    // Create the new permission request
    const newItem: ProtocolAccessRequest = {
      requestID,
      protocolSecurityLevel,
      protocolID: protocolNameString,
      counterparty,
      originator,
      description: reason,
      renewal,
      type: permissionType
    }

    if (groupPhase === 'pending') {
      deferRequest('protocol', newItem)
      return Promise.resolve()
    }

    // Enqueue the new request
    return new Promise<void>(resolve => {
      setProtocolRequests(prev => {
        const wasEmpty = prev.length === 0

        // If no requests were queued, handle focusing logic right away
        if (wasEmpty) {
          isFocused().then(currentlyFocused => {
            setWasOriginallyFocused(currentlyFocused)
            if (!currentlyFocused) {
              onFocusRequested()
            }
            setProtocolAccessModalOpen(true)
          })
        }

        resolve()
        return [...prev, newItem]
      })
    })
  }, [groupPhase, isFocused, onFocusRequested])

  // Provide a handler for spending authorization requests that enqueues them
  const spendingAuthorizationCallback = useCallback(async (args: PermissionRequest & { requestID: string }): Promise<void> => {
    const {
      requestID,
      originator,
      reason,
      renewal,
      spending
    } = args

    if (!requestID || !spending) {
      return Promise.resolve()
    }

    let {
      satoshis,
      lineItems
    } = spending

    if (!lineItems) {
      lineItems = []
    }

    // TODO: support these
    const transactionAmount = 0
    const totalPastSpending = 0
    const amountPreviouslyAuthorized = 0

    // Create the new permission request
    const newItem: SpendingRequest = {
      requestID,
      originator,
      description: reason,
      transactionAmount,
      totalPastSpending,
      amountPreviouslyAuthorized,
      authorizationAmount: satoshis,
      renewal,
      lineItems
    }

    if (groupPhase === 'pending') {
      deferRequest('spending', newItem)
      return
    }

    // Enqueue the new request
    return new Promise<void>(resolve => {
      setSpendingRequests(prev => {
        const wasEmpty = prev.length === 0

        // If no requests were queued, handle focusing logic right away
        if (wasEmpty) {
          isFocused().then(currentlyFocused => {
            setWasOriginallyFocused(currentlyFocused)
            if (!currentlyFocused) {
              onFocusRequested()
            }
            setSpendingAuthorizationModalOpen(true)
          })
        }

        resolve()
        return [...prev, newItem]
      })
    })
  }, [groupPhase, isFocused, onFocusRequested])

  // Provide a handler for group permission requests that enqueues them
  const groupPermissionCallback = useCallback(async (args: {
    requestID: string,
    permissions: GroupedPermissions,
    originator: string,
    reason?: string
  }): Promise<void> => {
    const {
      requestID,
      originator,
      permissions
    } = args

    if (!requestID || !permissions) {
      return Promise.resolve()
    }

    if (requestID.startsWith('group-peer:')) {
      const parts = requestID.split(':')
      const counterparty = parts[parts.length - 1] || 'self'
      const newItem: CounterpartyPermissionRequest = {
        requestID,
        originator,
        counterparty,
        permissions: {
          protocols: (permissions?.protocolPermissions || []).map(p => ({
            protocolID: p.protocolID,
            description: p.description
          }))
        }
      }

      const cooldownKey = `${normalizeOriginator(originator)}|${counterparty}`
      if (isPactCooldownActive(cooldownKey)) {
        try {
          await (permissionsManagerRef.current as any)?.dismissGroupedPermission?.(requestID)
        } catch (error) {
          console.debug('Failed to dismiss peer-grouped permission during cooldown:', error)
        }
        return Promise.resolve()
      }

      if (groupPhase === 'pending') {
        deferRequest('counterparty', newItem)
        return Promise.resolve()
      }

      return new Promise<void>(resolve => {
        setCounterpartyPermissionRequests(prev => {
          const wasEmpty = prev.length === 0

          if (wasEmpty) {
            isFocused().then(currentlyFocused => {
              setWasOriginallyFocused(currentlyFocused)
              if (!currentlyFocused) {
                onFocusRequested()
              }
              setCounterpartyPermissionModalOpen(true)
            })
          }

          resolve()
          return [...prev, newItem]
        })
      })
    }

    // Create the new permission request
    const newItem: GroupPermissionRequest = {
      requestID,
      originator,
      permissions
    }

    const cooldownKey = getGroupCooldownKey(originator, permissions)
    groupRequestCooldownKeyByIdRef.current.set(requestID, cooldownKey)

    if (isGroupCooldownActive(cooldownKey)) {
      try {
        await (permissionsManagerRef.current as any)?.dismissGroupedPermission?.(requestID)
      } catch (error) {
        console.debug('Failed to dismiss grouped permission during cooldown:', error)
      }
      groupRequestCooldownKeyByIdRef.current.delete(requestID)
      return Promise.resolve()
    }

    // Enqueue the new request
    return new Promise<void>(resolve => {
      setGroupPermissionRequests(prev => {
        const wasEmpty = prev.length === 0

        // If no requests were queued, handle focusing logic right away
        if (wasEmpty) {
          pendingGroupFocusRequestIdRef.current = requestID
          groupDidRequestFocusRef.current = false
          setGroupPermissionModalOpen(true)
          isFocused().then(currentlyFocused => {
            if (pendingGroupFocusRequestIdRef.current !== requestID) return
            setWasOriginallyFocused(currentlyFocused)
            if (!currentlyFocused) {
              groupDidRequestFocusRef.current = true
              onFocusRequested()
            }
          })
        }

        resolve()
        return [...prev, newItem]
      })
    })
  }, [deferRequest, getGroupCooldownKey, groupPhase, isFocused, isGroupCooldownActive, isPactCooldownActive, normalizeOriginator, onFocusRequested, setCounterpartyPermissionModalOpen, setGroupPermissionModalOpen])

  // ---- ENTER GROUP PENDING MODE & PAUSE OTHERS when group request enqueued ----
  useEffect(() => {
    if (groupPermissionRequests.length > 0 && groupPhase !== 'pending') {
      setGroupPhase('pending')
      // Move any currently queued requests into deferred buffers
      setDeferred(prev => ({
        basket: [...prev.basket, ...basketRequests],
        certificate: [...prev.certificate, ...certificateRequests],
        protocol: [...prev.protocol, ...protocolRequests],
        spending: [...prev.spending, ...spendingRequests],
        counterparty: [...prev.counterparty, ...counterpartyPermissionRequests],
      }))
      // Clear queues & close their modals to avoid "fighting" dialogs
      setBasketRequests([]); setCertificateRequests([]); setProtocolRequests([]); setSpendingRequests([])
      setBasketAccessModalOpen(false); setCertificateAccessModalOpen(false); setProtocolAccessModalOpen(false); setSpendingAuthorizationModalOpen(false)
      setCounterpartyPermissionRequests([]); setCounterpartyPermissionModalOpen(false)
      // Start grace timer so the app doesn't stall if user never answers
      if (groupTimerRef.current) window.clearTimeout(groupTimerRef.current)
      groupTimerRef.current = window.setTimeout(() => {
        releaseDeferredAfterGroup(null)
      }, GROUP_GRACE_MS)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupPermissionRequests.length])

  // ---- WAB + network + storage configuration ----
  const [wabUrl, setWabUrl] = useState<string>('');
  const [wabInfo, setWabInfo] = useState<{
    supportedAuthMethods: string[];
    faucetEnabled: boolean;
    faucetAmount: number;
  } | null>(null);

  const [selectedAuthMethod, setSelectedAuthMethod] = useState<string>("");
  const [selectedNetwork, setSelectedNetwork] = useState<'main' | 'test'>(DEFAULT_CHAIN); // "test" or "main"
  const [selectedStorageUrl, setSelectedStorageUrl] = useState<string>('');

  // Flag that indicates configuration is complete. For returning users,
  // if a snapshot exists we auto-mark configComplete.
  const [configStatus, setConfigStatus] = useState<ConfigStatus>('initial');
  // Used to trigger a re-render after snapshot load completes.
  const [snapshotLoaded, setSnapshotLoaded] = useState<boolean>(false);

  // Fetch WAB info for first-time configuration
  const fetchWabInfo = useCallback(async () => {
    if (!useWab || !wabUrl) return null
    try {
      const response = await fetch(`${wabUrl}/info`);
      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}: ${response.statusText}`);
      }

      const info = await response.json();
      setWabInfo(info);

      // If there's only one auth method, auto-select it
      if (info.supportedAuthMethods && info.supportedAuthMethods.length === 1) {
        setSelectedAuthMethod(info.supportedAuthMethods[0]);
      }
      return info;
    } catch (error: any) {
      console.error("Error fetching WAB info", error);
      toast.error("Could not fetch WAB info: " + error.message);
      return null;
    }
  }, [wabUrl, useWab]);

  // Auto-fetch WAB info and apply default configuration when component mounts
  useEffect(() => {
    if (!localStorage.snap && configStatus === 'initial' && useWab) {
      (async () => {
        try {
          const info = await fetchWabInfo();

          if (info && info.supportedAuthMethods && info.supportedAuthMethods.length > 0) {
            setSelectedAuthMethod(info.supportedAuthMethods[0]);
            // Automatically apply default configuration
            setConfigStatus('configured');
          }
        } catch (error: any) {
          console.error("Error in initial WAB setup", error);
        }
      })();
    }
  }, [wabUrl, configStatus, fetchWabInfo, useWab]);

  // For new users: mark configuration complete when WalletConfig is submitted.
  const finalizeConfig = (wabConfig: WABConfig) => {
    const { wabUrl, wabInfo, method, network, storageUrl, useWab: useWabSetting, loginType: loginTypeSetting, messageBoxUrl, useRemoteStorage, useMessageBox } = wabConfig
    const effectiveLoginType = loginTypeSetting || (useWabSetting !== false ? 'wab' : 'mnemonic-advanced')
    try {
      if (effectiveLoginType === 'wab') {
        if (!wabUrl) {
          toast.error("WAB Server URL is required");
          return;
        }

        if (!wabInfo || !method) {
          toast.error("Auth Method selection is required");
          return;
        }
      }

      if (!network) {
        toast.error("Network selection is required");
        return;
      }

      if (useRemoteStorage && !storageUrl) {
        toast.error("Storage URL is required when Remote Storage is enabled");
        return;
      }

      if (useMessageBox && !messageBoxUrl) {
        toast.error("Message Box URL is required when Message Box is enabled");
        return;
      }

      // Trim trailing slashes from URLs
      const trimmedWabUrl = (wabUrl || '').replace(/\/+$/, '');
      const trimmedStorageUrl = (storageUrl || '').replace(/\/+$/, '');
      const trimmedMessageBoxUrl = (messageBoxUrl || '').replace(/\/+$/, '');

      setLoginType(effectiveLoginType)
      setWabUrl(trimmedWabUrl)
      setWabInfo(wabInfo)
      setSelectedAuthMethod(method)
      setSelectedNetwork(network)
      setSelectedStorageUrl(trimmedStorageUrl)
      setMessageBoxUrl(trimmedMessageBoxUrl)
      setUseRemoteStorage(useRemoteStorage || false)
      setUseMessageBox(useMessageBox || false)

      // Save the configuration
      toast.success("Configuration applied successfully!");
      setConfigStatus('configured');
      return true
    } catch (error: any) {
      console.error("Error applying configuration:", error);
      toast.error("Failed to apply configuration: " + (error.message || "Unknown error"));
      return false
    }
  }

  // Build wallet function
  const buildWallet = useCallback(async (
    primaryKey: number[],
    privilegedKeyManager: PrivilegedKeyManager
  ): Promise<any> => {
    console.log('[buildWallet] ========== STARTING WALLET BUILD ==========');
    console.log('[buildWallet] Network:', selectedNetwork);
    console.log('[buildWallet] Use Remote Storage:', useRemoteStorage);
    console.log('[buildWallet] Storage URL:', selectedStorageUrl);
    console.log('[buildWallet] Admin Originator:', adminOriginator);

    setInitializingBackendServices(true);

    try {
      const newManagers = {} as any;
      const chain = selectedNetwork;
      const keyDeriver = new CachedKeyDeriver(new PrivateKey(primaryKey));
      console.log('[buildWallet] Created KeyDeriver with identityKey:', keyDeriver.identityKey);

      // First, create and initialize the primary/active storage provider
      let activeStorage: any;
      const services = new Services(chain);

      if (useRemoteStorage) {
        console.log('[buildWallet] Preparing REMOTE storage as active:', selectedStorageUrl);
        // We'll create this after the wallet
        activeStorage = null; // Will be created below
      } else {
        console.log('[buildWallet] Preparing LOCAL Electron storage as active');
        // Create and initialize local storage first
        const electronStorage = new StorageElectronIPC(keyDeriver.identityKey, chain);
        electronStorage.setServices(services as any);
        console.log('[buildWallet] Initializing backend services...');
        await electronStorage.initializeBackendServices();
        console.log('[buildWallet] Making local storage available...');
        await electronStorage.makeAvailable();
        activeStorage = electronStorage;
      }

      // Create backup storage providers array
      const backupProviders: any[] = [];

      // Create WalletStorageManager with active storage
      // Constructor signature: WalletStorageManager(identityKey, active?, backups?)
      const storageManager = new WalletStorageManager(keyDeriver.identityKey, activeStorage, backupProviders);
      console.log('[buildWallet] Created WalletStorageManager with active storage');

      const signer = new WalletSigner(chain, keyDeriver as any, storageManager);
      const wallet = new Wallet(signer, services, undefined, privilegedKeyManager);
      newManagers.settingsManager = wallet.settingsManager;
      newManagers.wallet = wallet;
      newManagers.storageManager = storageManager;
      console.log('[buildWallet] Created Wallet, Signer, Services');

      // If using remote storage, create it now and add it as active
      if (useRemoteStorage) {
        console.log('[buildWallet] Creating REMOTE storage client:', selectedStorageUrl);
        const client = new StorageClient(wallet, selectedStorageUrl);
        await client.makeAvailable();
        await storageManager.addWalletStorageProvider(client);
        console.log('[buildWallet] Remote storage added to WalletStorageManager');
      }

      // Get all stores and set the first one (primary) as active
      const stores = storageManager.getStores();
      if (stores && stores.length > 0) {
        const activeStoreKey = stores[0].storageIdentityKey;
        console.log('[buildWallet] Setting active storage:', activeStoreKey);
        await storageManager.setActive(activeStoreKey);
        console.log('[buildWallet] Active storage configured');
      }

      // Add backup storage providers if configured
      if (backupStorageUrls && backupStorageUrls.length > 0) {
        console.log('[buildWallet] Adding BACKUP storage providers:', backupStorageUrls.length);
        for (const backupUrl of backupStorageUrls) {
          try {
            console.log('[buildWallet] Adding backup storage:', backupUrl);

            // Handle LOCAL_STORAGE special case
            if (backupUrl === 'LOCAL_STORAGE') {
              const electronStorage = new StorageElectronIPC(keyDeriver.identityKey, chain);
              electronStorage.setServices(services as any);
              await electronStorage.makeAvailable();
              await storageManager.addWalletStorageProvider(electronStorage as any);
              console.log('[buildWallet] Local Electron storage added as backup');
            } else {
              // Remote storage client
              const backupClient = new StorageClient(wallet, backupUrl);
              await backupClient.makeAvailable();
              await storageManager.addWalletStorageProvider(backupClient);
              console.log('[buildWallet] Backup storage added:', backupUrl);
            }
          } catch (error: any) {
            console.error('[buildWallet] Failed to add backup storage:', backupUrl, error);
            toast.error(`Failed to connect to backup storage ${backupUrl}: ${error.message}`);
          }
        }
      }

      console.log('[buildWallet] Setting up permissions manager...');
      // Setup permissions with provided callbacks.
      const permissionsManager = new WalletPermissionsManager(wallet, adminOriginator, permissionsConfig);

      permissionsManagerRef.current = permissionsManager;

      if (protocolPermissionCallback) {
        permissionsManager.bindCallback('onProtocolPermissionRequested', protocolPermissionCallback);
      }
      if (basketAccessCallback) {
        permissionsManager.bindCallback('onBasketAccessRequested', basketAccessCallback);
      }
      if (spendingAuthorizationCallback) {
        permissionsManager.bindCallback('onSpendingAuthorizationRequested', spendingAuthorizationCallback);
      }
      if (certificateAccessCallback) {
        permissionsManager.bindCallback('onCertificateAccessRequested', certificateAccessCallback);
      }

      if (groupPermissionCallback) {
        permissionsManager.bindCallback('onGroupedPermissionRequested', groupPermissionCallback);
      }

      if (counterpartyPermissionCallback) {
        try {
          ;(permissionsManager as any).bindCallback('onCounterpartyPermissionRequested', counterpartyPermissionCallback as any);
        } catch (e) {
          console.warn('[buildWallet] onCounterpartyPermissionRequested callback not supported by WalletPermissionsManager:', e);
        }
      }

      // ---- Proxy grouped-permission grant/deny so we can release the gate automatically ----
      const originalGrantGrouped = (permissionsManager as any).grantGroupedPermission?.bind(permissionsManager);
      const originalDenyGrouped = (permissionsManager as any).denyGroupedPermission?.bind(permissionsManager);
      const originalDismissGrouped = (permissionsManager as any).dismissGroupedPermission?.bind(permissionsManager);
      if (originalGrantGrouped) {
        (permissionsManager as any).grantGroupedPermission = async (requestID: string, granted: any) => {
          const res = await originalGrantGrouped(requestID, granted);
          try { await releaseDeferredAfterGroup(decisionFromGranted(granted)); } catch {}
          const key = groupRequestCooldownKeyByIdRef.current.get(requestID)
          if (key) {
            startGroupCooldown(key)
            groupRequestCooldownKeyByIdRef.current.delete(requestID)
          }
          return res;
        };
      }
      if (originalDenyGrouped) {
        (permissionsManager as any).denyGroupedPermission = async (requestID: string) => {
          const res = await originalDenyGrouped(requestID);
          try { await releaseDeferredAfterGroup(null); } catch {}
          const key = groupRequestCooldownKeyByIdRef.current.get(requestID)
          if (key) {
            startGroupCooldown(key)
            groupRequestCooldownKeyByIdRef.current.delete(requestID)
          }
          return res;
        };
      }

      if (originalDismissGrouped) {
        (permissionsManager as any).dismissGroupedPermission = async (requestID: string) => {
          const res = await originalDismissGrouped(requestID);
          try { await releaseDeferredAfterGroup(null); } catch {}
          const key = groupRequestCooldownKeyByIdRef.current.get(requestID)
          if (key) {
            startGroupCooldown(key)
            groupRequestCooldownKeyByIdRef.current.delete(requestID)
          }
          return res;
        }
      }

      console.log('[buildWallet] Binding permission callbacks...');
      // Store in window for debugging
      (window as any).permissionsManager = permissionsManager;
      newManagers.permissionsManager = permissionsManager;

      setManagers(m => ({ ...m, ...newManagers }));
      console.log('[buildWallet] ========== WALLET BUILD COMPLETE ==========');
      console.log('[buildWallet] Returning permissionsManager');

      setInitializingBackendServices(false);
      return permissionsManager;
    } catch (error: any) {
      console.error("[buildWallet] ========== WALLET BUILD FAILED ==========");
      console.error("[buildWallet] Error:", error);
      console.error("[buildWallet] Stack:", error.stack);
      toast.error("Failed to build wallet: " + error.message);
      setInitializingBackendServices(false);
      return null;
    }
  }, [
    selectedNetwork,
    selectedStorageUrl,
    adminOriginator,
    protocolPermissionCallback,
    basketAccessCallback,
    spendingAuthorizationCallback,
    certificateAccessCallback,
    groupPermissionCallback,
    useRemoteStorage,
    backupStorageUrls
  ]);

  // ---- Enhanced Snapshot V3 with Config ----

  /**
   * Saves an enhanced Version 3 snapshot that wraps the wallet-toolbox snapshot
   * with WalletConfig settings.
   * Format: [version=3][varint:config_length][config_json][wallet_snapshot]
   */
  const saveEnhancedSnapshot = useCallback((configOverrides?: { backupStorageUrls?: string[], messageBoxUrl?: string, useMessageBox?: boolean }) => {
    if (!managers.walletManager) {
      throw new Error('Wallet manager not available for snapshot');
    }

    // Get the wallet-toolbox snapshot (Version 2)
    const walletSnapshot = managers.walletManager.saveSnapshot();

    // Build config object - use override if provided, otherwise use current state
    const config = {
      network: selectedNetwork,
      useWab,
      loginType,
      wabUrl,
      authMethod: selectedAuthMethod,
      useRemoteStorage,
      storageUrl: selectedStorageUrl,
      backupStorageUrls: configOverrides?.backupStorageUrls || backupStorageUrls,
      useMessageBox: configOverrides?.useMessageBox || useMessageBox,
      messageBoxUrl: configOverrides?.messageBoxUrl || messageBoxUrl,
    };
    console.log('[saveEnhancedSnapshot] Saving config:', { configOverrides });

    // Serialize config to JSON bytes
    const configJson = JSON.stringify(config);
    const configBytes = Array.from(new TextEncoder().encode(configJson));

    // Build Version 3 snapshot
    const version = 3;
    const configLength = configBytes.length;

    // Encode varint for config length (simple implementation for lengths < 128)
    const varintBytes: number[] = [];
    let len = configLength;
    while (len >= 0x80) {
      varintBytes.push((len & 0x7f) | 0x80);
      len >>>= 7;
    }
    varintBytes.push(len & 0x7f);

    // Combine: [version][varint][config][wallet_snapshot]
    const enhancedSnapshot = [
      version,
      ...varintBytes,
      ...configBytes,
      ...walletSnapshot
    ];

    return Utils.toBase64(enhancedSnapshot);
  }, [
    managers.walletManager,
    wabUrl,
    selectedNetwork,
    selectedStorageUrl,
    messageBoxUrl,
    selectedAuthMethod,
    loginType,
    useRemoteStorage,
    useMessageBox,
    backupStorageUrls
  ]);

  /**
   * Loads an enhanced snapshot, handling both Version 2 (legacy) and Version 3 (with config).
   * Restores config state and returns the wallet snapshot portion for the walletManager.
   */
  const loadEnhancedSnapshot = useCallback((snapArr: number[]): { walletSnapshot: number[], config?: any } => {
    if (!snapArr || snapArr.length === 0) {
      throw new Error('Empty snapshot');
    }

    const version = snapArr[0];

    // Version 1 or 2: legacy wallet-toolbox formats, no config included
    if (version === 1 || version === 2) {
      console.log(`Loading Version ${version} snapshot (legacy)`);
      return { walletSnapshot: snapArr };
    }

    // Version 3: enhanced format with config
    if (version === 3) {
      console.log('Loading Version 3 snapshot with config');

      // Decode varint for config length
      let offset = 1;
      let configLength = 0;
      let shift = 0;
      while (offset < snapArr.length) {
        const byte = snapArr[offset++];
        configLength |= (byte & 0x7f) << shift;
        if ((byte & 0x80) === 0) break;
        shift += 7;
      }

      // Extract config JSON bytes
      const configBytes = snapArr.slice(offset, offset + configLength);
      const configJson = new TextDecoder().decode(new Uint8Array(configBytes));
      const config = JSON.parse(configJson);

      // Extract wallet snapshot (remaining bytes)
      const walletSnapshot = snapArr.slice(offset + configLength);

      return { walletSnapshot, config };
    }

    // Unknown version
    throw new Error(`Unsupported snapshot version: ${version}`);
  }, []);

  // Load snapshot function
  const loadWalletSnapshot = useCallback(async (walletManager: WalletAuthenticationManager) => {
    console.log('[loadWalletSnapshot] Checking for snapshot...');
    if (localStorage.snap) {
      console.log('[loadWalletSnapshot] Snapshot found, loading...');
      try {
        const snapArr = Utils.toArray(localStorage.snap, 'base64');
        const { walletSnapshot, config } = loadEnhancedSnapshot(snapArr);
        console.log('[loadWalletSnapshot] Snapshot decoded. Version:', walletSnapshot[0], 'Has config:', !!config);

        // Config is already restored in early useEffect, skip here
        if (config) {
          console.log('[loadWalletSnapshot] Config present in snapshot (already restored earlier)');
        }

        // Load wallet snapshot into walletManager
        console.log('[loadWalletSnapshot] Loading snapshot into walletManager...');
        await walletManager.loadSnapshot(walletSnapshot);
        console.log('[loadWalletSnapshot] Snapshot loaded into walletManager successfully');
        console.log('[loadWalletSnapshot] WalletManager authenticated:', walletManager.authenticated);
        // We'll handle setting snapshotLoaded in a separate effect watching authenticated state
      } catch (err: any) {
        console.error("[loadWalletSnapshot] Error loading snapshot:", err);
        console.error("[loadWalletSnapshot] Stack:", err.stack);
        localStorage.removeItem('snap'); // Clear invalid snapshot
        toast.error("Couldn't load saved data: " + err.message);
      }
    } else {
      console.log('[loadWalletSnapshot] No snapshot found in localStorage');
    }
  }, [loadEnhancedSnapshot, configStatus]);

  // ---- Early config restoration from snapshot (before wallet manager creation)
  useEffect(() => {
    if (localStorage.snap && configStatus === 'initial') {
      console.log('[Config Restore] Checking snapshot for config...');
      try {
        const snapArr = Utils.toArray(localStorage.snap, 'base64');
        const { config } = loadEnhancedSnapshot(snapArr);
        if (config) {
          console.log('[Config Restore] Restoring config from snapshot BEFORE wallet creation:', config);
          setWabUrl(config.wabUrl || '');
          setSelectedNetwork(config.network || DEFAULT_CHAIN);
          setSelectedStorageUrl(config.storageUrl || '');
          setMessageBoxUrl(config.messageBoxUrl || '');
          setSelectedAuthMethod(config.authMethod || '');
          // Restore loginType, with backward compat for old snapshots that only have useWab
          if (config.loginType) {
            setLoginType(config.loginType);
          } else {
            setLoginType(config.useWab !== false ? 'wab' : 'mnemonic-advanced');
          }
          // Infer useRemoteStorage from storage URL if not explicitly set in snapshot
          const inferredUseRemoteStorage = config.useRemoteStorage !== undefined
            ? config.useRemoteStorage
            : !!config.storageUrl;
          setUseRemoteStorage(inferredUseRemoteStorage);
          setUseMessageBox(config.useMessageBox !== undefined ? config.useMessageBox : false);
          setBackupStorageUrls(config.backupStorageUrls || []);
          console.log('[Config Restore] Message Box URL restored:', config.messageBoxUrl, '| useMessageBox:', config.useMessageBox);
          setConfigStatus('configured');
          console.log('[Config Restore] Config restored, wallet manager will be created next');
        }
      } catch (err) {
        console.error('[Config Restore] Failed to restore config from snapshot:', err);
      }
    }
  }, [loadEnhancedSnapshot]); // Run only once on mount

  // Watch for wallet authentication after snapshot is loaded
  useEffect(() => {
    if (managers?.walletManager?.authenticated && localStorage.snap) {
      setSnapshotLoaded(true);
    }
  }, [managers?.walletManager?.authenticated]);

  // ---- Build the wallet manager once all required inputs are ready.
  useEffect(() => {
    console.log('[WalletManager Init] Checking conditions...');
    console.log('[WalletManager Init] passwordRetriever:', !!passwordRetriever);
    console.log('[WalletManager Init] recoveryKeySaver:', !!recoveryKeySaver);
    console.log('[WalletManager Init] configStatus:', configStatus);
    console.log('[WalletManager Init] managers.walletManager exists:', !!managers.walletManager);
    console.log('[WalletManager Init] localStorage.snap exists:', !!localStorage.snap);

    const directKeyMode = loginType === 'direct-key'
    if (
      (directKeyMode || (passwordRetriever && recoveryKeySaver)) &&
      configStatus !== 'editing' && // either user configured or snapshot exists
      !managers.walletManager && // build only once
      !walletManagerInitInFlightRef.current
    ) {
      walletManagerInitInFlightRef.current = true
      console.log('[WalletManager Init] ========== CONDITIONS MET, CREATING WALLET MANAGER ==========');
      (async () => {
        try {
          // Create network service based on selected network
          const networkPreset = selectedNetwork === 'main' ? 'mainnet' : 'testnet';
          console.log('[WalletManager Init] Network preset:', networkPreset);

          // Create a LookupResolver instance
          const resolver = new LookupResolver({
            networkPreset
          });

          // Create a broadcaster with proper network settings
          const broadcaster = new SHIPBroadcaster(['tm_users'], {
            networkPreset
          });

          let walletManager: any;
          console.log('[WalletManager Init] loginType:', loginType);
          if (loginType === 'wab') {
            console.log('[WalletManager Init] Creating WalletAuthenticationManager...');
            const wabClient = new WABClient(wabUrl);
            let phoneInteractor
            if (selectedAuthMethod === 'DevConsole') {
              phoneInteractor = new DevConsoleInteractor();
            } else {
              phoneInteractor = new TwilioPhoneInteractor();
            }
            walletManager = new WalletAuthenticationManager(
              adminOriginator,
              buildWallet,
              new OverlayUMPTokenInteractor(resolver, broadcaster),
              recoveryKeySaver,
              passwordRetriever,
              wabClient,
              phoneInteractor
            );
          } else if (loginType === 'direct-key') {
            console.log('[WalletManager Init] Creating SimpleWalletManager (direct-key mode)...');
            walletManager = new SimpleWalletManager(
              adminOriginator,
              buildWallet
            );
          } else {
            console.log('[WalletManager Init] Creating CWIStyleWalletManager...');
            walletManager = new CWIStyleWalletManager(
              adminOriginator,
              buildWallet,
              new OverlayUMPTokenInteractor(resolver, broadcaster),
              recoveryKeySaver,
              passwordRetriever,
              walletFunder
            );
          }
          console.log('[WalletManager Init] WalletManager created');
          // Store in window for debugging
          (window as any).walletManager = walletManager;

          // Load snapshot if available BEFORE setting managers
          console.log('[WalletManager Init] About to load snapshot...');
          await loadWalletSnapshot(walletManager);
          console.log('[WalletManager Init] Snapshot loading completed');

          // Set managers state after snapshot is loaded
          console.log('[WalletManager Init] Setting walletManager in state...');
          setManagers(m => ({ ...m, walletManager }));
          console.log('[WalletManager Init] ========== WALLET MANAGER SETUP COMPLETE ==========');

          // Create PeerPayClient if messageBoxUrl is configured (without auto-anointing)
          console.log('[WalletManager Init] messageBoxUrl:', messageBoxUrl);
          console.log('[WalletManager Init] useMessageBox:', useMessageBox);

          if (messageBoxUrl && useMessageBox) {
            (async () => {
              try {
                console.log('[WalletContext] Wallet authenticated, initializing PeerPayClient...');
                const client = new PeerPayClient({
                  walletClient: managers.permissionsManager,
                  messageBoxHost: messageBoxUrl,
                  enableLogging: true,
                  originator: adminOriginator
                });

                // DON'T call init() - this would auto-anoint and trigger spending authorization
                // User must explicitly anoint the host via the UI
                setPeerPayClient(client);

                // Check anointment status (read-only, no transaction)
                try {
                  const identityKey = await client.getIdentityKey();
                  const ads = await client.queryAdvertisements(identityKey, messageBoxUrl);
                  const isAnointed = ads.length > 0 && ads.some(ad => ad.host === messageBoxUrl);
                  setIsHostAnointed(isAnointed);
                  setAnointedHosts(ads);
                  console.log('[WalletContext] Anointment status:', isAnointed);
                } catch (checkError) {
                  console.warn('[WalletContext] Could not check anointment status:', checkError);
                }

                console.log('[WalletContext] PeerPayClient created successfully');
              } catch (error: any) {
                console.error('[WalletContext] Failed to create PeerPayClient:', error);
              }
            })();
          }

        } catch (err: any) {
          console.error("Error initializing wallet manager:", err);
          toast.error("Failed to initialize wallet: " + err.message);
          // Reset configuration if wallet initialization fails
          setConfigStatus('editing');
        } finally {
          walletManagerInitInFlightRef.current = false
        }
      })();
    }
  }, [
    !!passwordRetriever,
    !!recoveryKeySaver,
    configStatus,
    managers.walletManager,
    selectedNetwork,
    wabUrl,
    walletFunder,
    messageBoxUrl,
    useMessageBox,
    loginType,
    buildWallet,
    loadWalletSnapshot,
    adminOriginator
  ]);

  // When Settings manager becomes available, populate the user's settings
  useEffect(() => {
    const loadSettings = async () => {
      if (managers.settingsManager) {
        try {
          const userSettings = await managers.settingsManager.get();
          setSettings(userSettings);
        } catch (e) {
          // Unable to load settings, defaults are already loaded.
        }
      }
    };

    loadSettings();
  }, [managers]);

  const addBackupStorageUrl = useCallback(async (url: string) => {
    if (!managers.walletManager) {
      throw new Error('Wallet manager not available');
    }

    // Check for duplicates in backup list
    if (backupStorageUrls.includes(url)) {
      throw new Error('This backup storage is already added');
    }

    // Special handling for LOCAL_STORAGE
    const isLocalStorage = url === 'LOCAL_STORAGE';

    // Validate URL format for remote storage
    if (!isLocalStorage && !url.startsWith('http://') && !url.startsWith('https://')) {
      throw new Error('Backup storage URL must start with http:// or https://');
    }

    // Check if it's the same as the primary storage (only for remote storage)
    if (!isLocalStorage && useRemoteStorage && selectedStorageUrl === url) {
      throw new Error('This URL is already your primary storage. Cannot add it as a backup.');
    }

    // Check if local storage is already primary storage
    if (isLocalStorage && !useRemoteStorage) {
      throw new Error('Local storage is already your primary storage. Cannot add it as a backup.');
    }

    try {
      // Get the wallet and storage manager from managers
      const wallet = managers.wallet;
      const storageManager = managers.storageManager;

      if (!wallet) {
        throw new Error('Wallet not available');
      }

      if (!storageManager) {
        throw new Error('Storage manager not available');
      }

      console.log('[addBackupStorageUrl] Adding new backup storage:', url);

      // Create appropriate storage provider
      let backupProvider: any;
      if (isLocalStorage) {
        // Create local Electron storage as backup
        // Get identityKey from storageManager which always has it
        const identityKey = storageManager?._authId?.identityKey
        if (!identityKey) {
          throw new Error('Could not get identity key from wallet');
        }
        const electronStorage = new StorageElectronIPC(identityKey, selectedNetwork);
        const services = new Services(selectedNetwork);
        electronStorage.setServices(services as any);
        await electronStorage.makeAvailable();
        backupProvider = electronStorage;
        console.log('[addBackupStorageUrl] Local Electron storage created as backup');
      } else {
        // Create remote storage client as backup
        backupProvider = new StorageClient(wallet, url);
        await backupProvider.makeAvailable();
        console.log('[addBackupStorageUrl] Remote storage client created as backup');
      }

      await storageManager.addWalletStorageProvider(backupProvider);
      console.log('[addBackupStorageUrl] Backup storage provider added');

      // Re-verify and set active storage to ensure proper configuration
      const stores = storageManager.getStores();
      if (stores && stores.length > 0) {
        const activeStoreKey = stores[0].storageIdentityKey;
        console.log('[addBackupStorageUrl] Re-setting active storage:', activeStoreKey);
        await storageManager.setActive(activeStoreKey);
        console.log('[addBackupStorageUrl] Active storage re-configured');
      }

      // Create updated backup URLs list
      const newBackupUrls = [...backupStorageUrls, url];

      // Save snapshot with new config BEFORE updating state
      try {
        const snapshot = saveEnhancedSnapshot({ backupStorageUrls: newBackupUrls });
        localStorage.snap = snapshot;
        console.log('[addBackupStorageUrl] Snapshot saved with', newBackupUrls.length, 'backups');
      } catch (err) {
        console.error('[addBackupStorageUrl] Failed to save snapshot:', err);
      }

      // Update state after saving snapshot
      setBackupStorageUrls(newBackupUrls);

      toast.success('Backup storage added successfully!');
    } catch (error: any) {
      console.error('[addBackupStorageUrl] Error:', error);
      toast.error('Failed to add backup storage: ' + error.message);
      throw error;
    }
  }, [managers, saveEnhancedSnapshot, backupStorageUrls, useRemoteStorage, selectedStorageUrl]);

  const removeBackupStorageUrl = useCallback(async (url: string) => {
    try {
      // Create updated backup URLs list (without the removed URL)
      const newBackupUrls = backupStorageUrls.filter(u => u !== url);

      // Save snapshot with new config BEFORE updating state
      try {
        const snapshot = saveEnhancedSnapshot({ backupStorageUrls: newBackupUrls });
        localStorage.snap = snapshot;
        console.log('[removeBackupStorageUrl] Snapshot saved with', newBackupUrls.length, 'backups');
      } catch (err) {
        console.error('[removeBackupStorageUrl] Failed to save snapshot:', err);
      }

      // Update state after saving snapshot
      setBackupStorageUrls(newBackupUrls);

      toast.success('Backup storage removed. It will be disconnected on next restart.');
    } catch (error: any) {
      console.error('[removeBackupStorageUrl] Error:', error);
      toast.error('Failed to remove backup storage: ' + error.message);
      throw error;
    }
  }, [saveEnhancedSnapshot, backupStorageUrls]);

  const syncBackupStorage = useCallback(async (progressCallback?: (message: string) => void) => {
    if (!managers.storageManager) {
      throw new Error('Storage manager not available');
    }

    try {
      console.log('[syncBackupStorage] Starting manual sync...');

      const storageManager = managers.storageManager;

      // WalletStorageManager has updateBackups method to sync data to backup providers
      // It accepts an optional progress callback: updateBackups(table?: string, progCB?: (s: string) => string)
      if (typeof storageManager.updateBackups === 'function') {
        // Create a progress logger that both logs to console and calls the callback
        const progLog = (s: string): string => {
          console.log('[syncBackupStorage]', s);
          if (progressCallback) {
            progressCallback(s);
          }
          return s;
        };

        await storageManager.updateBackups(undefined, progLog);
        console.log('[syncBackupStorage] Sync completed via updateBackups');
      } else {
        console.warn('[syncBackupStorage] Storage manager does not have updateBackups method');
        if (progressCallback) {
          progressCallback('Backup providers sync automatically on each wallet action');
        }
      }
    } catch (error: any) {
      console.error('[syncBackupStorage] Error:', error);
      throw error;
    }
  }, [managers.storageManager]);

  const updateMessageBoxUrl = useCallback(async (url: string) => {
    try {
      if (!url || !url.trim()) {
        toast.error('Message Box URL cannot be empty');
        throw new Error('Message Box URL cannot be empty');
      }

      // Trim trailing slashes
      const trimmedUrl = url.trim().replace(/\/+$/, '');

      // Validate URL format
      try {
        new URL(trimmedUrl);
      } catch (e) {
        toast.error('Invalid Message Box URL format');
        throw new Error('Invalid Message Box URL format');
      }

      console.log('[updateMessageBoxUrl] Updating Message Box URL to:', trimmedUrl);

      // Update state
      setMessageBoxUrl(trimmedUrl);
      setUseMessageBox(true);

      // Create PeerPayClient without auto-anointing
      // User must explicitly anoint the host via the UI
      if (managers?.permissionsManager) {
        try {
          console.log('[updateMessageBoxUrl] Initializing PeerPayClient...');
          const client = new PeerPayClient({
            walletClient: managers.permissionsManager,
            messageBoxHost: trimmedUrl,
            enableLogging: true,
            originator: adminOriginator
          });

          // DON'T call init() - this would auto-anoint and trigger spending authorization
          // Instead, just set the client and check anointment status
          setPeerPayClient(client);

          // Check if host is already anointed (read-only, no transaction)
          try {
            const identityKey = await client.getIdentityKey();
            const ads = await client.queryAdvertisements(identityKey, trimmedUrl);
            const isAnointed = ads.length > 0 && ads.some(ad => ad.host === trimmedUrl);
            setIsHostAnointed(isAnointed);
            setAnointedHosts(ads);
            console.log('[updateMessageBoxUrl] Anointment status checked:', isAnointed);
          } catch (checkError) {
            console.warn('[updateMessageBoxUrl] Could not check anointment status:', checkError);
            setIsHostAnointed(false);
            setAnointedHosts([]);
          }

          console.log('[updateMessageBoxUrl] PeerPayClient created successfully');
        } catch (initError: any) {
          console.error('[updateMessageBoxUrl] Failed to create PeerPayClient:', initError);
          // Don't throw - we can retry later
        }
      }

      // Save snapshot with new config
      try {
        const snapshot = saveEnhancedSnapshot({ messageBoxUrl: trimmedUrl, useMessageBox: true });
        localStorage.snap = snapshot;
        console.log('[updateMessageBoxUrl] Snapshot saved with new Message Box URL');
      } catch (err) {
        console.error('[updateMessageBoxUrl] Failed to save snapshot:', err);
        throw new Error('Failed to save configuration');
      }

      toast.success('Message Box URL configured successfully!');
    } catch (error: any) {
      console.error('[updateMessageBoxUrl] Error:', error);
      toast.error('Failed to update Message Box URL: ' + error.message);
      throw error;
    }
  }, [saveEnhancedSnapshot, managers?.walletManager, adminOriginator]);

  const removeMessageBoxUrl = useCallback(async () => {
    try {
      console.log('[removeMessageBoxUrl] Removing Message Box URL');

      // Revoke any existing anointments before removing
      if (peerPayClient && anointedHosts.length > 0) {
        console.log('[removeMessageBoxUrl] Revoking', anointedHosts.length, 'anointment(s)...');
        for (const token of anointedHosts) {
          try {
            console.log('[removeMessageBoxUrl] Revoking anointment for:', token.host);
            await peerPayClient.revokeHostAdvertisement(token);
            console.log('[removeMessageBoxUrl] Revoked anointment for:', token.host);
          } catch (revokeError: any) {
            console.warn('[removeMessageBoxUrl] Failed to revoke anointment:', revokeError);
            // Continue with removal even if revoke fails
          }
        }
      }

      // Update state
      setMessageBoxUrl('');
      setUseMessageBox(false);
      setPeerPayClient(null); // Clear the PeerPayClient
      setIsHostAnointed(false); // Clear anointment state
      setAnointedHosts([]);

      // Save snapshot with new config
      try {
        const snapshot = saveEnhancedSnapshot();
        localStorage.snap = snapshot;
        console.log('[removeMessageBoxUrl] Snapshot saved with Message Box removed');
      } catch (err) {
        console.error('[removeMessageBoxUrl] Failed to save snapshot:', err);
        throw new Error('Failed to save configuration');
      }

      toast.success('Message Box URL removed successfully!');
    } catch (error: any) {
      console.error('[removeMessageBoxUrl] Error:', error);
      toast.error('Failed to remove Message Box URL: ' + error.message);
      throw error;
    }
  }, [saveEnhancedSnapshot, peerPayClient, anointedHosts]);

  // Check anointment status without triggering anointment
  const checkAnointmentStatus = useCallback(async () => {
    try {
      if (!peerPayClient || !messageBoxUrl) {
        setIsHostAnointed(false);
        setAnointedHosts([]);
        return;
      }

      console.log('[checkAnointmentStatus] Checking anointment status for:', messageBoxUrl);
      const identityKey = await peerPayClient.getIdentityKey();
      const ads = await peerPayClient.queryAdvertisements(identityKey, messageBoxUrl);

      const isAnointed = ads.length > 0 && ads.some(ad => ad.host === messageBoxUrl);
      setIsHostAnointed(isAnointed);
      setAnointedHosts(ads);

      console.log('[checkAnointmentStatus] Host anointed:', isAnointed, 'Advertisements:', ads.length);
    } catch (error: any) {
      console.error('[checkAnointmentStatus] Error:', error);
      setIsHostAnointed(false);
      setAnointedHosts([]);
    }
  }, [peerPayClient, messageBoxUrl]);

  // Explicitly anoint the current host (requires user authorization)
  const anointCurrentHost = useCallback(async () => {
    try {
      if (!peerPayClient || !messageBoxUrl) {
        toast.error('Message Box URL not configured');
        return;
      }

      setAnointmentLoading(true);
      console.log('[anointCurrentHost] Anointing host:', messageBoxUrl);

      // Call init which will anoint if needed
      await peerPayClient.init(messageBoxUrl);

      // Refresh anointment status
      await checkAnointmentStatus();

      toast.success('Host anointed successfully!');
      console.log('[anointCurrentHost] Host anointed successfully');
    } catch (error: any) {
      console.error('[anointCurrentHost] Error:', error);
      toast.error('Failed to anoint host: ' + error.message);
      throw error;
    } finally {
      setAnointmentLoading(false);
    }
  }, [peerPayClient, messageBoxUrl, checkAnointmentStatus]);

  // Revoke an existing host anointment
  const revokeHostAnointment = useCallback(async (token: AdvertisementToken) => {
    try {
      if (!peerPayClient) {
        toast.error('PeerPay client not initialized');
        return;
      }

      setAnointmentLoading(true);
      console.log('[revokeHostAnointment] Revoking anointment for:', token.host);

      await peerPayClient.revokeHostAdvertisement(token);

      // Refresh anointment status
      await checkAnointmentStatus();

      toast.success('Host anointment revoked successfully!');
      console.log('[revokeHostAnointment] Anointment revoked successfully');
    } catch (error: any) {
      console.error('[revokeHostAnointment] Error:', error);
      toast.error('Failed to revoke anointment: ' + error.message);
      throw error;
    } finally {
      setAnointmentLoading(false);
    }
  }, [peerPayClient, checkAnointmentStatus]);

  const logout = useCallback(() => {
    // Clear localStorage to prevent auto-login
    localStorage.clear();
    if (localStorage.snap) {
      localStorage.removeItem('snap');
    }

    // Reset manager state
    setManagers({});

    // Reset configuration state
    setConfigStatus('configured');
    setSnapshotLoaded(false);
    setPeerPayClient(null); // Clear PeerPayClient on logout
    setIsHostAnointed(false); // Clear anointment state on logout
    setAnointedHosts([]);
  }, []);

  // Automatically set active profile when wallet manager becomes available
  useEffect(() => {
    if (managers?.walletManager?.authenticated) {
      // Profiles are only available for WAB/CWIStyle managers, not SimpleWalletManager
      if (loginType !== 'direct-key' && managers.walletManager.listProfiles) {
        const profiles = managers.walletManager.listProfiles()
        const profileToSet = profiles.find((p: any) => p.active) || profiles[0]
        if (profileToSet?.id) {
          console.log('PROFILE IS NOW BEING SET!', profileToSet)
          setActiveProfile(profileToSet)
        }
      }

      // Create PeerPayClient if messageBoxUrl is configured (without auto-anointing)
      if (messageBoxUrl && useMessageBox) {
        (async () => {
          try {
            console.log('[WalletContext] Wallet authenticated, initializing PeerPayClient...');q
            const client = new PeerPayClient({
              walletClient: managers.permissionsManager,
              messageBoxHost: messageBoxUrl,
              enableLogging: true,
              originator: adminOriginator
            });

            // DON'T call init() - this would auto-anoint and trigger spending authorization
            // User must explicitly anoint the host via the UI
            setPeerPayClient(client);

            // Check anointment status (read-only, no transaction)
            try {
              const identityKey = await client.getIdentityKey();
              const ads = await client.queryAdvertisements(identityKey, messageBoxUrl);
              const isAnointed = ads.length > 0 && ads.some(ad => ad.host === messageBoxUrl);
              setIsHostAnointed(isAnointed);
              setAnointedHosts(ads);
              console.log('[WalletContext] Anointment status:', isAnointed);
            } catch (checkError) {
              console.warn('[WalletContext] Could not check anointment status:', checkError);
            }

            console.log('[WalletContext] PeerPayClient created successfully');
          } catch (error: any) {
            console.error('[WalletContext] Failed to create PeerPayClient:', error);
          }
        })();
      }
    } else {
      setActiveProfile(null)
      setPeerPayClient(null)
      setIsHostAnointed(false)
      setAnointedHosts([])
    }
  }, [managers?.walletManager?.authenticated, messageBoxUrl, useMessageBox, adminOriginator])

  // Track recent origins to prevent duplicate updates in a short time period
  const recentOriginsRef = useRef<Map<string, number>>(new Map());
  const DEBOUNCE_TIME_MS = 5000; // 5 seconds debounce

  useEffect(() => {
    if (managers?.walletManager?.authenticated && activeProfile?.id) {
      const wallet = managers.walletManager;
      let disposed = false
      let unlistenFn: (() => void) | undefined;

      const setupListener = async () => {
        // Create a wrapper function that adapts updateRecentApp to the signature expected by RequestInterceptorWallet
        // and implements debouncing to prevent multiple updates for the same origin
        const updateRecentAppWrapper = async (profileId: string, origin: string): Promise<void> => {
          try {
            // Create a cache key combining profile ID and origin
            const cacheKey = `${profileId}:${origin}`;
            const now = Date.now();

            // Check if we've recently processed this origin
            const lastProcessed = recentOriginsRef.current.get(cacheKey);
            if (lastProcessed && (now - lastProcessed) < DEBOUNCE_TIME_MS) {
              // Skip this update as we've recently processed this origin
              console.debug('Skipping recent app update for', origin, '- too soon');
              return;
            }

            // Update the timestamp for this origin
            recentOriginsRef.current.set(cacheKey, now);

            // Call the original updateRecentApp but ignore the return value
            await updateRecentApp(profileId, origin);

            // Dispatch custom event to notify components of recent apps update
            window.dispatchEvent(new CustomEvent('recentAppsUpdated', {
              detail: {
                profileId,
                origin
              }
            }));
          } catch (error) {
            // Silently ignore errors in recent apps tracking
            console.debug('Error tracking recent app:', error);
          }
        };

        // Set up the original onWalletReady listener
        const interceptorWallet = new RequestInterceptorWallet(wallet, Utils.toBase64(activeProfile.id), updateRecentAppWrapper);
        const maybeUnlisten = await onWalletReady(interceptorWallet);
        if (disposed) {
          if (typeof maybeUnlisten === 'function') {
            maybeUnlisten()
          }
          return
        }
        unlistenFn = maybeUnlisten;
      };

      setupListener();

      return () => {
        disposed = true
        if (typeof unlistenFn === 'function') {
          unlistenFn()
        }
      }
    }
  }, [managers?.walletManager?.authenticated, managers?.walletManager, activeProfile?.id, onWalletReady])
  
  // Pop the first request from the basket queue, close if empty, relinquish focus if needed
  const advanceBasketQueue = () => {
    setBasketRequests(prev => {
      const newQueue = prev.slice(1)
      if (newQueue.length === 0) {
        setBasketAccessModalOpen(false)
        if (!wasOriginallyFocused) {
          onFocusRelinquished()
        }
      }
      return newQueue
    })
  }

  // Pop the first request from the certificate queue, close if empty, relinquish focus if needed
  const advanceCertificateQueue = () => {
    setCertificateRequests(prev => {
      const newQueue = prev.slice(1)
      if (newQueue.length === 0) {
        setCertificateAccessModalOpen(false)
        if (!wasOriginallyFocused) {
          onFocusRelinquished()
        }
      }
      return newQueue
    })
  }

  // Pop the first request from the protocol queue, close if empty, relinquish focus if needed
  const advanceProtocolQueue = () => {
    setProtocolRequests(prev => {
      const newQueue = prev.slice(1)
      if (newQueue.length === 0) {
        setProtocolAccessModalOpen(false)
        if (!wasOriginallyFocused) {
          onFocusRelinquished()
        }
      }
      return newQueue
    })
  }

  // Pop the first request from the spending queue, close if empty, relinquish focus if needed
  const advanceSpendingQueue = () => {
    setSpendingRequests(prev => {
      const newQueue = prev.slice(1)
      if (newQueue.length === 0) {
        setSpendingAuthorizationModalOpen(false)
        if (!wasOriginallyFocused) {
          onFocusRelinquished()
        }
      }
      return newQueue
    })
  }

  // Pop the first request from the group permission queue, close if empty, relinquish focus if needed
  const advanceGroupQueue = () => {
    setGroupPermissionRequests(prev => {
      const newQueue = prev.slice(1)
      if (newQueue.length === 0) {
        setGroupPermissionModalOpen(false)
        if (!wasOriginallyFocused) {
          onFocusRelinquished()
        }
      }
      return newQueue
    })
  }

  useEffect(() => {
    const current = groupPermissionRequests[0]
    if (!current) return
    const cooldownKey = getGroupCooldownKey(current.originator, current.permissions)
    if (!isGroupCooldownActive(cooldownKey)) return

    ;(async () => {
      try {
        await (managers.permissionsManager as any)?.dismissGroupedPermission?.(current.requestID)
      } catch (error) {
        console.debug('Failed to dismiss grouped permission during cooldown:', error)
      } finally {
        groupRequestCooldownKeyByIdRef.current.delete(current.requestID)
        advanceGroupQueue()
      }
    })()
  }, [advanceGroupQueue, getGroupCooldownKey, groupPermissionRequests, isGroupCooldownActive, managers.permissionsManager])

  // Update permissions configuration and save to localStorage
  const updatePermissionsConfig = useCallback(async (config: PermissionsConfig) => {
    try {
      setPermissionsConfig(config);
      localStorage.setItem('permissionsConfig', JSON.stringify(config));
      toast.success('Permissions configuration updated. Please reload the app for changes to take effect.');
    } catch (e: any) {
      console.error('Failed to update permissions config:', e);
      toast.error('Failed to update permissions configuration');
      throw e;
    }
  }, []);

  const contextValue = useMemo<WalletContextValue>(() => ({
    managers,
    updateManagers: setManagers,
    settings,
    updateSettings,
    network: selectedNetwork === 'test' ? 'testnet' : 'mainnet',
    activeProfile: activeProfile,
    setActiveProfile: setActiveProfile,
    logout,
    adminOriginator,
    setPasswordRetriever,
    setRecoveryKeySaver,
    snapshotLoaded,
    basketRequests,
    certificateRequests,
    protocolRequests,
    spendingRequests,
    groupPermissionRequests,
    counterpartyPermissionRequests,
    startPactCooldownForCounterparty,
    advanceBasketQueue,
    advanceCertificateQueue,
    advanceGroupQueue,
    advanceCounterpartyPermissionQueue,
    advanceProtocolQueue,
    advanceSpendingQueue,
    setWalletFunder,
    setUseWab,
    useWab,
    loginType,
    setLoginType,
    recentApps,
    finalizeConfig,
    setConfigStatus,
    configStatus,
    wabUrl,
    setWabUrl,
    storageUrl: selectedStorageUrl,
    messageBoxUrl,
    useRemoteStorage,
    useMessageBox,
    saveEnhancedSnapshot,
    backupStorageUrls,
    addBackupStorageUrl,
    removeBackupStorageUrl,
    syncBackupStorage,
    updateMessageBoxUrl,
    removeMessageBoxUrl,
    initializingBackendServices,
    permissionsConfig,
    updatePermissionsConfig,
    peerPayClient,
    isHostAnointed,
    anointedHosts,
    anointmentLoading,
    anointCurrentHost,
    revokeHostAnointment,
    checkAnointmentStatus
  }), [
    managers,
    settings,
    updateSettings,
    selectedNetwork,
    activeProfile,
    logout,
    adminOriginator,
    setPasswordRetriever,
    setRecoveryKeySaver,
    snapshotLoaded,
    basketRequests,
    certificateRequests,
    protocolRequests,
    spendingRequests,
    groupPermissionRequests,
    counterpartyPermissionRequests,
    startPactCooldownForCounterparty,
    advanceBasketQueue,
    advanceCertificateQueue,
    advanceGroupQueue,
    advanceProtocolQueue,
    advanceSpendingQueue,
    setWalletFunder,
    setUseWab,
    useWab,
    loginType,
    setLoginType,
    recentApps,
    finalizeConfig,
    setConfigStatus,
    configStatus,
    wabUrl,
    setWabUrl,
    selectedStorageUrl,
    messageBoxUrl,
    useRemoteStorage,
    useMessageBox,
    saveEnhancedSnapshot,
    backupStorageUrls,
    addBackupStorageUrl,
    removeBackupStorageUrl,
    syncBackupStorage,
    updateMessageBoxUrl,
    removeMessageBoxUrl,
    initializingBackendServices,
    permissionsConfig,
    updatePermissionsConfig,
    peerPayClient,
    isHostAnointed,
    anointedHosts,
    anointmentLoading,
    anointCurrentHost,
    revokeHostAnointment,
    checkAnointmentStatus,
    advanceCounterpartyPermissionQueue
  ]);

  return (
    <WalletContext.Provider value={contextValue}>
      {children}
    </WalletContext.Provider>
  )
}