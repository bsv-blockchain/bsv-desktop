interface FetchManifestParams {
  domain: string
}

/**
 * Fetches and returns the contents of `/manifest.json` for a given domain.
 *
 * - Strips **all** protocol prefixes from the supplied domain.
 * - Forces `http` for `localhost`, defaults to `https` otherwise.
 * - Uses an `AbortController` to aggressively timeout stalled requests so that
 *   sites *without* a manifest don’t block the caller.
 * - Always resolves to an **object** – falling back to an empty object `{}`
 *   on any kind of failure (network error, non‑2xx status, invalid JSON, etc.).
 *
 * @param {FetchManifestParams} params – `{ domain }` to query
 * @param {number} [timeout=1500] – hard timeout in **milliseconds** before aborting
 */
export default async function fetchManifest(
  { domain }: FetchManifestParams,
  timeout = 800,
): Promise<Record<string, unknown>> {
  // 1. Normalise domain & choose protocol
  const cleanDomain = domain.replace(/^(https?:\/\/)+/i, '')
  const protocol = cleanDomain.startsWith('localhost:') ? 'http' : 'https'
  const url = `${protocol}://${cleanDomain}/manifest.json`

  // 2. Setup AbortController for a hard timeout
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)

  try {
    const res = await fetch(url, { signal: controller.signal })

    // Clear the timeout as soon as we get a response
    clearTimeout(timer)

    if (!res.ok) return {}

    // `res.json()` throws on invalid JSON – we use that to fall back safely
    return (await res.json()) as Record<string, unknown>
  } catch (_) {
    // Any error (network, timeout, bad JSON, etc.) results in a safe fallback
    return {}
  }
}
