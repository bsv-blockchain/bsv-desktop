/** A protocol entry from a counterparty request, in either shape the wallet sends. */
export type CounterpartyProtocolEntry = {
  protocolName?: string
  protocolID?: [number, string] | (number | string)[]
  description?: string
}

/**
 * Pact requests (from an app manifest's counterpartyPermissions) name protocols by
 * `protocolName` and are always security level 2. Peer-grouped requests carry a
 * full `protocolID`. Entries with neither are dropped rather than shown as blank.
 */
export function displayProtocols(entries: CounterpartyProtocolEntry[] | undefined): Array<{ securityLevel: number; protocolName: string }> {
  return (entries || []).flatMap(entry => {
    const [level, name] = Array.isArray(entry?.protocolID) ? entry.protocolID : []
    const protocolName = typeof name === 'string' && name ? name : entry?.protocolName
    if (typeof protocolName !== 'string' || !protocolName) return []
    return [{ securityLevel: typeof level === 'number' ? level : 2, protocolName }]
  })
}
