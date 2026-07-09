import { app, ipcMain, session } from 'electron';
import fs from 'fs';
import path from 'path';

export interface NetworkProxySettings {
  mode: 'direct' | 'fixed_servers';
  proxyRules: string;
  lastProxyRules?: string;
}

export interface NetworkProxySettingsResponse extends NetworkProxySettings {
  restartRequired: boolean;
}

interface RegisterNetworkIpcOptions {
  hasActiveMonitorWorkers?: () => boolean | Promise<boolean>;
}

const DEFAULT_PROXY_SETTINGS: NetworkProxySettings = {
  mode: 'direct',
  proxyRules: ''
};

const LOCAL_BYPASS = '<local>;localhost;127.0.0.1;::1';
const LOCAL_NO_PROXY = 'localhost,127.0.0.1,::1';

/** In-memory: workers forked before a mid-session proxy change still need a relaunch. */
let pendingWorkerRestart = false;

/** Snapshot of settings currently applied to Chromium session + process.env. */
let appliedSettings: NetworkProxySettings | null = null;

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

function settingsEqual(a: NetworkProxySettings | null, b: NetworkProxySettings): boolean {
  if (!a) return false;
  return a.mode === b.mode && a.proxyRules === b.proxyRules;
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

function clearProcessProxyEnv(): void {
  delete process.env.HTTP_PROXY;
  delete process.env.HTTPS_PROXY;
  delete process.env.http_proxy;
  delete process.env.https_proxy;
  delete process.env.ALL_PROXY;
  delete process.env.all_proxy;
  delete process.env.NO_PROXY;
  delete process.env.no_proxy;
}

function setProcessProxyEnv(proxyRules: string): void {
  process.env.HTTP_PROXY = proxyRules;
  process.env.HTTPS_PROXY = proxyRules;
  process.env.http_proxy = proxyRules;
  process.env.https_proxy = proxyRules;
  process.env.NO_PROXY = LOCAL_NO_PROXY;
  process.env.no_proxy = LOCAL_NO_PROXY;
}

/**
 * Apply Chromium session proxy + process env so Node children forked later inherit the same policy.
 * Does not restart already-running workers.
 */
async function applyProxySettings(settings: NetworkProxySettings): Promise<void> {
  const normalized = normalizeProxySettings(settings);

  if (normalized.mode === 'direct') {
    await session.defaultSession.setProxy({ mode: 'direct' });
    clearProcessProxyEnv();
    appliedSettings = normalized;
    console.log('[Network] Proxy disabled (direct)');
    return;
  }

  await session.defaultSession.setProxy({
    mode: 'fixed_servers',
    proxyRules: normalized.proxyRules,
    proxyBypassRules: LOCAL_BYPASS
  });
  setProcessProxyEnv(normalized.proxyRules);
  appliedSettings = normalized;
  console.log(`[Network] Proxy enabled: ${normalized.proxyRules}`);
}

/**
 * Startup: only touch networking if the user previously saved settings.
 * No settings file → leave Chromium defaults (including system proxy) alone.
 */
export async function applyPersistedProxySettings(): Promise<void> {
  const persisted = readProxySettings();
  if (!persisted) {
    appliedSettings = null;
    pendingWorkerRestart = false;
    return;
  }

  try {
    await applyProxySettings(persisted);
    pendingWorkerRestart = false;
  } catch (error) {
    console.error('[Network] Failed to apply persisted proxy settings:', error);
  }
}

export function registerNetworkIpc(options: RegisterNetworkIpcOptions = {}): void {
  const { hasActiveMonitorWorkers } = options;

  ipcMain.handle('network:get-proxy-settings', async (): Promise<NetworkProxySettingsResponse> => {
    const settings = getEffectiveProxySettings();
    return {
      ...settings,
      restartRequired: pendingWorkerRestart
    };
  });

  ipcMain.handle('network:set-proxy-settings', async (_event, settings: NetworkProxySettings) => {
    try {
      const validated = validateProxySettings(settings);
      const changed = !settingsEqual(appliedSettings, validated);

      writeProxySettings(validated);
      await applyProxySettings(validated);

      if (changed) {
        const workersActive = hasActiveMonitorWorkers
          ? Boolean(await hasActiveMonitorWorkers())
          : false;
        pendingWorkerRestart = workersActive;
      }

      return {
        success: true,
        settings: validated,
        restartRequired: pendingWorkerRestart
      };
    } catch (error: any) {
      console.error('[IPC] network:set-proxy-settings error:', error);
      return { success: false, error: error.message };
    }
  });
}
