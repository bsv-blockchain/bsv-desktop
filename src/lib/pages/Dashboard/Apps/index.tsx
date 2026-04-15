import React, { useCallback, useContext, useEffect, useRef, useState } from 'react'
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Tooltip,
  Typography,
} from '@mui/material'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { toast } from 'react-toastify'
import { WalletContext } from '../../../WalletContext'
import AmountDisplay from '../../../components/AmountDisplay'
import type { WalletAction } from '@bsv/sdk'

const PAGE_SIZE = 30

const ABORTABLE_STATUSES = new Set(['unsigned', 'nosend', 'nonfinal'])

function getStatusChip(status: string) {
  switch (status) {
    case 'completed':
    case 'unproven':
    case 'sending':
      return <Chip size="small" label={status === 'completed' ? 'Confirmed' : status === 'unproven' ? 'Accepted' : 'Broadcasting'} color="success" />
    case 'nosend':
      return <Chip size="small" label="Not Sent" color="warning" />
    case 'unsigned':
      return <Chip size="small" label="Unsigned" color="warning" />
    case 'nonfinal':
      return <Chip size="small" label="Non-Final" color="warning" />
    case 'failed':
      return <Chip size="small" label="Failed" color="error" />
    default:
      return <Chip size="small" label={status} />
  }
}

const Transactions: React.FC = () => {
  const { managers, adminOriginator, network } = useContext(WalletContext)

  const [actions, setActions] = useState<WalletAction[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [copyingTxid, setCopyingTxid] = useState<string | null>(null)
  // Tracks the oldest offset we've fetched so far (walking backwards from the end)
  const oldestOffsetRef = useRef(0)

  const fetchActions = useCallback(async (offset: number) => {
    if (!managers.permissionsManager) return null
    return managers.permissionsManager.listActions(
      { labels: [], limit: PAGE_SIZE, offset },
      adminOriginator
    )
  }, [managers.permissionsManager, adminOriginator])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      // Fetch page 1 just to get totalActions, then fetch the last page
      const probe = await fetchActions(0)
      if (cancelled || !probe) return
      const total = probe.totalActions
      const lastPageOffset = Math.max(0, total - PAGE_SIZE)
      const result = lastPageOffset === 0 ? probe : await fetchActions(lastPageOffset)
      if (cancelled || !result) return
      setActions([...result.actions].reverse())
      oldestOffsetRef.current = lastPageOffset
      setHasMore(lastPageOffset > 0)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [fetchActions])

  const loadMore = async () => {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    const nextOffset = Math.max(0, oldestOffsetRef.current - PAGE_SIZE)
    const result = await fetchActions(nextOffset)
    if (result) {
      setActions(prev => [...prev, ...[...result.actions].reverse()])
      oldestOffsetRef.current = nextOffset
      setHasMore(nextOffset > 0)
    }
    setLoadingMore(false)
  }

  const handleExplorerLink = (txid: string) => {
    const base = network === 'mainnet'
      ? 'https://whatsonchain.com'
      : 'https://test.whatsonchain.com'
    window.open(`${base}/tx/${txid}`, '_blank', 'noopener,noreferrer')
  }

  const handleCopyTxid = async (txid: string) => {
    if (copyingTxid) return
    setCopyingTxid(txid)
    try {
      await navigator.clipboard.writeText(txid)
      toast.success('Transaction ID copied!')
    } catch {
      toast.error('Failed to copy')
    } finally {
      setCopyingTxid(null)
    }
  }

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="300px">
        <CircularProgress />
      </Box>
    )
  }

  if (actions.length === 0) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="300px">
        <Typography color="textSecondary">No transactions yet.</Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h5" sx={{ mb: 2 }}>Transactions</Typography>
      <List disablePadding>
        {actions.map((item, index) => (
          <ListItem
            key={`${item.txid || index}-${index}`}
            divider
            sx={{ alignItems: 'flex-start', px: 1 }}
          >
            <ListItemText
              primary={
                <Typography variant="body1" noWrap sx={{ maxWidth: 320 }}>
                  {item.description || 'Transaction'}
                </Typography>
              }
              secondary={getStatusChip(item.status)}
            />
            <Box display="flex" alignItems="center" gap={1} flexShrink={0}>
              <Typography variant="body2" fontWeight={600} color={item.satoshis < 0 ? 'error' : 'textPrimary'}>
                <AmountDisplay showPlus>{item.satoshis}</AmountDisplay>
              </Typography>
              {!ABORTABLE_STATUSES.has(item.status) && item.txid && (
                <>
                  <Tooltip title="View on WhatsOnChain">
                    <IconButton size="small" onClick={() => handleExplorerLink(item.txid)}>
                      <OpenInNewIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Copy transaction ID">
                    <IconButton
                      size="small"
                      onClick={() => handleCopyTxid(item.txid)}
                      disabled={copyingTxid === item.txid}
                    >
                      <ContentCopyIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </>
              )}
            </Box>
          </ListItem>
        ))}
      </List>

      {hasMore && (
        <Box display="flex" justifyContent="center" mt={2}>
          <Button variant="outlined" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : 'Load more'}
          </Button>
        </Box>
      )}
    </Box>
  )
}

export default Transactions
