/**
 * Environment variable that makes a copy run from source load the built renderer
 * (dist/index.html) instead of the Vite dev server on http://localhost:5173. It exists so a
 * second test wallet can run from a build (`npm run build` once) without a Vite server, and
 * never shows whatever else happens to listen on port 5173. Set it to `1`.
 */
export const LOAD_DIST_ENV = 'BSV_DESKTOP_LOAD_DIST';

/**
 * Whether this run is in development mode: the window loads the Vite dev server and opens
 * DevTools, and the dev-only switches apply. A packaged app is not, unless NODE_ENV is
 * `development`; a run from source is, unless BSV_DESKTOP_LOAD_DIST is `1` (or `true`),
 * which wins over NODE_ENV.
 */
export function isDevMode(
  isPackaged: boolean,
  env: Record<string, string | undefined> = process.env
): boolean {
  if (/^(1|true)$/i.test(env[LOAD_DIST_ENV]?.trim() ?? '')) return false;
  return env.NODE_ENV === 'development' || !isPackaged;
}
