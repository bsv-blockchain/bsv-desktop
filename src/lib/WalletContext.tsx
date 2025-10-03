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
} from '@bsv/wallet-toolbox-client'
import { StorageElectronIPC } from './StorageElectronIPC'
import {
  PrivateKey,
  SHIPBroadcaster,
  Utils,
  LookupResolver,
  WalletInterface,
  CachedKeyDeriver,
} from '@bsv/sdk'
import { DEFAULT_SETTINGS, WalletSettings, WalletSettingsManager } from '@bsv/wallet-toolbox/out/src/WalletSettingsManager'
import { toast } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'
import { DEFAULT_CHAIN, ADMIN_ORIGINATOR, DEFAULT_USE_WAB } from './config'
import { UserContext } from './UserContext'
import { GroupPermissionRequest, GroupedPermissions } from './types/GroupedPermissions'
import { updateRecentApp } from './pages/Dashboard/Apps/getApps'
import { RequestInterceptorWallet } from './RequestInterceptorWallet'
import { WalletProfile } from './types/WalletProfile'
// -----
// Context Types
// -----


interface ManagerState {
  walletManager?: WalletAuthenticationManager;
  permissionsManager?: WalletPermissionsManager;
  settingsManager?: WalletSettingsManager;
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
  advanceBasketQueue: () => void
  advanceCertificateQueue: () => void
  advanceProtocolQueue: () => void
  advanceSpendingQueue: () => void
  setWalletFunder: (funder: (presentationKey: number[], wallet: WalletInterface, adminOriginator: string) => Promise<void>) => void
  setUseWab: (use: boolean) => void
  useWab: boolean
  advanceGroupQueue: () => void
  recentApps: any[]
  finalizeConfig: (wabConfig: WABConfig) => boolean
  setConfigStatus: (status: ConfigStatus) => void
  configStatus: ConfigStatus
  wabUrl: string
  storageUrl: string
  messageBoxUrl: string
  useRemoteStorage: boolean
  useMessageBox: boolean
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
  advanceBasketQueue: () => { },
  advanceCertificateQueue: () => { },
  advanceProtocolQueue: () => { },
  advanceSpendingQueue: () => { },
  setWalletFunder: () => { },
  setUseWab: () => { },
  useWab: true,
  advanceGroupQueue: () => { },
  recentApps: [],
  finalizeConfig: () => false,
  setConfigStatus: () => { },
  configStatus: 'initial',
  wabUrl: '',
  storageUrl: '',
  messageBoxUrl: '',
  useRemoteStorage: false,
  useMessageBox: false
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

  const { isFocused, onFocusRequested, onFocusRelinquished, setBasketAccessModalOpen, setCertificateAccessModalOpen, setProtocolAccessModalOpen, setSpendingAuthorizationModalOpen, setGroupPermissionModalOpen } = useContext(UserContext);

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
  const [useWab, setUseWab] = useState<boolean>(DEFAULT_USE_WAB)
  const [useRemoteStorage, setUseRemoteStorage] = useState<boolean>(false)
  const [useMessageBox, setUseMessageBox] = useState<boolean>(false)
  const [groupPermissionRequests, setGroupPermissionRequests] = useState<GroupPermissionRequest[]>([])

  // ---- Group gate & deferred buffers ----
  const [groupPhase, setGroupPhase] = useState<GroupPhase>('idle');
  const groupDecisionRef = useRef<GroupDecision | null>(null);
  const groupTimerRef = useRef<number | null>(null);
  const GROUP_GRACE_MS = 20000; // release if no answer within 20s (tweak as desired)
  const [deferred, setDeferred] = useState<{
    basket: BasketAccessRequest[],
    certificate: CertificateAccessRequest[],
    protocol: ProtocolAccessRequest[],
    spending: SpendingRequest[],
  }>({ basket: [], certificate: [], protocol: [], spending: [] });

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
      return d.allow.protocols instanceof Set && d.allow.protocols.has(req.protocolID);
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
        if (Array.isArray(id) && id.length > 1 && typeof id[1] === 'string') names.add(id[1]);
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

    setDeferred({ basket: [], certificate: [], protocol: [], spending: [] });
    setGroupPhase('idle');

    // Re-open the uncovered ones via your existing flows
    if (requeue.basket.length) { setBasketRequests(requeue.basket); setBasketAccessModalOpen(true); }
    if (requeue.certificate.length) { setCertificateRequests(requeue.certificate); setCertificateAccessModalOpen(true); }
    if (requeue.protocol.length) { setProtocolRequests(requeue.protocol); setProtocolAccessModalOpen(true); }
    if (requeue.spending.length) { setSpendingRequests(requeue.spending); setSpendingAuthorizationModalOpen(true); }
  };

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

    // Create the new permission request
    const newItem: GroupPermissionRequest = {
      requestID,
      originator,
      permissions
    }

    // Enqueue the new request
    return new Promise<void>(resolve => {
      setGroupPermissionRequests(prev => {
        const wasEmpty = prev.length === 0

        // If no requests were queued, handle focusing logic right away
        if (wasEmpty) {
          isFocused().then(currentlyFocused => {
            setWasOriginallyFocused(currentlyFocused)
            if (!currentlyFocused) {
              onFocusRequested()
            }
            setGroupPermissionModalOpen(true)
          })
        }

        resolve()
        return [...prev, newItem]
      })
    })
  }, [isFocused, onFocusRequested, setGroupPermissionModalOpen])

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
      }))
      // Clear queues & close their modals to avoid "fighting" dialogs
      setBasketRequests([]); setCertificateRequests([]); setProtocolRequests([]); setSpendingRequests([])
      setBasketAccessModalOpen(false); setCertificateAccessModalOpen(false); setProtocolAccessModalOpen(false); setSpendingAuthorizationModalOpen(false)
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
    if (!useWab) return null
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
    const { wabUrl, wabInfo, method, network, storageUrl, useWab: useWabSetting, messageBoxUrl, useRemoteStorage, useMessageBox } = wabConfig
    try {
      if (useWabSetting !== false) {
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

      setUseWab(useWabSetting !== false)
      setWabUrl(wabUrl)
      setWabInfo(wabInfo)
      setSelectedAuthMethod(method)
      setSelectedNetwork(network)
      setSelectedStorageUrl(storageUrl)
      setMessageBoxUrl(messageBoxUrl)

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
    try {
      const newManagers = {} as any;
      const chain = selectedNetwork;
      const keyDeriver = new CachedKeyDeriver(new PrivateKey(primaryKey));
      const storageManager = new WalletStorageManager(keyDeriver.identityKey);
      const signer = new WalletSigner(chain, keyDeriver as any, storageManager);
      const services = new Services(chain);
      const wallet = new Wallet(signer, services, undefined, privilegedKeyManager);
      newManagers.settingsManager = wallet.settingsManager;

      // Use user-selected storage provider
      if (useRemoteStorage) {
        const client = new StorageClient(wallet, selectedStorageUrl);
        await client.makeAvailable();
        await storageManager.addWalletStorageProvider(client);
      } else {
        // Use local Electron IPC storage (StorageKnex running in main process)
        const electronStorage = new StorageElectronIPC(keyDeriver.identityKey, chain);
        await electronStorage.makeAvailable();
        await storageManager.addWalletStorageProvider(electronStorage);
      }

      // Setup permissions with provided callbacks.
      const permissionsManager = new WalletPermissionsManager(wallet, adminOriginator, {
        differentiatePrivilegedOperations: true,
        seekBasketInsertionPermissions: false,
        seekBasketListingPermissions: false,
        seekBasketRemovalPermissions: false,
        seekCertificateAcquisitionPermissions: true,
        seekCertificateDisclosurePermissions: true,
        seekCertificateRelinquishmentPermissions: true,
        seekCertificateListingPermissions: false,
        seekGroupedPermission: true,
        seekPermissionsForIdentityKeyRevelation: false,
        seekPermissionsForIdentityResolution: false,
        seekPermissionsForKeyLinkageRevelation: true,
        seekPermissionsForPublicKeyRevelation: true,
        seekPermissionWhenApplyingActionLabels: false,
        seekPermissionWhenListingActionsByLabel: false,
        seekProtocolPermissionsForEncrypting: false,
        seekProtocolPermissionsForHMAC: false,
        seekProtocolPermissionsForSigning: true,
        seekSpendingPermissions: true,
      });

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

      // ---- Proxy grouped-permission grant/deny so we can release the gate automatically ----
      const originalGrantGrouped = (permissionsManager as any).grantGroupedPermission?.bind(permissionsManager);
      const originalDenyGrouped = (permissionsManager as any).denyGroupedPermission?.bind(permissionsManager);
      if (originalGrantGrouped) {
        (permissionsManager as any).grantGroupedPermission = async (requestID: string, granted: any) => {
          const res = await originalGrantGrouped(requestID, granted);
          try { await releaseDeferredAfterGroup(decisionFromGranted(granted)); } catch {}
          return res;
        };
      }
      if (originalDenyGrouped) {
        (permissionsManager as any).denyGroupedPermission = async (requestID: string) => {
          const res = await originalDenyGrouped(requestID);
          try { await releaseDeferredAfterGroup(null); } catch {}
          return res;
        };
      }

      // Store in window for debugging
      (window as any).permissionsManager = permissionsManager;
      newManagers.permissionsManager = permissionsManager;

      setManagers(m => ({ ...m, ...newManagers }));

      return permissionsManager;
    } catch (error: any) {
      console.error("Error building wallet:", error);
      toast.error("Failed to build wallet: " + error.message);
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
    useRemoteStorage
  ]);


  // Load snapshot function
  const loadWalletSnapshot = useCallback(async (walletManager: WalletAuthenticationManager) => {
    if (localStorage.snap) {
      try {
        const snapArr = Utils.toArray(localStorage.snap, 'base64');
        await walletManager.loadSnapshot(snapArr);
        // We'll handle setting snapshotLoaded in a separate effect watching authenticated state
      } catch (err: any) {
        console.error("Error loading snapshot", err);
        localStorage.removeItem('snap'); // Clear invalid snapshot
        toast.error("Couldn't load saved data: " + err.message);
      }
    }
  }, []);

  // Watch for wallet authentication after snapshot is loaded
  useEffect(() => {
    if (managers?.walletManager?.authenticated && localStorage.snap) {
      setSnapshotLoaded(true);
    }
  }, [managers?.walletManager?.authenticated]);

  // ---- Build the wallet manager once all required inputs are ready.
  useEffect(() => {
    if (
      passwordRetriever &&
      recoveryKeySaver &&
      configStatus !== 'editing' && // either user configured or snapshot exists
      !managers.walletManager // build only once
    ) {
      try {
        // Create network service based on selected network
        const networkPreset = selectedNetwork === 'main' ? 'mainnet' : 'testnet';

        // Create a LookupResolver instance
        const resolver = new LookupResolver({
          networkPreset
        });

        // Create a broadcaster with proper network settings
        const broadcaster = new SHIPBroadcaster(['tm_users'], {
          networkPreset
        });

        let walletManager: any;
        if (useWab) {
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
        } else {
          walletManager = new CWIStyleWalletManager(
            adminOriginator,
            buildWallet,
            new OverlayUMPTokenInteractor(resolver, broadcaster),
            recoveryKeySaver,
            passwordRetriever,
            walletFunder
          );
        }
        // Store in window for debugging
        (window as any).walletManager = walletManager;

        // Set initial managers state to prevent null references
        setManagers(m => ({ ...m, walletManager }));

        // Load snapshot if available
        loadWalletSnapshot(walletManager);

      } catch (err: any) {
        console.error("Error initializing wallet manager:", err);
        toast.error("Failed to initialize wallet: " + err.message);
        // Reset configuration if wallet initialization fails
        setConfigStatus('editing');
      }
    }
  }, [
    passwordRetriever,
    recoveryKeySaver,
    configStatus,
    managers.walletManager,
    selectedNetwork,
    wabUrl,
    walletFunder,
    useWab,
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
  }, []);

  // Automatically set active profile when wallet manager becomes available
  useEffect(() => {
    if (managers?.walletManager?.authenticated) {
      const profiles = managers.walletManager.listProfiles()
      const profileToSet = profiles.find((p: any) => p.active) || profiles[0]
      if (profileToSet?.id) {
        console.log('PROFILE IS NOW BEING SET!', profileToSet)
        setActiveProfile(profileToSet)
      }
    } else {
      setActiveProfile(null)
    }
  }, [managers?.walletManager?.authenticated])

  // Track recent origins to prevent duplicate updates in a short time period
  const recentOriginsRef = useRef<Map<string, number>>(new Map());
  const DEBOUNCE_TIME_MS = 5000; // 5 seconds debounce

  useEffect(() => {
    if (managers?.walletManager?.authenticated && activeProfile) {
      const wallet = managers.walletManager;
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
        unlistenFn = await onWalletReady(interceptorWallet);
      };

      setupListener();

      return () => {
        if (unlistenFn) {
          unlistenFn()
        }
      }
    }
  }, [managers, activeProfile])

  useEffect(() => {
    if (typeof managers.walletManager === 'object') {
      (async () => {

      })()
    }
  }, [adminOriginator, managers?.permissionsManager])

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
    advanceBasketQueue,
    advanceCertificateQueue,
    advanceGroupQueue,
    advanceProtocolQueue,
    advanceSpendingQueue,
    setWalletFunder,
    setUseWab,
    useWab,
    recentApps,
    finalizeConfig,
    setConfigStatus,
    configStatus,
    wabUrl,
    storageUrl: selectedStorageUrl,
    messageBoxUrl,
    useRemoteStorage,
    useMessageBox
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
    advanceBasketQueue,
    advanceCertificateQueue,
    advanceProtocolQueue,
    advanceSpendingQueue,
    setWalletFunder,
    setUseWab,
    useWab,
    recentApps,
    finalizeConfig,
    setConfigStatus,
    configStatus,
    wabUrl,
    selectedStorageUrl,
    messageBoxUrl,
    useRemoteStorage,
    useMessageBox
  ]);

  return (
    <WalletContext.Provider value={contextValue}>
      {children}
    </WalletContext.Provider>
  )
}