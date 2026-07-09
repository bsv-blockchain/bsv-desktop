import express, { Request, Response } from 'express';
import cors from 'cors';
import { BrowserWindow } from 'electron';
import { Server } from 'https';
import https from 'https';
import { generateSelfSignedCert, ensureCertTrusted } from './sslCert.js';

interface HttpRequestEvent {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
  request_id: number;
}

interface HttpResponseEvent {
  request_id: number;
  status: number;
  body: string;
}

interface PendingRequest {
  resolve: (response: HttpResponseEvent) => void;
  reject: (error: Error) => void;
}

let requestIdCounter = 1;
const pendingRequests = new Map<number, PendingRequest>();

function failAllPendingRequests(reason: string): void {
  if (pendingRequests.size === 0) return;
  console.error(`[HTTP] failing ${pendingRequests.size} pending request(s): ${reason}`);
  const error = new Error(reason);
  for (const pending of pendingRequests.values()) {
    pending.reject(error);
  }
  pendingRequests.clear();
}

function setCorsHeaders(res: Response): void {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');
  res.header('Access-Control-Allow-Methods', '*');
  res.header('Access-Control-Expose-Headers', '*');
  res.header('Access-Control-Allow-Private-Network', 'true');
}

function canWriteResponse(res: Response): boolean {
  return !res.writableEnded && !res.destroyed && res.writable;
}

export async function startHttpServer(mainWindow: BrowserWindow): Promise<() => Promise<void>> {
  const app = express();

  // Private Network Access header on ALL responses (must be before cors middleware)
  app.use((_req: Request, res: Response, next) => {
    res.header('Access-Control-Allow-Private-Network', 'true');
    next();
  });

  // Enable CORS with all permissive settings
  app.use(cors({
    origin: '*',
    methods: '*',
    allowedHeaders: '*',
    exposedHeaders: '*',
    credentials: false,
    preflightContinue: true
  }));

  // Parse JSON bodies
  app.use(express.json({ limit: '50mb' }));
  app.use(express.text({ type: '*/*', limit: '50mb' }));

  // Handle OPTIONS for all routes (runs after cors middleware with preflightContinue)
  app.options('*', (_req: Request, res: Response) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', '*');
    res.header('Access-Control-Allow-Methods', '*');
    res.header('Access-Control-Expose-Headers', '*');
    res.header('Access-Control-Allow-Private-Network', 'true');
    res.sendStatus(200);
  });

  // Serve manifest.json
  app.get('/manifest.json', (_req: Request, res: Response) => {
    const manifest = {
      "short_name": "BSV Desktop",
      "name": "BSV Desktop",
      "icons": [
        {
          "src": "favicon.ico",
          "sizes": "64x64 32x32 24x24 16x16",
          "type": "image/x-icon"
        }
      ],
      "start_url": ".",
      "display": "standalone",
      "theme_color": "#000000",
      "background_color": "#ffffff",
      "babbage": {
        "trust": {
          "name": "BSV Desktop",
          "note": "Allows basic payments between counterparties",
          "icon": "https://localhost:2121/favicon.ico",
          "publicKey": "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
        }
      }
    };
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Content-Type', 'application/json');
    res.json(manifest);
  });

  // Listen for responses from renderer
  mainWindow.webContents.on('ipc-message', (_event, channel, response) => {
    if (channel === 'http-response') {
      const typedResponse = response as HttpResponseEvent;
      const pending = pendingRequests.get(typedResponse.request_id);
      if (pending) {
        pending.resolve(typedResponse);
        pendingRequests.delete(typedResponse.request_id);
      }
    }
  });

  // Fail in-flight bridge waits when the renderer can no longer answer.
  // Permission prompts may wait indefinitely while healthy; dead sessions must not.
  const onRendererUnavailable = (reason: string) => {
    failAllPendingRequests(`WALLET_BRIDGE_UNAVAILABLE: ${reason}`);
  };

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    onRendererUnavailable(`renderer process gone (${details.reason})`);
  });

  // Full reloads drop in-flight IPC handlers; settle waits rather than hang forever.
  mainWindow.webContents.on('did-start-loading', () => {
    onRendererUnavailable('renderer reloading');
  });

  mainWindow.webContents.on('destroyed', () => {
    onRendererUnavailable('webContents destroyed');
  });

  mainWindow.on('closed', () => {
    onRendererUnavailable('window closed');
  });

  // Handle all HTTP requests
  app.all('*', async (req: Request, res: Response) => {
    const request_id = requestIdCounter++;
    try {
      console.log(`[HTTP] ${req.method} ${req.path} → renderer (request_id: ${request_id})`);

      // Convert headers to simple object
      const headers: Record<string, string> = {};
      Object.entries(req.headers).forEach(([key, value]) => {
        if (typeof value === 'string') {
          headers[key] = value;
        } else if (Array.isArray(value)) {
          headers[key] = value[0];
        }
      });

      // Get body as string
      let body = '';
      if (typeof req.body === 'string') {
        body = req.body;
      } else if (req.body) {
        body = JSON.stringify(req.body);
      }

      if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
        throw new Error('WALLET_BRIDGE_UNAVAILABLE: window is not available');
      }

      const requestEvent: HttpRequestEvent = {
        method: req.method,
        path: req.path,
        headers,
        body,
        request_id
      };

      // Wait until the renderer answers, the HTTP client disconnects, or the bridge dies.
      // No short timeout: a visible permission prompt is a legitimate pending state.
      const responsePromise = new Promise<HttpResponseEvent>((resolve, reject) => {
        pendingRequests.set(request_id, { resolve, reject });

        // req "close" also fires after a normal completed response — only treat as
        // abandon when we never finished writing and the entry is still pending.
        const onClientGone = () => {
          if (!pendingRequests.has(request_id)) return;
          if (res.writableEnded) return;
          console.warn(`[HTTP] client disconnected (request_id: ${request_id})`);
          pendingRequests.delete(request_id);
          reject(new Error('CLIENT_DISCONNECTED: HTTP client closed the connection'));
        };
        req.on('close', onClientGone);
      });

      // Send to renderer
      mainWindow.webContents.send('http-request', requestEvent);

      // Wait for response
      const httpResponse = await responsePromise;

      if (!canWriteResponse(res)) {
        console.warn(`[HTTP] dropping response — client already gone (request_id: ${request_id})`);
        return;
      }

      // Send response back to HTTP client
      setCorsHeaders(res);
      res.status(httpResponse.status).send(httpResponse.body);
    } catch (error) {
      console.error('Error handling HTTP request:', error);
      // Client already left (or response already finished) — nothing useful to write.
      if (!canWriteResponse(res)) {
        return;
      }
      setCorsHeaders(res);
      const message = error instanceof Error ? error.message : String(error);
      const isBridgeUnavailable = message.includes('WALLET_BRIDGE_UNAVAILABLE');
      const isClientDisconnected = message.includes('CLIENT_DISCONNECTED');
      if (isClientDisconnected) {
        // Connection is gone; avoid racing a write. canWriteResponse should usually
        // have short-circuited, but keep this path defensive.
        return;
      }
      res.status(isBridgeUnavailable ? 503 : 500).send(JSON.stringify({
        status: 'error',
        code: isBridgeUnavailable ? 'WALLET_BRIDGE_UNAVAILABLE' : 'HTTP_BRIDGE_ERROR',
        description: message,
      }));
    }
  });

  // Generate self-signed certificate
  const { cert, key, certPath } = await generateSelfSignedCert();

  // Prompt user to trust certificate if needed
  await ensureCertTrusted(certPath);

  // Start HTTPS server (2121) + HTTP fallback (3321)
  const server: Server = await new Promise((resolve, reject) => {
    const srv = https.createServer({ cert, key }, app);

    srv.listen(2121, '127.0.0.1', () => {
      console.log('HTTPS server listening on https://127.0.0.1:2121');
      app.listen(3321, '127.0.0.1', () => {
        console.log('HTTP server listening on http://127.0.0.1:3321');
        resolve(srv);
      });
    });

    srv.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        console.error('Port 2121 is already in use!');
        process.exit(1);
      }
      reject(error);
    });
  });

  // Return cleanup function
  return async () => {
    failAllPendingRequests('WALLET_BRIDGE_UNAVAILABLE: HTTP server shutting down');
    return new Promise<void>((resolve) => {
      server.close(() => {
        console.log('HTTPS server closed');
        resolve();
      });
    });
  };
}
