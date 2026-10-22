/**
 * Backend Storage Handler for BSV Desktop Wallet
 *
 * This module provides StorageKnex-based wallet storage that runs in the
 * Electron main process. It uses better-sqlite3 for local database storage
 * at ~/.bsv-desktop/wallet.db
 *
 * Architecture:
 * - Main process: StorageKnex instance (this file)
 * - IPC: Communication bridge (electron/main.ts)
 * - Renderer: StorageElectronIPC wrapper (src/lib/StorageElectronIPC.ts)
 */

import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';
import { fork, ChildProcess } from 'child_process';
import { fileURLToPath } from 'url';
import { StorageKnex, KnexMigrations, Monitor, WalletStorageManager, sdk } from '@bsv/wallet-toolbox';
import { assertArcadeCallbackToken, createArcadeServices } from './arcade.js';
import { normalizeNetworkSettings, type NetworkSettings } from './networkConfig.js';
import { arcadeSseCursorPath } from './arcadeSse.js';
import { patchListCertificates } from './optimized-queries.js';
import { WalletStorageAccess } from './wallet-portability/access.js';
import { WalletDataBindings, walletStorageKey, assertRecoveryBinding } from './wallet-portability/bindings.js';
import {
  DEFAULT_MONITOR_FEE_RATE,
  DEFAULT_STORAGE_FEE_RATE,
  getConfiguredFeeRate
} from './feeSettings.js';
import { ensureUniqueLocalStorageIdentity } from './storage-identity.js';
import {
  ColorGuardStorageUnavailableError,
  guardPostBeef,
  installColorBroadcastGuard,
  loadColorClassifier,
  sharedColorGuardJournal
} from './colorBroadcastGuard.js';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Allow-list of StorageKnex methods the renderer is permitted to invoke through
 * the `storage:call-method` IPC channel. Must stay in sync with the methods
 * exposed by src/lib/StorageElectronIPC.ts. Anything not listed here is rejected.
 */
const ALLOWED_STORAGE_METHODS: ReadonlySet<string> = new Set([
  // Certificates
  'insertCertificate', 'updateCertificate', 'findCertificates', 'deleteCertificate',
  'insertCertificateAuth', 'relinquishCertificate', 'findCertificatesAuth', 'listCertificates',
  // Outputs
  'insertOutput', 'updateOutput', 'findOutputs', 'deleteOutput',
  'relinquishOutput', 'findOutputsAuth', 'listOutputs',
  // Transactions
  'insertTransaction', 'updateTransaction', 'findTransactions', 'deleteTransaction',
  // Commissions
  'insertCommission', 'findCommissions',
  // Output baskets
  'insertOutputBasket', 'updateOutputBasket', 'findOutputBaskets', 'deleteOutputBasket',
  'findOutputBasketsAuth',
  // Proven transactions
  'insertProvenTx', 'updateProvenTx', 'findProvenTxs', 'deleteProvenTx',
  'insertProvenTxReq', 'updateProvenTxReq', 'findProvenTxReqs', 'deleteProvenTxReq',
  // Labels & tags
  'insertTxLabel', 'findTxLabels', 'deleteTxLabel',
  'insertOutputTag', 'findOutputTags', 'deleteOutputTag',
  // Counterparties
  'insertCounterparty', 'updateCounterparty', 'findCounterparties', 'deleteCounterparty',
  // Sync
  'processSyncChunk', 'requestSyncChunk', 'getSyncChunk', 'findOrInsertSyncStateAuth',
  // Wallet / chain status
  'getWalletStatus', 'getHeight', 'updateHeight',
  // Permissions
  'findPermissions', 'insertPermission', 'updatePermission', 'deletePermission',
  // Settings
  'findSettings', 'insertSetting', 'updateSetting', 'deleteSetting',
  // Lifecycle & actions
  'destroy', 'migrate', 'findOrInsertUser', 'setActive',
  'abortAction', 'createAction', 'processAction', 'internalizeAction', 'listActions',
  // Action batches (wallet-toolbox >= 2.4.4)
  'getCapabilities', 'beginActionBatch', 'extendActionBatch', 'renewActionBatch',
  'prepareActionBatchCommit', 'putActionBatchBlob', 'commitActionBatch', 'abortActionBatch',
  // Action batch packed uploads and digest commit (wallet-toolbox >= 2.4.20)
  'putActionBatchPack', 'commitActionBatchByDigest',
  // Action batch resume (wallet-toolbox >= 2.7)
  'resumeActionBatch',
  // BRC-177 noSend expiry (wallet-toolbox >= 2.11)
  'prepareNoSendExpiry', 'activateNoSendExpiry', 'armNoSendExpiry',
]);

// Refused unless the wallet's monitor is running (see callStorageMethod).
const NO_SEND_EXPIRY_METHODS: ReadonlySet<string> = new Set([
  'prepareNoSendExpiry', 'activateNoSendExpiry', 'armNoSendExpiry',
]);

// Lazy-load knex to avoid loading better-sqlite3 until actually needed
let createKnex: any = null;
function getCreateKnex() {
  if (!createKnex) {
    createKnex = require('./storage-loader.cjs').createKnex;
  }
  return createKnex;
}

/** A transaction status change seen by a monitor worker, e.g. from an Arcade SSE event. */
export interface TxStatusChangedEvent {
  identityKey: string;
  chain: 'main' | 'test' | 'ttn' | 'tstn';
  txid: string;
  status: string;
}

/** A 1Color transaction the broadcast guard has just held (contract §8.2). */
export interface ColorHeldEvent {
  identityKey: string;
  chain: 'main' | 'test' | 'ttn' | 'tstn';
  txid: string;
}

/**
 * Storage instance manager
 * Maintains a map of storage instances keyed by identityKey
 */
class StorageManager {
  readonly bindings = new WalletDataBindings();
  private access = new Map<string, WalletStorageAccess>();
  private storageAccess(identityKey: string, chain: 'main' | 'test' | 'ttn' | 'tstn'): WalletStorageAccess {
    const key = walletStorageKey(identityKey, chain);
    if (!this.access.has(key)) this.access.set(key, new WalletStorageAccess());
    return this.access.get(key)!;
  }
  /** Everyday storage IPC: concurrent, but fenced by quiesce/activation. */
  request<T>(identityKey: string, chain: 'main' | 'test' | 'ttn' | 'tstn', operation: () => Promise<T>): Promise<T> {
    return this.storageAccess(identityKey, chain).share(operation);
  }
  async quiesce<T>(identityKey: string, chain: 'main' | 'test' | 'ttn' | 'tstn', operation: () => Promise<T>): Promise<T> {
    return this.storageAccess(identityKey, chain).run(async () => {
      const running = this.monitorWorkers.has(walletStorageKey(identityKey, chain));
      await this.stopMonitorWorker(identityKey, chain);
      try { return await operation(); }
      finally {
        // A failed restart must not mask the operation's own result.
        if (running) await this.startMonitorWorker(identityKey, chain).catch(error =>
          console.error(`[Monitor Worker] Failed to restart for ${walletStorageKey(identityKey, chain)}:`, error));
      }
    });
  }
  async closeForActivation(identityKey: string, chain: 'main' | 'test' | 'ttn' | 'tstn', commit: () => Promise<void>): Promise<void> {
    await this.storageAccess(identityKey, chain).close(async seal => {
      // If the monitor cannot be stopped nothing has changed yet, so storage stays usable.
      await this.stopMonitorWorker(identityKey, chain);
      seal();
      const key = walletStorageKey(identityKey, chain);
      const db = this.databases.get(key);
      if (db) await db.destroy();
      this.databases.delete(key); this.storages.delete(key);
      await commit();
    });
  }
  /** Close an inactive network after its renderer session has drained. */
  async releaseNetwork(identityKey: string, chain: 'main' | 'test' | 'ttn' | 'tstn'): Promise<void> {
    await this.storageAccess(identityKey, chain).run(async () => {
      await this.stopMonitorWorker(identityKey, chain);
      const key = walletStorageKey(identityKey, chain);
      const database = this.databases.get(key);
      if (database) await database.destroy();
      this.databases.delete(key);
      this.storages.delete(key);
    });
  }
  private storages: Map<string, StorageKnex> = new Map();
  private databases: Map<string, any> = new Map();
  private storageInitializations: Map<string, Promise<StorageKnex>> = new Map();
  private serviceSettings = new Map<string, NetworkSettings>();
  // Each wallet's Arcade callback token, handed over by the renderer, which
  // alone can derive it. Kept for monitor restarts; never logged.
  private callbackTokens = new Map<string, string>();
  // Separate storage managers for backend monitoring (independent from renderer)
  private monitorStorageManagers: Map<string, WalletStorageManager> = new Map();
  private monitors: Map<string, Monitor> = new Map();
  // Monitor worker processes
  private monitorWorkers: Map<string, ChildProcess> = new Map();
  // Workers whose Monitor is running its tasks, which include BRC-177 deadlines
  private monitoringWorkers = new WeakSet<ChildProcess>();
  // Workers asked to stop, which never count as running again
  private stoppingWorkers = new WeakSet<ChildProcess>();
  private txStatusListeners = new Set<(event: TxStatusChangedEvent) => void>();
  private colorHeldListeners = new Set<(event: ColorHeldEvent) => void>();

  /** Subscribe to 1Color broadcasts held by the guard, in main or in a monitor worker. */
  onColorHeld(listener: (event: ColorHeldEvent) => void): () => void {
    this.colorHeldListeners.add(listener);
    return () => { this.colorHeldListeners.delete(listener); };
  }

  private emitColorHeld(event: ColorHeldEvent): void {
    for (const listener of this.colorHeldListeners) {
      try { listener(event); } catch (error) { console.error('[Storage] color held listener failed:', error); }
    }
  }

  /**
   * The color guard's release and sweep run here: inside the everyday storage
   * fence, so a quiesce or activation never sees them mid-post. Only on an
   * already-open storage (checked inside the fence, so never one that
   * `releaseNetwork`/`closeForActivation` just closed): the guard never reopens
   * a closed wallet database or creates one for an identity it is handed.
   */
  withColorGuardStorage<T>(identityKey: string, chain: 'main' | 'test' | 'ttn' | 'tstn', fn: (storage: StorageKnex) => Promise<T>): Promise<T> {
    return this.request(identityKey, chain, async () => {
      const key = walletStorageKey(identityKey, chain);
      const storage = this.storages.get(key) ?? await this.storageInitializations.get(key);
      if (storage === undefined) throw new ColorGuardStorageUnavailableError(key);
      return await fn(storage);
    });
  }

  /** Subscribe to transaction status changes seen by any monitor worker. */
  onTxStatusChanged(listener: (event: TxStatusChangedEvent) => void): () => void {
    this.txStatusListeners.add(listener);
    return () => { this.txStatusListeners.delete(listener); };
  }

  /**
   * Ask every monitor worker to reopen a dropped Arcade SSE stream. Cheap to
   * call often: an open stream is left alone.
   */
  requestArcadeEvents(): void {
    for (const worker of this.monitorWorkers.values()) {
      if (!worker.connected) continue;
      // The channel can close between the check and the send (a worker exiting),
      // and this runs from window-focus and resume handlers, so neither a
      // synchronous throw nor a callback error may escape.
      try {
        worker.send({ type: 'fetch-sse' }, () => { /* worker may be exiting */ });
      } catch { /* worker exiting; the next focus or resume asks again */ }
    }
  }

  /** True when any forked monitor worker is still running (inherits env at fork time). */
  hasActiveMonitorWorkers(): boolean {
    return this.monitorWorkers.size > 0;
  }

  /**
   * Get or create a storage instance for the given identity key
   */
  async getOrCreateStorage(identityKey: string, chain: 'main' | 'test' | 'ttn' | 'tstn'): Promise<StorageKnex> {
    const key = walletStorageKey(identityKey, chain);

    if (this.storages.has(key)) {
      return this.storages.get(key)!;
    }

    const pending = this.storageInitializations.get(key);
    if (pending) return await pending;

    const initialization = this.createStorage(identityKey, chain, key);
    this.storageInitializations.set(key, initialization);
    try {
      return await initialization;
    } finally {
      if (this.storageInitializations.get(key) === initialization) {
        this.storageInitializations.delete(key);
      }
    }
  }

  private async createStorage(
    identityKey: string,
    chain: 'main' | 'test' | 'ttn' | 'tstn',
    key: string
  ): Promise<StorageKnex> {

    // Create new storage instance
    const homeDir = os.homedir();
    const bsvDir = path.join(homeDir, '.bsv-desktop');

    // Ensure directory exists
    if (!fs.existsSync(bsvDir)) {
      fs.mkdirSync(bsvDir, { recursive: true });
    }

    // Use separate database files for different identities and chains
    // Format: wallet-<identityKey>-<chain>.db
    const dbPath = this.bindings.databasePath(identityKey, chain);

    console.log(`[Storage] Creating storage at: ${dbPath}`);

    // Create knex instance via CommonJS wrapper
    const knexFactory = getCreateKnex();
    const db = knexFactory({
      client: 'better-sqlite3',
      connection: {
        filename: dbPath
      },
      useNullAsDefault: true,
      pool: {
        afterCreate: (conn: any, cb: any) => {
          // Enable WAL mode for better concurrent access
          conn.pragma('journal_mode = WAL');
          // Keep up to 64MB in memory before flushing to disk
          conn.pragma('cache_size = -64000');
          // Store temp tables/indices in memory instead of disk
          conn.pragma('temp_store = MEMORY');
          // Memory-map up to 256MB of the database file for faster reads
          conn.pragma('mmap_size = 268435456');
          cb(null, conn);
        }
      }
    });

    // A recovered database must still match its binding before any migrations
    // or monitor can write to it. A substituted file never becomes a new wallet.
    const binding = this.bindings.get(identityKey, chain);
    if (binding) {
      try {
        assertRecoveryBinding(binding, chain, await db('settings').first(), await db('users').where({ identityKey }).first(), identityKey);
      } catch (error) { await db.destroy(); throw error; }
    }

    // Run database migrations to create tables
    console.log(`[Storage] Running database migrations for ${key}...`);
    const migrations = new KnexMigrations(
      chain,
      'BSV Desktop Wallet',
      identityKey,
      10000 // maxOutputScriptLength
    );
    await db.migrate.latest({
      migrationSource: migrations
    });
    const storageIdentityKey = await ensureUniqueLocalStorageIdentity(db, identityKey);
    console.log(`[Storage] Local provider identity ready: ${storageIdentityKey.slice(0, 10)}...`);
    console.log(`[Storage] Migrations complete`);

    // Keep the existing 250 sat/kB default, introduced as a margin for reported
    // underfunded token ancestors. This is a fixed transaction rate, not an
    // ancestor-fee calculation. A per-chain override takes effect after restart.
    const storage = new StorageKnex({
      knex: db,
      chain: chain,
      feeModel: {
        model: 'sat/kb',
        value: getConfiguredFeeRate(chain, DEFAULT_STORAGE_FEE_RATE)
      },
      commissionSatoshis: 0
    });

    // Replace upstream N+1 listCertificates with batched version
    patchListCertificates(storage);

    // Hold every unreleased 1Color broadcast (contract §8.2). Installed before the
    // storage is published, so no caller ever sees an unguarded instance.
    installColorBroadcastGuard(storage as any, {
      identityKey,
      chain,
      journal: sharedColorGuardJournal(),
      classify: loadColorClassifier,
      notifyHeld: txid => this.emitColorHeld({ identityKey, chain, txid })
    });
    void loadColorClassifier().catch(() => { /* logged once by the loader; every broadcast is held */ });

    // Store references
    this.databases.set(key, db);
    this.storages.set(key, storage);

    console.log(`[Storage] Created storage instance for ${key}`);

    return storage;
  }

  /**
   * Check if storage is available for the given identity key
   */
  async isAvailable(identityKey: string, chain: 'main' | 'test' | 'ttn' | 'tstn'): Promise<boolean> {
    // Storage is always available once created
    await this.getOrCreateStorage(identityKey, chain);
    return true;
  }

  /**
   * Make storage available (initialize database tables)
   * Returns TableSettings from the storage
   */
  async makeAvailable(identityKey: string, chain: 'main' | 'test' | 'ttn' | 'tstn'): Promise<any> {
    const storage = await this.getOrCreateStorage(identityKey, chain);
    const settings = await storage.makeAvailable();
    console.log(`[Storage] Storage made available for ${identityKey}-${chain}`);
    return settings;
  }

  /**
   * Initialize services on the storage instance
   * Creates a new Services instance in the backend process
   */
  async initializeServices(
    identityKey: string,
    chain: 'main' | 'test' | 'ttn' | 'tstn',
    settings: Partial<NetworkSettings> | undefined,
    callbackToken: string
  ): Promise<void> {
    const resolved = normalizeNetworkSettings(chain, settings || {});
    const key = walletStorageKey(identityKey, chain);
    assertArcadeCallbackToken(callbackToken);

    // Check if already initialized to prevent duplicates
    if (
      this.monitorWorkers.has(key) &&
      JSON.stringify(this.serviceSettings.get(key)) === JSON.stringify(resolved) &&
      this.callbackTokens.get(key) === callbackToken
    ) {
      console.log(`[Storage] Services already initialized for ${key}, skipping`);
      return;
    }
    await this.stopMonitorWorker(identityKey, chain);
    const storage = await this.getOrCreateStorage(identityKey, chain);
    this.serviceSettings.set(key, resolved);
    this.callbackTokens.set(key, callbackToken);

    console.log(`[Storage] Initializing services for ${key}`);

    // Arcade first for broadcasting and proofs, ChainTracks on the Arcade
    // deployment, and the wallet's callback token on every broadcast so Arcade
    // reports its status to the monitor worker's SSE subscription.
    const services = createArcadeServices(chain, callbackToken, resolved);
    console.log(`[Storage] Broadcasting and proofs via Arcade at ${resolved.arcadeUrl}`);
    // Defence in depth under the storage-layer guard: no unreleased 1Color tx, and
    // no tx spending one, ever reaches a broadcaster from this process.
    guardPostBeef(services as any, {
      identityKey,
      chain,
      journal: sharedColorGuardJournal(),
      classify: loadColorClassifier,
      storage: storage as any,
      notifyHeld: txid => this.emitColorHeld({ identityKey, chain, txid })
    });

    // Type assertion to access setServices method
    const storageAny = storage as any;

    if (typeof storageAny.setServices === 'function') {
      storageAny.setServices(services);
      console.log(`[Storage] Services initialized and set for ${key}`);
    } else {
      console.warn(`[Storage] setServices method not available on StorageKnex for ${key}`);
    }

    console.log(`[Storage] Backend services initialized`);

    // Start Monitor worker process (separate process to avoid blocking)
    await this.startMonitorWorker(identityKey, chain);
  }

  /**
   * Start Monitor worker process
   * Runs Monitor in a separate process to avoid blocking the main process
   */
  async startMonitorWorker(
    identityKey: string,
    chain: 'main' | 'test' | 'ttn' | 'tstn'
  ): Promise<void> {
    const key = walletStorageKey(identityKey, chain);

    // Don't start if already running
    if (this.monitorWorkers.has(key)) {
      console.log(`[Monitor Worker] Already running for ${key}`);
      return;
    }

    console.log(`[Monitor Worker] Starting worker process for ${key}`);

    try {
      // Path to the monitor worker script
      const workerPath = path.join(__dirname, 'monitor-worker.js');

      // Fork the worker process
      const worker = fork(workerPath, [], {
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        env: { ...process.env }
      });

      // Store reference
      this.monitorWorkers.set(key, worker);

      // Set up event handlers
      worker.on('message', (message: any) => {
        console.log(`[Monitor Worker] Message from ${key}:`, message.type);

        if (message.type === 'monitor-error') {
          console.error(`[Monitor Worker] Error in ${key}:`, message.error);
        } else if (message.type === 'monitor-started') {
          if (!this.stoppingWorkers.has(worker)) this.monitoringWorkers.add(worker);
        } else if (message.type === 'color-held' && typeof message.txid === 'string') {
          this.emitColorHeld({ identityKey, chain, txid: message.txid });
        } else if (message.type === 'tx-status-changed' && typeof message.txid === 'string') {
          const event: TxStatusChangedEvent = { identityKey, chain, txid: message.txid, status: String(message.status ?? '') };
          for (const listener of this.txStatusListeners) {
            try { listener(event); } catch (error) { console.error('[Storage] tx status listener failed:', error); }
          }
        }
      });

      worker.on('error', (error) => {
        console.error(`[Monitor Worker] Process error for ${key}:`, error);
        this.monitorWorkers.delete(key);
      });

      worker.on('exit', (code, signal) => {
        console.log(`[Monitor Worker] Process exited for ${key}, code: ${code}, signal: ${signal}`);
        this.monitorWorkers.delete(key);
      });

      // Pipe worker stdout/stderr to main process for logging
      // Buffer to handle partial lines that may arrive in chunks
      let stdoutBuffer = '';
      let stderrBuffer = '';

      worker.stdout?.on('data', (data) => {
        stdoutBuffer += data.toString();
        const lines = stdoutBuffer.split('\n');
        // Keep the last incomplete line in the buffer
        stdoutBuffer = lines.pop() || '';
        // Log complete lines
        lines.forEach(line => {
          if (line.trim()) {
            console.log(`[Monitor Worker ${key}]`, line.trim());
          }
        });
      });

      worker.stderr?.on('data', (data) => {
        stderrBuffer += data.toString();
        const lines = stderrBuffer.split('\n');
        // Keep the last incomplete line in the buffer
        stderrBuffer = lines.pop() || '';
        // Log complete lines
        lines.forEach(line => {
          if (line.trim()) {
            console.error(`[Monitor Worker ${key}]`, line.trim());
          }
        });
      });

      // Wait for worker ready signal
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Monitor worker timeout waiting for ready signal'));
        }, 10000);

        const messageHandler = (message: any) => {
          if (message.type === 'ready') {
            clearTimeout(timeout);
            worker.off('message', messageHandler);
            resolve();
          }
        };

        worker.on('message', messageHandler);
      });

      console.log(`[Monitor Worker] Worker ready for ${key}`);

      // Send start command to worker
      worker.send({
        type: 'start',
        config: {
          identityKey,
          chain,
          databasePath: this.bindings.databasePath(identityKey, chain),
          // Resolve in the main process so a preference saved during this
          // session cannot alter a worker started before the next restart.
          feeRate: getConfiguredFeeRate(chain, DEFAULT_MONITOR_FEE_RATE),
          sseCursorPath: arcadeSseCursorPath(identityKey, chain),
          serviceSettings: this.serviceSettings.get(key),
          // The worker subscribes with the token the main process broadcasts
          // with, and refuses to start without one.
          callbackToken: this.callbackTokens.get(key),
          // The worker's broadcast guard reads the same hold journal as main.
          colorGuardRoot: sharedColorGuardJournal().root
        }
      });

      console.log(`[Monitor Worker] Start command sent to ${key}`);
    } catch (error: any) {
      console.error(`[Monitor Worker] Failed to start for ${key}:`, error);
      this.monitorWorkers.delete(key);
      throw error;
    }
  }

  /**
   * Stop Monitor worker process
   */
  async stopMonitorWorker(identityKey: string, chain: 'main' | 'test' | 'ttn' | 'tstn'): Promise<void> {
    const key = walletStorageKey(identityKey, chain);
    const worker = this.monitorWorkers.get(key);

    if (!worker) {
      return;
    }
    // A stopping monitor no longer enforces BRC-177 deadlines, even if its
    // 'monitor-started' was already in flight when the stop began.
    this.monitoringWorkers.delete(worker);
    this.stoppingWorkers.add(worker);

    // Resolve only after the child is actually gone. Sending SIGKILL is not
    // evidence that the old writer has exited.
    if (worker.exitCode !== null || worker.signalCode !== null) { this.monitorWorkers.delete(key); return; }
    await new Promise<void>((resolve, reject) => {
      let forceTimer: ReturnType<typeof setTimeout>;
      const timeout = setTimeout(() => {
        worker.kill('SIGKILL');
        forceTimer = setTimeout(() => reject(new Error('Monitor did not exit; storage was not switched')), 5000);
      }, 5000);
      worker.once('exit', () => { clearTimeout(timeout); clearTimeout(forceTimer); resolve(); });
      if (worker.connected) worker.send({ type: 'stop' }, error => { if (error) worker.kill('SIGTERM'); });
      else worker.kill('SIGTERM');
    });
    this.monitorWorkers.delete(key);
  }

  /**
   * BRC-177 (wallet/0177.md) forbids creating the funding transaction when the
   * monitor cannot enforce the deadline, so noSend expiry is offered only while
   * this wallet's monitor worker is running its tasks.
   */
  private isMonitoring(identityKey: string, chain: 'main' | 'test' | 'ttn' | 'tstn'): boolean {
    const worker = this.monitorWorkers.get(walletStorageKey(identityKey, chain));
    return worker !== undefined && this.monitoringWorkers.has(worker);
  }

  /**
   * Proxy method calls to the underlying storage instance
   */
  async callStorageMethod(
    identityKey: string,
    chain: 'main' | 'test' | 'ttn' | 'tstn',
    method: string,
    args: any[]
  ): Promise<any> {
    // Only methods the renderer's StorageElectronIPC wrapper actually calls are
    // permitted. This prevents a compromised renderer from invoking arbitrary
    // methods (or prototype members) on the StorageKnex instance via IPC.
    if (!ALLOWED_STORAGE_METHODS.has(method)) {
      throw new Error(`Storage method not permitted: ${method}`);
    }
    // Checked here as well as in getCapabilities because the monitor can stop
    // after the toolbox has read the capabilities. prepareNoSendExpiry starts
    // the funding transaction. activate and arm run before the protected action
    // is released, and the toolbox handles their refusal safely: a refused
    // activate leaves the anchor as spendable change, and a refused arm makes it
    // abort the action, which releases the anchor. Only the funding fee is lost.
    if (NO_SEND_EXPIRY_METHODS.has(method) && !this.isMonitoring(identityKey, chain)) {
      throw new Error('BRC-177 noSend expiry is unavailable while the wallet monitor is not running');
    }

    const storage = await this.getOrCreateStorage(identityKey, chain);

    // Type assertion to access storage methods dynamically
    const storageAny = storage as any;

    if (typeof storageAny[method] !== 'function') {
      throw new Error(`Method ${method} does not exist on StorageKnex`);
    }

    console.log(`[Storage] Calling ${method} for ${identityKey}-${chain}`);

    try {
      const result = await storageAny[method](...args);
      if (method === 'getCapabilities' && !this.isMonitoring(identityKey, chain)) {
        const capabilities = { ...result };
        delete capabilities.brc177NoSendExpiry;
        return capabilities;
      }
      return result;
    } catch (error: any) {
      console.error(`[Storage] Error calling ${method}:`, error);
      throw error;
    }
  }

  /**
   * Cleanup all storage instances
   */
  async cleanup(): Promise<void> {
    console.log('[Storage] Cleaning up storage instances...');

    // Stop all Monitor workers first
    const workerStopPromises: Promise<void>[] = [];
    for (const [key] of this.monitorWorkers.entries()) {
      const [identityKey, chain] = key.split('-');
      workerStopPromises.push(
        this.stopMonitorWorker(identityKey, chain as 'main' | 'test' | 'ttn' | 'tstn')
      );
    }
    // One stuck worker must not stop the database connections below from closing.
    for (const result of await Promise.allSettled(workerStopPromises)) {
      if (result.status === 'rejected') console.error('[Storage] Monitor worker did not stop during cleanup:', result.reason);
    }
    this.monitorWorkers.clear();

    // Stop all Monitors (legacy, should be empty now)
    for (const [key, monitor] of this.monitors.entries()) {
      try {
        console.log(`[Monitor] Stopping ${key}...`);
        await monitor.stopTasks();
        console.log(`[Monitor] Stopped ${key}`);
      } catch (error) {
        console.error(`[Monitor] Error stopping ${key}:`, error);
      }
    }
    this.monitors.clear();

    // Destroy all database connections
    for (const [key, db] of this.databases.entries()) {
      try {
        await db.destroy();
        console.log(`[Storage] Destroyed database connection for ${key}`);
      } catch (error) {
        console.error(`[Storage] Error destroying database for ${key}:`, error);
      }
    }

    this.storages.clear();
    this.databases.clear();
  }
}

// Export singleton instance
export const storageManager = new StorageManager();

/**
 * The reply electron/main.ts sends when a storage call fails. A toolbox
 * WalletError also travels as its JSON, so the renderer can rethrow the same
 * error class with its code and fields (WERR_INSUFFICIENT_FUNDS and the
 * satoshis needed, for one); any other error keeps the message only.
 */
export function storageCallFailure(error: any): { success: false; error: string; walletError?: string } {
  if (typeof error?.name === 'string' && error.name.startsWith('WERR_')) {
    return { success: false, error: error.message, walletError: sdk.WalletError.unknownToJson(error) };
  }
  return { success: false, error: error?.message };
}
