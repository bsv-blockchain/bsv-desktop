/**
 * StorageElectronIPC - Frontend Storage Wrapper
 *
 * This class implements the WalletStorageProvider interface by delegating
 * all storage operations to the Electron main process via IPC.
 *
 * Architecture Pattern:
 * - Renderer Process: This class (implements WalletStorageProvider interface)
 * - IPC Bridge: window.electronAPI.storage methods
 * - Main Process: StorageKnex instance managed by electron/storage.ts
 *
 * This approach is the recommended pattern for Electron applications because:
 * 1. Node.js modules (better-sqlite3, knex) only work in main process
 * 2. IPC provides clean separation between UI and storage layers
 * 3. Storage operations can be properly synchronized across the app
 * 4. Database connections are managed centrally in main process
 *
 * Alternative Considered: StorageClient
 * - StorageClient is designed for remote HTTP storage servers
 * - Using it would require running a separate HTTP server just for local storage
 * - IPC is more efficient and simpler for Electron's architecture
 */

import type { WalletStorageProvider, WalletServices } from '@bsv/wallet-toolbox/out/src/sdk';

export class StorageElectronIPC implements WalletStorageProvider {
  private identityKey: string;
  private chain: 'main' | 'test';
  private services?: WalletServices;
  private settings?: any;

  constructor(identityKey: string, chain: 'main' | 'test') {
    this.identityKey = identityKey;
    this.chain = chain;

    console.log('[StorageElectronIPC] Created for identity:', identityKey, 'chain:', chain);
  }

  /**
   * Set wallet services (required by WalletStorageProvider interface)
   */
  setServices(v: WalletServices): void {
    this.services = v;
  }

  /**
   * Initialize services on backend storage
   * Services must be created on backend since they contain non-serializable objects
   */
  async initializeBackendServices(): Promise<void> {
    const result = await window.electronAPI.storage.initializeServices(
      this.identityKey,
      this.chain
    );
    if (!result.success) {
      throw new Error(`Failed to initialize services on backend: ${result.error}`);
    }
    console.log('[StorageElectronIPC] Services initialized on backend successfully');
  }

  /**
   * Returns false as this is not a full StorageProvider (only WalletStorageProvider)
   */
  isStorageProvider(): boolean {
    return false;
  }

  /**
   * Check if storage is currently available
   */
  isAvailable(): boolean {
    return this.settings !== undefined;
  }

  /**
   * Get wallet services
   */
  getServices(): WalletServices {
    if (!this.services) {
      throw new Error('Services not set on StorageElectronIPC');
    }
    return this.services;
  }

  /**
   * Get storage settings
   */
  getSettings(): any {
    if (!this.settings) {
      throw new Error('Settings not available - call makeAvailable() first');
    }
    return this.settings;
  }

  /**
   * Check if storage can be made available
   */
  canMakeAvailable(): boolean {
    // In Electron, storage is always available via IPC
    return true;
  }

  /**
   * Initialize storage (create database tables)
   * Returns TableSettings object
   */
  async makeAvailable(): Promise<any> {
    console.log('[StorageElectronIPC] Making storage available...');

    const result = await window.electronAPI.storage.makeAvailable(
      this.identityKey,
      this.chain
    );

    if (!result.success) {
      throw new Error(`Failed to make storage available: ${result.error}`);
    }

    // Store settings from backend
    this.settings = result.settings;

    console.log('[StorageElectronIPC] Storage is now available, settings:', this.settings);

    return this.settings;
  }

  /**
   * Generic method to call any storage method via IPC
   * This delegates to the StorageKnex instance in the main process
   */
  private async callMethod<T>(method: string, ...args: any[]): Promise<T> {
    console.log(`[StorageElectronIPC] Calling ${method}`, args);

    const result = await window.electronAPI.storage.callMethod(
      this.identityKey,
      this.chain,
      method,
      args
    );

    if (!result.success) {
      throw new Error(`Storage method ${method} failed: ${result.error}`);
    }

    return result.result as T;
  }

  // ===== WalletStorageProvider Interface Methods =====
  //
  // These methods implement the required interface for wallet-toolbox storage.
  // Each method delegates to the StorageKnex instance in the main process via IPC.
  //
  // Note: Method signatures must match WalletStorageProvider exactly.
  // The actual implementation is in electron/storage.ts using StorageKnex.

  async insertCertificate(...args: any[]): Promise<any> {
    return this.callMethod('insertCertificate', ...args);
  }

  async updateCertificate(...args: any[]): Promise<any> {
    return this.callMethod('updateCertificate', ...args);
  }

  async findCertificates(...args: any[]): Promise<any> {
    return this.callMethod('findCertificates', ...args);
  }

  async deleteCertificate(...args: any[]): Promise<any> {
    return this.callMethod('deleteCertificate', ...args);
  }

  async insertOutput(...args: any[]): Promise<any> {
    return this.callMethod('insertOutput', ...args);
  }

  async updateOutput(...args: any[]): Promise<any> {
    return this.callMethod('updateOutput', ...args);
  }

  async findOutputs(...args: any[]): Promise<any> {
    return this.callMethod('findOutputs', ...args);
  }

  async deleteOutput(...args: any[]): Promise<any> {
    return this.callMethod('deleteOutput', ...args);
  }

  async insertTransaction(...args: any[]): Promise<any> {
    return this.callMethod('insertTransaction', ...args);
  }

  async updateTransaction(...args: any[]): Promise<any> {
    return this.callMethod('updateTransaction', ...args);
  }

  async findTransactions(...args: any[]): Promise<any> {
    return this.callMethod('findTransactions', ...args);
  }

  async deleteTransaction(...args: any[]): Promise<any> {
    return this.callMethod('deleteTransaction', ...args);
  }

  async insertCommission(...args: any[]): Promise<any> {
    return this.callMethod('insertCommission', ...args);
  }

  async findCommissions(...args: any[]): Promise<any> {
    return this.callMethod('findCommissions', ...args);
  }

  async insertOutputBasket(...args: any[]): Promise<any> {
    return this.callMethod('insertOutputBasket', ...args);
  }

  async updateOutputBasket(...args: any[]): Promise<any> {
    return this.callMethod('updateOutputBasket', ...args);
  }

  async findOutputBaskets(...args: any[]): Promise<any> {
    return this.callMethod('findOutputBaskets', ...args);
  }

  async deleteOutputBasket(...args: any[]): Promise<any> {
    return this.callMethod('deleteOutputBasket', ...args);
  }

  async insertProvenTx(...args: any[]): Promise<any> {
    return this.callMethod('insertProvenTx', ...args);
  }

  async updateProvenTx(...args: any[]): Promise<any> {
    return this.callMethod('updateProvenTx', ...args);
  }

  async findProvenTxs(...args: any[]): Promise<any> {
    return this.callMethod('findProvenTxs', ...args);
  }

  async deleteProvenTx(...args: any[]): Promise<any> {
    return this.callMethod('deleteProvenTx', ...args);
  }

  async insertProvenTxReq(...args: any[]): Promise<any> {
    return this.callMethod('insertProvenTxReq', ...args);
  }

  async updateProvenTxReq(...args: any[]): Promise<any> {
    return this.callMethod('updateProvenTxReq', ...args);
  }

  async findProvenTxReqs(...args: any[]): Promise<any> {
    return this.callMethod('findProvenTxReqs', ...args);
  }

  async deleteProvenTxReq(...args: any[]): Promise<any> {
    return this.callMethod('deleteProvenTxReq', ...args);
  }

  async insertTxLabel(...args: any[]): Promise<any> {
    return this.callMethod('insertTxLabel', ...args);
  }

  async findTxLabels(...args: any[]): Promise<any> {
    return this.callMethod('findTxLabels', ...args);
  }

  async deleteTxLabel(...args: any[]): Promise<any> {
    return this.callMethod('deleteTxLabel', ...args);
  }

  async insertOutputTag(...args: any[]): Promise<any> {
    return this.callMethod('insertOutputTag', ...args);
  }

  async findOutputTags(...args: any[]): Promise<any> {
    return this.callMethod('findOutputTags', ...args);
  }

  async deleteOutputTag(...args: any[]): Promise<any> {
    return this.callMethod('deleteOutputTag', ...args);
  }

  async insertCounterparty(...args: any[]): Promise<any> {
    return this.callMethod('insertCounterparty', ...args);
  }

  async updateCounterparty(...args: any[]): Promise<any> {
    return this.callMethod('updateCounterparty', ...args);
  }

  async findCounterparties(...args: any[]): Promise<any> {
    return this.callMethod('findCounterparties', ...args);
  }

  async deleteCounterparty(...args: any[]): Promise<any> {
    return this.callMethod('deleteCounterparty', ...args);
  }

  async processSyncChunk(...args: any[]): Promise<any> {
    return this.callMethod('processSyncChunk', ...args);
  }

  async requestSyncChunk(...args: any[]): Promise<any> {
    return this.callMethod('requestSyncChunk', ...args);
  }

  async getWalletStatus(...args: any[]): Promise<any> {
    return this.callMethod('getWalletStatus', ...args);
  }

  async getHeight(...args: any[]): Promise<any> {
    return this.callMethod('getHeight', ...args);
  }

  async updateHeight(...args: any[]): Promise<any> {
    return this.callMethod('updateHeight', ...args);
  }

  async findPermissions(...args: any[]): Promise<any> {
    return this.callMethod('findPermissions', ...args);
  }

  async insertPermission(...args: any[]): Promise<any> {
    return this.callMethod('insertPermission', ...args);
  }

  async updatePermission(...args: any[]): Promise<any> {
    return this.callMethod('updatePermission', ...args);
  }

  async deletePermission(...args: any[]): Promise<any> {
    return this.callMethod('deletePermission', ...args);
  }

  async findSettings(...args: any[]): Promise<any> {
    return this.callMethod('findSettings', ...args);
  }

  async insertSetting(...args: any[]): Promise<any> {
    return this.callMethod('insertSetting', ...args);
  }

  async updateSetting(...args: any[]): Promise<any> {
    return this.callMethod('updateSetting', ...args);
  }

  async deleteSetting(...args: any[]): Promise<any> {
    return this.callMethod('deleteSetting', ...args);
  }

  // ===== WalletStorageWriter Methods =====

  async destroy(): Promise<void> {
    return this.callMethod('destroy');
  }

  async migrate(...args: any[]): Promise<any> {
    return this.callMethod('migrate', ...args);
  }

  async findOrInsertUser(...args: any[]): Promise<any> {
    return this.callMethod('findOrInsertUser', ...args);
  }

  async abortAction(...args: any[]): Promise<any> {
    return this.callMethod('abortAction', ...args);
  }

  async createAction(...args: any[]): Promise<any> {
    return this.callMethod('createAction', ...args);
  }

  async processAction(...args: any[]): Promise<any> {
    return this.callMethod('processAction', ...args);
  }

  async internalizeAction(...args: any[]): Promise<any> {
    return this.callMethod('internalizeAction', ...args);
  }

  async insertCertificateAuth(...args: any[]): Promise<any> {
    return this.callMethod('insertCertificateAuth', ...args);
  }

  async relinquishCertificate(...args: any[]): Promise<any> {
    return this.callMethod('relinquishCertificate', ...args);
  }

  async relinquishOutput(...args: any[]): Promise<any> {
    return this.callMethod('relinquishOutput', ...args);
  }

  // ===== WalletStorageReader Methods =====

  async findCertificatesAuth(...args: any[]): Promise<any> {
    return this.callMethod('findCertificatesAuth', ...args);
  }

  async findOutputBasketsAuth(...args: any[]): Promise<any> {
    return this.callMethod('findOutputBasketsAuth', ...args);
  }

  async findOutputsAuth(...args: any[]): Promise<any> {
    return this.callMethod('findOutputsAuth', ...args);
  }

  async listActions(...args: any[]): Promise<any> {
    return this.callMethod('listActions', ...args);
  }

  async listCertificates(...args: any[]): Promise<any> {
    return this.callMethod('listCertificates', ...args);
  }

  async listOutputs(...args: any[]): Promise<any> {
    return this.callMethod('listOutputs', ...args);
  }

  // ===== WalletStorageSync Methods =====

  async findOrInsertSyncStateAuth(...args: any[]): Promise<any> {
    return this.callMethod('findOrInsertSyncStateAuth', ...args);
  }

  async setActive(...args: any[]): Promise<any> {
    return this.callMethod('setActive', ...args);
  }

  async getSyncChunk(...args: any[]): Promise<any> {
    return this.callMethod('getSyncChunk', ...args);
  }
}
