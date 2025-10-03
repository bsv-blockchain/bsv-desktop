// Global type declarations for Electron IPC API

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
    callMethod: (identityKey: string, chain: 'main' | 'test', method: string, args: any[]) => Promise<{ success: boolean; result?: any; error?: string }>;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
