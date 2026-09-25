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
import { StorageKnex, Monitor, WalletStorageManager } from '@bsv/wallet-toolbox';
import { arcadeUrl } from './endpoints.js';
import { arcadeCallbackToken, createArcadeServices } from './arcade.js';
import {
  arcadeSseCursorPath,
  createArcadeMonitorOptions,
  startArcadeSsePump,
  tolerateTransientArcadeRejections
} from './arcadeSse.js';
import {
  DEFAULT_MONITOR_FEE_RATE,
  getConfiguredFeeRate
} from './feeSettings.js';

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
  chain: 'main' | 'test' | 'ttn';
  databasePath: string;
  /** Resolved by the parent process to keep this worker on its startup snapshot. */
  feeRate?: number;
  /** Where the Arcade SSE resume cursor is kept; chosen by the parent process. */
  sseCursorPath?: string;
}

let monitor: Monitor | null = null;
let storageManager: WalletStorageManager | null = null;
let stopSsePump: (() => void) | null = null;
let stopping = false;

/**
 * Message the parent, if it is still there. Once the IPC channel has closed,
 * a bare process.send() emits an 'error' event on process, which is fatal when
 * unhandled — and SSE status events can arrive at any moment.
 */
function tellParent(message: Record<string, unknown>): void {
  if (!process.send || !process.connected) return;
  process.send(message, (error: Error | null) => {
    if (error) console.warn(`[Monitor Worker] Could not message parent (${message.type}):`, error.message);
  });
}

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
    // Use same naming convention as storage.ts: wallet-<identityKey>-<chain>.db
    const dbFileName = `wallet-${key}.db`;
    const dbPath = config.databasePath;
    if (!path.isAbsolute(dbPath)) throw new Error("Monitor database must be selected by main");

    console.log(`[Monitor Worker] Connecting to database: ${dbPath}`);

    // Create knex instance with WAL mode
    const knexFactory = getCreateKnex();
    const db = knexFactory({
      client: 'better-sqlite3',
      connection: {
        filename: dbPath
      },
      useNullAsDefault: true,
      pool: {
        afterCreate: (conn: any, cb: any) => {
          // Enable WAL mode for concurrent access
          conn.pragma('journal_mode = WAL');
          cb(null, conn);
        }
      }
    });

    console.log(`[Monitor Worker] Database connection established`);

    // Create StorageKnex instance (read-only monitoring)
    const storage = new StorageKnex({
      knex: db,
      chain: chain,
      feeModel: {
        model: 'sat/kb',
        value: config.feeRate ?? getConfiguredFeeRate(chain, DEFAULT_MONITOR_FEE_RATE)
      },
      commissionSatoshis: 0
    });

    console.log(`[Monitor Worker] StorageKnex created`);

    // The Monitor re-broadcasts unconfirmed transactions and collects their
    // merkle proofs, so it needs the same Arcade-first Services as the main
    // process — and the same callback token, or it would subscribe to a stream
    // the main process's broadcasts never report into.
    const services = createArcadeServices(chain, identityKey);
    console.log(`[Monitor Worker] Broadcasting, proofs and SSE via Arcade at ${arcadeUrl(chain)}`);

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

    // Monitor options on the same Services (and so the same ChainTracks client),
    // with live status events from Arcade (TaskArcadeSSE, one of the default tasks).
    const monitorOptions = createArcadeMonitorOptions(chain, storageManager, services, {
      callbackToken: arcadeCallbackToken(identityKey),
      cursorPath: config.sseCursorPath ?? arcadeSseCursorPath(identityKey, chain),
      onStatusChanged: (txid, status) => {
        tellParent({ type: 'tx-status-changed', txid, status });
      }
    });

    monitor = new Monitor(monitorOptions);
    console.log(`[Monitor Worker] Monitor created`);

    // Add default wallet monitoring tasks
    monitor.addDefaultTasks();
    console.log(`[Monitor Worker] Default tasks added`);
    if (!tolerateTransientArcadeRejections(monitor)) {
      console.warn(`[Monitor Worker] ArcadeSSE task not found; live status events are unavailable`);
    }
    // startTasks() below does not return while the monitor runs.
    stopSsePump = startArcadeSsePump(monitor);

    // Start monitoring tasks (runs continuous loop)
    console.log(`[Monitor Worker] Starting tasks...`);
    await monitor.startTasks();
    console.log(`[Monitor Worker] Monitor started successfully for ${key}`);

    // Notify parent process
    tellParent({ type: 'monitor-started', key });
  } catch (error: any) {
    console.error(`[Monitor Worker] Failed to start:`, error);
    console.error(`[Monitor Worker] Stack:`, error.stack);

    // Notify parent process of failure
    tellParent({
      type: 'monitor-error',
      error: error.message,
      stack: error.stack
    });

    process.exit(1);
  }
}

/**
 * Stop the Monitor
 */
async function stopMonitor(): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log('[Monitor Worker] Stopping monitor...');

  stopSsePump?.();
  stopSsePump = null;

  if (monitor) {
    try {
      await monitor.stopTasks();
      console.log('[Monitor Worker] Monitor stopped');
    } catch (error) {
      console.error('[Monitor Worker] Error stopping monitor:', error);
    }
  }

  // Notify parent and exit
  tellParent({ type: 'monitor-stopped' });

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

    case 'fetch-sse':
      // Reopens a dropped Arcade SSE stream; does nothing to an open one.
      monitor?.fetchSSEEvents().catch(() => {});
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

// The parent is gone (crashed or killed without stopping us). An orphaned
// monitor only holds the wallet database open, so shut down.
process.on('disconnect', async () => {
  console.log('[Monitor Worker] Parent disconnected');
  await stopMonitor();
});

process.on('SIGINT', async () => {
  console.log('[Monitor Worker] Received SIGINT');
  await stopMonitor();
});

// Notify parent that worker is ready
console.log('[Monitor Worker] Worker process started, waiting for start command');
tellParent({ type: 'ready' });
