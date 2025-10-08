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

let requestIdCounter = 1;
const pendingRequests = new Map<number, (response: HttpResponseEvent) => void>();

export async function startHttpServer(mainWindow: BrowserWindow): Promise<() => Promise<void>> {
  const app = express();

  // Enable CORS with all permissive settings
  app.use(cors({
    origin: '*',
    methods: '*',
    allowedHeaders: '*',
    exposedHeaders: '*',
    credentials: false
  }));

  // Parse JSON bodies
  app.use(express.json({ limit: '50mb' }));
  app.use(express.text({ type: '*/*', limit: '50mb' }));

  // Handle OPTIONS for all routes
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
      const resolver = pendingRequests.get(typedResponse.request_id);
      if (resolver) {
        resolver(typedResponse);
        pendingRequests.delete(typedResponse.request_id);
      }
    }
  });

  // Handle all HTTP requests
  app.all('*', async (req: Request, res: Response) => {
    try {
      const request_id = requestIdCounter++;

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

      const requestEvent: HttpRequestEvent = {
        method: req.method,
        path: req.path,
        headers,
        body,
        request_id
      };

      // Send request to renderer and wait for response
      const responsePromise = new Promise<HttpResponseEvent>((resolve, reject) => {
        pendingRequests.set(request_id, resolve);

        // Timeout after 30 seconds
        setTimeout(() => {
          if (pendingRequests.has(request_id)) {
            pendingRequests.delete(request_id);
            reject(new Error('Request timeout'));
          }
        }, 30000);
      });

      // Send to renderer
      mainWindow.webContents.send('http-request', requestEvent);

      // Wait for response
      const httpResponse = await responsePromise;

      // Send response back to HTTP client
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Headers', '*');
      res.header('Access-Control-Allow-Methods', '*');
      res.header('Access-Control-Expose-Headers', '*');
      res.header('Access-Control-Allow-Private-Network', 'true');
      res.status(httpResponse.status).send(httpResponse.body);
    } catch (error) {
      console.error('Error handling HTTP request:', error);
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Headers', '*');
      res.header('Access-Control-Allow-Methods', '*');
      res.header('Access-Control-Expose-Headers', '*');
      res.header('Access-Control-Allow-Private-Network', 'true');
      res.status(500).send(JSON.stringify({ error: String(error) }));
    }
  });

  // Generate self-signed certificate
  const { cert, key, certPath } = await generateSelfSignedCert();

  // Prompt user to trust certificate if needed
  await ensureCertTrusted(certPath);

  // Start HTTPS server
  const server: Server = await new Promise((resolve, reject) => {
    const srv = https.createServer({ cert, key }, app);

    srv.listen(2121, '127.0.0.1', () => {
      console.log('HTTPS server listening on https://127.0.0.1:2121');
      resolve(srv);
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
    return new Promise<void>((resolve) => {
      server.close(() => {
        console.log('HTTPS server closed');
        resolve();
      });
    });
  };
}
