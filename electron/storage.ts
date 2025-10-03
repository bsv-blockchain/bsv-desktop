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
import { StorageKnex, KnexMigrations, Services, Monitor, WalletStorageManager } from '@bsv/wallet-toolbox';

const require = createRequire(import.meta.url);

// Lazy-load knex to avoid loading better-sqlite3 until actually needed
let createKnex: any = null;
function getCreateKnex() {
  if (!createKnex) {
    createKnex = require('./storage-loader.cjs').createKnex;
  }
  return createKnex;
}

/**
 * Storage instance manager
 * Maintains a map of storage instances keyed by identityKey
 */
class StorageManager {
  private storages: Map<string, StorageKnex> = new Map();
  private databases: Map<string, any> = new Map();
  // Separate storage managers for backend monitoring (independent from renderer)
  private monitorStorageManagers: Map<string, WalletStorageManager> = new Map();
  private monitors: Map<string, Monitor> = new Map();

  /**
   * Get or create a storage instance for the given identity key
   */
  async getOrCreateStorage(identityKey: string, chain: 'main' | 'test'): Promise<StorageKnex> {
    const key = `${identityKey}-${chain}`;

    if (this.storages.has(key)) {
      return this.storages.get(key)!;
    }

    // Create new storage instance
    const homeDir = os.homedir();
    const bsvDir = path.join(homeDir, '.bsv-desktop');

    // Ensure directory exists
    if (!fs.existsSync(bsvDir)) {
      fs.mkdirSync(bsvDir, { recursive: true });
    }

    // Use separate database files for different chains
    const dbFileName = chain === 'main' ? 'wallet.db' : 'wallet-test.db';
    const dbPath = path.join(bsvDir, dbFileName);

    console.log(`[Storage] Creating storage at: ${dbPath}`);

    // Create knex instance via CommonJS wrapper
    const knexFactory = getCreateKnex();
    const db = knexFactory({
      client: 'sqlite3',
      connection: {
        filename: dbPath
      },
      useNullAsDefault: true
    });

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
    console.log(`[Storage] Migrations complete`);

    // Create StorageKnex instance
    const storage = new StorageKnex({
      knex: db,
      chain: chain,
      feeModel: { model: 'sat/kb' },
      commissionSatoshis: 0
    });

    // Store references
    this.databases.set(key, db);
    this.storages.set(key, storage);

    console.log(`[Storage] Created storage instance for ${key}`);

    return storage;
  }

  /**
   * Check if storage is available for the given identity key
   */
  async isAvailable(identityKey: string, chain: 'main' | 'test'): Promise<boolean> {
    // Storage is always available once created
    await this.getOrCreateStorage(identityKey, chain);
    return true;
  }

  /**
   * Make storage available (initialize database tables)
   * Returns TableSettings from the storage
   */
  async makeAvailable(identityKey: string, chain: 'main' | 'test'): Promise<any> {
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
    chain: 'main' | 'test'
  ): Promise<void> {
    const storage = await this.getOrCreateStorage(identityKey, chain);
    const key = `${identityKey}-${chain}`;

    console.log(`[Storage] Initializing services for ${key}`);

    // Create Services instance in the backend
    const services = new Services(chain);

    // Type assertion to access setServices method
    const storageAny = storage as any;

    if (typeof storageAny.setServices === 'function') {
      storageAny.setServices(services);
      console.log(`[Storage] Services initialized and set for ${key}`);
    } else {
      console.warn(`[Storage] setServices method not available on StorageKnex for ${key}`);
    }

    // Create a separate WalletStorageManager for backend monitoring
    // This is independent from the renderer's WalletStorageManager
    const monitorStorageManager = new WalletStorageManager(identityKey);
    await monitorStorageManager.addWalletStorageProvider(storage);
    this.monitorStorageManagers.set(key, monitorStorageManager);

    console.log(`[Storage] Backend WalletStorageManager created for monitoring: ${key}`);

    // Start Monitor in the backend process (separate from renderer)
    await this.startMonitor(identityKey, chain, monitorStorageManager, services);
  }

  /**
   * Start Monitor for a storage instance
   * The monitor runs background tasks to monitor and update wallet state
   */
  async startMonitor(
    identityKey: string,
    chain: 'main' | 'test',
    storageManager: WalletStorageManager,
    services: Services
  ): Promise<void> {
    const key = `${identityKey}-${chain}`;

    // Don't start if already running
    if (this.monitors.has(key)) {
      console.log(`[Monitor] Already running for ${key}`);
      return;
    }

    console.log(`[Monitor] Starting for ${key}`);

    try {
      // Create Monitor with default options
      const monitorOptions = Monitor.createDefaultWalletMonitorOptions(
        chain,
        storageManager
      );

      // Override services with our backend instance
      monitorOptions.services = services;

      const monitor = new Monitor(monitorOptions);

      // Add default wallet monitoring tasks
      monitor.addDefaultTasks();

      // Start the monitoring tasks (runs continuous loop)
      await monitor.startTasks();

      // Store reference
      this.monitors.set(key, monitor);

      console.log(`[Monitor] Started successfully for ${key}`);
    } catch (error: any) {
      console.error(`[Monitor] Failed to start for ${key}:`, error);
      throw error;
    }
  }

  /**
   * Stop Monitor for a storage instance
   */
  async stopMonitor(identityKey: string, chain: 'main' | 'test'): Promise<void> {
    const key = `${identityKey}-${chain}`;
    const monitor = this.monitors.get(key);

    if (!monitor) {
      return;
    }

    console.log(`[Monitor] Stopping for ${key}`);

    try {
      await monitor.stopTasks();
      this.monitors.delete(key);
      console.log(`[Monitor] Stopped successfully for ${key}`);
    } catch (error) {
      console.error(`[Monitor] Error stopping for ${key}:`, error);
    }
  }

  /**
   * Proxy method calls to the underlying storage instance
   */
  async callStorageMethod(
    identityKey: string,
    chain: 'main' | 'test',
    method: string,
    args: any[]
  ): Promise<any> {
    const storage = await this.getOrCreateStorage(identityKey, chain);

    // Type assertion to access storage methods dynamically
    const storageAny = storage as any;

    if (typeof storageAny[method] !== 'function') {
      throw new Error(`Method ${method} does not exist on StorageKnex`);
    }

    console.log(`[Storage] Calling ${method} for ${identityKey}-${chain}`);

    try {
      const result = await storageAny[method](...args);
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

    // Stop all Monitors first
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
