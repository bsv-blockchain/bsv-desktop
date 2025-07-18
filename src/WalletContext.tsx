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
  WABClient,
  PermissionRequest,
} from '@bsv/wallet-toolbox-client'
import {
  PrivateKey,
  SHIPBroadcaster,
  Utils,
  LookupResolver,
  WalletInterface,
  CachedKeyDeriver
} from '@bsv/sdk'
import { DEFAULT_SETTINGS, WalletSettings, WalletSettingsManager } from '@bsv/wallet-toolbox-client/out/src/WalletSettingsManager'
import { toast } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'
import { DEFAULT_WAB_URL, DEFAULT_STORAGE_URL, DEFAULT_CHAIN, ADMIN_ORIGINATOR, DEFAULT_USE_WAB } from './config'
import { UserContext } from './UserContext'
import { GroupPermissionRequest, GroupedPermissions } from './types/GroupedPermissions'
import { updateRecentApp } from './pages/Dashboard/Apps/getApps'
import { RequestInterceptorWallet } from './RequestInterceptorWallet'

// -----
// Context Types
// -----

export interface ActiveProfile {
  id: number[];
  name: string;
  createdAt: number | null;
  active: boolean;
}

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
  activeProfile: ActiveProfile | null;
  setActiveProfile: (profile: ActiveProfile | null) => void;
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
  configStatus: 'initial'
})

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
  useWab?: boolean;
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
  const [activeProfile, setActiveProfile] = useState<ActiveProfile | null>(null)

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
  const [groupPermissionRequests, setGroupPermissionRequests] = useState<GroupPermissionRequest[]>([])

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
  }, [isFocused, onFocusRequested])

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
          }
        ]
      })
    }
  }, [isFocused, onFocusRequested])

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
  }, [isFocused, onFocusRequested])

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
  }, [isFocused, onFocusRequested])

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

  // ---- WAB + network + storage configuration ----
  const [wabUrl, setWabUrl] = useState<string>(DEFAULT_WAB_URL);
  const [wabInfo, setWabInfo] = useState<{
    supportedAuthMethods: string[];
    faucetEnabled: boolean;
    faucetAmount: number;
  } | null>(null);

  const [selectedAuthMethod, setSelectedAuthMethod] = useState<string>("");
  const [selectedNetwork, setSelectedNetwork] = useState<'main' | 'test'>(DEFAULT_CHAIN); // "test" or "main"
  const [selectedStorageUrl, setSelectedStorageUrl] = useState<string>(DEFAULT_STORAGE_URL);

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
    const { wabUrl, wabInfo, method, network, storageUrl, useWab: useWabSetting } = wabConfig
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

      if (!storageUrl) {
        toast.error("Storage URL is required");
        return;
      }

      setUseWab(useWabSetting !== false)
      setWabUrl(wabUrl)
      setWabInfo(wabInfo)
      setSelectedAuthMethod(method)
      setSelectedNetwork(network)
      setSelectedStorageUrl(storageUrl)

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
      const client = new StorageClient(wallet, selectedStorageUrl);
      await client.makeAvailable();
      await storageManager.addWalletStorageProvider(client);

      // Setup permissions with provided callbacks.
      const permissionsManager = new WalletPermissionsManager(wallet, adminOriginator, {
        seekProtocolPermissionsForEncrypting: true,
        seekProtocolPermissionsForHMAC: true,
        seekPermissionsForPublicKeyRevelation: true,
        seekPermissionsForIdentityKeyRevelation: true,
        seekPermissionsForIdentityResolution: true,
        seekGroupedPermission: true
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
    groupPermissionCallback
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
          const phoneInteractor = new TwilioPhoneInteractor();
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
    if (managers?.walletManager?.authenticated) {
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
  }, [managers])

  useEffect(() => {
    if (typeof managers.walletManager === 'object') {
      (async () => {

      })()
    }
  }, [adminOriginator, managers?.permissionsManager])

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
    configStatus
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
  ]);

  return (
    <WalletContext.Provider value={contextValue}>
      {children}
    </WalletContext.Provider>
  )
}
