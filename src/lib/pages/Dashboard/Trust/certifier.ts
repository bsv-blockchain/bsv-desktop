import type { Certifier } from '@bsv/wallet-toolbox-client'

/** Build a trusted certifier from the Add Provider form (BRC-68 manifest or manual entry). */
export function buildTrustedCertifier({ name, description, icon, identityKey }: {
  name: string
  description: string
  icon: string
  identityKey: string
}): Certifier {
  // Typed (not cast) so a field-name drift against Certifier fails to compile.
  return { name, description, iconUrl: icon, identityKey, trust: 5 }
}

/**
 * Entries added before the iconUrl fix were saved with a non-standard `icon`
 * field, so fall back to it to keep their icon rendering.
 */
export function certifierIconUrl(entity: Certifier & { icon?: string }): string | undefined {
  return entity.iconUrl || entity.icon
}
