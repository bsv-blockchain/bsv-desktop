// Global type declarations for Electron IPC API

export interface ElectronAPI {
  isFocused: () => Promise<boolean>;
  requestFocus: () => Promise<void>;
  relinquishFocus: () => Promise<void>;
  downloadFile: (fileName: string, content: number[]) => Promise<{ success: boolean; path?: string; error?: string }>;
  saveFile: (defaultPath: string, content: number[]) => Promise<{ success: boolean; path?: string; canceled?: boolean; error?: string }>;
  saveMnemonic: (mnemonic: string) => Promise<{ success: boolean; path?: string; error?: string }>;
  savePrivateKey: (privateKey: string) => Promise<{ success: boolean; path?: string; error?: string }>;
  proxyFetchManifest: (url: string) => Promise<{ status: number; headers: [string, string][]; body: string }>;
  network: {
    getProxySettings: () => Promise<{ mode: 'direct' | 'fixed_servers'; proxyRules: string; lastProxyRules?: string; restartRequired?: boolean }>;
    setProxySettings: (settings: { mode: 'direct' | 'fixed_servers'; proxyRules: string; lastProxyRules?: string }) => Promise<{ success: boolean; settings?: { mode: 'direct' | 'fixed_servers'; proxyRules: string; lastProxyRules?: string }; restartRequired?: boolean; error?: string }>;
    onOpenSettings: (callback: () => void) => void;
    removeOpenSettingsListener: (callback: () => void) => void;
  };
  app: {
    /** Relaunches the app; the process exits and the Promise does not resolve. */
    restart: () => Promise<void>;
  };
  onHttpRequest: (callback: (event: any) => void) => void;
  sendHttpResponse: (response: any) => void;
  removeHttpRequestListener: () => void;
  storage: {
    isAvailable: (identityKey: string, chain: 'main' | 'test') => Promise<boolean>;
    makeAvailable: (identityKey: string, chain: 'main' | 'test') => Promise<{ success: boolean; settings?: any; error?: string }>;
    callMethod: (identityKey: string, chain: 'main' | 'test', method: string, args: any[]) => Promise<{ success: boolean; result?: any; error?: string }>;
    initializeServices: (identityKey: string, chain: 'main' | 'test') => Promise<{ success: boolean; error?: string }>;
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
