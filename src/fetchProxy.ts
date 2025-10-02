// Proxy fetch for manifest.json files through Electron backend
// This is needed because browsers have CORS restrictions

if (typeof window !== 'undefined') {
  const g = window as unknown as { __manifestProxyPatched?: boolean };
  if (!g.__manifestProxyPatched) {
    g.__manifestProxyPatched = true;

    const originalFetch = window.fetch.bind(window);

    function isHttpsManifest(urlStr: string): boolean {
      try {
        const url = new URL(urlStr);
        if (url.protocol !== 'https:') return false;
        const pathname = url.pathname.toLowerCase();
        return pathname.endsWith('/manifest.json') || pathname === '/manifest.json';
      } catch {
        return false;
      }
    }

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : (input instanceof URL ? input.toString() : input.url);

      if (isHttpsManifest(url)) {
        try {
          const result = await window.electronAPI.proxyFetchManifest(url);
          const headers = new Headers(result.headers);
          return new Response(result.body, { status: result.status, headers });
        } catch (e) {
          // Fall back to original fetch if the proxy fails
          console.warn('proxy_fetch_manifest failed, falling back to original fetch:', e);
          return originalFetch(input as any, init as any);
        }
      }

      return originalFetch(input as any, init as any);
    };
  }
}
