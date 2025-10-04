/**
 * Monitor Worker Process
 *
 * Runs as a separate process to handle background wallet monitoring tasks
 * without blocking the main Electron process or renderer.
 *
 * This worker:
 * - Creates its own StorageKnex instance
 * - Creates its own WalletStorageManager
 * - Runs Monitor.startTasks() in isolation
 * - Communicates with parent via process IPC
 */

import path from 'path';
import os from 'os';
import { createRequire } from 'module';
import { StorageKnex, KnexMigrations, Services, Monitor, WalletStorageManager } from '@bsv/wallet-toolbox';

const require = createRequire(import.meta.url);

// Lazy-load knex
let createKnex: any = null;
function getCreateKnex() {
  if (!createKnex) {
    createKnex = require('./storage-loader.cjs').createKnex;
  }
  return createKnex;
}

interface MonitorConfig {
  identityKey: string;
  chain: 'main' | 'test';
}

let monitor: Monitor | null = null;
let storageManager: WalletStorageManager | null = null;

/**
 * Initialize and start the Monitor
 */
async function startMonitor(config: MonitorConfig): Promise<void> {
  const { identityKey, chain } = config;
  const key = `${identityKey}-${chain}`;

  console.log(`[Monitor Worker] Starting for ${key}`);

  try {
    // Create database path
    const homeDir = os.homedir();
    const bsvDir = path.join(homeDir, '.bsv-desktop');
    const dbFileName = chain === 'main' ? 'wallet.db' : 'wallet-test.db';
    const dbPath = path.join(bsvDir, dbFileName);

    console.log(`[Monitor Worker] Connecting to database: ${dbPath}`);

    // Create knex instance with WAL mode
    const knexFactory = getCreateKnex();
    const db = knexFactory({
      client: 'sqlite3',
      connection: {
        filename: dbPath
      },
      useNullAsDefault: true,
      pool: {
        afterCreate: (conn: any, cb: any) => {
          // Enable WAL mode for concurrent access
          conn.run('PRAGMA journal_mode = WAL;', cb);
        }
      }
    });

    console.log(`[Monitor Worker] Database connection established`);

    // Create StorageKnex instance (read-only monitoring)
    const storage = new StorageKnex({
      knex: db,
      chain: chain,
      feeModel: { model: 'sat/kb' },
      commissionSatoshis: 0
    });

    console.log(`[Monitor Worker] StorageKnex created`);

    // Create Services
    const services = new Services(chain);

    // Set services on storage
    const storageAny = storage as any;
    if (typeof storageAny.setServices === 'function') {
      storageAny.setServices(services);
      console.log(`[Monitor Worker] Services set on StorageKnex`);
    }

    // Create WalletStorageManager for this worker
    storageManager = new WalletStorageManager(identityKey);
    console.log(`[Monitor Worker] WalletStorageManager created`);

    // Add storage provider
    console.log(`[Monitor Worker] Adding storage provider...`);
    await storageManager.addWalletStorageProvider(storage);
    console.log(`[Monitor Worker] Storage provider added`);

    // Create Monitor with default options
    const monitorOptions = Monitor.createDefaultWalletMonitorOptions(
      chain,
      storageManager
    );

    // Override services
    monitorOptions.services = services;

    monitor = new Monitor(monitorOptions);
    console.log(`[Monitor Worker] Monitor created`);

    // Add default wallet monitoring tasks
    monitor.addDefaultTasks();
    console.log(`[Monitor Worker] Default tasks added`);

    // Start monitoring tasks (runs continuous loop)
    console.log(`[Monitor Worker] Starting tasks...`);
    await monitor.startTasks();
    console.log(`[Monitor Worker] Monitor started successfully for ${key}`);

    // Notify parent process
    if (process.send) {
      process.send({ type: 'monitor-started', key });
    }
  } catch (error: any) {
    console.error(`[Monitor Worker] Failed to start:`, error);
    console.error(`[Monitor Worker] Stack:`, error.stack);

    // Notify parent process of failure
    if (process.send) {
      process.send({
        type: 'monitor-error',
        error: error.message,
        stack: error.stack
      });
    }

    process.exit(1);
  }
}

/**
 * Stop the Monitor
 */
async function stopMonitor(): Promise<void> {
  console.log('[Monitor Worker] Stopping monitor...');

  if (monitor) {
    try {
      await monitor.stopTasks();
      console.log('[Monitor Worker] Monitor stopped');
    } catch (error) {
      console.error('[Monitor Worker] Error stopping monitor:', error);
    }
  }

  // Notify parent and exit
  if (process.send) {
    process.send({ type: 'monitor-stopped' });
  }

  process.exit(0);
}

// Handle messages from parent process
process.on('message', async (message: any) => {
  console.log('[Monitor Worker] Received message:', message.type);

  switch (message.type) {
    case 'start':
      await startMonitor(message.config);
      break;

    case 'stop':
      await stopMonitor();
      break;

    default:
      console.log('[Monitor Worker] Unknown message type:', message.type);
  }
});

// Handle process termination
process.on('SIGTERM', async () => {
  console.log('[Monitor Worker] Received SIGTERM');
  await stopMonitor();
});

process.on('SIGINT', async () => {
  console.log('[Monitor Worker] Received SIGINT');
  await stopMonitor();
});

// Notify parent that worker is ready
console.log('[Monitor Worker] Worker process started, waiting for start command');
if (process.send) {
  process.send({ type: 'ready' });
}
