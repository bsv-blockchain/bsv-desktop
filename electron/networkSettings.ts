import { app, ipcMain, session } from 'electron';
import fs from 'fs';
import path from 'path';

interface NetworkProxySettings {
  mode: 'direct' | 'fixed_servers';
  proxyRules: string;
  lastProxyRules?: string;
}

const DEFAULT_PROXY_SETTINGS: NetworkProxySettings = {
  mode: 'direct',
  proxyRules: ''
};

function getProxySettingsPath(): string {
  return path.join(app.getPath('userData'), 'network-settings.json');
}

function readProxySettings(): NetworkProxySettings | null {
  try {
    const filePath = getProxySettingsPath();
    if (!fs.existsSync(filePath)) return null;

    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (parsed?.mode === 'direct') {
      return {
        ...DEFAULT_PROXY_SETTINGS,
        lastProxyRules: typeof parsed.lastProxyRules === 'string' ? parsed.lastProxyRules.trim() : ''
      };
    }

    if (parsed?.mode === 'fixed_servers' && typeof parsed.proxyRules === 'string') {
      const proxyRules = parsed.proxyRules.trim();
      return {
        mode: 'fixed_servers',
        proxyRules,
        lastProxyRules: typeof parsed.lastProxyRules === 'string' ? parsed.lastProxyRules.trim() : proxyRules
      };
    }
  } catch (error) {
    console.error('[Network] Failed to read proxy settings:', error);
  }

  return null;
}

function writeProxySettings(settings: NetworkProxySettings): void {
  const normalized = normalizeProxySettings(settings);
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(getProxySettingsPath(), JSON.stringify(normalized, null, 2), 'utf-8');
}

function normalizeProxySettings(settings: NetworkProxySettings): NetworkProxySettings {
  if (settings.mode === 'direct') {
    return {
      ...DEFAULT_PROXY_SETTINGS,
      lastProxyRules: settings.lastProxyRules?.trim() || ''
    };
  }

  const proxyRules = settings.proxyRules.trim();
  return {
    mode: 'fixed_servers',
    proxyRules,
    lastProxyRules: proxyRules
  };
}

function getEffectiveProxySettings(): NetworkProxySettings {
  return readProxySettings() ?? { ...DEFAULT_PROXY_SETTINGS };
}

function validateProxySettings(settings: NetworkProxySettings): NetworkProxySettings {
  const normalized = normalizeProxySettings(settings);

  if (normalized.mode === 'direct') {
    return normalized;
  }

  if (!normalized.proxyRules) {
    throw new Error('Proxy server is required');
  }

  if (!isValidHttpProxyUrl(normalized.proxyRules)) {
    throw new Error('Use an HTTP proxy URL such as http://host:port');
  }

  return normalized;
}

function isValidHttpProxyUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const port = Number(url.port);
    return url.protocol === 'http:' &&
      Boolean(url.hostname) &&
      Boolean(url.port) &&
      Number.isInteger(port) &&
      port > 0 &&
      port <= 65535 &&
      url.username === '' &&
      url.password === '' &&
      url.pathname === '/' &&
      url.search === '' &&
      url.hash === '';
  } catch {
    return false;
  }
}

async function applyProxySettings(settings: NetworkProxySettings): Promise<void> {
  const normalized = normalizeProxySettings(settings);

  if (normalized.mode === 'direct') {
    await session.defaultSession.setProxy({ mode: 'direct' });
    console.log('[Network] Proxy disabled');
    return;
  }

  await session.defaultSession.setProxy({
    mode: 'fixed_servers',
    proxyRules: normalized.proxyRules,
    proxyBypassRules: '<local>;localhost;127.0.0.1;::1'
  });
  console.log(`[Network] Proxy enabled: ${normalized.proxyRules}`);
}

export async function applyPersistedProxySettings(): Promise<void> {
  const persistedProxySettings = readProxySettings();
  if (persistedProxySettings) {
    await applyProxySettings(persistedProxySettings);
  }
}

export function registerNetworkIpc(): void {
  ipcMain.handle('network:get-proxy-settings', async () => {
    return getEffectiveProxySettings();
  });

  ipcMain.handle('network:set-proxy-settings', async (_event, settings: NetworkProxySettings) => {
    try {
      const validated = validateProxySettings(settings);
      writeProxySettings(validated);
      return { success: true, settings: validated, restartRequired: true };
    } catch (error: any) {
      console.error('[IPC] network:set-proxy-settings error:', error);
      return { success: false, error: error.message };
    }
  });
}
