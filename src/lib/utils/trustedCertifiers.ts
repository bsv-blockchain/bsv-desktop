import type { TrustManifestDetails } from './parseTrustManifest'

export interface TrustedCertifier {
  name: string
  description: string
  iconUrl?: string
  identityKey: string
  trust: number
}

const sameIdentity = (left: string, right: string): boolean => (
  left.toLowerCase() === right.toLowerCase()
)

export const trustedCertifierFromManifest = (
  details: TrustManifestDetails,
  trust = 5
): TrustedCertifier => ({
  name: details.name,
  description: details.note,
  iconUrl: details.icon,
  identityKey: details.publicKey.toLowerCase(),
  trust
})

export const addTrustedCertifier = <T extends TrustedCertifier>(
  entities: T[],
  entity: T
): { entities: T[], added: boolean } => {
  if (entities.some(current => sameIdentity(current.identityKey, entity.identityKey))) {
    return { entities, added: false }
  }

  return { entities: [entity, ...entities], added: true }
}

export const updateTrustedCertifier = <T extends TrustedCertifier>(
  entities: T[],
  identityKey: string,
  update: Partial<Pick<T, 'name' | 'description' | 'iconUrl' | 'trust'>>
): T[] => entities.map(entity => (
  sameIdentity(entity.identityKey, identityKey)
    ? { ...entity, ...update }
    : entity
))

export const removeTrustedCertifier = <T extends TrustedCertifier>(
  entities: T[],
  identityKey: string
): T[] => entities.filter(entity => !sameIdentity(entity.identityKey, identityKey))

export const assertMatchingTrustIdentity = (
  first: TrustManifestDetails,
  second: TrustManifestDetails
): void => {
  if (!sameIdentity(first.publicKey, second.publicKey)) {
    throw new Error('Trust manifests publish different identity keys')
  }
}
