/**
 * The Mandala overlay keys a host color module accepted, for the holder-send
 * linkage grant policy (D20).
 *
 * The policy must only ever match overlays the color module itself uses, so it
 * reads them from the module instance rather than from settings: a settings row
 * the module dropped (an off-curve key that passes the identity-key regex, a
 * bad url, a duplicate) gets no grant, and neither does any overlay while the
 * module refuses `p color` requests (remote active storage) or after it was
 * disposed. Lookups are live and never throw.
 *
 * No color-module imports: PermissionQueueManager reads this without loading
 * the module.
 */

const registry = new WeakMap<object, () => readonly string[]>()

/** Called by the host color module when it is built (and with `undefined` on dispose). */
export function setColorLinkageOverlayKeys (module: object, keys: (() => readonly string[]) | undefined): void {
  if (keys) registry.set(module, keys)
  else registry.delete(module)
}

/** The overlay keys `module` accepts right now; `[]` for anything else or on any fault. */
export function colorLinkageOverlayKeys (module: unknown): string[] {
  if (module === null || (typeof module !== 'object' && typeof module !== 'function')) return []
  const keys = registry.get(module as object)
  if (!keys) return []
  try {
    const out = keys()
    return Array.isArray(out) ? out.filter((k): k is string => typeof k === 'string') : []
  } catch {
    return []
  }
}
