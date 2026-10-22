/**
 * The live payments worker: a hidden, sandboxed window that runs WebRTC (ICE, DTLS, SCTP)
 * for direct payments, so that a peer that reaches Chromium's WebRTC code reaches a process
 * that holds no keys. The wallet window holds them (its `secrets` bridge and the wallet),
 * and it no longer does WebRTC at all.
 *
 * The worker window:
 * - is sandboxed, with context isolation and no Node, in its own in-memory session
 *   (`partition: 'live-payments'`), so it shares no storage with the wallet window;
 * - has a preload that only hands it its port (live-worker-preload.cjs), and the page is a
 *   small bundle (src/liveWorkerPage.ts) with no network access of its own: every request
 *   but its own page is cancelled, and every permission is denied (so host candidates stay
 *   mDNS names unless "Connect directly on the same network" sets the IP handling policy);
 * - talks to the wallet window only over a MessageChannel this module sets up, through which
 *   it may ask for five checked wallet calls, signals and payments
 *   (src/lib/services/liveWorker/protocol.ts).
 *
 * The wallet window asks for it with `live-worker:open` and lets it go with
 * `live-worker:close`; when it dies the wallet window hears `live-worker:gone` and starts
 * another. Only the wallet window may ask.
 */
import path from 'path';
import type { BrowserWindow as BrowserWindowType, IpcMain, IpcMainInvokeEvent, MessageChannelMain as MessageChannelMainType, Session, WebContents } from 'electron';
import { shareLocalAddressWithWebRtc } from './webrtcPrivacy.js';

export const LIVE_WORKER_PARTITION = 'live-payments';

/** The Electron pieces this needs, passed in so it can be tested without Electron. */
export interface LiveWorkerDeps {
  BrowserWindow: typeof BrowserWindowType;
  MessageChannelMain: typeof MessageChannelMainType;
  ipcMain: Pick<IpcMain, 'handle'>;
  fromPartition: (partition: string) => Session;
  /** The wallet window's webContents, the only one that may open the worker. */
  walletContents: () => WebContents | null | undefined;
  isDev: boolean;
  /** Directory of the compiled main process (dist-electron). */
  dir: string;
}

/** The worker page: the Vite dev server's in development, the built file otherwise. */
export function liveWorkerPage(isDev: boolean, dir: string): { url: string } | { file: string } {
  return isDev ? { url: 'http://localhost:5173/live-worker.html' } : { file: path.join(dir, '../dist/live-worker.html') };
}

/** True for a request the worker page may make: its own page and bundle, nothing else. */
export function isWorkerPageRequest(url: string, isDev: boolean): boolean {
  if (isDev) return url.startsWith('http://localhost:5173/') || url.startsWith('ws://localhost:5173/');
  return url.startsWith('file://') || url.startsWith('devtools://');
}

export interface LiveWorkerController {
  /** The "Connect directly on the same network" choice, applied to the worker (now or when it starts). */
  setShareLocalAddress(share: unknown): void;
  /** Stops the worker (on quit). */
  destroy(): void;
}

export function registerLiveWorker(deps: LiveWorkerDeps): LiveWorkerController {
  let worker: BrowserWindowType | null = null;
  let loaded: Promise<void> | null = null;
  let shareLocalAddress = true;
  let sessionReady = false;

  function prepareSession(): Session {
    const s = deps.fromPartition(LIVE_WORKER_PARTITION);
    if (sessionReady) return s;
    sessionReady = true;
    // Every permission denied: no camera or microphone, so Chromium offers mDNS names for host
    // candidates (the IP handling policy decides the rest), and nothing else either.
    s.setPermissionCheckHandler(() => false);
    s.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    // No network access of its own: the page and its bundle only. WebRTC's own traffic
    // (STUN, TURN, peers) does not go through here.
    s.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: !isWorkerPageRequest(details.url, deps.isDev) });
    });
    return s;
  }

  /** `w` died or closed: forget it, and tell the wallet window (once). */
  function lose(w: BrowserWindowType): void {
    if (worker !== w) return;
    worker = null;
    loaded = null;
    if (!w.isDestroyed()) w.destroy();
    deps.walletContents()?.send('live-worker:gone');
  }

  function start(): Promise<void> {
    if (worker && !worker.isDestroyed() && loaded) return loaded;
    const session = prepareSession();
    const w = new deps.BrowserWindow({
      show: false,
      width: 1,
      height: 1,
      skipTaskbar: true,
      webPreferences: {
        preload: path.join(deps.dir, 'live-worker-preload.cjs'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        webviewTag: false,
        session,
        spellcheck: false,
        devTools: deps.isDev,
        // A hidden window's timers are throttled otherwise; dials and acks run on timers.
        backgroundThrottling: false
      }
    });
    worker = w;
    shareLocalAddressWithWebRtc(w.webContents, shareLocalAddress);
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    let first = true;
    const block = (event: { preventDefault(): void }) => {
      if (first) return;
      event.preventDefault();
    };
    w.webContents.on('will-navigate', block);
    w.webContents.on('will-redirect', block);
    w.webContents.on('render-process-gone', (_e, details) => {
      console.warn('[live worker] the worker stopped:', details?.reason);
      lose(w);
    });
    w.on('closed', () => lose(w));
    const page = liveWorkerPage(deps.isDev, deps.dir);
    loaded = ('url' in page ? w.loadURL(page.url) : w.loadFile(page.file)).then(
      () => { first = false; },
      e => {
        first = false;
        if (worker === w) {
          worker = null;
          loaded = null;
          w.destroy();
        }
        throw e;
      }
    );
    return loaded;
  }

  /** A new channel between the wallet window and the worker; each end gets one port. */
  function connect(wallet: WebContents): void {
    if (!worker || worker.isDestroyed()) throw new Error('The live payments worker is not running');
    const { port1, port2 } = new deps.MessageChannelMain();
    worker.webContents.postMessage('live-worker:port', null, [port2]);
    wallet.postMessage('live-worker:port', null, [port1]);
  }

  const fromWallet = (event: IpcMainInvokeEvent) => {
    const wallet = deps.walletContents();
    if (!wallet || event.sender !== wallet) throw new Error('Only the wallet window may use the live payments worker');
    return wallet;
  };

  deps.ipcMain.handle('live-worker:open', async event => {
    const wallet = fromWallet(event);
    await start();
    connect(wallet);
  });

  deps.ipcMain.handle('live-worker:close', event => {
    fromWallet(event);
    const w = worker;
    worker = null;
    loaded = null;
    if (w && !w.isDestroyed()) w.destroy();
  });

  return {
    setShareLocalAddress(share: unknown) {
      if (typeof share !== 'boolean') return;
      shareLocalAddress = share;
      if (worker && !worker.isDestroyed()) shareLocalAddressWithWebRtc(worker.webContents, share);
    },
    destroy() {
      const w = worker;
      worker = null;
      loaded = null;
      if (w && !w.isDestroyed()) w.destroy();
    }
  };
}
