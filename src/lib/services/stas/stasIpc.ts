/**
 * Shared helper for the `stas:query` IPC channel.
 *
 * Returns `undefined` when the channel is not present (non-Electron
 * environments such as Vitest); throws on a query error reported by the main
 * process. Callers handle the `undefined` case explicitly when they need
 * defensive behaviour (e.g. high-water mark falls back to 0 in tests).
 */
export async function stasQuery(
  identityKey: string,
  chain: 'main' | 'test',
  method: string,
  args: any[]
): Promise<any> {
  const api =
    typeof window !== 'undefined' ? (window as any).electronAPI?.stas : undefined;
  if (!api) return undefined;
  const res = await api.query(identityKey, chain, method, args);
  if (!res || !res.success) {
    throw new Error(`stas:query ${method} failed: ${res && res.error}`);
  }
  return res.result;
}
