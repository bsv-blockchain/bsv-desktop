/** A protocol entry from a counterparty request, in either shape the wallet sends. */
export type CounterpartyProtocolEntry = {
  protocolName?: string
  protocolID?: [number, string] | (number | string)[]
  description?: string
}

export type DisplayProtocol = {
  securityLevel: number
  protocolName: string
  /** App-manifest reason, when the request carried a non-blank description. */
  description?: string
}

/**
 * Pact requests (from an app manifest's counterpartyPermissions) name protocols by
 * `protocolName` and are always security level 2. Peer-grouped requests carry a
 * full `protocolID`. Entries with neither are dropped rather than shown as blank.
 * A non-blank manifest `description` is kept so the prompt can show it; the
 * protocol registry description is resolved separately by ProtoChip.
 */
export function displayProtocols(entries: CounterpartyProtocolEntry[] | undefined): DisplayProtocol[] {
  return (entries || []).flatMap(entry => {
    const [level, name] = Array.isArray(entry?.protocolID) ? entry.protocolID : []
    const protocolName = typeof name === 'string' && name ? name : entry?.protocolName
    if (typeof protocolName !== 'string' || !protocolName) return []
    const description = typeof entry?.description === 'string' && entry.description.trim()
      ? entry.description
      : undefined
    return [{
      securityLevel: typeof level === 'number' ? level : 2,
      protocolName,
      ...(description ? { description } : {}),
    }]
  })
}
