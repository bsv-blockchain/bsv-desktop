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
import { StorageKnex, KnexMigrations } from '@bsv/wallet-toolbox';

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
      client: 'better-sqlite3',
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
   */
  async makeAvailable(identityKey: string, chain: 'main' | 'test'): Promise<void> {
    const storage = await this.getOrCreateStorage(identityKey, chain);
    await storage.makeAvailable();
    console.log(`[Storage] Storage made available for ${identityKey}-${chain}`);
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
