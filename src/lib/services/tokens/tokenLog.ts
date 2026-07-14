/**
 * tokenLog — one switch for the token services' tracing output.
 *
 * The STAS/DSTAS/BSV-21 transfer paths were developed against a wall of
 * console output: derived pubkeys, script invariants, per-input/per-output tx
 * dumps, raw signAction results. That tracing is what makes an unlocking-script
 * mismatch findable, so it should stay in the tree — but a tester watching a
 * normal send should not have to tell it apart from an actual failure.
 *
 * So: `debug()` is off unless asked for; `info()` and `warn()` always speak.
 * Only outcomes go through the latter two.
 *
 * Turn tracing on with either:
 *   localStorage.setItem('tokenDebug', '1')   // then reload; per-machine, no rebuild
 *   VITE_TOKEN_DEBUG=1                        // build-time
 */

function tracingEnabled(): boolean {
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('tokenDebug') === '1') {
      return true;
    }
  } catch {
    /* localStorage unavailable (SSR / worker) — fall through to env */
  }
  try {
    return (import.meta as any)?.env?.VITE_TOKEN_DEBUG === '1';
  } catch {
    return false;
  }
}

export const tokenLog = {
  /** Development tracing. Silent unless tokenDebug is on. */
  debug: (...args: unknown[]): void => {
    if (tracingEnabled()) console.log(...args);
  },
  /** An outcome worth seeing on a normal run (e.g. a broadcast txid). */
  info: (...args: unknown[]): void => console.log(...args),
  /** Something actually went wrong, or degraded. Always shown. */
  warn: (...args: unknown[]): void => console.warn(...args),
};
