// Smoke test of the live payments worker in real Electron (electron/liveWorker.ts):
// npm run build, then:
//   APP_DIST_ELECTRON=$PWD/dist-electron node_modules/.bin/electron scripts/smoke-live-worker.mjs
// It opens the worker, checks it is sandboxed with no Node and no network of its own, that
// host candidates are mDNS names with "same network" off and addresses with it on, and
// that a crash is reported to the wallet window. It prints [smoke] lines and quits.
import { app, BrowserWindow, MessageChannelMain, session } from 'electron'
import path from 'path'
const dir = process.env.APP_DIST_ELECTRON
const { registerLiveWorker } = await import(path.join(dir, 'liveWorker.js'))
const handlers = {}
let port
const wallet = { postMessage: (_c, _m, ports) => { port = ports[0] }, send: c => console.log('wallet got', c) }
const out = (...a) => console.log('[smoke]', ...a)
app.whenReady().then(async () => {
  const ctl = registerLiveWorker({ BrowserWindow, MessageChannelMain, ipcMain: { handle: (c, fn) => { handlers[c] = fn } }, fromPartition: p => session.fromPartition(p), walletContents: () => wallet, isDev: false, dir })
  ctl.setShareLocalAddress(false)
  await handlers['live-worker:open']({ sender: wallet })
  const pending = new Map(); let id = 1
  port.on('message', e => { const m = e.data; if (m.t === 'res') { pending.get(m.id)?.(m); pending.delete(m.id) } else out('worker asked', m.op, JSON.stringify(m).slice(0, 120)) })
  port.start()
  const req = (op, f) => new Promise(r => { const i = id++; pending.set(i, r); port.postMessage({ ...f, t: 'req', id: i, op }) })
  out('create ->', JSON.stringify(await req('create', { cid: 1, spec: { signaler: false, iceServers: [], iceProvider: false, maxMessageBytes: 1337432, limits: { maxMessageBytes: 1337432 } } })))
  out('startReceiving (no signaler) ->', JSON.stringify(await req('startReceiving', { cid: 1 })))
  out('unknown op ->', JSON.stringify(await req('readSecrets', {})))
  const w = BrowserWindow.getAllWindows()[0]
  out('worker sandboxed:', w.webContents.getLastWebPreferences().sandbox, 'node in page:', await w.webContents.executeJavaScript('typeof require + "/" + typeof process'))
  out('fetch from worker:', await w.webContents.executeJavaScript('fetch("https://example.com").then(() => "allowed", e => "blocked: " + e.message)'))
  const gather = `(async () => { const pc = new RTCPeerConnection({ iceServers: [] }); pc.createDataChannel('x'); await pc.setLocalDescription(); await new Promise(r => setTimeout(r, 1500)); const c = pc.localDescription.sdp.split('\\n').filter(l => l.startsWith('a=candidate')).map(l => l.split(' ')[4]); pc.close(); return c.join(', ') })()`
  out('host candidates (same network off):', await w.webContents.executeJavaScript(gather))
  ctl.setShareLocalAddress(true)
  out('host candidates (same network on):', (await w.webContents.executeJavaScript(gather)).replace(/\d+\.\d+\.\d+\.\d+/g, '<ipv4>').replace(/[0-9a-f]{1,4}(:[0-9a-f]{0,4}){2,7}/gi, '<ipv6>'))
  w.webContents.forcefullyCrashRenderer()
  await new Promise(r => setTimeout(r, 1000))
  ctl.destroy()
  app.quit()
})
