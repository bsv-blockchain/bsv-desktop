/**
 * Route main-process HTTP(S) `fetch` through Electron's session network stack.
 *
 * Why this exists:
 * `@bsv/wallet-toolbox` builds its Arcade/ARC providers with `@bsv/sdk`'s
 * `defaultHttpClient()`, which uses `globalThis.fetch` when it exists (Node 18+).
 * Electron's main process is Node, so those calls use undici's fetch, and
 * undici does NOT read `HTTP_PROXY`/`HTTPS_PROXY` in this runtime. The result is
 * that the app's Network proxy setting (session.setProxy) was applied to
 * Chromium (renderer, fee policy, manifest) but not to the wallet's
 * `POST /tx` broadcast or `GET /tx/{txid}` status calls.
 *
 * `session.defaultSession.fetch` uses Chromium's network stack and therefore
 * honors `session.setProxy`, including `fixed_servers`, system/PAC mode and the
 * local bypass rules. Replacing global fetch before the wallet's Services are
 * created makes every wallet-toolbox HTTP call (Arcade first, fallbacks too)
 * proxy-aware without patching the toolbox.
 *
 * Scope: only HTTP(S) is routed through the session. `data:`, `blob:` and
 * `file:` keep Node's fetch behavior. Electron's `net.fetch` also ignores
 * `integrity` and reports an imprecise `Response.url` / `.type`; wallet calls do
 * not use those, but the wrapper stays out of their way.
 *
 * The monitor worker is a plain Node child and cannot use this; it installs its
 * own undici dispatcher instead (see workerProxyFetch.js).
 */

import { session } from 'electron';

let installed = false;

function inputUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** Idempotent; call after app.whenReady() and after the persisted proxy is applied. */
export function installSessionFetch(): void {
  if (installed) return;

  const defaultSession = session?.defaultSession;
  if (!defaultSession || typeof defaultSession.fetch !== 'function') {
    console.warn('[Network] session.fetch is unavailable; main-process fetch stays direct');
    return;
  }

  installed = true;
  const sessionFetch = defaultSession.fetch.bind(defaultSession);
  const originalFetch = globalThis.fetch;

  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = inputUrl(input).trim();
    if (!/^https?:/i.test(url)) {
      if (typeof originalFetch !== 'function') {
        return Promise.reject(new TypeError(`Unsupported fetch URL: ${url}`));
      }
      return originalFetch(input, init);
    }

    // Keep wallet traffic out of the default session's cookie jar and HTTP
    // cache. Callers that set either option explicitly keep their value.
    const nextInit = { ...(init ?? {}) } as RequestInit & { cache?: string };
    if (nextInit.credentials === undefined) nextInit.credentials = 'omit';
    if (nextInit.cache === undefined) nextInit.cache = 'no-store';

    return sessionFetch(input as any, nextInit as any) as unknown as Promise<Response>;
  }) as typeof fetch;

  console.log('[Network] Main-process HTTP(S) fetch routed through the Electron session (proxy-aware)');
}
