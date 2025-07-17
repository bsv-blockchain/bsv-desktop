import { Base64String } from "@bsv/sdk";
import isImageUrl from "../../../utils/isImageUrl";
import parseAppManifest from "../../../utils/parseAppManifest";

const getRecentAppsStorageKey = (profileId?: string): string => {
  return profileId ? `brc100_recent_apps_${profileId}` : "brc100_recent_apps";
};

export interface RecentApp {
  name: string;
  iconImageUrl?: string;
  domain: string;
  timestamp: number;
  isPinned?: boolean;
}

interface RecentAppsStorage {
  apps: RecentApp[];
}

interface PaginationOptions {
  limit?: number;
  offset?: number;
  domainsOnly?: boolean;
}

/**
 * Get recently used apps from localStorage with optional pagination
 */
export function getRecentApps(profileId: Base64String): RecentApp[];
export function getRecentApps(
  profileId: Base64String,
  options?: { limit?: number; offset?: number }
): RecentApp[];
export function getRecentApps(
  profileId: Base64String,
  options?: { limit?: number; offset?: number; domainsOnly: true }
): string[];
export function getRecentApps(
  profileId: Base64String,
  options: PaginationOptions = {}
): RecentApp[] | string[] {
  if (typeof window === "undefined" || !window.localStorage) {
    return options.domainsOnly ? [] : [];
  }

  const storageData = window.localStorage.getItem(
    getRecentAppsStorageKey(profileId)
  );
  if (!storageData) {
    return options.domainsOnly ? [] : [];
  }

  let { apps } = JSON.parse(storageData) as RecentAppsStorage;
  if (!Array.isArray(apps)) {
    apps = [];
  }

  const { offset = 0, limit, domainsOnly } = options;
  const pagedApps =
    typeof limit === "number" ? apps.slice(offset, offset + limit) : apps.slice(offset);

  return domainsOnly ? pagedApps.map((a) => a.domain) : pagedApps;
}

/**
 * Fetch meta data for a single domain – name, favicon & fallback values
 */
const fetchAppData = async (domain: string): Promise<RecentApp> => {
  const formattedDomain = domain.replace(/^https?:\/\//, "");
  const result: RecentApp = {
    name: formattedDomain,
    iconImageUrl: "",
    domain: formattedDomain,
    timestamp: Date.now(),
    isPinned: false,
  };

  // Attempt favicon
  try {
    const possibleFavicon = `https://${formattedDomain}/favicon.ico`;
    if (await isImageUrl(possibleFavicon)) {
      result.iconImageUrl = possibleFavicon;
    }
  } catch {
    /* silently ignore */
  }

  // Attempt web‑app manifest
  try {
    const manifest = await parseAppManifest({ domain: formattedDomain });
    if (manifest?.name) {
      result.name = manifest.name as string;
    }
  } catch {
    /* silently ignore */
  }

  return result;
};

/**
 * Update or add an app to the recent apps list.
 *
 * **Overloads**
 * 1. `(profileId, RecentApp)` – behavior unchanged.
 * 2. `(profileId, domain)` – automatic meta-data lookup & storage.
 */
export async function updateRecentApp(profileId: string, app: RecentApp): Promise<RecentApp[]>;
export async function updateRecentApp(profileId: string, domain: string): Promise<RecentApp[]>;
export async function updateRecentApp(
  profileId: string,
  appOrDomain: RecentApp | string
): Promise<RecentApp[]> {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return [];
    }

    // Current cache
    const currentApps = getRecentApps(profileId) as RecentApp[];

    // Normalize domain for comparison purposes
    const rawDomain =
      typeof appOrDomain === "string"
        ? appOrDomain.replace(/^https?:\/\//, "")
        : appOrDomain.domain.replace(/^https?:\/\//, "");

    // Look for an existing cached entry
    const existing = currentApps.find((a) => a.domain === rawDomain);

    // Decide what to store
    let app: RecentApp;
    if (existing) {
      // Re‑use cached data but refresh timestamp and isPinned if available
      if (typeof appOrDomain === 'string') {
        app = { ...existing, timestamp: Date.now() };
      } else {
        app = { ...existing, timestamp: Date.now(), isPinned: appOrDomain.isPinned };
      }
    } else if (typeof appOrDomain === "string") {
      // Fetch fresh meta‑data
      app = await fetchAppData(rawDomain);
    } else {
      // Caller supplied a full object – ensure timestamp freshness
      app = { ...appOrDomain, timestamp: Date.now() };
    }

    // Remove any previous entry for that domain
    const filteredApps = currentApps.filter((a) => a.domain !== rawDomain);

    // Insert at the top
    const updatedApps = [app, ...filteredApps];

    // Persist
    window.localStorage.setItem(
      getRecentAppsStorageKey(profileId),
      JSON.stringify({ apps: updatedApps })
    );

    return updatedApps;
  } catch (error) {
    console.error("Error updating recent app in localStorage:", error);
    return [];
  }
}

/**
 * Utility to resolve an array of domains in parallel (kept for existing callers)
 */
export const resolveAppDataFromDomain = async ({
  appDomains,
}: {
  appDomains: string[];
}): Promise<RecentApp[]> => {
  const dataPromises = appDomains.map((domain) => fetchAppData(domain.replace(/^https?:\/\//, "")));
  return Promise.all(dataPromises);
};
