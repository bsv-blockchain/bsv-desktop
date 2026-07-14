/**
 * BasketsPage — browse the wallet's baskets and the outputs inside each.
 *
 * A basket is a labelled bucket of outputs (tokens, change, app data). BRC-100's
 * `listOutputs` needs a basket name upfront, so there's no "enumerate baskets"
 * call on the wallet surface; we read the basket list + per-basket counts over
 * the stas:query IPC.
 *
 * Layout: a sticky basket list on the left, the selected basket's outputs on the
 * right. Responsive — the two panes stack on a narrow window.
 */

import React, { useContext, useEffect, useState, useCallback } from 'react'
import {
  Card,
  CardContent,
  Typography,
  Box,
  Button,
  Stack,
  Chip,
  Divider,
  CircularProgress,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableContainer,
  Paper,
} from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import InventoryIcon from '@mui/icons-material/Inventory'
import { WalletContext } from '../../WalletContext'
import { stasQuery } from '../../services/stas'

interface BasketRow {
  basketId: number
  name: string
  numberOfDesiredUTXOs: number | null
  minimumDesiredUTXOValue: number | null
  outputCount: number
  spendableCount: number
  totalSatoshis: number
}

interface OutputRow {
  outputId: number
  outpoint: string
  txid: string | null
  vout: number
  satoshis: number
  spendable: boolean
  type?: string
  customInstructions: string | null
  lockingScript: string | null
  createdAt?: string
}

function formatSats(n: number | undefined | null): string {
  return (n ?? 0).toLocaleString() + ' sats'
}

function truncateHex(hex: string | null | undefined, len = 24): string {
  if (!hex) return '—'
  if (hex.length <= len) return hex
  return `${hex.substring(0, len)}…`
}

export default function BasketsPage() {
  const { stas } = useContext(WalletContext)
  const identityKey = stas?.keyDeriver?.identityKey
  const chain = stas?.keyDeriver?.chain

  const [baskets, setBaskets] = useState<BasketRow[] | null>(null)
  const [loadingBaskets, setLoadingBaskets] = useState(false)
  const [basketsError, setBasketsError] = useState<string | null>(null)

  const [selectedBasket, setSelectedBasket] = useState<string | null>(null)
  const [outputs, setOutputs] = useState<OutputRow[] | null>(null)
  const [loadingOutputs, setLoadingOutputs] = useState(false)
  const [outputsError, setOutputsError] = useState<string | null>(null)

  const loadBaskets = useCallback(async () => {
    if (!identityKey || !chain) return
    setLoadingBaskets(true)
    setBasketsError(null)
    try {
      const rows = (await stasQuery(identityKey, chain, 'listAllBaskets', [])) ?? []
      setBaskets(rows as BasketRow[])
      // Auto-select the basket with the most outputs on first load.
      if (!selectedBasket && Array.isArray(rows) && rows.length > 0) {
        const sorted = [...rows].sort(
          (a: any, b: any) => (b.outputCount ?? 0) - (a.outputCount ?? 0)
        )
        setSelectedBasket(sorted[0].name)
      }
    } catch (e) {
      setBasketsError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoadingBaskets(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityKey, chain])

  const loadOutputs = useCallback(
    async (basket: string) => {
      if (!identityKey || !chain) return
      setLoadingOutputs(true)
      setOutputsError(null)
      try {
        const rows =
          (await stasQuery(identityKey, chain, 'listBasketOutputs', [basket])) ?? []
        setOutputs(rows as OutputRow[])
      } catch (e) {
        setOutputsError(e instanceof Error ? e.message : String(e))
      } finally {
        setLoadingOutputs(false)
      }
    },
    [identityKey, chain]
  )

  useEffect(() => {
    loadBaskets()
  }, [loadBaskets])

  useEffect(() => {
    if (selectedBasket) loadOutputs(selectedBasket)
  }, [selectedBasket, loadOutputs])

  return (
    <Card sx={{ m: 2 }}>
      <CardContent>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          justifyContent='space-between'
          alignItems={{ xs: 'stretch', sm: 'center' }}
          spacing={2}
          sx={{ mb: 1 }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography variant='h6' sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <InventoryIcon fontSize='small' /> Baskets
            </Typography>
            <Typography variant='caption' color='text.secondary'>
              Every basket this wallet holds, with the outputs inside it and each
              basket's spendable count and total value. Pick a basket to see its outputs.
            </Typography>
          </Box>
          <Button
            variant='outlined'
            size='small'
            startIcon={loadingBaskets ? <CircularProgress size={14} /> : <RefreshIcon />}
            onClick={() => {
              loadBaskets()
              if (selectedBasket) loadOutputs(selectedBasket)
            }}
            disabled={!identityKey || loadingBaskets || loadingOutputs}
            sx={{ flexShrink: 0, alignSelf: { xs: 'flex-start', sm: 'auto' } }}
          >
            {loadingBaskets || loadingOutputs ? 'Loading…' : 'Refresh'}
          </Button>
        </Stack>

        <Divider sx={{ my: 2 }} />

        {basketsError && (
          <Typography color='error' variant='caption' display='block' sx={{ mb: 1 }}>
            {basketsError}
          </Typography>
        )}

        {/* Two panes — basket list + outputs. Stacks on a narrow window; on wide
            windows the basket list sticks so scrolling outputs keeps it in view. */}
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '280px minmax(0, 1fr)' }, gap: 2, alignItems: 'start' }}>
          <Box sx={{ position: { md: 'sticky' }, top: { md: 8 }, minWidth: 0 }}>
            <Typography variant='subtitle2' sx={{ mb: 1 }}>
              Baskets ({baskets?.length ?? 0})
            </Typography>
            {baskets && baskets.length === 0 && (
              <Typography variant='caption' color='text.secondary'>
                No baskets yet. The wallet creates `default` on first use.
              </Typography>
            )}
            {baskets && baskets.length > 0 && (
              <Stack spacing={0.5} sx={{ maxHeight: { md: '70vh' }, overflowY: { md: 'auto' }, pr: { md: 0.5 } }}>
                {baskets.map((b) => {
                  const isSelected = b.name === selectedBasket
                  return (
                    <Box
                      key={b.basketId}
                      onClick={() => setSelectedBasket(b.name)}
                      role='button'
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setSelectedBasket(b.name)
                        }
                      }}
                      sx={{
                        p: 1,
                        borderRadius: 1,
                        cursor: 'pointer',
                        bgcolor: isSelected ? 'action.selected' : 'action.hover',
                        borderLeft: '3px solid',
                        borderColor: isSelected ? 'primary.main' : 'transparent',
                        transition: 'background-color 0.1s',
                        '&:hover': { bgcolor: 'action.selected' },
                        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' },
                      }}
                    >
                      <Typography variant='body2' sx={{ fontWeight: isSelected ? 600 : 500 }}>
                        {b.name}
                      </Typography>
                      <Stack direction='row' spacing={0.5} sx={{ mt: 0.5 }} flexWrap='wrap'>
                        <Chip size='small' label={`${b.outputCount} out`} variant='outlined' />
                        <Chip
                          size='small'
                          label={`${b.spendableCount} spendable`}
                          color={b.spendableCount > 0 ? 'success' : 'default'}
                          variant='outlined'
                        />
                        <Chip
                          size='small'
                          label={formatSats(b.totalSatoshis)}
                          variant='outlined'
                        />
                      </Stack>
                      {b.numberOfDesiredUTXOs != null && (
                        <Typography variant='caption' color='text.secondary' sx={{ mt: 0.5, display: 'block' }}>
                          target: {b.numberOfDesiredUTXOs}
                        </Typography>
                      )}
                    </Box>
                  )
                })}
              </Stack>
            )}
          </Box>

          {/* Outputs table for the selected basket */}
          <Box sx={{ minWidth: 0 }}>
            <Typography variant='subtitle2' sx={{ mb: 1 }}>
              {selectedBasket
                ? `Outputs in "${selectedBasket}" (${outputs?.length ?? 0})`
                : 'Select a basket to see its outputs'}
            </Typography>

            {outputsError && (
              <Typography color='error' variant='caption' display='block' sx={{ mb: 1 }}>
                {outputsError}
              </Typography>
            )}

            {loadingOutputs && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, my: 2 }}>
                <CircularProgress size={16} />
                <Typography variant='caption'>Loading outputs…</Typography>
              </Box>
            )}

            {!loadingOutputs && outputs && outputs.length === 0 && selectedBasket && (
              <Typography variant='caption' color='text.secondary'>
                No outputs in this basket yet.
              </Typography>
            )}

            {!loadingOutputs && outputs && outputs.length > 0 && (
              <TableContainer
                component={Paper}
                variant='outlined'
                sx={{ maxHeight: 600, width: '100%', overflowX: 'auto' }}
              >
                <Table size='small' stickyHeader sx={{ minWidth: 520 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell>Outpoint</TableCell>
                      <TableCell align='right'>Satoshis</TableCell>
                      <TableCell align='center'>Spendable</TableCell>
                      <TableCell>Script</TableCell>
                      <TableCell>Custom Instr.</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {outputs.map((o) => (
                      <TableRow key={o.outputId} hover>
                        <TableCell sx={{ fontFamily: 'monospace', fontSize: 11 }}>
                          {o.txid ? (
                            <a
                              href={`https://whatsonchain.com/tx/${o.txid}`}
                              target='_blank'
                              rel='noreferrer'
                              style={{ color: 'inherit' }}
                            >
                              {o.txid.substring(0, 12)}…:{o.vout}
                            </a>
                          ) : (
                            <span style={{ color: '#888' }}>?:{o.vout}</span>
                          )}
                        </TableCell>
                        <TableCell align='right' sx={{ fontFamily: 'monospace', fontSize: 11 }}>
                          {o.satoshis.toLocaleString()}
                        </TableCell>
                        <TableCell align='center'>
                          {o.spendable ? (
                            <Chip size='small' label='yes' color='success' variant='outlined' />
                          ) : (
                            <Chip size='small' label='no' variant='outlined' />
                          )}
                        </TableCell>
                        <TableCell sx={{ fontFamily: 'monospace', fontSize: 10 }}>
                          <span title={o.lockingScript ?? ''}>
                            {truncateHex(o.lockingScript, 22)}
                            {o.lockingScript && (
                              <Typography
                                variant='caption'
                                color='text.secondary'
                                component='span'
                                sx={{ ml: 0.5 }}
                              >
                                ({(o.lockingScript.length / 2).toLocaleString()}B)
                              </Typography>
                            )}
                          </span>
                        </TableCell>
                        <TableCell sx={{ fontFamily: 'monospace', fontSize: 10 }}>
                          <span title={o.customInstructions ?? ''}>
                            {truncateHex(o.customInstructions, 30)}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Box>
        </Box>
      </CardContent>
    </Card>
  )
}
