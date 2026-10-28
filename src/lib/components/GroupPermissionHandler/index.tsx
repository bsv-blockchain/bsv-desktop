import { useState, useEffect, useContext, useMemo, useCallback, useRef, type ReactNode } from 'react'
import {
  DialogContent,
  DialogActions,
  Button,
  Typography,
  CircularProgress,
  Box,
  Stack,
  Divider,
  Checkbox,
  TextField,
  FormControlLabel,
  InputAdornment,
  Collapse,
  Switch
} from '@mui/material'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import GppGoodOutlinedIcon from '@mui/icons-material/GppGoodOutlined'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import PaymentsOutlinedIcon from '@mui/icons-material/PaymentsOutlined'
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined'
import BadgeOutlinedIcon from '@mui/icons-material/BadgeOutlined'
import HandshakeOutlinedIcon from '@mui/icons-material/HandshakeOutlined'
import CustomDialog from '../CustomDialog'
import { WalletContext, WalletContextValue } from '../../WalletContext'
import { UserContext, UserContextValue } from '../../UserContext'
import AppChip from '../AppChip'
import CounterpartyChip from '../CounterpartyChip'
import AmountDisplay from '../AmountDisplay'
import { ExchangeRateContext } from '../AmountDisplay/ExchangeRateContextProvider'
import type { GroupedPermissions } from '@bsv/wallet-toolbox-client'
import { isSupportedFiatCurrency } from '../../utils/currency'
import useAppDisplayName from '../../hooks/useAppDisplayName'
import useRegistryProtocolDescription from '../../hooks/useRegistryProtocolDescription'

// Local type definitions for group permissions
type ProtocolPermission = {
  protocolID: [number, string]
  counterparty?: string
  description?: string
}

type BasketAccess = {
  basket: string
  description?: string
}

type CertificateAccess = {
  type: string
  fields?: string[]
  verifierPublicKey?: string
  description?: string
}

type SpendingAuthorization = {
  amount: number
  description?: string
}

// We use the structure of requests from the wallet context
// Each request contains requestID, originator and groupPermissions

const FeatureRegistryDescription = ({ protocolID }: { protocolID: [number, string] }) => {
  const record = useRegistryProtocolDescription(protocolID[1], protocolID[0])
  return record ? <Box sx={{ mt: 0.5 }}><Typography variant="caption">Registry description</Typography><Typography variant="body2">{record.description}</Typography><Box component="details"><summary>Registry publisher</summary><Typography variant="caption" sx={{ overflowWrap: 'anywhere' }}>{record.publisher}</Typography></Box></Box> : null
}

const GroupPermissionHandler = () => {
  const {
    groupPermissionRequests,
    advanceGroupQueue,
    managers,
    settings
  } = useContext<WalletContextValue>(WalletContext)

  const {
    groupPermissionModalOpen
  } = useContext<UserContextValue>(UserContext)

  const rates = useContext<any>(ExchangeRateContext)
  const { satoshisPerUSD, fiatPerUSD } = rates || {}

  const rawCurrency: string = String(
    (settings as any)?.currency ??
    (settings as any)?.fiatCurrency ??
    (settings as any)?.displayCurrency ??
    ''
  ).toUpperCase()

  type Unit =
    | { kind: 'sats' }
    | { kind: 'bsv' }
    | { kind: 'fiat'; code: string }

  const unit: Unit = useMemo(() => {
    if (/SAT/i.test(rawCurrency)) return { kind: 'sats' }
    if (rawCurrency === 'BSV' || /BITCOIN/i.test(rawCurrency)) return { kind: 'bsv' }
    if (isSupportedFiatCurrency(rawCurrency)) return { kind: 'fiat', code: rawCurrency }
    return { kind: 'sats' }
  }, [rawCurrency])

  const fiatRatesReady = useMemo(() => {
    if (unit.kind !== 'fiat') return true
    return !!satoshisPerUSD && typeof fiatPerUSD?.[unit.code] === 'number'
  }, [unit, satoshisPerUSD, fiatPerUSD])

  const [originator, setOriginator] = useState('')
  const [requestID, setRequestID] = useState<string | null>(null)
  const [spendingAuthorization, setSpendingAuthorization] = useState<SpendingAuthorization | undefined>(undefined)
  const [protocolPermissions, setProtocolPermissions] = useState<ProtocolPermission[]>([])
  const [basketAccess, setBasketAccess] = useState<BasketAccess[]>([])
  const [certificateAccess, setCertificateAccess] = useState<CertificateAccess[]>([])
  const [checkedProtocolKeys, setCheckedProtocolKeys] = useState<Set<string>>(new Set())
  const [checkedBasketKeys, setCheckedBasketKeys] = useState<Set<string>>(new Set())
  const [checkedCertificateKeys, setCheckedCertificateKeys] = useState<Set<string>>(new Set())
  const [spendingEnabled, setSpendingEnabled] = useState<boolean>(false)
  const [spendingAmount, setSpendingAmount] = useState<string>('')
  const [spendingAmountSats, setSpendingAmountSats] = useState<number | null>(null)
  const [spendingAmountDirty, setSpendingAmountDirty] = useState<boolean>(false)
  const [isGranting, setIsGranting] = useState(false)
  const [expandAll, setExpandAll] = useState(false)
  const [requestGrouping, setRequestGrouping] = useState<'app' | 'peer' | null>(null)
  const [requestPeerCounterparty, setRequestPeerCounterparty] = useState<string | null>(null)

  const permissionsManagerForRequestRef = useRef<any>(null)

  const appName = useAppDisplayName(originator)
  const [remember, setRemember] = useState(false)

  const isPeerGroupedRequest = useMemo(() => {
    if (protocolPermissions.some(p => ['self', 'anyone'].includes(p.counterparty ?? 'self'))) return false
    if (requestGrouping === 'peer') return true
    if (requestGrouping === 'app') return false
    if (!protocolPermissions.length) return false
    if (basketAccess.length || certificateAccess.length || spendingAuthorization) return false
    const allLevel2 = protocolPermissions.every(p => (p.protocolID?.[0] ?? 0) === 2)
    if (!allLevel2) return false
    const cps = new Set(protocolPermissions.map(p => p.counterparty ?? 'self'))
    return cps.size === 1
  }, [requestGrouping, protocolPermissions, basketAccess, certificateAccess, spendingAuthorization])

  const peerCounterparty = useMemo(() => {
    if (!isPeerGroupedRequest) return null
    if (requestGrouping === 'peer' && requestPeerCounterparty) return requestPeerCounterparty
    return protocolPermissions[0]?.counterparty ?? requestPeerCounterparty ?? 'self'
  }, [isPeerGroupedRequest, protocolPermissions, requestGrouping, requestPeerCounterparty])

  const protocolKey = (p: ProtocolPermission) => {
    const id = p.protocolID
    const sec = Array.isArray(id) ? id[0] : ''
    const name = Array.isArray(id) ? id[1] : ''
    const cp = p.counterparty ?? 'self'
    return sec === 2 ? `${name}|${cp}` : `${name}`
  }

  const basketKey = (b: BasketAccess) => b.basket

  const certificateKey = (c: CertificateAccess) => {
    const type = c.type ?? ''
    const verifier = c.verifierPublicKey ?? ''
    const fields = (c.fields ?? []).slice().sort().join('|')
    return `${type}|${verifier}|${fields}`
  }

  const spendingAmountNumber = useMemo(() => {
    const n = Number(spendingAmount)
    return Number.isFinite(n) ? n : NaN
  }, [spendingAmount])

  const inputStep = useMemo(() => {
    if (!fiatRatesReady && unit.kind === 'fiat') return 1
    if (unit.kind === 'sats') return 1
    if (unit.kind === 'bsv') return 0.00000001
    return 0.01
  }, [unit, fiatRatesReady])

  const adornmentLabel = useMemo(() => {
    if (!fiatRatesReady && unit.kind === 'fiat') return 'sats'
    if (unit.kind === 'sats') return 'sats'
    if (unit.kind === 'bsv') return 'BSV'
    return unit.code === 'USD' ? '$' : unit.code === 'EUR' ? '€' : unit.code === 'GBP' ? '£' : unit.code
  }, [unit, fiatRatesReady])

  const satsToInput = useCallback((sats: number) => {
    if (!fiatRatesReady && unit.kind === 'fiat') return sats
    if (unit.kind === 'sats') return sats
    if (unit.kind === 'bsv') return sats / 1e8

    if (!satoshisPerUSD) return NaN
    const usd = sats / satoshisPerUSD
    const r = unit.code === 'USD' ? 1 : fiatPerUSD?.[unit.code]
    if (typeof r !== 'number') return NaN
    return usd * r
  }, [unit, fiatRatesReady, satoshisPerUSD, fiatPerUSD])

  const inputToSats = useCallback((amount: number) => {
    if (!fiatRatesReady && unit.kind === 'fiat') return Math.round(amount)
    if (unit.kind === 'sats') return Math.round(amount)
    if (unit.kind === 'bsv') return Math.round(amount * 1e8)

    if (!satoshisPerUSD) return NaN
    const r = unit.code === 'USD' ? 1 : fiatPerUSD?.[unit.code]
    if (typeof r !== 'number' || r === 0) return NaN
    const usd = amount / r
    return Math.round(usd * satoshisPerUSD)
  }, [unit, fiatRatesReady, satoshisPerUSD, fiatPerUSD])

  const formatInputFromSats = useCallback((sats: number) => {
    const trimZeros = (s: string) => s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
    const v = satsToInput(sats)
    if (!Number.isFinite(v)) return String(sats)

    if (!fiatRatesReady && unit.kind === 'fiat') {
      return String(Math.round(v))
    }
    if (unit.kind === 'sats') return String(Math.round(v))
    if (unit.kind === 'bsv') return trimZeros(v.toFixed(8))

    const abs = Math.abs(v)
    if (abs > 0 && abs < 1) {
      const e = Math.floor(Math.log10(abs))
      const decimals = Math.min(12, Math.max(2, 3 - 1 - e))
      return trimZeros(v.toFixed(decimals))
    }

    return trimZeros(v.toFixed(2))
  }, [satsToInput, unit, fiatRatesReady])

  useEffect(() => {
    if (!spendingAuthorization) return
    if (spendingAmountDirty) return
    if (typeof spendingAmountSats !== 'number' || !Number.isFinite(spendingAmountSats)) return
    const next = formatInputFromSats(spendingAmountSats)
    setSpendingAmount(prev => (prev === next ? prev : next))
  }, [spendingAuthorization, spendingAmountDirty, spendingAmountSats, formatInputFromSats])

  const handleCancel = async () => {
    // Dismiss the current group permission request so we fall back to individual prompts
    if (requestID) {
      try {
        const pm = permissionsManagerForRequestRef.current ?? managers?.permissionsManager
        await (pm as any)?.denyGroupedPermission?.(requestID)
      } catch (error) {
        console.error('Error dismissing group permission:', error)
      }
    }

    advanceGroupQueue()
  }

  const handleGrant = async () => {
    setIsGranting(true)
    try {
      // Grant only the checked items. Unchecked items fall back to individual prompts.
      const granted: Partial<GroupedPermissions> = {
        protocolPermissions: protocolPermissions.filter(p => checkedProtocolKeys.has(protocolKey(p))) as any,
        basketAccess: basketAccess.filter(b => checkedBasketKeys.has(basketKey(b))) as any,
        certificateAccess: certificateAccess.filter(c => checkedCertificateKeys.has(certificateKey(c))) as any
      }

      if (spendingAuthorization && spendingEnabled) {
        if (typeof spendingAmountSats !== 'number' || !Number.isFinite(spendingAmountSats) || spendingAmountSats < 0) {
          setIsGranting(false)
          return
        }
        granted.spendingAuthorization = {
          amount: spendingAmountSats,
          description: spendingAuthorization.description
        } as any
      }

      let grantedSuccessfully = false
      if (requestID) {
        try {
          const pm = permissionsManagerForRequestRef.current ?? managers?.permissionsManager
          await (pm as any)?.grantGroupedPermission?.({
            requestID,
            granted: granted as GroupedPermissions,
            ...(remember || (spendingAuthorization && spendingEnabled) ? { expiry: 0 } : { sessionDurationMs: 1_800_000 })
          })
          grantedSuccessfully = true
        } catch (error) {
          console.error('Error granting group permission:', error)
        }
      }

      if (grantedSuccessfully) {
        try {
          const normOriginator = originator ? originator.replace(/^https?:\/\//, '') : originator
          if ((granted as any)?.protocolPermissions?.length) {
            window.dispatchEvent(new CustomEvent('protocol-permissions-changed', { detail: { op: 'grant-group', originator: normOriginator } }))
          }
          if ((granted as any)?.basketAccess?.length) {
            window.dispatchEvent(new CustomEvent('basket-access-changed', { detail: { op: 'grant-group', originator: normOriginator } }))
          }
          if ((granted as any)?.certificateAccess?.length) {
            window.dispatchEvent(new CustomEvent('cert-access-changed', { detail: { op: 'grant-group', originator: normOriginator } }))
          }
          if ((granted as any)?.spendingAuthorization) {
            window.dispatchEvent(new CustomEvent('spending-authorization-changed', { detail: { op: 'grant-group', originator: normOriginator } }))
          }
        } catch {
          // ignore
        }
        advanceGroupQueue()
      }
    } finally {
      setIsGranting(false)
    }
  }

  useEffect(() => {
    // Monitor the group permission requests from the wallet context
    if (groupPermissionRequests && groupPermissionRequests.length > 0) {
      // Get the first group permission request
      const currentRequest = groupPermissionRequests[0]

      if ((currentRequest as any)?.requestID && (currentRequest as any).requestID === requestID) {
        return
      }

      // Process the current request
      const processRequest = async () => {
        try {
          // Ensure we have proper typing for the current request
          const { requestID, originator, permissions, grouping, peerCounterparty } = currentRequest as any
          // Use the permissions property from the request as our groupPermissions
          const groupPermissions = permissions || {
            protocolPermissions: [],
            basketAccess: [],
            certificateAccess: []
          }

          permissionsManagerForRequestRef.current = (currentRequest as any)?.permissionsManager ?? null

          // Set the request ID
          setRequestID(requestID)

          setRequestGrouping(grouping ?? null)
          setRequestPeerCounterparty(peerCounterparty ?? null)

          // Set the originator
          setOriginator(originator || '')

          // Reset details visibility for new request
          setExpandAll(false)

          // Set protocol permissions
          const newProtocolPermissions = (groupPermissions?.protocolPermissions) || []
          setProtocolPermissions(newProtocolPermissions)
          setCheckedProtocolKeys(new Set(newProtocolPermissions.map(protocolKey)))

          // Set basket access permissions
          const newBasketAccess = (groupPermissions?.basketAccess) || []
          setBasketAccess(newBasketAccess)
          setCheckedBasketKeys(new Set(newBasketAccess.map(basketKey)))

          // Set certificate access permissions
          const newCertificateAccess = (groupPermissions?.certificateAccess)
            ? groupPermissions.certificateAccess.map((x: CertificateAccess) => ({
              ...x,
              fields: Array.isArray(x.fields)
                ? x.fields
                : x.fields
                  ? Object.keys(x.fields)
                  : []
            }))
            : []
          setCertificateAccess(newCertificateAccess)
          setCheckedCertificateKeys(new Set(newCertificateAccess.map(certificateKey)))

          // Set spending authorization
          setSpendingAuthorization(groupPermissions?.spendingAuthorization)
          setSpendingEnabled(!!groupPermissions?.spendingAuthorization)
          setSpendingAmountDirty(false)
          if (groupPermissions?.spendingAuthorization) {
            const sats = Number(groupPermissions.spendingAuthorization.amount)
            setSpendingAmountSats(Number.isFinite(sats) ? sats : null)
            setSpendingAmount(Number.isFinite(sats) ? formatInputFromSats(sats) : String(groupPermissions.spendingAuthorization.amount))
          } else {
            setSpendingAmountSats(null)
            setSpendingAmount('')
          }
        } catch (e) {
          console.error('Error processing group permission request:', e)
        }
      }

      processRequest()
    } else {
      // Reset the dialog when there are no requests
      setOriginator('')
      setRemember(false)
      setRequestID(null)
      setRequestGrouping(null)
      setRequestPeerCounterparty(null)
      permissionsManagerForRequestRef.current = null
      setSpendingAuthorization(undefined)
      setProtocolPermissions([])
      setBasketAccess([])
      setCertificateAccess([])
      setCheckedProtocolKeys(new Set())
      setCheckedBasketKeys(new Set())
      setCheckedCertificateKeys(new Set())
      setSpendingEnabled(false)
      setSpendingAmount('')
      setSpendingAmountSats(null)
      setSpendingAmountDirty(false)
      setExpandAll(false)
    }
  }, [groupPermissionRequests, advanceGroupQueue, requestID, formatInputFromSats])

  const handleDialogClose = (_event: any, reason?: string) => {
    if (reason === 'backdropClick' || reason === 'escapeKeyDown') return
    handleCancel()
  }

  // Connect-style summary rows: tinted icon + plain-language title + one-line
  // detail. Rows with options expand in place; selective changes are
  // reflected back into the row copy.
  type SummaryRow = {
    key: 'peer' | 'protocol' | 'basket' | 'certificate' | 'spending'
    icon: ReactNode
    accent: string
    title: string
    detail: ReactNode
    expandable: boolean
    warning?: boolean
  }
  const summaryRows = useMemo((): SummaryRow[] => {
    const rows: SummaryRow[] = []

    if (isPeerGroupedRequest && peerCounterparty) {
      rows.push({
        key: 'peer',
        icon: <HandshakeOutlinedIcon />,
        accent: '#7e57c2',
        title: 'Trust this person or service',
        detail: 'Interact with the person or service shown above through this app.',
        expandable: false
      })
    }
    if (protocolPermissions.length > 0) {
      const total = protocolPermissions.length
      const selected = protocolPermissions.filter(p => checkedProtocolKeys.has(protocolKey(p))).length
      rows.push({
        key: 'protocol',
        icon: <LockOutlinedIcon />,
        accent: '#9575cd',
        title: 'App features',
        detail: selected === total
          ? 'Let this app use your wallet to power its features.'
          : `Let this app run ${selected} of ${total} requested features.`,
        expandable: true
      })
    }
    if (basketAccess.length > 0) {
      const total = basketAccess.length
      const selected = basketAccess.filter(b => checkedBasketKeys.has(basketKey(b))).length
      rows.push({
        key: 'basket',
        icon: <Inventory2OutlinedIcon />,
        accent: '#4db6ac',
        title: 'Saved app data',
        detail: selected === total
          ? 'Save and read data in your wallet.'
          : `Access ${selected} of ${total} requested data stores.`,
        expandable: true
      })
    }
    if (certificateAccess.length > 0) {
      const total = certificateAccess.length
      const selected = certificateAccess.filter(c => checkedCertificateKeys.has(certificateKey(c))).length
      rows.push({
        key: 'certificate',
        icon: <BadgeOutlinedIcon />,
        accent: '#64b5f6',
        title: 'Verified details',
        detail: selected === total
          ? 'Share specific verified details, like a verified name.'
          : `Share ${selected} of ${total} requested verified details.`,
        expandable: true
      })
    }
    if (spendingAuthorization) {
      rows.push({
        key: 'spending',
        icon: <PaymentsOutlinedIcon />,
        accent: '#d4a94f',
        title: 'Monthly spending limit',
        detail: spendingEnabled && typeof spendingAmountSats === 'number' && Number.isFinite(spendingAmountSats)
          ? (
            <>
              Up to <AmountDisplay showFiatAsInteger>{spendingAmountSats}</AmountDisplay> per month without asking for approval.
            </>
          )
          : 'Off — each payment will ask for approval.',
        expandable: true,
        warning: true
      })
    }
    return rows
  }, [
    isPeerGroupedRequest, peerCounterparty, protocolPermissions, basketAccess,
    certificateAccess, spendingAuthorization, spendingEnabled, spendingAmountSats,
    checkedProtocolKeys, checkedBasketKeys, checkedCertificateKeys
  ])

  return (
    <CustomDialog
      open={groupPermissionModalOpen && groupPermissionRequests.length > 0}
      onClose={handleDialogClose}
      maxWidth='sm'
      fullWidth
      title={isPeerGroupedRequest ? 'Trust this person or service?' : `Allow ${appName ?? originator ?? 'this app'} to access your wallet?`}
    >
      <DialogContent>
        <Typography sx={{ mb: 2 }}>{groupPermissionRequests[0]?.permissions?.description || 'Choose the app features you want to allow.'}</Typography>
        <Typography variant="body2" sx={{ mb: 2 }}>Purposes below are provided by the app. Each approval covers the selected protocol features and their displayed key scopes.</Typography>
        {!spendingEnabled && <Typography variant="body2" sx={{ mb: 2 }}>No payment permission is requested.</Typography>}
        <FormControlLabel control={<Checkbox checked={remember} onChange={(_, checked) => setRemember(checked)} />} label="Remember these permissions" />
        <Typography variant="body2" sx={{ mb: 2 }}>{remember || (spendingAuthorization && spendingEnabled)
          ? 'Saves on-chain permission tokens until revoked. Transaction and wallet service fees may apply. Spending limits apply separately.'
          : 'This wallet session, up to 30 minutes. Ends on lock, wallet change or revocation in App access. No permission tokens are created.'}</Typography>
        <Box sx={{ textAlign: 'center', mb: 2.5 }}>
          {originator && (
            <Box sx={{ display: 'flex', justifyContent: 'center' }}>
              <AppChip
                showDomain
                label={originator}
                clickable={false}
              />
            </Box>
          )}
          {isPeerGroupedRequest && peerCounterparty && (
            <Box sx={{ mt: 1 }}>
              <Typography variant='caption' color='text.secondary'>
                Person or service
              </Typography>
              <Box sx={{ mt: 0.25, display: 'flex', justifyContent: 'center' }}>
                <CounterpartyChip
                  counterparty={peerCounterparty}
                  clickable={false}
                />
              </Box>
            </Box>
          )}
        </Box>

        {protocolPermissions.map(p => <Box key={protocolKey(p)} sx={{ mb: 1.5 }}>
          <Typography fontWeight={600}>{p.protocolID[1].startsWith('p ecpm ') ? 'Protect card and app data' : p.protocolID[1] === 'poker demo transcript' ? 'Sign game messages' : 'Use an app feature'}</Typography>
          <Typography variant="body2">{p.description || p.protocolID[1]}</Typography>
          <FeatureRegistryDescription protocolID={p.protocolID} />
          <Typography variant="caption" color="text.secondary">{p.counterparty === 'self' ? 'Your wallet’s own key scope' : p.counterparty === 'anyone' ? 'Public key scope; no specific opponent is trusted' : p.protocolID[0] === 1 ? 'All counterparties for this feature' : 'Specific counterparty: ' + p.counterparty}</Typography>
        </Box>)}
        <Box sx={{ bgcolor: 'action.hover', borderRadius: 3, px: 1, py: 0.5, mb: 2 }}>
          {summaryRows.map((row, i) => (
            <Box
              key={row.key}
              sx={row.warning ? {
                my: 0.75,
                borderRadius: 2,
                bgcolor: 'rgba(212, 169, 79, 0.08)',
                border: '1px solid rgba(212, 169, 79, 0.35)'
              } : {}}
            >
              {i > 0 && !row.warning && <Divider sx={{ mx: 1.5, opacity: 0.5 }} />}
              <Stack
                direction='row'
                spacing={2}
                alignItems='center'
                data-testid={`group-permission-row-${row.key}`}
                data-proofrun={`group-permission-row-${row.key}`}
                sx={{ px: 1.5, py: 1.75 }}
              >
                <Box
                  sx={{
                    width: 44,
                    height: 44,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    bgcolor: `${row.accent}26`,
                    color: row.accent
                  }}
                >
                  {row.icon}
                </Box>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant='body1' sx={{ fontWeight: 600, lineHeight: 1.3 }}>
                    {row.title}
                  </Typography>
                  <Typography variant='body2' color='text.secondary'>
                    {row.detail}
                  </Typography>
                </Box>
                {row.key === 'spending' && (
                  <Switch
                    checked={spendingEnabled}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setSpendingEnabled(e.target.checked)}
                    inputProps={{
                      'aria-label': 'Enable automatic payments'
                    }}
                    data-testid="group-permission-spending-enabled"
                    data-proofrun="group-permission-spending-enabled"
                  />
                )}
              </Stack>
              {row.expandable && (
                <Collapse in={expandAll} unmountOnExit>
                  {/* Left padding aligns options with the row text column. */}
                  <Box sx={{ pl: 9, pr: 2, pb: 1.5 }}>
                    {row.key === 'spending' && spendingAuthorization && spendingEnabled && (
                      <TextField
                        label={!fiatRatesReady && unit.kind === 'fiat' ? 'Monthly spending limit (satoshis)' : unit.kind === 'fiat' ? `Monthly spending limit (${unit.code})` : unit.kind === 'bsv' ? 'Monthly spending limit (BSV)' : 'Monthly spending limit (satoshis)'}
                        type='number'
                        size='small'
                        value={spendingAmount}
                        onChange={(e) => {
                          const next = e.target.value
                          setSpendingAmount(next)
                          setSpendingAmountDirty(true)
                          const n = Number(next)
                          if (!Number.isFinite(n)) {
                            setSpendingAmountSats(null)
                            return
                          }
                          const sats = inputToSats(n)
                          setSpendingAmountSats(Number.isFinite(sats) ? sats : null)
                        }}
                        fullWidth
                        inputProps={{
                          min: 0,
                          step: inputStep,
                          'aria-label': 'Grouped spending maximum'
                        }}
                        data-testid="group-permission-spending-amount"
                        data-proofrun="group-permission-spending-amount"
                        InputProps={{
                          startAdornment: <InputAdornment position="start">{adornmentLabel}</InputAdornment>
                        }}
                        helperText={
                          Number.isFinite(spendingAmountNumber) && typeof spendingAmountSats === 'number' && Number.isFinite(spendingAmountSats)
                            ? undefined
                            : 'Enter a valid number'
                        }
                        error={spendingEnabled && (!Number.isFinite(spendingAmountNumber) || spendingAmountNumber < 0 || typeof spendingAmountSats !== 'number' || !Number.isFinite(spendingAmountSats))}
                      />
                    )}
                    {row.key === 'protocol' && protocolPermissions.map((x, j) => (
                      <FormControlLabel
                        key={j}
                        sx={{ display: 'flex', alignItems: 'flex-start', ml: 0, mr: 0, mb: 0.5 }}
                        control={
                          <Checkbox
                            size='small'
                            sx={{ py: 0.25 }}
                            checked={checkedProtocolKeys.has(protocolKey(x))}
                            inputProps={{
                              'aria-label': `Include app feature ${x.protocolID?.[1] ?? j + 1}`
                            }}
                            data-testid={`group-permission-protocol-${j}`}
                            data-proofrun={`group-permission-protocol-${j}`}
                            onChange={(e) => {
                              const key = protocolKey(x)
                              setCheckedProtocolKeys(prev => {
                                const next = new Set(prev)
                                if (e.target.checked) next.add(key)
                                else next.delete(key)
                                return next
                              })
                            }}
                          />
                        }
                        label={
                          <Box>
                            <Typography variant='body2'>
                              {x.description || x.protocolID?.[1]}
                            </Typography>
                            {x.description && (
                              <Typography variant='caption' color='text.secondary'>
                                {x.protocolID?.[1]}
                              </Typography>
                            )}
                          </Box>
                        }
                      />
                    ))}
                    {row.key === 'certificate' && certificateAccess.map((x, j) => (
                      <FormControlLabel
                        key={j}
                        sx={{ display: 'flex', alignItems: 'flex-start', ml: 0, mr: 0, mb: 0.5 }}
                        control={
                          <Checkbox
                            size='small'
                            sx={{ py: 0.25 }}
                            checked={checkedCertificateKeys.has(certificateKey(x))}
                            inputProps={{
                              'aria-label': `Include verified detail ${x.type ?? j + 1}`
                            }}
                            data-testid={`group-permission-certificate-${j}`}
                            data-proofrun={`group-permission-certificate-${j}`}
                            onChange={(e) => {
                              const key = certificateKey(x)
                              setCheckedCertificateKeys(prev => {
                                const next = new Set(prev)
                                if (e.target.checked) next.add(key)
                                else next.delete(key)
                                return next
                              })
                            }}
                          />
                        }
                        label={
                          <Box>
                            <Typography variant='body2'>
                              {x.description || x.type}
                            </Typography>
                            {x.description && (
                              <Typography variant='caption' color='text.secondary'>
                                {x.type}
                              </Typography>
                            )}
                          </Box>
                        }
                      />
                    ))}
                    {row.key === 'basket' && basketAccess.map((x, j) => (
                      <FormControlLabel
                        key={j}
                        sx={{ display: 'flex', alignItems: 'flex-start', ml: 0, mr: 0, mb: 0.5 }}
                        control={
                          <Checkbox
                            size='small'
                            sx={{ py: 0.25 }}
                            checked={checkedBasketKeys.has(basketKey(x))}
                            inputProps={{
                              'aria-label': `Include saved app data ${x.basket ?? j + 1}`
                            }}
                            data-testid={`group-permission-basket-${j}`}
                            data-proofrun={`group-permission-basket-${j}`}
                            onChange={(e) => {
                              const key = basketKey(x)
                              setCheckedBasketKeys(prev => {
                                const next = new Set(prev)
                                if (e.target.checked) next.add(key)
                                else next.delete(key)
                                return next
                              })
                            }}
                          />
                        }
                        label={
                          <Box>
                            <Typography variant='body2'>
                              {x.description || x.basket}
                            </Typography>
                            {x.description && (
                              <Typography variant='caption' color='text.secondary'>
                                {x.basket}
                              </Typography>
                            )}
                          </Box>
                        }
                      />
                    ))}
                  </Box>
                </Collapse>
              )}
            </Box>
          ))}
        </Box>

        <Stack
          direction='row'
          spacing={1}
          alignItems='center'
          justifyContent='center'
          sx={{ px: 1 }}
        >
          <GppGoodOutlinedIcon sx={{ color: 'text.secondary', fontSize: 18, flexShrink: 0 }} />
          <Typography variant='caption' color='text.secondary'>
            You can turn this off anytime in Settings.
          </Typography>
          <Typography variant='caption' color='text.secondary'>·</Typography>
          <Typography
            component='button'
            variant='caption'
            onClick={() => setExpandAll(v => !v)}
            aria-label={expandAll ? 'Hide access options' : 'Customize access'}
            data-testid="group-permission-toggle-details"
            data-proofrun="group-permission-toggle-details"
            sx={{
              background: 'none',
              border: 'none',
              p: 0,
              color: 'primary.main',
              cursor: 'pointer',
              fontFamily: 'inherit'
            }}
          >
            {expandAll ? 'Hide options' : 'Customize'}
          </Typography>
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5, pt: 0.5, gap: 1.5, flex: 'none', borderTop: 'none' }}>
        <Button
          onClick={handleCancel}
          variant='outlined'
          disabled={isGranting}
          size='large'
          fullWidth
          sx={{ borderRadius: 6 }}
          aria-label={isPeerGroupedRequest ? 'Do not trust this person or service' : 'Do not allow app access'}
          data-testid="group-permission-deny"
          data-proofrun="group-permission-deny"
        >
          {isPeerGroupedRequest ? 'Don\u2019t trust' : 'Don\u2019t allow'}
        </Button>
        <Button
          variant='contained'
          color='primary'
          onClick={handleGrant}
          disabled={isGranting}
          startIcon={isGranting ? <CircularProgress size={16} color='inherit' /> : <CheckCircleOutlineIcon />}
          size='large'
          fullWidth
          sx={{ borderRadius: 6 }}
          aria-label={isPeerGroupedRequest ? 'Trust this person or service' : 'Allow app access'}
          data-testid="group-permission-allow"
          data-proofrun="group-permission-allow"
        >
          {isGranting ? 'Allowing…' : isPeerGroupedRequest ? 'Trust' : remember || (spendingAuthorization && spendingEnabled) ? 'Allow and remember' : 'Allow for this session'}
        </Button>
      </DialogActions>
    </CustomDialog>
  )
}

export default GroupPermissionHandler
