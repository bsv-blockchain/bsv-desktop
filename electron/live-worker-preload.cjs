// Preload of the live payments worker window (electron/liveWorker.ts), which is sandboxed:
// CommonJS, and only `electron` may be required. It does one thing: hand the port from the
// main process to the page. Nothing is exposed to the page.
'use strict';
const { ipcRenderer } = require('electron');

ipcRenderer.on('live-worker:port', (event) => {
  if (event.ports.length === 1) window.postMessage('bsv-desktop:live-worker-port', '*', [event.ports[0]]);
});
