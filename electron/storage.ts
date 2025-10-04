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
import { StorageKnex, KnexMigrations, Services, Monitor, WalletStorageManager } from '@bsv/wallet-toolbox';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  // Monitor worker processes
  private monitorWorkers: Map<string, ChildProcess> = new Map();

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
      useNullAsDefault: true,
      pool: {
        afterCreate: (conn: any, cb: any) => {
          // Enable WAL mode for better concurrent access
          conn.run('PRAGMA journal_mode = WAL;', cb);
        }
      }
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

    // Check if already initialized to prevent duplicates
    if (this.monitorWorkers.has(key)) {
      console.log(`[Storage] Services already initialized for ${key}, skipping`);
      return;
    }

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
    chain: 'main' | 'test'
  ): Promise<void> {
    const key = `${identityKey}-${chain}`;

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
      worker.stdout?.on('data', (data) => {
        console.log(`[Monitor Worker ${key}]`, data.toString().trim());
      });

      worker.stderr?.on('data', (data) => {
        console.error(`[Monitor Worker ${key}]`, data.toString().trim());
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
          chain
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
  async stopMonitorWorker(identityKey: string, chain: 'main' | 'test'): Promise<void> {
    const key = `${identityKey}-${chain}`;
    const worker = this.monitorWorkers.get(key);

    if (!worker) {
      return;
    }

    console.log(`[Monitor Worker] Stopping worker for ${key}`);

    try {
      // Send stop command
      worker.send({ type: 'stop' });

      // Wait for graceful shutdown
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          console.warn(`[Monitor Worker] Timeout waiting for ${key} to stop, forcing kill`);
          worker.kill('SIGKILL');
          resolve();
        }, 5000);

        worker.once('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      this.monitorWorkers.delete(key);
      console.log(`[Monitor Worker] Stopped successfully for ${key}`);
    } catch (error) {
      console.error(`[Monitor Worker] Error stopping for ${key}:`, error);
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

    // Stop all Monitor workers first
    const workerStopPromises: Promise<void>[] = [];
    for (const [key] of this.monitorWorkers.entries()) {
      const [identityKey, chain] = key.split('-');
      workerStopPromises.push(
        this.stopMonitorWorker(identityKey, chain as 'main' | 'test')
      );
    }
    await Promise.all(workerStopPromises);
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
