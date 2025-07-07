import { useState, useEffect, useCallback, useRef } from 'react'
import OptimizedAppDataFetcher, { OptimizedAppData } from '../utils/optimizedAppDataFetcher'
import getAppsOptimized from '../pages/Dashboard/Apps/getAppsOptimized'
import { WalletInterface } from '@bsv/sdk'

interface UseOptimizedAppsParams {
  permissionsManager?: WalletInterface
  adminOriginator: string
  pinnedApps: Set<string>
}

interface UseOptimizedAppsReturn {
  apps: OptimizedAppData[]
  loading: boolean
  error: string | null
  refreshApps: () => Promise<void>
  progress: number
}

// Helper function to format domain names consistently
function formatDomain(domain: string): string {
  let formatted = domain
  if (domain.startsWith('https://')) {
    formatted = domain.substring(8)
  }
  if (domain.startsWith('http://')) {
    formatted = domain.substring(7)
  }
  return formatted
}

export const useOptimizedApps = ({
  permissionsManager,
  adminOriginator,
  pinnedApps
}: UseOptimizedAppsParams): UseOptimizedAppsReturn => {
  const [apps, setApps] = useState<OptimizedAppData[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)

  const fetcherRef = useRef<OptimizedAppDataFetcher>()
  const abortControllerRef = useRef<AbortController>()

  // Initialize fetcher
  useEffect(() => {
    if (!fetcherRef.current) {
      fetcherRef.current = new OptimizedAppDataFetcher()
    }
  }, [])

  const loadApps = useCallback(async () => {
    if (!permissionsManager || !fetcherRef.current) {
      return
    }

    // Cancel any ongoing fetch
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    abortControllerRef.current = new AbortController()

    setError(null)
    setProgress(0)

    // Check if we have cached apps to show immediately
    const fetcher = fetcherRef.current
    const cachedApps = fetcher.getCachedApps()

    if (cachedApps.length > 0) {
      // Apply pinning status to cached apps
      const appsWithPinning = cachedApps.map(app => ({
        ...app,
        isPinned: pinnedApps.has(app.domain)
      }))
      setApps(appsWithPinning)
    } else {
      setLoading(true)
    }

    try {
      // Step 1: Get domain list
      const domains = await getAppsOptimized({
        permissionsManager,
        adminOriginator
      })

      if (abortControllerRef.current.signal.aborted) return

      if (domains.length === 0) {
        setApps([])
        setLoading(false)
        return
      }

      // Step 2: Create initial apps from domains (immediate display)
      const initialApps: OptimizedAppData[] = domains.map(domain => ({
        appName: formatDomain(domain),
        domain,
        isPinned: pinnedApps.has(domain)
      }))

      // Show initial apps immediately if we don't have cached data
      if (cachedApps.length === 0) {
        setApps(initialApps)
        setLoading(false)
      }

      // Step 3: Progressive enhancement with app data
      const totalApps = domains.length
      let processedCount = 0

      // Use the fetcher's batch processing
      for await (const batchApps of fetcher.getAppDataBatch(domains)) {
        if (abortControllerRef.current?.signal.aborted) return

        // Apply pinning status and update apps
        setApps(currentApps => {
          const updatedApps = [...currentApps]

          batchApps.forEach(batchApp => {
            const appIndex = updatedApps.findIndex(app => app.domain === batchApp.domain)
            if (appIndex !== -1) {
              updatedApps[appIndex] = {
                ...batchApp,
                isPinned: pinnedApps.has(batchApp.domain)
              }
            }
          })

          // Sort: pinned first, then alphabetically
          return updatedApps.sort((a, b) => {
            if (a.isPinned && !b.isPinned) return -1
            if (!a.isPinned && b.isPinned) return 1
            return a.appName.localeCompare(b.appName)
          })
        })

        processedCount += batchApps.length
        setProgress((processedCount / totalApps) * 100)
      }

      setProgress(100)
    } catch (err) {
      if (!abortControllerRef.current?.signal.aborted) {
        setError(err instanceof Error ? err.message : 'Failed to load apps')
      }
    } finally {
      if (!abortControllerRef.current?.signal.aborted) {
        setLoading(false)
      }
    }
  }, [permissionsManager, adminOriginator, pinnedApps])

  const refreshApps = useCallback(async () => {
    if (fetcherRef.current) {
      fetcherRef.current.clearCache()
    }
    await loadApps()
  }, [loadApps])

  // Load apps when dependencies change
  useEffect(() => {
    loadApps()

    // Cleanup on unmount
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [loadApps])

  // Update pin status when pinnedApps changes
  useEffect(() => {
    setApps(prevApps => {
      const updatedApps = prevApps.map(app => ({
        ...app,
        isPinned: pinnedApps.has(app.domain)
      }))

      // Re-sort when pin status changes
      return updatedApps.sort((a, b) => {
        if (a.isPinned && !b.isPinned) return -1
        if (!a.isPinned && b.isPinned) return 1
        return a.appName.localeCompare(b.appName)
      })
    })
  }, [pinnedApps])

  return {
    apps,
    loading,
    error,
    refreshApps,
    progress
  }
}

export default useOptimizedApps
