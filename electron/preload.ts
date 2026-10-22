import { contextBridge, ipcRenderer } from 'electron';
import type { FeeSettingsView } from './feeSettings.js';

/** Mirrors TxStatusChangedEvent in storage.ts (not imported: preload must not pull in storage). */
export interface TxStatusChangedEvent {
  identityKey: string;
  chain: 'main' | 'test' | 'ttn' | 'tstn';
  txid: string;
  status: string;
}

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Focus management
  isFocused: () => ipcRenderer.invoke('is-focused'),
  requestFocus: () => ipcRenderer.invoke('request-focus'),
  relinquishFocus: () => ipcRenderer.invoke('relinquish-focus'),

  // File operations
  downloadFile: (fileName: string, content: number[]) =>
    ipcRenderer.invoke('download-file', fileName, content),
  saveFile: (defaultPath: string, content: number[]) =>
    ipcRenderer.invoke('save-file', defaultPath, content),

  // Manifest proxy
  proxyFetchManifest: (url: string) =>
    ipcRenderer.invoke('proxy-fetch-manifest', url),

  // Network proxy settings
  network: {
    getProxySettings: () => ipcRenderer.invoke('network:get-proxy-settings'),
    setProxySettings: (settings: { mode: 'direct' | 'fixed_servers'; proxyRules: string; lastProxyRules?: string }) =>
      ipcRenderer.invoke('network:set-proxy-settings', settings),
    onOpenSettings: (callback: () => void) => {
      ipcRenderer.on('network-settings:open', callback);
    },
    removeOpenSettingsListener: (callback: () => void) => {
      ipcRenderer.removeListener('network-settings:open', callback);
    }
  },

  // Transaction fee settings
  fees: {
    get: (chain: 'main' | 'test' | 'ttn' | 'tstn') =>
      ipcRenderer.invoke('fees:get', chain),
    set: (chain: 'main' | 'test' | 'ttn' | 'tstn', rate: number | null) =>
      ipcRenderer.invoke('fees:set', chain, rate)
  },

  app: {
    restart: () => ipcRenderer.invoke('app:restart')
  },

  // Direct payments: offer this device's local addresses to wallets on the same network
  webrtc: {
    shareLocalAddress: (share: boolean): Promise<void> => ipcRenderer.invoke('webrtc:share-local-address', share)
  },

  // The live payments worker (electron/liveWorker.ts). Its port arrives as a window message,
  // posted below: a MessagePort cannot cross contextBridge.
  liveWorker: {
    open: (): Promise<void> => ipcRenderer.invoke('live-worker:open'),
    close: (): Promise<void> => ipcRenderer.invoke('live-worker:close'),
    onGone: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on('live-worker:gone', listener);
      return () => { ipcRenderer.removeListener('live-worker:gone', listener); };
    }
  },

  // Troubleshoot: re-run the HTTPS bridge certificate trust flow
  cert: {
    checkAndRepair: () => ipcRenderer.invoke('cert:check-and-repair')
  },

  // HTTP request/response handling
  onHttpRequest: (callback: (event: any) => void) => {
    ipcRenderer.on('http-request', (_event, request) => callback(request));
  },
  onHttpRequestCancelled: (callback: (event: { request_id: number; reason?: string }) => void) => {
    ipcRenderer.on('http-request-cancelled', (_event, payload) => callback(payload));
  },
  sendHttpResponse: (response: any) => {
    ipcRenderer.send('http-response', response);
  },

  // Transaction status changes seen by the monitor (Arcade SSE events among them)
  onTxStatusChanged: (callback: (event: TxStatusChangedEvent) => void) => {
    const listener = (_event: unknown, payload: TxStatusChangedEvent) => callback(payload);
    ipcRenderer.on('wallet:tx-status-changed', listener);
    return () => { ipcRenderer.removeListener('wallet:tx-status-changed', listener); };
  },
  removeHttpRequestListener: () => {
    ipcRenderer.removeAllListeners('http-request');
    ipcRenderer.removeAllListeners('http-request-cancelled');
  },

  walletData: {
    call: (action: string, data: Record<string, unknown>) => ipcRenderer.invoke('wallet-data:call', action, data),
    onProgress: (callback: (message: string) => void) => {
      const listener = (_event: unknown, message: string) => callback(message);
      ipcRenderer.on('wallet-data:progress', listener);
      return () => ipcRenderer.removeListener('wallet-data:progress', listener);
    }
  },

  // Storage operations
  storage: {
    releaseNetwork: (identityKey: string, chain: 'main' | 'test' | 'ttn' | 'tstn') =>
      ipcRenderer.invoke('storage:release-network', identityKey, chain),
    isAvailable: (identityKey: string, chain: 'main' | 'test' | 'ttn' | 'tstn') =>
      ipcRenderer.invoke('storage:is-available', identityKey, chain),
    makeAvailable: (identityKey: string, chain: 'main' | 'test' | 'ttn' | 'tstn') =>
      ipcRenderer.invoke('storage:make-available', identityKey, chain),
    initializeServices: (identityKey: string, chain: 'main' | 'test' | 'ttn' | 'tstn', settings: import('./networkConfig.js').NetworkSettings | undefined, callbackToken: string) =>
      ipcRenderer.invoke('storage:initialize-services', identityKey, chain, settings, callbackToken),
    callMethod: (identityKey: string, chain: 'main' | 'test' | 'ttn' | 'tstn', method: string, args: any[]) =>
      ipcRenderer.invoke('storage:call-method', identityKey, chain, method, args)
  },

  // Secret store (vault-backed; requires unlock)
  secrets: {
    getAll: (): Promise<Record<string, string>> =>
      ipcRenderer.invoke('secrets:get-all'),
    set: (name: string, value: string): Promise<void> =>
      ipcRenderer.invoke('secrets:set', name, value),
    delete: (name: string): Promise<void> =>
      ipcRenderer.invoke('secrets:delete', name),
  },

  // Vault unlock / enroll (cold-start gate)
  vault: {
    status: (): Promise<{
      locked: boolean
      hasVault: boolean
      methods: Array<'se' | 'passphrase'>
      biometricsAvailable: boolean
      needsMigration: boolean
    }> => ipcRenderer.invoke('vault:status'),
    unlockWithPassphrase: (passphrase: string): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke('vault:unlock-passphrase', passphrase),
    unlockWithBiometrics: (): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke('vault:unlock-biometrics'),
    enroll: (options: {
      passphrase: string
      enableBiometrics: boolean
      initialSecrets?: Record<string, string>
    }): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke('vault:enroll', options),
    lock: (): Promise<void> => ipcRenderer.invoke('vault:lock'),
    endSession: (): Promise<void> => ipcRenderer.invoke('vault:end-session'),
    destroy: (): Promise<void> => ipcRenderer.invoke('vault:destroy'),
  },

  bootConfig: {
    get: (): Promise<any> => ipcRenderer.invoke('boot-config:get'),
    set: (config: any): Promise<void> => ipcRenderer.invoke('boot-config:set', config),
  },

  // Auto-update operations
  updates: {
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    getState: () => ipcRenderer.invoke('update:get-state'),
    onUpdateAvailable: (callback: (info: any) => void) => {
      ipcRenderer.on('update-available', (_event, info) => callback(info));
    },
    onDownloadProgress: (callback: (progress: any) => void) => {
      ipcRenderer.on('update-download-progress', (_event, progress) => callback(progress));
    },
    onUpdateDownloaded: (callback: (info: any) => void) => {
      ipcRenderer.on('update-downloaded', (_event, info) => callback(info));
    },
    onUpdateError: (callback: (error: string) => void) => {
      ipcRenderer.on('update-error', (_event, error) => callback(error));
    },
    removeAllListeners: () => {
      ipcRenderer.removeAllListeners('update-available');
      ipcRenderer.removeAllListeners('update-download-progress');
      ipcRenderer.removeAllListeners('update-downloaded');
      ipcRenderer.removeAllListeners('update-error');
    }
  }
});

// Type definitions for window.electronAPI
export interface ElectronAPI {
  walletData: {
    call: (action: string, data: Record<string, unknown>) => Promise<any>;
    onProgress: (callback: (message: string) => void) => () => void;
  };

  isFocused: () => Promise<boolean>;
  requestFocus: () => Promise<void>;
  relinquishFocus: () => Promise<void>;
  downloadFile: (fileName: string, content: number[]) => Promise<{ success: boolean; path?: string; error?: string }>;
  saveFile: (defaultPath: string, content: number[]) => Promise<{ success: boolean; path?: string; canceled?: boolean; error?: string }>;
  proxyFetchManifest: (url: string) => Promise<{ status: number; headers: [string, string][]; body: string }>;
  network: {
    getProxySettings: () => Promise<{ mode: 'direct' | 'fixed_servers'; proxyRules: string; lastProxyRules?: string; restartRequired?: boolean }>;
    setProxySettings: (settings: { mode: 'direct' | 'fixed_servers'; proxyRules: string; lastProxyRules?: string }) => Promise<{ success: boolean; settings?: { mode: 'direct' | 'fixed_servers'; proxyRules: string; lastProxyRules?: string }; restartRequired?: boolean; error?: string }>;
    onOpenSettings: (callback: () => void) => void;
    removeOpenSettingsListener: (callback: () => void) => void;
  };
  fees: {
    get: (chain: 'main' | 'test' | 'ttn' | 'tstn') => Promise<FeeSettingsView>;
    set: (chain: 'main' | 'test' | 'ttn' | 'tstn', rate: number | null) => Promise<{
      success: boolean;
      settings?: FeeSettingsView;
      error?: string;
    }>;
  };
  app: {
    /** Relaunches the app; the process exits and the Promise does not resolve. */
    restart: () => Promise<void>;
  };
  /** Direct payments: whether WebRTC offers this device's LAN and IPv6 addresses (see electron/webrtcPrivacy.ts). */
  webrtc: {
    shareLocalAddress: (share: boolean) => Promise<void>;
  };
  cert: {
    checkAndRepair: () => Promise<{ trusted: boolean | null; repaired: boolean }>;
  };
  onHttpRequest: (callback: (event: any) => void) => void;
  onHttpRequestCancelled: (callback: (event: { request_id: number; reason?: string }) => void) => void;
  sendHttpResponse: (response: any) => void;
  removeHttpRequestListener: () => void;
  /** Returns an unsubscribe function. */
  onTxStatusChanged: (callback: (event: TxStatusChangedEvent) => void) => () => void;
  storage: {
    releaseNetwork: (identityKey: string, chain: 'main' | 'test' | 'ttn' | 'tstn') => Promise<{ success: boolean; error?: string }>;
    isAvailable: (identityKey: string, chain: 'main' | 'test' | 'ttn' | 'tstn') => Promise<boolean>;
    makeAvailable: (identityKey: string, chain: 'main' | 'test' | 'ttn' | 'tstn') => Promise<{ success: boolean; settings?: any; error?: string }>;
    initializeServices: (identityKey: string, chain: 'main' | 'test' | 'ttn' | 'tstn', settings: import('./networkConfig.js').NetworkSettings | undefined, callbackToken: string) => Promise<{ success: boolean; error?: string }>;
    callMethod: (identityKey: string, chain: 'main' | 'test' | 'ttn' | 'tstn', method: string, args: any[]) => Promise<{ success: boolean; result?: any; error?: string; walletError?: string }>;
  };
  secrets: {
    getAll: () => Promise<Record<string, string>>;
    set: (name: string, value: string) => Promise<void>;
    delete: (name: string) => Promise<void>;
  };
  vault: {
    status: () => Promise<{
      locked: boolean;
      hasVault: boolean;
      methods: Array<'se' | 'passphrase'>;
      biometricsAvailable: boolean;
      needsMigration: boolean;
    }>;
    unlockWithPassphrase: (passphrase: string) => Promise<{ ok: true } | { ok: false; error: string }>;
    unlockWithBiometrics: () => Promise<{ ok: true } | { ok: false; error: string }>;
    enroll: (options: {
      passphrase: string;
      enableBiometrics: boolean;
      initialSecrets?: Record<string, string>;
    }) => Promise<{ ok: true } | { ok: false; error: string }>;
    lock: () => Promise<void>;
    endSession: () => Promise<void>;
    destroy: () => Promise<void>;
  };
  bootConfig: {
    get: () => Promise<any>;
    set: (config: any) => Promise<void>;
  };
  updates: {
    check: () => Promise<{ success: boolean; updateInfo?: any; error?: string }>;
    download: () => Promise<{ success: boolean; error?: string }>;
    install: () => Promise<{ success: boolean; error?: string }>;
    getState: () => Promise<{ success: boolean; state?: any; error?: string }>;
    onUpdateAvailable: (callback: (info: any) => void) => void;
    onDownloadProgress: (callback: (progress: any) => void) => void;
    onUpdateDownloaded: (callback: (info: any) => void) => void;
    onUpdateError: (callback: (error: string) => void) => void;
    removeAllListeners: () => void;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

// The live payments worker's port, from main: handed to the page, which only takes it from
// this window (src/lib/services/liveWorker/index.ts).
ipcRenderer.on('live-worker:port', (event) => {
  // The electron build has no DOM types; this is the page's window.postMessage.
  const page = globalThis as unknown as { postMessage(message: string, targetOrigin: string, transfer: unknown[]): void };
  if (event.ports.length === 1) page.postMessage('bsv-desktop:live-worker-port', '*', [event.ports[0]]);
});
