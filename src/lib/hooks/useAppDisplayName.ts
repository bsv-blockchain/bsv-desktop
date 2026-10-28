import { useEffect, useState } from 'react';
import fetchManifest from '../utils/parseAppManifest';

/**
 * Resolves an originator domain to the app's display name from its
 * manifest, using the same localStorage cache AppChip populates.
 * Returns null until (unless) a name is known.
 */
export default function useAppDisplayName(originator: string | undefined | null): string | null {
  const [resolved, setResolved] = useState<{ originator: string; name: string } | null>(null);

  useEffect(() => {
    setResolved(null);
    let cancelled = false;
    if (originator) {
      let cachedName: string | null = null;
      try {
        const cached = window.localStorage.getItem(`manifest_label_${originator}`);
        if (cached) {
          const name = JSON.parse(cached)?.name;
          if (typeof name === 'string' && name) cachedName = name;
        }
      } catch {
        /* fall through to fetch */
      }
      if (cachedName) {
        setResolved({ originator, name: cachedName });
      } else {
        fetchManifest({ domain: originator })
          .then((manifest) => {
            const name = (manifest as any)?.name;
            if (!cancelled && typeof name === 'string' && name) setResolved({ originator, name });
          })
          .catch(() => {});
      }
    }
    return () => {
      cancelled = true;
    };
  }, [originator]);

  return resolved && resolved.originator === originator ? resolved.name : null;
}
