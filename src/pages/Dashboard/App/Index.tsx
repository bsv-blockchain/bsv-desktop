/* ------------------------------------------------------------------
 * Apps.tsx — clean, performant version
 * ------------------------------------------------------------------ */

import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Grid,
  Typography,
  IconButton,
} from '@mui/material'
import CheckIcon from '@mui/icons-material/Check'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import { useLocation } from 'react-router-dom'
import { History } from 'history'

import { WalletContext } from '../../../WalletContext'
import { WalletAction } from '@bsv/sdk'
import { DEFAULT_APP_ICON } from '../../../constants/popularApps'
import PageHeader from '../../../components/PageHeader'
import RecentActions from '../../../components/RecentActions'
import AccessAtAGlance from '../../../components/AccessAtAGlance'
import fetchAndCacheAppData from '../../../utils/fetchAndCacheAppData'

/* ------------------------------------------------------------------
 *  Constants & helpers
 * ------------------------------------------------------------------ */

const LIMIT = 10
const CACHE_CAPACITY = 25 // max # of apps kept in RAM

/** Simple LRU cache for per-app pages */
class LruCache<K, V> {
  private map = new Map<K, V>()

  constructor(private capacity = 50) { }

  get(key: K): V | undefined {
    const item = this.map.get(key)
    if (!item) return undefined
    // bump to most-recent
    this.map.delete(key)
    this.map.set(key, item)
    return item
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key)
    this.map.set(key, value)
    if (this.map.size > this.capacity) {
      // delete least-recent
      const first = this.map.keys().next().value
      this.map.delete(first)
    }
  }
}
const APP_PAGE_CACHE = new LruCache<
  string,
  { actions: TransformedWalletAction[]; totalActions: number }
>(CACHE_CAPACITY)

/** Transform raw actions for UI */
interface TransformedWalletAction extends WalletAction {
  amount: number
  fees?: number
}
const transformActions = (actions: WalletAction[]): TransformedWalletAction[] =>
  actions.map(a => {
    const inputSum = (a.inputs ?? []).reduce(
      (s, i) => s + Number(i.sourceSatoshis),
      0,
    )
    const outputSum = (a.outputs ?? []).reduce(
      (s, o) => s + Number(o.satoshis),
      0,
    )

    return {
      ...a,
      amount: a.satoshis,
      fees: inputSum - outputSum || undefined,
    }
  })

/* ------------------------------------------------------------------
 *  Router state
 * ------------------------------------------------------------------ */
interface LocationState {
  domain?: string
  appName?: string
  iconImageUrl?: string
}

interface AppsProps {
  history?: History
}

/* ------------------------------------------------------------------
 *  Component
 * ------------------------------------------------------------------ */
const App: React.FC<AppsProps> = ({ history }) => {
  /* ---------- Router & persisted params -------------------------- */
  const { state } = useLocation<LocationState>()
  const initialDomain =
    state?.domain || sessionStorage.getItem('lastAppDomain') || 'unknown.com'
  const initialName =
    state?.appName || sessionStorage.getItem('lastAppName') || initialDomain
  const initialIcon =
    state?.iconImageUrl ||
    sessionStorage.getItem('lastAppIcon') ||
    DEFAULT_APP_ICON

  /* ---------- Context ------------------------------------------- */
  const { managers, adminOriginator } = useContext(WalletContext)
  const permissionsManager = managers?.permissionsManager

  /* ---------- Local state --------------------------------------- */
  const [appDomain, setAppDomain] = useState(initialDomain)
  const [appName, setAppName] = useState(initialName)
  const [appIcon, setAppIcon] = useState(initialIcon)

  const [appActions, setAppActions] = useState<TransformedWalletAction[]>(
    () => APP_PAGE_CACHE.get(initialDomain)?.actions || [],
  )
  const [totalActions, setTotalActions] = useState(
    () => APP_PAGE_CACHE.get(initialDomain)?.totalActions || 0,
  )
  const [page, setPage] = useState(0)
  const [isFetching, setIsFetching] = useState(false)
  const [allActionsShown, setAllActionsShown] = useState(false)
  const [copied, setCopied] = useState(false)

  /* ---------- Refs to avoid stale closures ---------------------- */
  const abortRef = useRef<AbortController | null>(null)

  /* ---------- Derived values ------------------------------------ */
  const url = useMemo(
    () => (appDomain.startsWith('http') ? appDomain : `https://${appDomain}`),
    [appDomain],
  )

  const cacheKey = useMemo(() => `transactions_${appDomain}`, [appDomain])

  /* ---------- Cache hydration (localStorage) -------------------- */
  useEffect(() => {
    const cached = localStorage.getItem(cacheKey)
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as {
          totalTransactions: number
          transactions: WalletAction[]
        }
        setTotalActions(parsed.totalTransactions)
        setAppActions(transformActions(parsed.transactions))
        setAllActionsShown(parsed.transactions.length >= parsed.totalTransactions)
      } catch (err) {
        console.error('Local cache parse error', err)
      }
    }
  }, [cacheKey])

  /* ---------- Persist router state ------------------------------ */
  useEffect(() => {
    sessionStorage.setItem('lastAppDomain', appDomain)
    sessionStorage.setItem('lastAppName', appName)
    sessionStorage.setItem('lastAppIcon', appIcon)
  }, [appDomain, appName, appIcon])

  /* ---------- Clipboard helper ---------------------------------- */
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
    } finally {
      setTimeout(() => setCopied(false), 2_000)
    }
  }

  /* ---------- Core: fetch a page of actions --------------------- */
  const fetchPage = useCallback(
    async (pageToLoad = 0) => {
      if (!permissionsManager || !adminOriginator) return
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      setIsFetching(true)

      try {
        /* Fetch page in ascending order; backend returns totalActions */
        const { actions, totalActions: total } =
          await permissionsManager.listActions(
            {
              labels: [`admin originator ${appDomain}`],
              labelQueryMode: 'any',
              includeLabels: true,
              includeInputs: true,
              includeOutputs: true,
              limit: LIMIT,
              offset: pageToLoad * LIMIT,
            },
            adminOriginator
          )

        const transformed = transformActions(actions)

        setTotalActions(total)
        setAllActionsShown((pageToLoad + 1) * LIMIT >= total)
        setAppActions(prev =>
          pageToLoad === 0 ? transformed : [...prev, ...transformed],
        )

        /* Cache only first page in localStorage */
        if (pageToLoad === 0) {
          localStorage.setItem(
            cacheKey,
            JSON.stringify({
              totalTransactions: total,
              transactions: actions,
            }),
          )
        }

        /* In-memory cache */
        APP_PAGE_CACHE.set(appDomain, {
          actions:
            pageToLoad === 0
              ? transformed
              : [...APP_PAGE_CACHE.get(appDomain)?.actions ?? [], ...transformed],
          totalActions: total,
        })
      } catch (err) {
        if ((err as Error).name !== 'AbortError')
          console.error('listActions error', err)
      } finally {
        setIsFetching(false)
      }
    },
    [appDomain, adminOriginator, cacheKey, permissionsManager],
  )

  /* ---------- Initial load & page changes ----------------------- */
  useEffect(() => {
    /* If we already have cached data for this page, skip fetch */
    const cachedPageCount =
      Math.ceil(APP_PAGE_CACHE.get(appDomain)?.actions.length ?? 0 / LIMIT) - 1
    if (page > cachedPageCount) fetchPage(page)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, appDomain]) // fetchPage excluded on purpose

  /* ---------- Handle domain change via router ------------------- */
  useEffect(() => {
    if (state?.domain && state.domain !== appDomain) {
      setAppDomain(state.domain)
      setAppName(state.appName || state.domain)
      setAppIcon(state.iconImageUrl || DEFAULT_APP_ICON)
      setPage(0)
      setAppActions([])
      setAllActionsShown(false)
    }
  }, [state, appDomain])

  /* ---------- Load lightweight app metadata --------------------- */
  useEffect(() => {
    if (!state?.appName || !state?.iconImageUrl) {
      fetchAndCacheAppData(appDomain, setAppIcon, setAppName, DEFAULT_APP_ICON)
    }
  }, [appDomain, state])

  /* ---------- Cleanup pending requests on unmount --------------- */
  useEffect(
    () => () => {
      abortRef.current?.abort()
    },
    [],
  )

  /* ---------- UI props ------------------------------------------ */
  const recentActionProps = {
    loading: isFetching,
    appActions,
    displayLimit: LIMIT,
    setDisplayLimit: () => { },
    setRefresh: () => {
      if (isFetching || allActionsShown) return;
      const next = page + 1;
      setPage(next);
      fetchPage(next);
    },
    allActionsShown,
  }

  /* ---------- Render -------------------------------------------- */
  return (
    <Grid container direction="column" spacing={3} sx={{ maxWidth: '100%' }}>
      {/* Header */}
      <Grid item xs={12}>
        <PageHeader
          history={history}
          title={appName}
          subheading={
            <Typography variant="caption" color="textSecondary">
              {url}
              <IconButton size="small" onClick={handleCopy} disabled={copied}>
                {copied ? (
                  <CheckIcon fontSize="small" />
                ) : (
                  <ContentCopyIcon fontSize="small" />
                )}
              </IconButton>
            </Typography>
          }
          icon={appIcon}
          buttonTitle="Launch"
          buttonIcon={<OpenInNewIcon />}
          onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
        />
      </Grid>

      {/* Body */}
      <Grid item xs={12}>
        <Grid container spacing={3}>
          {/* Recent actions */}
          <Grid item lg={6} md={6} xs={12}>
            <RecentActions {...recentActionProps} />
          </Grid>

          {/* Access at a Glance */}
          <Grid item lg={6} md={6} xs={12}>
            <AccessAtAGlance
              originator={appDomain}
              loading={isFetching}
              setRefresh={() => fetchPage(0)}
              history={history}
            />
          </Grid>
        </Grid>
      </Grid>
    </Grid>
  )
}

export default App
