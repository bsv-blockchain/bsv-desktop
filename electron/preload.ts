import { contextBridge, ipcRenderer } from 'electron';

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

  // HTTP request/response handling
  onHttpRequest: (callback: (event: any) => void) => {
    ipcRenderer.on('http-request', (_event, request) => callback(request));
  },
  sendHttpResponse: (response: any) => {
    ipcRenderer.send('http-response', response);
  },
  removeHttpRequestListener: () => {
    ipcRenderer.removeAllListeners('http-request');
  },

  // Storage operations
  storage: {
    isAvailable: (identityKey: string, chain: 'main' | 'test') =>
      ipcRenderer.invoke('storage:is-available', identityKey, chain),
    makeAvailable: (identityKey: string, chain: 'main' | 'test') =>
      ipcRenderer.invoke('storage:make-available', identityKey, chain),
    initializeServices: (identityKey: string, chain: 'main' | 'test') =>
      ipcRenderer.invoke('storage:initialize-services', identityKey, chain),
    callMethod: (identityKey: string, chain: 'main' | 'test', method: string, args: any[]) =>
      ipcRenderer.invoke('storage:call-method', identityKey, chain, method, args)
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
  isFocused: () => Promise<boolean>;
  requestFocus: () => Promise<void>;
  relinquishFocus: () => Promise<void>;
  downloadFile: (fileName: string, content: number[]) => Promise<{ success: boolean; path?: string; error?: string }>;
  saveFile: (defaultPath: string, content: number[]) => Promise<{ success: boolean; path?: string; canceled?: boolean; error?: string }>;
  proxyFetchManifest: (url: string) => Promise<{ status: number; headers: [string, string][]; body: string }>;
  onHttpRequest: (callback: (event: any) => void) => void;
  sendHttpResponse: (response: any) => void;
  removeHttpRequestListener: () => void;
  storage: {
    isAvailable: (identityKey: string, chain: 'main' | 'test') => Promise<boolean>;
    makeAvailable: (identityKey: string, chain: 'main' | 'test') => Promise<{ success: boolean; settings?: any; error?: string }>;
    initializeServices: (identityKey: string, chain: 'main' | 'test') => Promise<{ success: boolean; error?: string }>;
    callMethod: (identityKey: string, chain: 'main' | 'test', method: string, args: any[]) => Promise<{ success: boolean; result?: any; error?: string }>;
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
