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
  Services,
  StorageClient,
  TwilioPhoneInteractor,
  DevConsoleInteractor,
  WABClient,
  Wallet,
  PrivilegedKeyManager,
} from '@bsv/wallet-toolbox-client'
import {
  PrivateKey,
  SHIPBroadcaster,
  Utils,
  LookupResolver,
  WalletInterface,
  CachedKeyDeriver,
} from '@bsv/sdk'
import { WalletSettingsManager, DEFAULT_SETTINGS, WalletSettings } from '@bsv/wallet-toolbox-client/out/src/WalletSettingsManager'
import { toast } from 'react-toastify'
import { EventEmittable } from './EventEmittable'
import { PermissionQueueManager } from './PermissionQueueManager'
import { PeerPayManager } from './PeerPayManager'
import { StorageElectronIPC } from '../StorageElectronIPC'
import { DEFAULT_CHAIN, ADMIN_ORIGINATOR, DEFAULT_USE_WAB } from '../config'
import type { LoginType, WABConfig } from '../WalletContext'
import type { WalletProfile } from '../types/WalletProfile'

export type WalletLifecycle =
  | 'unconfigured'
  | 'configured'
  | 'initializing'
  | 'authenticated'
  | 'ready'
  | 'error'

// State exposed to React via snapshot
export type WalletServiceSnapshot = {
  lifecycle: WalletLifecycle
  // Config
  loginType: LoginType
  wabUrl: string
  wabInfo: any
  selectedAuthMethod: string
  selectedNetwork: 'main' | 'test'
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
    wallet?: WalletInterface
    storageManager?: WalletStorageManager
  }
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

  // ---- Config state (previously multiple useState hooks) ----
  private _loginType: LoginType = DEFAULT_USE_WAB ? 'wab' : 'direct-key'
  private _wabUrl = ''
  private _wabInfo: any = null
  private _selectedAuthMethod = ''
  private _selectedNetwork: 'main' | 'test' = DEFAULT_CHAIN
  private _selectedStorageUrl = ''
  private _messageBoxUrl = ''
  private _useRemoteStorage = false
  private _useMessageBox = false
  private _backupStorageUrls: string[] = []
  private _adminOriginator = ADMIN_ORIGINATOR

  // ---- Runtime state ----
  private _managers: WalletServiceSnapshot['managers'] = {}
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
  get settings() { return this._settings }
  get activeProfile() { return this._activeProfile }
  get snapshotLoaded() { return this._snapshotLoaded }
  get initializingBackendServices() { return this._initializingBackendServices }
  get lifecycle() { return this._lifecycle }

  getSnapshot(): WalletServiceSnapshot {
    return {
      lifecycle: this._lifecycle,
      loginType: this._loginType,
      wabUrl: this._wabUrl,
      wabInfo: this._wabInfo,
      selectedAuthMethod: this._selectedAuthMethod,
      selectedNetwork: this._selectedNetwork,
      selectedStorageUrl: this._selectedStorageUrl,
      messageBoxUrl: this._messageBoxUrl,
      useRemoteStorage: this._useRemoteStorage,
      useMessageBox: this._useMessageBox,
      backupStorageUrls: this._backupStorageUrls,
      adminOriginator: this._adminOriginator,
      managers: this._managers,
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
      if (!network) { toast.error('Network selection is required'); return false }
      if (useRemoteStorage && !storageUrl) {
        toast.error('Storage URL is required when Remote Storage is enabled')
        return false
      }

      const trimmedWabUrl = (wabUrl || '').replace(/\/+$/, '')
      const trimmedStorageUrl = (storageUrl || '').replace(/\/+$/, '')
      const trimmedMessageBoxUrl = (messageBoxUrl || '').replace(/\/+$/, '')

      // If loginType changes while a wallet manager exists, clear it so initialize() can rebuild
      if (effectiveLoginType !== this._loginType && this._managers.walletManager) {
        console.log(`[WalletService] loginType changing, clearing existing wallet manager`)
        const { walletManager, permissionsManager, settingsManager, ...rest } = this._managers
        this._managers = rest
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
      this._useMessageBox = useMessageBox || false

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
    if (!localStorage.snap || this._lifecycle !== 'unconfigured') return

    try {
      const snapArr = Utils.toArray(localStorage.snap, 'base64')
      const { config } = this._loadEnhancedSnapshot(snapArr)
      if (!config) return

      console.log('[WalletService] Restoring config from V3 snapshot')
      this._wabUrl = config.wabUrl || ''
      this._selectedNetwork = config.network || DEFAULT_CHAIN
      this._selectedStorageUrl = config.storageUrl || ''
      this._messageBoxUrl = config.messageBoxUrl || ''
      this._selectedAuthMethod = config.authMethod || ''
      this._loginType = config.loginType
        ? config.loginType
        : (config.useWab !== false ? 'wab' : 'mnemonic-advanced')
      this._useRemoteStorage = config.useRemoteStorage !== undefined
        ? config.useRemoteStorage
        : !!config.storageUrl
      this._useMessageBox = config.useMessageBox !== undefined ? config.useMessageBox : false
      this._backupStorageUrls = config.backupStorageUrls || []

      this.permissionQueue.adminOriginator = this._adminOriginator
      this._lifecycle = 'configured'
      this._emitState()
      console.log('[WalletService] Config restored, ready to initialize')
    } catch (err) {
      console.error('[WalletService] Failed to restore config from snapshot:', err)
    }
  }

  /**
   * Fetch WAB server info. For new users with WAB auto-config.
   */
  async fetchAndAutoConfig(): Promise<void> {
    if (!localStorage.snap && this._lifecycle === 'unconfigured' && this._loginType === 'wab' && this._wabUrl) {
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

  /**
   * Create the wallet manager and load snapshot.
   * Replaces the massive 12-dependency useEffect in WalletContext.
   * Called explicitly when all prerequisites are met.
   */
  async initialize(): Promise<void> {
    const directKeyMode = this._loginType === 'direct-key'
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
      } else if (this._loginType === 'direct-key') {
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
      if (directKeyMode && localStorage.snap && localStorage.getItem('primaryKeyHex')) {
        const storedHex = localStorage.getItem('primaryKeyHex')!.trim()
        if (storedHex) {
          try {
            const keyBytes = Utils.toArray(storedHex, 'hex')
            await (walletManager as any).providePrimaryKey(keyBytes)
            await (walletManager as any).providePrivilegedKeyManager(this._createDisabledPrivilegedManager())
          } catch (err) {
            console.warn('[WalletService] Auto-key provision failed:', err)
          }
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
      console.error('[WalletService] Initialization failed:', err)
      toast.error('Failed to initialize wallet: ' + err.message)
      this._lifecycle = 'error'
      this._emitState()
    } finally {
      this._initInFlight = false
    }
  }

  /** Internal: called by manager when user authenticates and provides primary key. */
  private async _buildWallet(
    primaryKey: number[],
    privilegedKeyManager: any
  ): Promise<any> {
    console.log('[WalletService] Building wallet...')
    this._initializingBackendServices = true
    this._emitState()

    try {
      const chain = this._selectedNetwork
      const keyDeriver = new CachedKeyDeriver(new PrivateKey(primaryKey))
      const services = new Services(chain)

      let activeStorage: any

      if (this._useRemoteStorage) {
        activeStorage = null // Created after wallet
      } else {
        const electronStorage = new StorageElectronIPC(keyDeriver.identityKey, chain)
        electronStorage.setServices(services as any)
        await electronStorage.initializeBackendServices()
        await electronStorage.makeAvailable()
        activeStorage = electronStorage
      }

      const storageManager = new WalletStorageManager(keyDeriver.identityKey, activeStorage, [])
      const signer = new WalletSigner(chain, keyDeriver as any, storageManager)
      const wallet = new Wallet(signer, services, undefined, privilegedKeyManager)

      if (this._useRemoteStorage) {
        const client = new StorageClient(wallet, this._selectedStorageUrl)
        await client.makeAvailable()
        await storageManager.addWalletStorageProvider(client)
      }

      // Add backup providers
      for (const backupUrl of this._backupStorageUrls) {
        try {
          if (backupUrl === 'LOCAL_STORAGE') {
            const electronStorage = new StorageElectronIPC(keyDeriver.identityKey, chain)
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

      const permissionsManager = this.permissionQueue.createPermissionsManager(wallet)
      this.permissionQueue.setPermissionsManager(permissionsManager)

      this._managers = {
        ...this._managers,
        permissionsManager,
        settingsManager: (wallet as any).settingsManager,
        wallet,
        storageManager,
      }

      // Load settings
      try {
        const userSettings = await (wallet as any).settingsManager?.get()
        if (userSettings) this._settings = userSettings
      } catch { }

      // Update active profile
      await this._updateActiveProfile()

      // Create PeerPay client if configured
      if (this._messageBoxUrl && this._useMessageBox) {
        await this.peerPay.createClient(permissionsManager, this._messageBoxUrl, this._adminOriginator)
      }

      this._lifecycle = 'ready'
      this._snapshotLoaded = !!localStorage.snap && !!this._managers.walletManager

      this._emitState()
      return permissionsManager
    } catch (error: any) {
      console.error('[WalletService] _buildWallet failed:', error)
      toast.error('Failed to build wallet: ' + error.message)
      this._initializingBackendServices = false
      this._emitState()
      return null
    } finally {
      this._initializingBackendServices = false
    }
  }

  private async _updateActiveProfile() {
    const { walletManager } = this._managers
    if (!walletManager?.authenticated) {
      this._activeProfile = null
      return
    }

    if (this._loginType === 'direct-key') {
      const storedHex = localStorage.getItem('primaryKeyHex')
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
    } else if (walletManager.listProfiles) {
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

    const config = {
      network: this._selectedNetwork,
      useWab: this._loginType === 'wab',
      loginType: this._loginType,
      wabUrl: this._wabUrl,
      authMethod: this._selectedAuthMethod,
      useRemoteStorage: this._useRemoteStorage,
      storageUrl: this._selectedStorageUrl,
      backupStorageUrls: configOverrides?.backupStorageUrls ?? this._backupStorageUrls,
      useMessageBox: configOverrides?.useMessageBox ?? this._useMessageBox,
      messageBoxUrl: configOverrides?.messageBoxUrl ?? this._messageBoxUrl,
    }

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
    if (!localStorage.snap) return
    try {
      const snapArr = Utils.toArray(localStorage.snap, 'base64')
      const { walletSnapshot } = this._loadEnhancedSnapshot(snapArr)
      await walletManager.loadSnapshot(walletSnapshot)
    } catch (err: any) {
      console.error('[WalletService] Error loading snapshot:', err)
      localStorage.removeItem('snap')
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

    const { wallet, storageManager } = this._managers
    if (!wallet || !storageManager) throw new Error('Wallet not available')

    let backupProvider: any
    if (isLocalStorage) {
      const identityKey = (storageManager as any)?._authId?.identityKey
      if (!identityKey) throw new Error('Could not get identity key from wallet')
      const electronStorage = new StorageElectronIPC(identityKey, this._selectedNetwork)
      const services = new Services(this._selectedNetwork)
      electronStorage.setServices(services as any)
      await electronStorage.makeAvailable()
      backupProvider = electronStorage
    } else {
      backupProvider = new StorageClient(wallet, url)
      await backupProvider.makeAvailable()
    }

    await storageManager.addWalletStorageProvider(backupProvider)

    const stores = storageManager.getStores()
    if (stores?.length > 0) await storageManager.setActive(stores[0].storageIdentityKey)

    const newBackupUrls = [...this._backupStorageUrls, url]
    const snapshot = this.saveEnhancedSnapshot({ backupStorageUrls: newBackupUrls })
    localStorage.snap = snapshot
    this._backupStorageUrls = newBackupUrls
    this._emitState()
    toast.success('Backup storage added successfully!')
  }

  async removeBackupStorageUrl(url: string): Promise<void> {
    const newBackupUrls = this._backupStorageUrls.filter(u => u !== url)
    try {
      const snapshot = this.saveEnhancedSnapshot({ backupStorageUrls: newBackupUrls })
      localStorage.snap = snapshot
    } catch (err) {
      console.error('[WalletService] Failed to save snapshot:', err)
    }
    this._backupStorageUrls = newBackupUrls
    this._emitState()
    toast.success('Backup storage removed. It will be disconnected on next restart.')
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

  async updateMessageBoxUrl(url: string): Promise<void> {
    if (!url?.trim()) throw new Error('Message Box URL cannot be empty')
    const trimmedUrl = url.trim().replace(/\/+$/, '')
    try { new URL(trimmedUrl) } catch { throw new Error('Invalid Message Box URL format') }

    this._messageBoxUrl = trimmedUrl
    this._useMessageBox = true

    const walletForPeerPay = this.permissionQueue['_permissionsManager'] || this._managers.permissionsManager
    if (walletForPeerPay) {
      await this.peerPay.replaceClient(walletForPeerPay, trimmedUrl, this._adminOriginator)
    }

    const snapshot = this.saveEnhancedSnapshot({ messageBoxUrl: trimmedUrl, useMessageBox: true })
    localStorage.snap = snapshot
    this._emitState()
    toast.success('Message Box URL configured successfully!')
  }

  async removeMessageBoxUrl(): Promise<void> {
    await this.peerPay.destroyClient(this._messageBoxUrl)
    this._messageBoxUrl = ''
    this._useMessageBox = false

    const snapshot = this.saveEnhancedSnapshot()
    localStorage.snap = snapshot
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

    this._managers = {}
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
    const directKeyMode = this._loginType === 'direct-key'
    if (
      this._lifecycle === 'configured' &&
      !this._managers.walletManager &&
      !this._initInFlight &&
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
