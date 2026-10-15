import { useContext, useMemo, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, InputAdornment, Paper, Skeleton, Stack, TextField, Tooltip, Typography } from '@mui/material'
import { ArrowDownwardRounded, ArrowUpwardRounded, ContentCopyRounded, OpenInNewRounded, ReceiptLongOutlined, RefreshRounded, SearchRounded } from '@mui/icons-material'
import type { WalletAction } from '@bsv/sdk'
import { toast } from 'react-toastify'
import AmountDisplay from '../../components/AmountDisplay'
import { WalletContext } from '../../WalletContext'
import { useWalletOverview } from '../../hooks/useWalletOverview'
import { wocExplorerBase } from '../../utils/woc'

const labels: Record<string, string> = { completed: 'Confirmed', unproven: 'Accepted', sending: 'Broadcasting', unsigned: 'Awaiting signature', nosend: 'Not sent', nonfinal: 'Pending', failed: 'Failed' }

export function ActivityList({ actions, loading, emptyAction = false }: { actions: WalletAction[]; loading?: boolean; emptyAction?: boolean }) {
  const { chain } = useContext(WalletContext)
  const [selected, setSelected] = useState<WalletAction | null>(null)
  if (loading && !actions.length) return <Stack gap={2} sx={{ p: 3 }}>{[1, 2, 3].map(row => <Skeleton key={row} height={54} />)}</Stack>
  return <>
    {!actions.length ? <Box sx={{ textAlign: 'center', py: 6, px: 3 }}><Box sx={{ mx: 'auto', mb: 2, width: 52, height: 52, borderRadius: '50%', bgcolor: 'background.default', display: 'grid', placeItems: 'center', color: 'text.secondary' }}><ReceiptLongOutlined /></Box><Typography variant="h5">A fresh start</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: 0.75, mb: 2 }}>Your payments and app activity will appear here.</Typography>{emptyAction && <Button component={RouterLink} to="/dashboard/payments?tab=receive" variant="outlined" size="small">Receive your first payment</Button>}</Box> : actions.map((action, index) => {
      const incoming = action.satoshis >= 0
      return <Box key={`${action.txid}-${index}`} component="button" onClick={() => setSelected(action)} sx={{ width: '100%', display: 'flex', alignItems: 'center', gap: 2, textAlign: 'left', px: 3, py: 2, border: 0, borderBottom: index < actions.length - 1 ? '1px solid' : 0, borderColor: 'divider', bgcolor: 'transparent', color: 'text.primary', font: 'inherit', cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}>
        <Box sx={{ width: 40, height: 40, flexShrink: 0, bgcolor: 'background.default', borderRadius: '50%', display: 'grid', placeItems: 'center', color: incoming ? 'primary.main' : 'text.secondary' }}>{incoming ? <ArrowDownwardRounded sx={{ fontSize: 19 }} /> : <ArrowUpwardRounded sx={{ fontSize: 19 }} />}</Box>
        <Box sx={{ flex: 1, minWidth: 0 }}><Typography variant="body2" fontWeight={600} noWrap>{action.description || (incoming ? 'Payment received' : 'Payment sent')}</Typography><Typography variant="caption" color="text.secondary">{labels[action.status] || action.status}</Typography></Box>
        <Typography variant="body2" fontWeight={600} sx={{ whiteSpace: 'nowrap', color: incoming ? 'primary.main' : 'text.primary' }}><AmountDisplay showPlus>{action.satoshis}</AmountDisplay></Typography>
      </Box>
    })}
    <Dialog open={!!selected} onClose={() => setSelected(null)} fullWidth maxWidth="sm"><DialogTitle>Payment details</DialogTitle><DialogContent>
      {selected && <Stack gap={2.5} sx={{ pt: 1 }}><Typography variant="h2"><AmountDisplay showPlus>{selected.satoshis}</AmountDisplay></Typography><Typography>{selected.description || 'Wallet transaction'}</Typography><Chip sx={{ alignSelf: 'flex-start' }} label={labels[selected.status] || selected.status} color={selected.status === 'failed' ? 'error' : selected.status === 'completed' ? 'success' : 'default'} />{selected.txid && <Box><Typography variant="caption" color="text.secondary">Transaction ID</Typography><Typography variant="body2" sx={{ overflowWrap: 'anywhere', fontFamily: 'monospace', mt: 0.5 }}>{selected.txid}</Typography><Button size="small" startIcon={<ContentCopyRounded />} onClick={async () => { try { await navigator.clipboard.writeText(selected.txid); toast.success('Transaction ID copied.') } catch { toast.error('Could not copy transaction ID.') } }}>Copy ID</Button>{chain !== 'ttn' && chain !== 'tstn' && <Button size="small" startIcon={<OpenInNewRounded />} href={`${wocExplorerBase(chain)}/tx/${selected.txid}`} target="_blank" rel="noopener noreferrer">View transaction</Button>}</Box>}</Stack>}
    </DialogContent><DialogActions><Button onClick={() => setSelected(null)}>Done</Button></DialogActions></Dialog>
  </>
}

export default function Activity() {
  const [limit, setLimit] = useState(30)
  const { actions, totalActions, loading, error, refresh } = useWalletOverview(limit)
  const [search, setSearch] = useState('')
  const filtered = useMemo(() => actions.filter(action => `${action.description} ${action.txid} ${action.status}`.toLowerCase().includes(search.toLowerCase())), [actions, search])
  return <>
    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 3 }}><Box><Typography variant="h1">Activity</Typography><Typography color="text.secondary" sx={{ mt: 1 }}>Every payment. Every app. All in one place.</Typography></Box><Tooltip title="Refresh activity"><IconButton aria-label="Refresh activity" onClick={() => void refresh()} disabled={loading}><RefreshRounded /></IconButton></Tooltip></Stack>
    {error && <Alert severity="error" sx={{ mb: 2 }} action={<Button onClick={() => void refresh()}>Retry</Button>}>{error}</Alert>}
    <TextField fullWidth size="small" label="Search loaded activity" value={search} onChange={event => setSearch(event.target.value)} InputProps={{ startAdornment: <InputAdornment position="start"><SearchRounded fontSize="small" /></InputAdornment> }} sx={{ mb: 3, maxWidth: 420 }} />
    <Paper sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 3, overflow: 'hidden' }}>{error && !actions.length ? <Typography color="text.secondary" sx={{ p: 4, textAlign: 'center' }}>Activity is unavailable. Refresh to try again.</Typography> : filtered.length === 0 && search ? <Typography sx={{ p: 5, textAlign: 'center' }} color="text.secondary">No matching activity.</Typography> : <ActivityList actions={filtered} loading={loading} emptyAction />}</Paper>
    {totalActions > actions.length && <Box sx={{ mt: 3, textAlign: 'center' }}><Button variant="outlined" onClick={() => setLimit(value => value + 30)} disabled={loading}>{loading ? 'Loading…' : 'Load more activity'}</Button></Box>}
  </>
}
