/**
 * Proxy-aware global fetch for the monitor worker.
 *
 * This file MUST be imported before any module that captures `globalThis.fetch`
 * at module-load time (notably `eventsource`), which is why monitor-worker.ts
 * imports it first.
 *
 * The worker is a plain Node child process, not an Electron renderer, so it has
 * no `session.defaultSession.fetch`. The parent resolves the app's proxy policy
 * and passes the URL in BSV_DESKTOP_PROXY_URL; this transport applies it with
 * undici's `ProxyAgent`.
 *
 * Do not read HTTP_PROXY/HTTPS_PROXY here. Those can come from the user's shell
 * even when the app is in direct mode, which would make the worker use a proxy
 * the main process is not using. BSV_DESKTOP_PROXY_URL is owned exclusively by
 * electron/networkSettings.ts.
 *
 * Only fixed-server proxies can be handed to a plain Node child; system/PAC
 * mode leaves the worker direct while the main process still follows the
 * Chromium session proxy.
 */

import { ProxyAgent, fetch as undiciFetch } from 'undici';

const PROXY_URL_ENV = 'BSV_DESKTOP_PROXY_URL';
const proxyUrl = process.env[PROXY_URL_ENV]?.trim();
const originalFetch = globalThis.fetch;

function inputUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
}

/**
 * ProxyAgent does not honor NO_PROXY. The app sets it to keep local services
 * (Chaintracks, a local Arcade, the wallet bridge) off the proxy, so apply the
 * same rule here. Domain entries match the domain and its subdomains; `*`
 * disables proxying.
 */
function shouldBypass(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return true;
  }

  const hostname = parsed.hostname.toLowerCase();
  if (isLoopback(hostname)) return true;

  const entries = (process.env.NO_PROXY || process.env.no_proxy || '')
    .split(',')
    .map(entry => entry.trim().toLowerCase())
    .filter(Boolean);

  for (const entry of entries) {
    if (entry === '*') return true;
    // The app writes hostnames without ports. Tolerate a port suffix if a shell
    // NO_PROXY includes one.
    const host = entry.replace(/:\d+$/, '');
    const domain = host.startsWith('.') ? host.slice(1) : host;
    if (hostname === domain || hostname.endsWith(`.${domain}`)) return true;
  }

  return false;
}

let dispatcher: ProxyAgent | undefined;
if (proxyUrl) {
  try {
    dispatcher = new ProxyAgent(proxyUrl);
    console.log('[Monitor Worker] wallet HTTP transport uses the configured proxy');
  } catch (error) {
    console.warn('[Monitor Worker] invalid proxy URL; wallet HTTP transport stays direct:', error);
  }
}

if (dispatcher) {
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = inputUrl(input).trim();
    if (!/^https?:/i.test(url) || shouldBypass(url)) {
      return originalFetch(input, init);
    }

    return undiciFetch(input as any, {
      ...(init as any),
      dispatcher
    } as any) as unknown as Promise<Response>;
  }) as typeof fetch;
}

export {};
