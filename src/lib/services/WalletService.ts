/**
 * WalletService — wallet lifecycle state machine.
 *
 * Extracted from WalletContext to eliminate:
 *  - 12-dependency wallet manager init useEffect (now: explicit initialize() call)
 *  - 3 competing paths to 'configured' state (now: single configure() method)
 *  - walletManagerInitInFlightRef escape hatch (now: this._initInFlight)
 *  - Snapshot management scattered across multiple effects and callbacks
 *
 * Lifecycle:
 *   'unconfigured' → configure() → 'configured'
 *   'configured' → initialize() → 'initializing' → 'authenticated' → 'ready'
 *   any → logout() → 'unconfigured'
 *   any → error → 'error'
 *
 * React integration: subscribe to 'stateChanged' events to drive re-renders.
 */

import {
  WalletAuthenticationManager,
  CWIStyleWalletManager,
  SimpleWalletManager,
  WalletPermissionsManager,
  WalletStorageManager,
  OverlayUMPTokenInteractor,
  WalletSigner,
  StorageClient,
  TwilioPhoneInteractor,
  DevConsoleInteractor,
  WABClient,
  Wallet,
  PrivilegedKeyManager,
  WalletSettingsManager,
  type WalletSettings,
} from '@bsv/wallet-toolbox-client'
import { createServices } from './createServices'
import { setTxStatusScope } from '../txStatusScope'
import {
  PrivateKey,
  SHIPBroadcaster,
  Utils,
  LookupResolver,
  WalletInterface,
  CachedKeyDeriver,
} from '@bsv/sdk'
import { toast } from 'react-toastify'
import { EventEmittable } from './EventEmittable'
import { PermissionQueueManager } from './PermissionQueueManager'
import { PeerPayManager } from './PeerPayManager'
import { StasKeyDeriver, StasOwnershipService, StasRegistration, StasDiscoveryService, StasTransferService } from './stas'
import {
  TokenProtocolRegistry,
  StasProtocolAdapter,
  DstasProtocolAdapter,
  BSV21ProtocolAdapter,
  BSV21KeyDeriver,
  OneSatIndexerClient,
  BSV21Registration,
  BSV21TransferService,
  BSV21DiscoveryService,
} from './tokens'
import { WocTokenIndexerClient } from './tokens/woc/WocTokenIndexerClient'
import { BackToGenesisClient } from './tokens/woc/BackToGenesisClient'
import { DstasTransferService } from './tokens/dstas/DstasTransferService'
import { PeerTokenClient } from '@bsv/message-box-client'
import { StasTokenSettlementAdapter } from './tokens/peer/StasTokenSettlementAdapter'
import { Bsv21TokenSettlementAdapter } from './tokens/peer/Bsv21TokenSettlementAdapter'
import { DstasTokenSettlementAdapter } from './tokens/peer/DstasTokenSettlementAdapter'
import { StorageElectronIPC } from '../StorageElectronIPC'
import { WalletDataStorageManager } from '../walletPortability/WalletDataStorageManager'
import { WalletDataSession, walletDataCall } from '../walletPortability/session'
import * as secrets from './secrets'
import { deriveMnemonicWallet, verifyMnemonicWallet } from '../utils/mnemonicRecovery'
import { DEFAULT_CHAIN, ADMIN_ORIGINATOR, DEFAULT_SETTINGS, MESSAGEBOX_HOST } from '../config'
import type { LoginType, WABConfig } from '../WalletContext'
import type { WalletProfile } from '../types/WalletProfile'
import { defaultNetworkSettingsMap, isWalletNetwork, normalizeMessageBoxUrl, normalizeNetworkSettings, restoreNetworkSettings, type NetworkSettings, type NetworkSettingsMap, type WalletNetwork } from '../networkConfig'
import { setWocEndpoints } from '../utils/woc'
import { activeHttpBridgeRequests, activeUserWalletOperations, isHttpBridgePaused, setHttpBridgePaused } from './httpBridgeSession'
import { clearWalletForHttpRoute } from '../../onWalletReady'

export type WalletLifecycle =
  | 'unconfigured'
  | 'configured'
  | 'initializing'
  | 'authenticated'
  | 'ready'
  | 'error'

// State exposed to React via snapshot
/** Bundle of STAS services produced by `_buildWallet` and exposed to the UI. */
export type StasServices = {
  keyDeriver: StasKeyDeriver
  ownership: StasOwnershipService
  discovery: StasDiscoveryService
  transfer: StasTransferService
  /**
   * Token-protocol adapter registry. Renderers should route transfer
   * calls through this rather than `transfer` directly — `transfer`
   * remains exposed for back-compat but only knows classic STAS.
   */
  tokens: TokenProtocolRegistry
  /** BSV-21 key derivation — symmetric counterpart to `keyDeriver` (STAS). */
  bsv21KeyDeriver: BSV21KeyDeriver
  /** BSV-21 discovery loop — symmetric counterpart to `discovery` (STAS). */
  bsv21Discovery: BSV21DiscoveryService
  /** 1Sat overlay REST client — exposed for diagnostics + the receive UI. */
  bsv21Indexer: OneSatIndexerClient
  /**
   * Back-to-Genesis provenance client. Verifies that a held/received token
   * output provably descends from its genesis mint (counterfeit detection).
   * Reads WOC's bStore-walking endpoints, independent of the token index.
   */
  backToGenesis: BackToGenesisClient
  /**
   * Peer-to-peer token client over MessageBox (the token analog of PeerPay).
   * Sends/accepts STAS, DSTAS, and BSV-21 tokens directly to a recipient's
   * identity key via the configured MessageBox host.
   */
  peerTokens: PeerTokenClient
}

export type WalletServiceSnapshot = {
  lifecycle: WalletLifecycle
  // Config
  loginType: LoginType
  wabUrl: string
  wabInfo: any
  selectedAuthMethod: string
  selectedNetwork: WalletNetwork
  networkSettings: NetworkSettingsMap
  switchingNetwork: boolean
  selectedStorageUrl: string
  messageBoxUrl: string
  useRemoteStorage: boolean
  useMessageBox: boolean
  backupStorageUrls: string[]
  adminOriginator: string
  // Runtime
  managers: {
    walletManager?: any
    permissionsManager?: WalletPermissionsManager
    settingsManager?: WalletSettingsManager
    storageManager?: WalletStorageManager
  }
  /**
   * Raw, unwrapped `Wallet` from `@bsv/wallet-toolbox`. Standalone — deliberately
   * kept out of `managers` so it's never confused with the permission-aware
   * `permissionsManager`. Used for internal wallet-toolbox plumbing that calls
   * wallet methods without an originator (e.g. `StorageClient`'s BRC-103
   * handshake calls `wallet.createHmac` directly). Routing those through
   * `permissionsManager` throws "Originator is required for permission checks".
   *
   * App-originated requests (anything carrying an originator from a third
   * party) must go through `managers.permissionsManager`, not this field.
   */
  wallet?: WalletInterface
  /** STAS BRC-42 services + discovery loop (Tasks 3/4). */
  stas?: StasServices
  settings: WalletSettings
  activeProfile: WalletProfile | null
  snapshotLoaded: boolean
  initializingBackendServices: boolean
}

type WalletServiceEvents = {
  stateChanged: WalletServiceSnapshot
}

export class WalletService extends EventEmittable<WalletServiceEvents> {
  // ---- Service composition ----
  readonly permissionQueue: PermissionQueueManager
  readonly peerPay: PeerPayManager

  // ---- Lifecycle ----
  private _lifecycle: WalletLifecycle = 'unconfigured'
  private _initInFlight = false
  private _startupError = ''

  // ---- Config state (previously multiple useState hooks) ----
  private _loginType: LoginType = 'mnemonic'
  private _wabUrl = ''
  private _wabInfo: any = null
  private _selectedAuthMethod = ''
  private _selectedNetwork: WalletNetwork = DEFAULT_CHAIN
  private _networkSettings = defaultNetworkSettingsMap()
  private _switchingNetwork = false
  private _selectedStorageUrl = ''
  private _messageBoxUrl = MESSAGEBOX_HOST
  private _useRemoteStorage = false
  private _useMessageBox = true
  private _backupStorageUrls: string[] = []
  private _adminOriginator = ADMIN_ORIGINATOR

  // ---- Runtime state ----
  walletData?: WalletDataSession
  private _walletDataGeneration = 0
  private _managers: WalletServiceSnapshot['managers'] = {}
  private _wallet?: WalletInterface
  private _stas?: StasServices
  private _settings: WalletSettings = DEFAULT_SETTINGS
  private _activeProfile: WalletProfile | null = null
  private _snapshotLoaded = false
  private _initializingBackendServices = false

  // ---- Callbacks provided by React UI ----
  private _passwordRetriever?: (reason: string, test: (pw: string) => boolean) => Promise<string>
  private _recoveryKeySaver?: (key: number[]) => Promise<true>
  private _walletFunder?: (presentationKey: number[], wallet: WalletInterface, adminOriginator: string) => Promise<void>

  constructor() {
    super()
    this.permissionQueue = new PermissionQueueManager()
    this.peerPay = new PeerPayManager()

    // Propagate sub-service changes as stateChanged
    this.permissionQueue.on('snapshot', () => this._emitState())
    this.peerPay.on('changed', () => this._emitState())
  }

  // ------------------------------------------------------------------
  // Public read-only accessors
  // ------------------------------------------------------------------

  get loginType() { return this._loginType }
  get wabUrl() { return this._wabUrl }
  get selectedNetwork() { return this._selectedNetwork }
  get selectedStorageUrl() { return this._selectedStorageUrl }
  get messageBoxUrl() { return this._messageBoxUrl }
  get useRemoteStorage() { return this._useRemoteStorage }
  get useMessageBox() { return this._useMessageBox }
  get backupStorageUrls() { return this._backupStorageUrls }
  get adminOriginator() { return this._adminOriginator }
  get managers() { return this._managers }
  get wallet() { return this._wallet }
  /** STAS BRC-42 services (ownership recognition + receive-key derivation). */
  get stas() { return this._stas }
  get settings() { return this._settings }
  get activeProfile() { return this._activeProfile }
  get snapshotLoaded() { return this._snapshotLoaded }
  get initializingBackendServices() { return this._initializingBackendServices }
  get lifecycle() { return this._lifecycle }
  get startupError() { return this._startupError }

  getSnapshot(): WalletServiceSnapshot {
    return {
      lifecycle: this._lifecycle,
      loginType: this._loginType,
      wabUrl: this._wabUrl,
      wabInfo: this._wabInfo,
      selectedAuthMethod: this._selectedAuthMethod,
      selectedNetwork: this._selectedNetwork,
      networkSettings: this._networkSettings,
      switchingNetwork: this._switchingNetwork,
      selectedStorageUrl: this._selectedStorageUrl,
      messageBoxUrl: this._messageBoxUrl,
      useRemoteStorage: this._useRemoteStorage,
      useMessageBox: this._useMessageBox,
      backupStorageUrls: this._backupStorageUrls,
      adminOriginator: this._adminOriginator,
      managers: this._managers,
      wallet: this._wallet,
      stas: this._stas,
      settings: this._settings,
      activeProfile: this._activeProfile,
      snapshotLoaded: this._snapshotLoaded,
      initializingBackendServices: this._initializingBackendServices,
    }
  }

  // ------------------------------------------------------------------
  // React UI callbacks registration
  // ------------------------------------------------------------------

  setPasswordRetriever(fn: (reason: string, test: (pw: string) => boolean) => Promise<string>) {
    this._passwordRetriever = fn
    this._tryAutoInitialize()
  }

  setRecoveryKeySaver(fn: (key: number[]) => Promise<true>) {
    this._recoveryKeySaver = fn
    this._tryAutoInitialize()
  }

  setWalletFunder(fn: (presentationKey: number[], wallet: WalletInterface, adminOriginator: string) => Promise<void>) {
    this._walletFunder = fn
  }

  // ------------------------------------------------------------------
  // Configuration
  // ------------------------------------------------------------------

  /**
   * Called by WalletConfig UI when user submits the config form.
   * Single entry point replacing 3 competing paths to 'configured' status.
   */
  configure(wabConfig: WABConfig): boolean {
    const {
      wabUrl,
      wabInfo,
      method,
      network,
      storageUrl,
      useWab: useWabSetting,
      loginType: loginTypeSetting,
      messageBoxUrl,
      useRemoteStorage,
      useMessageBox,
    } = wabConfig

    const effectiveLoginType: LoginType = loginTypeSetting || (useWabSetting !== false ? 'wab' : 'mnemonic-advanced')

    try {
      if (effectiveLoginType === 'wab') {
        if (!wabUrl) { toast.error('WAB Server URL is required'); return false }
        if (!wabInfo || !method) { toast.error('Auth Method selection is required'); return false }
      }
      if (!isWalletNetwork(network)) { toast.error('Choose a supported BSV network'); return false }
      if (useRemoteStorage && !storageUrl) {
        toast.error('Storage URL is required when Remote Storage is enabled')
        return false
      }

      const trimmedWabUrl = (wabUrl || '').replace(/\/+$/, '')
      const trimmedStorageUrl = (storageUrl || '').replace(/\/+$/, '')
      const trimmedMessageBoxUrl = normalizeMessageBoxUrl(messageBoxUrl)

      // If loginType changes while a wallet manager exists, clear it so initialize() can rebuild
      if (effectiveLoginType !== this._loginType && this._managers.walletManager) {
        console.log(`[WalletService] loginType changing, clearing existing wallet manager`)
        const { walletManager, permissionsManager, settingsManager, ...rest } = this._managers
        this._managers = rest
        this._wallet = undefined
        this._initInFlight = false
      }

      this._loginType = effectiveLoginType
      this._wabUrl = trimmedWabUrl
      this._wabInfo = wabInfo
      this._selectedAuthMethod = method
      this._selectedNetwork = network
      this._selectedStorageUrl = trimmedStorageUrl
      this._messageBoxUrl = trimmedMessageBoxUrl
      this._useRemoteStorage = useRemoteStorage || false
      this._useMessageBox = useMessageBox ?? true
      this._captureSelectedNetworkSettings()
      setWocEndpoints(this._networkSettings)

      // Sync to permissionQueue
      this.permissionQueue.adminOriginator = this._adminOriginator

      this._lifecycle = 'configured'
      this._emitState()
      toast.success('Configuration applied successfully!')
      this._tryAutoInitialize()
      return true
    } catch (error: any) {
      console.error('[WalletService] configure error:', error)
      toast.error('Failed to apply configuration: ' + (error.message || 'Unknown error'))
      return false
    }
  }

  /**
   * Restore config from an existing V3 snapshot.
   * Replaces the early config-restoration useEffect in WalletContext.
   * Call this once on app startup before calling initialize().
   */
  restoreConfigFromSnapshot() {
    const snap = secrets.getSnapshot()
    if (!snap || this._lifecycle !== 'unconfigured') return

    try {
      const snapArr = Utils.toArray(snap, 'base64')
      const { config } = this._loadEnhancedSnapshot(snapArr)
      if (!config) {
        this._startupError = 'This saved wallet needs its original configuration. Its snapshot has been preserved. Recover from a wallet data file or open it with the version that created it.'
        return
      }

      console.log('[WalletService] Restoring config from V3 snapshot')
      this._wabUrl = config.wabUrl || ''
      this._selectedNetwork = isWalletNetwork(config.network) ? config.network : DEFAULT_CHAIN
      this._networkSettings = restoreNetworkSettings(config.networkSettings)
      this._selectedStorageUrl = config.storageUrl || ''
      this._messageBoxUrl = normalizeMessageBoxUrl(config.messageBoxUrl?.trim() || this._networkSettings[this._selectedNetwork].messageBoxUrl)
      this._selectedAuthMethod = config.authMethod || ''
      this._loginType = config.loginType
        ? config.loginType
        : (config.useWab !== false ? 'wab' : 'mnemonic-advanced')
      this._useRemoteStorage = config.useRemoteStorage !== undefined
        ? config.useRemoteStorage
        : !!config.storageUrl
      this._useMessageBox = config.useMessageBox ?? this._networkSettings[this._selectedNetwork].useMessageBox ?? true
      this._backupStorageUrls = config.backupStorageUrls || []
      this._captureSelectedNetworkSettings()
      setWocEndpoints(this._networkSettings)

      this.permissionQueue.adminOriginator = this._adminOriginator
      this._lifecycle = 'configured'
      this._emitState()
      console.log('[WalletService] Config restored, ready to initialize')
    } catch (err) {
      this._startupError = 'The saved wallet configuration could not be read. Your snapshot and keys have been preserved. Open wallet data files to recover.'
      console.error('[WalletService] Failed to restore config from snapshot:', err)
    }
  }

  /**
   * Fetch WAB server info. For new users with WAB auto-config.
   */
  async fetchAndAutoConfig(): Promise<void> {
    if (!secrets.getSnapshot() && this._lifecycle === 'unconfigured' && this._loginType === 'wab' && this._wabUrl) {
      try {
        const response = await fetch(`${this._wabUrl}/info`)
        if (!response.ok) throw new Error(`Server responded with ${response.status}`)
        const info = await response.json()
        this._wabInfo = info
        if (info.supportedAuthMethods?.length === 1) {
          this._selectedAuthMethod = info.supportedAuthMethods[0]
        }
        if (info.supportedAuthMethods?.length > 0) {
          this._selectedAuthMethod = this._selectedAuthMethod || info.supportedAuthMethods[0]
          this._lifecycle = 'configured'
          this._emitState()
          this._tryAutoInitialize()
        }
      } catch (error: any) {
        console.error('[WalletService] Error fetching WAB info:', error)
        toast.error('Could not fetch WAB info: ' + error.message)
      }
    }
  }

  // ------------------------------------------------------------------
  // Wallet manager initialization
  // ------------------------------------------------------------------

  /** Save each network independently, including its optional remote storage. */
  private _captureSelectedNetworkSettings(overrides?: { backupStorageUrls?: string[]; messageBoxUrl?: string; useMessageBox?: boolean }) {
    const useMessageBox = overrides?.useMessageBox ?? this._useMessageBox
    this._networkSettings = {
      ...this._networkSettings,
      [this._selectedNetwork]: {
        ...this._networkSettings[this._selectedNetwork],
        storageUrl: this._useRemoteStorage ? this._selectedStorageUrl : '',
        messageBoxUrl: normalizeMessageBoxUrl(overrides?.messageBoxUrl ?? this._messageBoxUrl),
        useMessageBox,
        backupStorageUrls: [...(overrides?.backupStorageUrls ?? this._backupStorageUrls)],
      },
    }
  }

  /**
   * Rebuild from the same authenticated snapshot against another chain's data.
   * App requests and pending permission decisions must finish before switching.
   * If a service cannot open, restore the previous configuration and wallet.
   */
  async applyNetworkSettings(network: WalletNetwork, settings: NetworkSettings): Promise<void> {
    const resolved = normalizeNetworkSettings(network, settings)
    if (isHttpBridgePaused() || this._switchingNetwork || this._initInFlight || this._lifecycle !== 'ready' || !this._wallet) {
      throw new Error('Wait for the wallet to finish opening before changing networks.')
    }
    const identityWallet = this._wallet
    const identityKey = (await identityWallet.getPublicKey({ identityKey: true })).publicKey
    if (isHttpBridgePaused() || this._switchingNetwork || this._lifecycle !== 'ready' || this._wallet !== identityWallet) throw new Error('The wallet is already changing. Try again when it is ready.')
    const queues = this.permissionQueue.getSnapshot()
    if (activeHttpBridgeRequests() || activeUserWalletOperations() || queues.groupPhase === 'pending' || Object.entries(queues).some(([key, value]) => key.endsWith('Requests') && Array.isArray(value) && value.length > 0)) {
      throw new Error('Finish the current app request or payment approval before changing networks.')
    }

    // Pause synchronously so another app cannot start between the guard and
    // snapshot capture. Storage close drains already-running in-app operations.
    const previousNetwork = this._selectedNetwork
    const previousSnapshot = this.saveEnhancedSnapshot()
    const previousSettings = this._networkSettings
    this._switchingNetwork = true
    setHttpBridgePaused(true)
    this._emitState()

    const closeCurrentWallet = async () => {
      clearWalletForHttpRoute()
      this._walletDataGeneration++
      const previousSession = this.walletData
      const previousManager = this._managers.walletManager
      const previousPeerTokens = this._stas?.peerTokens
      this.walletData = undefined
      this.permissionQueue.setPermissionsManager(null)
      this._managers = {}
      this._wallet = undefined
      this._stas = undefined
      this._activeProfile = null
      this._snapshotLoaded = false
      this._lifecycle = 'configured'
      setWocEndpoints(this._networkSettings)
      setTxStatusScope(undefined)
      // Detach old balances/managers before sub-services emit the new chain.
      this._emitState()
      const cleanup = await Promise.allSettled([
        this.peerPay.suspendClient(),
        previousPeerTokens?.disconnectWebSocket(),
        Promise.resolve().then(() => previousManager?.destroy?.()),
        (async () => {
          try { await previousSession?.close() }
          finally {
            if (previousSession && window.electronAPI?.storage?.releaseNetwork) {
              const released = await window.electronAPI.storage.releaseNetwork(previousSession.identityKey, previousSession.chain)
              if (!released.success) throw new Error(released.error || 'The previous network could not close safely.')
            }
          }
        })(),
      ])
      const failed = cleanup.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      if (failed) throw failed.reason
    }
    const reopen = async () => {
      await closeCurrentWallet()
      await this.initialize()
      if (this.getSnapshot().lifecycle !== 'ready' || !this._wallet) {
        throw new Error(this._startupError || 'The wallet could not open the selected network services.')
      }
      const reopenedIdentity = (await this._wallet.getPublicKey({ identityKey: true })).publicKey
      if (reopenedIdentity !== identityKey) throw new Error('The wallet identity changed unexpectedly. The previous network has been retained.')
    }
    const select = (chain: WalletNetwork, map: NetworkSettingsMap) => {
      this._selectedNetwork = chain
      this._networkSettings = map
      const current = map[chain]
      this._selectedStorageUrl = current.storageUrl
      this._useRemoteStorage = Boolean(current.storageUrl)
      this._messageBoxUrl = current.messageBoxUrl
      this._useMessageBox = current.useMessageBox !== false
      this._backupStorageUrls = [...current.backupStorageUrls]
    }

    try {
      select(network, { ...previousSettings, [network]: resolved })
      // Persist the target configuration with the current identity snapshot
      // before the old manager is detached. Secrets stay inside the vault.
      await secrets.persistSnapshot(this.saveEnhancedSnapshot())
      await reopen()
      await secrets.persistSnapshot(this.saveEnhancedSnapshot())
      window.dispatchEvent(new CustomEvent('balance-changed'))
      window.dispatchEvent(new CustomEvent('wallet-network-changed', { detail: { chain: network } }))
    } catch (error) {
      select(previousNetwork, previousSettings)
      try {
        await secrets.persistSnapshot(previousSnapshot)
        await reopen()
        // Also restore the nonsecret boot configuration after a failed switch.
        await secrets.persistSnapshot(this.saveEnhancedSnapshot())
      } catch (restoreError) {
        console.error('[WalletService] Previous network could not reopen:', restoreError)
        // A vault failure can happen after the target wallet opened. Never
        // expose that wallet under the restored chain's configuration.
        await closeCurrentWallet().catch(cleanupError => console.warn('[WalletService] Failed network cleanup:', cleanupError))
        this._startupError = 'The network change could not be saved or restored. Your wallet keys are preserved. Restart the app before continuing.'
        this._lifecycle = 'error'
      }
      throw error
    } finally {
      this._switchingNetwork = false
      setHttpBridgePaused(false)
      this._emitState()
    }
  }

  /**
   * Create the wallet manager and load snapshot.
   * Replaces the massive 12-dependency useEffect in WalletContext.
   * Called explicitly when all prerequisites are met.
   */
  async initialize(): Promise<void> {
    const directKeyMode = this._loginType === 'direct-key' || this._loginType === 'mnemonic'
    const hasCredentials = directKeyMode || (this._passwordRetriever && this._recoveryKeySaver)

    if (
      !hasCredentials ||
      this._lifecycle !== 'configured' ||
      this._managers.walletManager ||
      this._initInFlight
    ) {
      return
    }

    this._initInFlight = true
    this._startupError = ''
    this._lifecycle = 'initializing'
    this._emitState()

    try {
      const networkPreset = this._selectedNetwork === 'main' ? 'mainnet' : 'testnet'
      const resolver = new LookupResolver({ networkPreset })
      const broadcaster = new SHIPBroadcaster(['tm_users'], { networkPreset })

      let walletManager: any

      if (this._loginType === 'wab') {
        const wabClient = new WABClient(this._wabUrl)
        const phoneInteractor = this._selectedAuthMethod === 'DevConsole'
          ? new DevConsoleInteractor()
          : new TwilioPhoneInteractor()
        walletManager = new WalletAuthenticationManager(
          this._adminOriginator,
          this._buildWallet.bind(this),
          new OverlayUMPTokenInteractor(resolver, broadcaster),
          this._recoveryKeySaver,
          this._passwordRetriever,
          wabClient,
          phoneInteractor
        )
      } else if (directKeyMode) {
        walletManager = new SimpleWalletManager(
          this._adminOriginator,
          this._buildWallet.bind(this)
        )
      } else {
        walletManager = new CWIStyleWalletManager(
          this._adminOriginator,
          this._buildWallet.bind(this),
          new OverlayUMPTokenInteractor(resolver, broadcaster),
          this._recoveryKeySaver,
          this._passwordRetriever,
          this._walletFunder
        )
      }

      ;(window as any).walletManager = walletManager

      // Add walletManager to managers NOW so _buildWallet (called inside
      // providePrimaryKey below) can reference it when setting _snapshotLoaded.
      this._managers = { ...this._managers, walletManager }

      // Load snapshot before calling providePrimaryKey
      await this._loadWalletSnapshot(walletManager)

      // For direct-key returning users, auto-provide stored key.
      // NOTE: providePrimaryKey calls _buildWallet internally, which will advance
      // lifecycle to 'ready'. We must NOT overwrite that afterwards.
      if (this._loginType === 'mnemonic' && secrets.getSnapshot() && secrets.getMnemonic()) {
        try {
          const material = deriveMnemonicWallet(secrets.getMnemonic()!)
          const storedHex = secrets.getKeyHex()?.trim().toLowerCase()
          if (storedHex && storedHex !== material.keyHex) {
            throw new Error('The saved phrase does not match this wallet. Your saved wallet has been preserved.')
          }
          if (walletManager.primaryKey) {
            verifyMnemonicWallet(material.mnemonic, Utils.toHex(walletManager.primaryKey))
          }
          if (!storedHex) secrets.setKeyHex(material.keyHex)
          await walletManager.providePrimaryKey(material.keyBytes)
          await walletManager.providePrivilegedKeyManager(new PrivilegedKeyManager(async () => material.privilegedKey))
        } catch (err: any) {
          this._startupError = err.message || 'Could not unlock the saved wallet.'
          console.error('[WalletService] Mnemonic unlock failed:', err)
          toast.error(err.message || 'Could not unlock the saved wallet.')
        }
      } else if (this._loginType === 'mnemonic' && secrets.getSnapshot()) {
        this._startupError = 'The recovery phrase is missing from this device. Your wallet snapshot has been preserved. Recover using your phrase, backup shares, or wallet data file.'
      } else if (this._loginType === 'direct-key' && secrets.getSnapshot()) {
        const storedHex = secrets.getKeyHex()?.trim().toLowerCase() || (walletManager.primaryKey ? Utils.toHex(walletManager.primaryKey) : '')
        if (storedHex) {
          try {
            if (walletManager.primaryKey && Utils.toHex(walletManager.primaryKey) !== storedHex) {
              throw new Error('The saved key does not match this wallet snapshot. Your saved wallet has been preserved.')
            }
            const keyBytes = Utils.toArray(storedHex, 'hex')
            if (!secrets.getKeyHex()) secrets.setKeyHex(storedHex)
            await (walletManager as any).providePrimaryKey(keyBytes)
            await (walletManager as any).providePrivilegedKeyManager(this._createDisabledPrivilegedManager())
          } catch (err) {
            this._startupError = (err as any)?.message || 'Could not unlock the saved wallet.'
            console.warn('[WalletService] Auto-key provision failed:', err)
          }
        } else {
          this._startupError = 'The saved wallet key is unavailable. Your wallet snapshot has been preserved. Open your wallet data files to recover.'
        }
      }

      // Only set 'authenticated' if _buildWallet hasn't already advanced us to 'ready'.
      // For WAB/CWI modes, _buildWallet hasn't run yet (user auth is still pending).
      // For direct-key auto-login, _buildWallet already ran and set 'ready'.
      if (this._lifecycle === 'initializing') {
        this._lifecycle = 'authenticated'
      }
      this._emitState()
    } catch (err: any) {
      this._startupError = err.message || 'Could not open the saved wallet.'
      console.error('[WalletService] Initialization failed:', err)
      toast.error('Failed to initialize wallet: ' + err.message)
      this._lifecycle = 'error'
      this._emitState()
    } finally {
      this._initInFlight = false
    }
  }

  /** Retry a failed startup without deleting or rewriting any saved wallet material. */
  async retrySavedWallet(): Promise<void> {
    if (this._initInFlight || this._initializingBackendServices || this._switchingNetwork || this._wallet) return
    this._managers.walletManager?.destroy?.()
    this._managers = {}
    this._startupError = ''
    this._lifecycle = 'configured'
    this._emitState()
    await this.initialize()
  }

  /** Internal: called by manager when user authenticates and provides primary key. */
  private async _buildWallet(
    primaryKey: number[],
    privilegedKeyManager: any
  ): Promise<any> {
    const generation = ++this._walletDataGeneration
    let candidate: WalletDataSession | undefined
    let openedLocal: { identityKey: string; chain: WalletNetwork } | undefined
    const previousSession = this.walletData
    const previousPeerTokens = this._stas?.peerTokens
    const walletManager = this._managers.walletManager
    // The old storage session is about to close. Its wallet and app reference
    // must stop being usable even if the replacement cannot be constructed.
    clearWalletForHttpRoute()
    this.permissionQueue.setPermissionsManager(null)
    this.walletData = undefined
    this._managers = walletManager ? { walletManager } : {}
    this._wallet = undefined
    this._stas = undefined
    this._activeProfile = null
    this._snapshotLoaded = false
    setTxStatusScope(undefined)
    console.log('[WalletService] Building wallet...')
    this._initializingBackendServices = true
    this._startupError = ''
    this._lifecycle = 'initializing'
    this._emitState()

    try {
      const cleanup = await Promise.allSettled([
        this.peerPay.suspendClient(),
        previousPeerTokens?.disconnectWebSocket(),
        (async () => {
          try { await previousSession?.close() }
          finally {
            if (previousSession && window.electronAPI?.storage?.releaseNetwork) {
              const released = await window.electronAPI.storage.releaseNetwork(previousSession.identityKey, previousSession.chain)
              if (!released.success) throw new Error(released.error || 'The previous wallet could not close safely.')
            }
          }
        })(),
      ])
      const failedCleanup = cleanup.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      if (failedCleanup) throw failedCleanup.reason
      if (generation !== this._walletDataGeneration) throw new Error('Wallet profile changed while closing storage')
      const chain = this._selectedNetwork
      const keyDeriver = new CachedKeyDeriver(new PrivateKey(primaryKey))
      const serviceSettings = this._networkSettings[chain]
      const services = createServices(chain, keyDeriver.identityKey, serviceSettings)

      let binding: { preferLocal: boolean } | undefined
      try {
        binding = await walletDataCall('binding', { identity: keyDeriver.identityKey, chain })
      } catch (error) {
        // Local storage cannot open without its binding, but a remote wallet can.
        if (!this._useRemoteStorage) throw error
        console.warn('[WalletService] Wallet data binding unavailable; continuing with remote storage:', error)
        toast.warning(`Saved wallet data selection could not be read, so remote storage is used: ${error instanceof Error ? error.message : String(error)}`)
      }
      if (generation !== this._walletDataGeneration) throw new Error('Wallet profile changed while opening storage')
      if (binding?.preferLocal) {
        this._useRemoteStorage = false
        this._backupStorageUrls = this._backupStorageUrls.filter(url => url !== 'LOCAL_STORAGE')
      }
      let activeStorage: any

      if (this._useRemoteStorage) {
        activeStorage = null // Created after wallet
      } else {
        const electronStorage = new StorageElectronIPC(keyDeriver.identityKey, chain, serviceSettings)
        electronStorage.setServices(services as any)
        openedLocal = { identityKey: keyDeriver.identityKey, chain }
        await electronStorage.initializeBackendServices()
        await electronStorage.makeAvailable()
        activeStorage = electronStorage
      }

      const storageManager = new WalletDataStorageManager(keyDeriver.identityKey, activeStorage, [])
      candidate = new WalletDataSession(keyDeriver.identityKey, chain, storageManager, !this._useRemoteStorage)
      const signer = new WalletSigner(chain, keyDeriver as any, storageManager)
      const wallet = new Wallet(signer, services, undefined, privilegedKeyManager)
      // Set default settings including "Who I Am" certifier before first get().
      // config is private in the type declarations but settable at runtime.
      ;(wallet.settingsManager as any).config = { defaultSettings: DEFAULT_SETTINGS }

      if (this._useRemoteStorage) {
        const client = new StorageClient(wallet, this._selectedStorageUrl)
        await client.makeAvailable()
        await storageManager.addWalletStorageProvider(client)
      }

      // Add backup providers
      for (const backupUrl of this._backupStorageUrls) {
        try {
          if (backupUrl === 'LOCAL_STORAGE') {
            const electronStorage = new StorageElectronIPC(keyDeriver.identityKey, chain, serviceSettings)
            electronStorage.setServices(services as any)
            await electronStorage.makeAvailable()
            await storageManager.addWalletStorageProvider(electronStorage as any)
          } else {
            const backupClient = new StorageClient(wallet, backupUrl)
            await backupClient.makeAvailable()
            await storageManager.addWalletStorageProvider(backupClient)
          }
        } catch (error: any) {
          console.error('[WalletService] Failed to add backup storage:', backupUrl, error)
          toast.error(`Failed to connect to backup storage ${backupUrl}: ${error.message}`)
        }
      }

      // Set primary store as active
      const stores = storageManager.getStores()
      if (stores && stores.length > 0) {
        await storageManager.setActive(stores[0].storageIdentityKey)
      }

      if (generation !== this._walletDataGeneration) throw new Error('Wallet profile changed while opening storage')
      this.walletData = candidate
      const permissionsManager = this.permissionQueue.createPermissionsManager(wallet)
      this.permissionQueue.setPermissionsManager(permissionsManager)

      this._managers = {
        ...this._managers,
        permissionsManager,
        settingsManager: (wallet as any).settingsManager,
        storageManager,
      }
      this._wallet = wallet
      // Publish only the newly constructed wallet, with no previous profile's
      // permissions manager or payment client surviving the transition.
      setTxStatusScope({ identityKey: keyDeriver.identityKey, chain })

      // Token discovery is available only on networks with token indexers.
      // Never query testnet tokens while a Tera network wallet is open.
      this._stas = undefined
      if (chain === 'main' || chain === 'test') {
        const tokenChain = chain

        // STAS BRC-42 services — ownership recognition + receive-key derivation,
        // plus the Task-4 discovery loop (WoC scan -> internalizeAction).
        const stasKeyDeriver = new StasKeyDeriver(wallet, keyDeriver.identityKey, tokenChain)
        const stasRegistration = new StasRegistration(wallet, keyDeriver.identityKey, tokenChain)
        const stasTransfer = new StasTransferService(wallet, keyDeriver.identityKey, tokenChain)

        // DSTAS transfer service (F3) — shares the STAS BRC-42 receive
        // namespace, builds the new output via the SDK's pure
        // buildDstasLockingScript, and assembles the DSTAS unlocking
        // script byte-for-byte to match the template's witness format.
        const dstasTransfer = new DstasTransferService(wallet, keyDeriver.identityKey, tokenChain)

        // BSV-21 services — separate BRC-42 namespace, 1Sat REST indexer,
        // standard P2PKH unlock path.
        const bsv21KeyDeriver = new BSV21KeyDeriver(wallet, keyDeriver.identityKey, tokenChain)
        const bsv21Indexer = new OneSatIndexerClient({ chain: tokenChain })
        const bsv21Registration = new BSV21Registration(wallet, keyDeriver.identityKey, tokenChain)
        const bsv21Transfer = new BSV21TransferService({
          wallet,
          identityKey: keyDeriver.identityKey,
          chain: tokenChain,
          deriver: bsv21KeyDeriver,
          indexer: bsv21Indexer,
        })

        // Token-protocol adapter registry. Order matters: STAS's prefix sniff
        // is cheap and unambiguous, DSTAS's SDK reader next, BSV-21's ord
        // envelope last (also cheap but distinct prefix).
        const tokens = new TokenProtocolRegistry()
        tokens.register(new StasProtocolAdapter(stasTransfer))
        tokens.register(new DstasProtocolAdapter(dstasTransfer))
        tokens.register(new BSV21ProtocolAdapter(bsv21Transfer))

        // Token discovery — WhatsOnChain is the single source for all three
        // standards: STAS (by base58 address) and DSTAS (by owner hash160) ride
        // StasDiscoveryService, BSV-21 rides BSV21DiscoveryService, all fed by
        // the same WocTokenIndexerClient.
        const wocIndexer = new WocTokenIndexerClient({ chain: tokenChain })
        const backToGenesis = new BackToGenesisClient({ chain: tokenChain })

        const stasDiscovery = new StasDiscoveryService({
          deriver: stasKeyDeriver,
          indexer: wocIndexer,
          registration: stasRegistration,
          wallet,
          registry: tokens,
        })
        const bsv21Discovery = new BSV21DiscoveryService({
          deriver: bsv21KeyDeriver,
          indexer: wocIndexer,
          registration: bsv21Registration,
          wallet,
        })

        // Peer-token client (token analog of PeerPay). Uses the same raw
        // `wallet` the token services use, so signing/derivation namespaces
        // match. Each adapter reuses the existing transfer-service building
        // blocks; the BRC-29 owner derivation lives inside the adapters.
        const peerTokens = new PeerTokenClient({
          messageBoxHost: this._messageBoxUrl || MESSAGEBOX_HOST,
          walletClient: wallet,
          originator: this._adminOriginator,
          adapters: [
            new StasTokenSettlementAdapter(wallet, keyDeriver.identityKey, tokenChain),
            new Bsv21TokenSettlementAdapter({
              wallet,
              identityKey: keyDeriver.identityKey,
              chain: tokenChain,
              deriver: bsv21KeyDeriver,
              indexer: bsv21Indexer,
            }),
            new DstasTokenSettlementAdapter(wallet, keyDeriver.identityKey, tokenChain),
          ],
        })

        this._stas = {
          keyDeriver: stasKeyDeriver,
          ownership: new StasOwnershipService(stasKeyDeriver),
          discovery: stasDiscovery,
          transfer: stasTransfer,
          tokens,
          bsv21KeyDeriver,
          bsv21Discovery,
          bsv21Indexer,
          backToGenesis,
          peerTokens,
        }

      }

      // Load settings
      try {
        const userSettings = await (wallet as any).settingsManager?.get()
        if (generation === this._walletDataGeneration && userSettings) this._settings = userSettings
      } catch { }

      if (generation !== this._walletDataGeneration) throw new Error('Wallet profile changed while loading settings')
      // Update active profile
      await this._updateActiveProfile()

      // Create PeerPay client if configured
      if (this._messageBoxUrl && this._useMessageBox) {
        await this.peerPay.createClient(permissionsManager, this._messageBoxUrl, this._adminOriginator)
      }

      if (generation !== this._walletDataGeneration) throw new Error('Wallet profile changed while starting services')
      // Clear the initializing flag BEFORE the ready emit so React (e.g. Greeter)
      // does not stay stuck on the non-interactive initializingBackendServices screen.
      // Previously this was only cleared in `finally` without an emit, so the UI
      // never learned the flag was false and hung forever after password login.
      this._initializingBackendServices = false
      this._lifecycle = 'ready'
      this._snapshotLoaded = !!secrets.getSnapshot() && !!this._managers.walletManager

      this._emitState()
      return permissionsManager
    } catch (error: any) {
      await candidate?.close().catch(() => {})
      if (generation !== this._walletDataGeneration) return null
      if (openedLocal && window.electronAPI?.storage?.releaseNetwork) {
        await window.electronAPI.storage.releaseNetwork(openedLocal.identityKey, openedLocal.chain)
          .catch(error => console.warn('[WalletService] Failed network storage cleanup:', error))
      }
      if (this.walletData === candidate) this.walletData = undefined
      console.error('[WalletService] _buildWallet failed:', error)
      clearWalletForHttpRoute()
      this.permissionQueue.setPermissionsManager(null)
      await Promise.allSettled([this.peerPay.suspendClient(), this._stas?.peerTokens?.disconnectWebSocket()])
      this._managers = walletManager ? { walletManager } : {}
      this._startupError = error.message || 'Could not open the wallet services.'
      this._wallet = undefined
      this._stas = undefined
      this._activeProfile = null
      toast.error('Failed to build wallet: ' + error.message)
      this._initializingBackendServices = false
      this._lifecycle = 'error'
      this._emitState()
      return null
    }
  }

  private async _updateActiveProfile() {
    const { walletManager } = this._managers
    const wallet = this._wallet

    // Use wallet existence (set by _buildWallet) as ready signal.
    // walletManager.authenticated is unreliable for SimpleWalletManager (direct-key).
    if (!wallet && !walletManager?.authenticated) {
      this._activeProfile = null
      return
    }

    if (this._loginType === 'direct-key' || this._loginType === 'mnemonic') {
      const storedHex = secrets.getKeyHex()
      if (storedHex) {
        try {
          const keyDeriver = new CachedKeyDeriver(new PrivateKey(Utils.toArray(storedHex.trim(), 'hex')))
          this._activeProfile = {
            id: Utils.toArray(keyDeriver.identityKey, 'hex'),
            name: 'Default',
            createdAt: null,
            active: true,
            identityKey: keyDeriver.identityKey,
          }
        } catch (err) {
          console.error('[WalletService] Failed to create synthetic profile:', err)
        }
      }
    }

    // For WAB/mnemonic modes, try listProfiles regardless of loginType
    // (loginType in snapshot may not match actual manager type)
    if (!this._activeProfile && walletManager?.listProfiles) {
      const profiles = walletManager.listProfiles()
      const profileToSet = profiles.find((p: any) => p.active) || profiles[0]
      if (profileToSet?.id) {
        this._activeProfile = profileToSet
      }
    }
  }

  // ------------------------------------------------------------------
  // Snapshot management (previously useCallback + useEffect in WalletContext)
  // ------------------------------------------------------------------

  saveEnhancedSnapshot(configOverrides?: { backupStorageUrls?: string[]; messageBoxUrl?: string; useMessageBox?: boolean }): string {
    if (!this._managers.walletManager) {
      throw new Error('Wallet manager not available for snapshot')
    }

    const walletSnapshot = this._managers.walletManager.saveSnapshot()

    this._captureSelectedNetworkSettings(configOverrides)
    const config = {
      network: this._selectedNetwork,
      networkSettings: this._networkSettings,
      useWab: this._loginType === 'wab',
      loginType: this._loginType,
      wabUrl: this._wabUrl,
      authMethod: this._selectedAuthMethod,
      useRemoteStorage: this._useRemoteStorage,
      storageUrl: this._selectedStorageUrl,
      backupStorageUrls: configOverrides?.backupStorageUrls ?? this._backupStorageUrls,
      useMessageBox: configOverrides?.useMessageBox ?? this._useMessageBox,
      messageBoxUrl: normalizeMessageBoxUrl(configOverrides?.messageBoxUrl ?? this._messageBoxUrl),
    }

    // Dual-write non-secret boot config for pre-unlock routing after restart.
    // Do not overwrite unlockMethods (set at vault enroll).
    void window.electronAPI?.bootConfig?.set({
      version: 1,
      hasVault: true,
      network: config.network,
      networkSettings: config.networkSettings,
      loginType: config.loginType,
      wabUrl: config.wabUrl,
      storageUrl: config.storageUrl,
      messageBoxUrl: config.messageBoxUrl,
      authMethod: config.authMethod,
      useRemoteStorage: config.useRemoteStorage,
      useMessageBox: config.useMessageBox,
      backupStorageUrls: config.backupStorageUrls,
    }).catch((err: any) => console.warn('[WalletService] bootConfig set failed:', err))

    const configJson = JSON.stringify(config)
    const configBytes = Array.from(new TextEncoder().encode(configJson))

    const varintBytes: number[] = []
    let len = configBytes.length
    while (len >= 0x80) {
      varintBytes.push((len & 0x7f) | 0x80)
      len >>>= 7
    }
    varintBytes.push(len & 0x7f)

    const enhancedSnapshot = [3, ...varintBytes, ...configBytes, ...walletSnapshot]
    return Utils.toBase64(enhancedSnapshot)
  }

  private _loadEnhancedSnapshot(snapArr: number[]): { walletSnapshot: number[]; config?: any } {
    if (!snapArr || snapArr.length === 0) throw new Error('Empty snapshot')

    const version = snapArr[0]

    if (version === 1 || version === 2) {
      return { walletSnapshot: snapArr }
    }

    if (version === 3) {
      let offset = 1
      let configLength = 0
      let shift = 0
      while (offset < snapArr.length) {
        const byte = snapArr[offset++]
        configLength |= (byte & 0x7f) << shift
        if ((byte & 0x80) === 0) break
        shift += 7
      }
      const configBytes = snapArr.slice(offset, offset + configLength)
      const configJson = new TextDecoder().decode(new Uint8Array(configBytes))
      const config = JSON.parse(configJson)
      const walletSnapshot = snapArr.slice(offset + configLength)
      return { walletSnapshot, config }
    }

    throw new Error(`Unsupported snapshot version: ${version}`)
  }

  private async _loadWalletSnapshot(walletManager: any) {
    const snap = secrets.getSnapshot()
    if (!snap) return
    try {
      const snapArr = Utils.toArray(snap, 'base64')
      const { walletSnapshot } = this._loadEnhancedSnapshot(snapArr)
      await walletManager.loadSnapshot(walletSnapshot)
    } catch (err: any) {
      console.error('[WalletService] Error loading snapshot:', err)
      toast.error("Couldn't load saved data: " + err.message)
    }
  }

  // ------------------------------------------------------------------
  // Storage management (previously useCallback in WalletContext)
  // ------------------------------------------------------------------

  async addBackupStorageUrl(url: string): Promise<void> {
    if (!this._managers.walletManager) throw new Error('Wallet manager not available')
    if (this._backupStorageUrls.includes(url)) throw new Error('This backup storage is already added')

    const isLocalStorage = url === 'LOCAL_STORAGE'
    if (!isLocalStorage && !url.startsWith('http://') && !url.startsWith('https://')) {
      throw new Error('Backup storage URL must start with http:// or https://')
    }
    if (!isLocalStorage && this._useRemoteStorage && this._selectedStorageUrl === url) {
      throw new Error('This URL is already your primary storage. Cannot add it as a backup.')
    }
    if (isLocalStorage && !this._useRemoteStorage) {
      throw new Error('Local storage is already your primary storage. Cannot add it as a backup.')
    }

    const wallet = this._wallet
    const { storageManager } = this._managers
    if (!wallet || !storageManager) throw new Error('Wallet not available')

    let backupProvider: any
    if (isLocalStorage) {
      const identityKey = (storageManager as any)?._authId?.identityKey
      if (!identityKey) throw new Error('Could not get identity key from wallet')
      const electronStorage = new StorageElectronIPC(identityKey, this._selectedNetwork, this._networkSettings[this._selectedNetwork])
      const services = createServices(this._selectedNetwork, identityKey, this._networkSettings[this._selectedNetwork])
      electronStorage.setServices(services as any)
      await electronStorage.makeAvailable()
      backupProvider = electronStorage
    } else {
      // Use the raw `wallet` (not `permissionsManager`) — StorageClient's BRC-103
      // handshake calls wallet.createHmac without an originator, which the
      // permissionsManager wrapper rejects with "Originator is required".
      backupProvider = new StorageClient(wallet, url)
      await backupProvider.makeAvailable()
    }

    await storageManager.addWalletStorageProvider(backupProvider)

    const stores = storageManager.getStores()
    if (stores?.length > 0) await storageManager.setActive(stores[0].storageIdentityKey)

    const newBackupUrls = [...this._backupStorageUrls, url]
    const snapshot = this.saveEnhancedSnapshot({ backupStorageUrls: newBackupUrls })
    secrets.setSnapshot(snapshot)
    this._backupStorageUrls = newBackupUrls
    this._emitState()
    toast.success('Backup storage added successfully!')
  }

  async removeBackupStorageUrl(url: string): Promise<void> {
    if (!this._backupStorageUrls.includes(url)) return

    const newBackupUrls = this._backupStorageUrls.filter(u => u !== url)

    // Persist before reload so the rebuilt wallet sees the updated snapshot.
    // If the snapshot fails to save we abort — leaving the live storageManager
    // attached to a backup the user thinks is gone is worse than a visible error.
    let snapshot: string
    try {
      snapshot = this.saveEnhancedSnapshot({ backupStorageUrls: newBackupUrls })
    } catch (err: any) {
      console.error('[WalletService] Failed to save snapshot:', err)
      toast.error('Failed to remove backup: could not save snapshot')
      throw err
    }
    secrets.setSnapshot(snapshot)
    this._backupStorageUrls = newBackupUrls
    this._emitState()

    // wallet-toolbox has no runtime API to detach a storage provider, so the
    // live storageManager keeps writing to the just-removed URL until the wallet
    // is rebuilt. Without this reload, syncBackupStorage and setPrimaryStorage
    // would still iterate the removed provider — which can fail mid-flight (e.g.,
    // a flaky removed backup) and, worse, could leave a user-removed store as a
    // sync target. A renderer reload triggers the standard auto-init path, which
    // reads the just-persisted snapshot and rebuilds the wallet cleanly with no
    // bespoke teardown logic for us to maintain.
    toast.info('Backup storage removed. Reloading wallet...')
    setTimeout(() => window.location.reload(), 600)
  }

  async syncBackupStorage(progressCallback?: (message: string) => void): Promise<void> {
    const { storageManager } = this._managers
    if (!storageManager) throw new Error('Storage manager not available')
    if (typeof storageManager.updateBackups === 'function') {
      await storageManager.updateBackups(undefined, (s: string) => {
        console.log('[WalletService syncBackup]', s)
        progressCallback?.(s)
        return s
      })
    } else {
      progressCallback?.('Backup providers sync automatically on each wallet action')
    }
  }

  /**
   * Switch the active (primary) storage to one of the currently-configured backups.
   *
   * - `target` is a storage URL (`http://...` / `https://...`) or the `'LOCAL_STORAGE'`
   *   sentinel for the local Electron-IPC backend.
   * - Underneath this calls `WalletStorageManager.setActive`, which syncs pending writes
   *   to the target backup before atomically flipping the active pointer. The wallet
   *   object is not rebuilt; subsequent reads/writes route through the new active store.
   * - The snapshot fields (`useRemoteStorage`, `storageUrl`, `backupStorageUrls`) are
   *   re-derived from `storageManager.getStores()` after the operation. The manager is
   *   the authoritative source of truth, so the snapshot always matches its actual
   *   active store. This also self-heals any prior divergence (e.g., a swap that
   *   flipped the manager but failed to persist to the snapshot).
   */
  async setPrimaryStorage(target: string, progressCallback?: (message: string) => void): Promise<void> {
    const { storageManager } = this._managers
    if (!storageManager) throw new Error('Storage manager not available')

    const isLocal = target === 'LOCAL_STORAGE'
    const normalizedTarget = isLocal ? target : target.trim().replace(/\/+$/, '')
    if (!isLocal && !normalizedTarget.startsWith('http://') && !normalizedTarget.startsWith('https://')) {
      throw new Error('Storage target must be a URL or LOCAL_STORAGE')
    }

    const stores = storageManager.getStores()
    if (!stores || stores.length === 0) throw new Error('No storage providers configured')

    const targetStore = stores.find(s =>
      isLocal ? !s.endpointURL : s.endpointURL === normalizedTarget
    )
    if (!targetStore) {
      throw new Error(`No storage provider matching ${normalizedTarget}. Add it as a backup first.`)
    }

    // Snapshot the *visible* primary before any change, so we can decide which toast to
    // show after reconciliation.
    const visiblePrimaryBefore = this._useRemoteStorage ? this._selectedStorageUrl : 'LOCAL_STORAGE'
    const targetWasAlreadyActive = targetStore.isActive

    if (!targetWasAlreadyActive) {
      await storageManager.setActive(targetStore.storageIdentityKey, (s: string) => {
        console.log('[WalletService setPrimaryStorage]', s)
        progressCallback?.(s)
        return s
      })
    }

    if (this.walletData) {
      await walletDataCall('preference', { identity: this.walletData.identityKey, chain: this.walletData.chain, preferLocal: isLocal })
      this.walletData = new WalletDataSession(this.walletData.identityKey, this.walletData.chain, storageManager as WalletDataStorageManager, isLocal)
    }

    // Reconcile the snapshot from the manager's authoritative store list. Always run
    // this — even on the no-op path — because the snapshot may have drifted out of
    // sync from a prior operation (e.g., a swap that completed in the manager but
    // didn't persist to localStorage). Re-deriving `useRemoteStorage` / `storageUrl` /
    // `backupStorageUrls` from `getStores()` heals any divergence.
    const reconciledStores = storageManager.getStores() || []
    const activeStore = reconciledStores.find(s => s.isActive)
    if (!activeStore) throw new Error('No active storage after setPrimaryStorage')

    if (activeStore.endpointURL) {
      this._useRemoteStorage = true
      this._selectedStorageUrl = activeStore.endpointURL
    } else {
      this._useRemoteStorage = false
      this._selectedStorageUrl = ''
    }
    const newBackups: string[] = []
    let localSeenAsBackup = false
    for (const s of reconciledStores) {
      if (s.isActive) continue
      if (s.endpointURL) {
        if (!newBackups.includes(s.endpointURL)) newBackups.push(s.endpointURL)
      } else if (!localSeenAsBackup) {
        newBackups.push('LOCAL_STORAGE')
        localSeenAsBackup = true
      }
    }
    this._backupStorageUrls = newBackups

    const snapshot = this.saveEnhancedSnapshot()
    secrets.setSnapshot(snapshot)
    this._emitState()

    const visiblePrimaryAfter = this._useRemoteStorage ? this._selectedStorageUrl : 'LOCAL_STORAGE'
    if (targetWasAlreadyActive && visiblePrimaryBefore === visiblePrimaryAfter) {
      toast.info('Already the primary storage')
    } else {
      toast.success('Primary storage switched!')
    }
  }

  async updateMessageBoxUrl(url: string): Promise<void> {
    const trimmedUrl = normalizeMessageBoxUrl(url)

    this._messageBoxUrl = trimmedUrl
    this._useMessageBox = true

    const walletForPeerPay = this.permissionQueue['_permissionsManager'] || this._managers.permissionsManager
    if (walletForPeerPay) {
      await this.peerPay.replaceClient(walletForPeerPay, trimmedUrl, this._adminOriginator)
    }

    const snapshot = this.saveEnhancedSnapshot({ messageBoxUrl: trimmedUrl, useMessageBox: true })
    secrets.setSnapshot(snapshot)
    this._emitState()
    toast.success('Message Box URL configured successfully!')
  }

  async removeMessageBoxUrl(): Promise<void> {
    await this.peerPay.destroyClient(this._messageBoxUrl)
    this._messageBoxUrl = MESSAGEBOX_HOST
    this._useMessageBox = false

    const snapshot = this.saveEnhancedSnapshot()
    secrets.setSnapshot(snapshot)
    this._emitState()
    toast.success('Message Box URL removed successfully!')
  }

  async updateSettings(newSettings: WalletSettings): Promise<void> {
    if (!this._managers.settingsManager) throw new Error('The user must be logged in to update settings!')
    await this._managers.settingsManager.set(newSettings)
    this._settings = newSettings
    this._emitState()
  }

  // ------------------------------------------------------------------
  // Logout
  // ------------------------------------------------------------------

  logout() {
    setTxStatusScope(undefined)
    this._walletDataGeneration++
    void this.walletData?.close().catch(() => {})
    this.walletData = undefined
    const preservedKeys: Record<string, string> = {}
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith('payReq_')) {
        preservedKeys[key] = localStorage.getItem(key) ?? ''
      }
    }

    localStorage.clear()

    for (const [key, value] of Object.entries(preservedKeys)) {
      localStorage.setItem(key, value)
    }

    // Clear wallet secrets and lock the vault, but KEEP enrollment (passphrase +
    // biometrics wraps). Destroying the vault forced "Create vault" on every logout.
    void secrets.endSession().catch((err) =>
      console.warn('[WalletService] endSession on logout failed:', err)
    )
    secrets.clearCache()

    this._managers = {}
    this._wallet = undefined
    this._lifecycle = 'configured'
    this._snapshotLoaded = false
    this._activeProfile = null
    this.peerPay.reset()
    this._emitState()
  }

  // ------------------------------------------------------------------
  // Internal helpers
  // ------------------------------------------------------------------

  private _tryAutoInitialize() {
    const directKeyMode = this._loginType === 'direct-key' || this._loginType === 'mnemonic'
    if (
      this._lifecycle === 'configured' &&
      !this._managers.walletManager &&
      !this._initInFlight &&
      // Callback registration can run after the old managers are detached.
      // The network transition owns initialization until storage has closed.
      !this._switchingNetwork &&
      (directKeyMode || (this._passwordRetriever && this._recoveryKeySaver))
    ) {
      this.initialize()
    }
  }

  private _createDisabledPrivilegedManager() {
    return new PrivilegedKeyManager(async () => {
      throw new Error('Privileged operations are not available in direct-key mode')
    })
  }

  private _emitState() {
    this.emit('stateChanged', this.getSnapshot())
  }
}
