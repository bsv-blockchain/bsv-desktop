import { useEffect, useState } from 'react';
import fetchManifest from '../utils/parseAppManifest';

type ManifestProtocolEntry = {
  protocolID?: unknown;
  protocolName?: unknown;
  description?: unknown;
};

const findDescription = (
  manifest: Record<string, unknown> | undefined,
  protocolName: string
): string | null => {
  const metanet = (manifest as any)?.metanet ?? (manifest as any)?.babbage;
  if (!metanet) return null;
  // Grouped grants carry descriptions; protocolDescriptions is a display-only
  // section for protocols an app uses ad hoc (individual prompts) without
  // requesting a grouped grant for them.
  const pools: ManifestProtocolEntry[][] = [
    metanet?.groupPermissions?.protocolPermissions,
    metanet?.protocolDescriptions,
    metanet?.counterpartyPermissions?.protocols,
  ].filter(Array.isArray);
  for (const pool of pools) {
    for (const entry of pool) {
      const name = Array.isArray(entry?.protocolID)
        ? entry.protocolID[1]
        : (entry?.protocolID ?? entry?.protocolName);
      if (name === protocolName && typeof entry?.description === 'string' && entry.description) {
        return entry.description;
      }
    }
  }
  return null;
};

const findBasketDescription = (
  manifest: Record<string, unknown> | undefined,
  basket: string
): string | null => {
  const metanet = (manifest as any)?.metanet ?? (manifest as any)?.babbage;
  if (!metanet) return null;
  const pools: Array<{ basket?: unknown; description?: unknown }>[] = [
    metanet?.groupPermissions?.basketAccess,
    metanet?.basketDescriptions,
  ].filter(Array.isArray);
  for (const pool of pools) {
    for (const entry of pool) {
      if (entry?.basket === basket && typeof entry?.description === 'string' && entry.description) {
        return entry.description;
      }
    }
  }
  return null;
};

const useManifestDescription = (
  originator: string | undefined | null,
  subject: string | undefined | null,
  finder: (manifest: Record<string, unknown> | undefined, subject: string) => string | null
): string | null => {
  const [resolved, setResolved] = useState<{
    originator: string;
    subject: string;
    description: string;
  } | null>(null);

  useEffect(() => {
    setResolved(null);
    if (!originator || !subject) return undefined;
    let cancelled = false;
    try {
      const cached = window.localStorage.getItem(`manifest_label_${originator}`);
      if (cached) {
        const fromCache = finder(JSON.parse(cached), subject);
        if (fromCache) setResolved({ originator, subject, description: fromCache });
      }
    } catch {
      /* cache miss is fine */
    }
    fetchManifest({ domain: originator })
      .then((manifest) => {
        if (cancelled) return;
        const fresh = finder(manifest, subject);
        if (fresh) setResolved({ originator, subject, description: fresh });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originator, subject]);

  return resolved && resolved.originator === originator && resolved.subject === subject
    ? resolved.description
    : null;
};

/**
 * Resolves a human description for a basket from the app's manifest
 * (groupPermissions.basketAccess or the display-only basketDescriptions
 * section), for individual prompts where the request carries none.
 */
export function useManifestBasketDescription(
  originator: string | undefined | null,
  basket: string | undefined | null
): string | null {
  return useManifestDescription(originator, basket, findBasketDescription);
}

/**
 * Resolves a human description for a protocol from the app's manifest, for
 * individual prompts where the request itself carries none. Reads the cached
 * manifest for an instant answer, then refreshes from the network.
 */
export default function useManifestProtocolDescription(
  originator: string | undefined | null,
  protocolName: string | undefined | null
): string | null {
  return useManifestDescription(originator, protocolName, findDescription);
}
