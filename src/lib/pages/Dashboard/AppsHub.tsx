import { useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { Alert, Box, Button, Chip, InputAdornment, Paper, Skeleton, Stack, Tab, Tabs, TextField, Typography } from '@mui/material'
import { AppsRounded, ArrowForwardRounded, OpenInNewRounded, SearchRounded, SettingsOutlined } from '@mui/icons-material'
import { AppCatalog as AppCatalogAPI } from 'metanet-apps'
import type { PublishedApp } from 'metanet-apps/src/types'
import { WalletContext } from '../../WalletContext'
import { openUrl } from '../../utils/openUrl'
import { applyAppIconFallback, FALLBACK_APP_ICON } from '../../utils/appIconFallback'

export default function AppsHub() {
  const { recentApps } = useContext(WalletContext)
  const [tab, setTab] = useState(0)
  const [search, setSearch] = useState('')
  const [catalog, setCatalog] = useState<PublishedApp[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setLoading(true)
    try { setCatalog(await new AppCatalogAPI({}).findApps()); setError('') }
    catch { setError('The app directory is unavailable. Your connected apps are still here.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])
  const apps = useMemo(() => (tab === 0 ? catalog.map(app => ({ name: app.metadata.name, description: app.metadata.description, domain: app.metadata.domain, url: app.metadata.httpURL, icon: app.metadata.icon, category: app.metadata.category })) : recentApps.map(app => ({ name: app.name || app.domain, description: app.domain, domain: app.domain, icon: app.iconImageUrl }))).filter(app => `${app.name} ${app.description} ${app.domain}`.toLowerCase().includes(search.toLowerCase())), [catalog, recentApps, tab, search])
  const launch = (app: { url?: string; domain: string }) => {
    try { const url = new URL(app.url || `https://${app.domain}`); if (!['http:', 'https:'].includes(url.protocol)) throw new Error(); void openUrl(url.href) }
    catch { setError('This app does not have a valid website address.') }
  }
  return <>
    <Typography variant="h1">Your wallet opens doors.</Typography><Typography color="text.secondary" sx={{ mt: 1, mb: 3 }}>Discover apps that put your payments and identity to work.</Typography>
    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={2} sx={{ mb: 3 }}><Tabs value={tab} onChange={(_, next) => setTab(next)} aria-label="Apps"><Tab label="Discover" /><Tab label={`Connected${recentApps.length ? ` · ${recentApps.length}` : ''}`} /></Tabs><TextField size="small" label="Search apps" value={search} onChange={event => setSearch(event.target.value)} InputProps={{ startAdornment: <InputAdornment position="start"><SearchRounded sx={{ fontSize: 20 }} /></InputAdornment> }} sx={{ width: { xs: '100%', sm: 270 } }} /></Stack>
    {error && <Alert severity="info" sx={{ mb: 3 }} action={<Button onClick={() => void load()} disabled={loading}>Retry</Button>}>{error}</Alert>}
    {tab === 0 && loading ? <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', xl: 'repeat(3, 1fr)' }, gap: 2.5 }}>{[1,2,3,4,5,6].map(item => <Skeleton key={item} variant="rounded" height={210} />)}</Box> : apps.length ? <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', xl: 'repeat(3, 1fr)' }, gap: 2.5 }}>{apps.map((app, index) => <Paper key={`${app.domain}-${index}`} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 3, p: 3, display: 'flex', flexDirection: 'column', gap: 1.5, minWidth: 0 }}><Stack direction="row" gap={1.5} alignItems="center"><img src={app.icon || FALLBACK_APP_ICON} onError={event => applyAppIconFallback(event.currentTarget)} alt="" width={44} height={44} style={{ borderRadius: 10 }} /><Box sx={{ minWidth: 0 }}><Typography variant="h5" noWrap>{app.name}</Typography><Typography variant="caption" color="text.secondary" noWrap>{app.domain}</Typography></Box></Stack><Typography variant="body2" color="text.secondary" sx={{ flex: 1, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{app.description}</Typography><Stack direction="row" justifyContent="space-between"><Button size="small" onClick={() => launch(app)} endIcon={<OpenInNewRounded sx={{ fontSize: 15 }} />} sx={{ px: 0 }}>Open app</Button>{tab === 1 && <Button size="small" component={RouterLink} to={`/dashboard/manage-app/${encodeURIComponent(app.domain)}`} startIcon={<SettingsOutlined sx={{ fontSize: 16 }} />}>Access</Button>}</Stack></Paper>)}</Box> : <Paper sx={{ textAlign: 'center', p: 7, border: '1px solid', borderColor: 'divider', borderRadius: 3 }}><AppsRounded sx={{ color: 'text.secondary', mb: 2, fontSize: 36 }} /><Typography variant="h4">{search ? 'No apps found' : tab === 1 ? 'Your next connection starts here.' : 'The directory is quiet right now.'}</Typography><Typography color="text.secondary" variant="body2" sx={{ mt: 1, mb: 2 }}>{search ? 'Try a different name or keyword.' : tab === 1 ? 'Apps you connect to will appear here. You stay in control of their access.' : 'Refresh to check for available apps.'}</Typography>{tab === 1 && <Button onClick={() => setTab(0)} endIcon={<ArrowForwardRounded />}>Discover apps</Button>}</Paper>}
  </>
}
