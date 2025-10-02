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
    callMethod: (identityKey: string, chain: 'main' | 'test', method: string, args: any[]) =>
      ipcRenderer.invoke('storage:call-method', identityKey, chain, method, args)
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
    makeAvailable: (identityKey: string, chain: 'main' | 'test') => Promise<{ success: boolean; error?: string }>;
    callMethod: (identityKey: string, chain: 'main' | 'test', method: string, args: any[]) => Promise<{ success: boolean; result?: any; error?: string }>;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
