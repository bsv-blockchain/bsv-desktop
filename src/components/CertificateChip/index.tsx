// src/components/CertificateChip/index.tsx
import React, { useEffect, useContext, useState, useMemo } from 'react'
import {
  Chip,
  Box,
  Typography,
  IconButton,
  Tooltip,
  Link as MuiLink,
  Stack,
  Avatar,
  Divider,
  Button
} from '@mui/material'
import { withRouter, RouteComponentProps } from 'react-router-dom'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import CounterpartyChip from '../CounterpartyChip'
import { Base64String, RegistryClient, CertificateDefinitionData, CertificateFieldDescriptor } from '@bsv/sdk'
import { WalletContext } from '../../WalletContext'
import { deterministicImage } from '../../utils/deterministicImage'
import AppLogo from '../AppLogo'
interface CertificateChipProps extends RouteComponentProps {
  certType: Base64String
  expiry?: number // epoch seconds
  originator: string
  canrevoke?: boolean
  onRevokeClick: () => void
  clickable?: boolean
  size?: number
  backgroundColor?: string
  onClick?: (event: React.MouseEvent<HTMLDivElement>) => void
}

/* ---------- helpers ---------- */
function truncateMiddle(s: string, keep = 12): string {
  if (!s) return ''
  if (s.length <= keep * 2 + 3) return s
  return `${s.slice(0, keep)}…${s.slice(-keep)}`
}
function isoFromEpochSeconds(secs?: number): string | undefined {
  if (!secs && secs !== 0) return undefined
  return new Date(secs * 1000).toISOString()
}
function relativeFromEpochSeconds(secs?: number): string | undefined {
  if (!secs && secs !== 0) return undefined
  const diff = secs * 1000 - Date.now()
  const abs = Math.abs(diff)
  const days = Math.floor(abs / 86_400_000)
  const hours = Math.floor((abs % 86_400_000) / 3_600_000)
  const label = `${days}d ${hours}h`
  return diff >= 0 ? `in ${label}` : `${label} ago`
}
function originAvatar(origin: string) {
  const src = deterministicImage?.(origin)
  const label = origin.replace(/^https?:\/\//, '').replace(/\/.*/, '').split('.').filter(Boolean)
  const core = label.length >= 2 ? label[label.length - 2] : label[0] || '?'
  const letter = (core[0] || '?').toUpperCase()
  return { src, letter }
}
function iconSrcFrom(iconURL?: string): string | undefined {
  if (!iconURL) return undefined
  if (/^https?:\/\//i.test(iconURL)) return iconURL
  return deterministicImage?.(iconURL)
}

/* ---------- styles ---------- */
const ROW_SX = { height: '3em', width: '100%', alignItems: 'center', justifyContent: 'space-between' } as const
const MONO_SX = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', wordBreak: 'break-all' } as const

const CertificateChip: React.FC<CertificateChipProps> = ({
  certType,
  expiry,
  originator,
  canrevoke,
  onRevokeClick,
  clickable = true,
  size = 1.0,
  backgroundColor = 'transparent',
  onClick,
  history
}) => {
  const { managers, settings, activeProfile } = useContext(WalletContext)

  // Definition-driven state
  const [certname, setCertName] = useState<string>('Unknown Cert')
  const [resolvedCertType, setResolvedCertType] = useState<string>(certType || '')
  const [documentationURL, setDocumentationURL] = useState<string>('')
  const [description, setDescription] = useState<string>('')
  const [iconURL, setIconURL] = useState<string>('')
  const [fields, setFields] = useState<{ [key: string]: CertificateFieldDescriptor }>({})
  const [verifier, setVerifier] = useState<string>('')
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const rel = relativeFromEpochSeconds(expiry)
  const abs = isoFromEpochSeconds(expiry)
  // const { src: originSrc, letter } = originAvatar(originator)

  // Resolve certificate definition
  useEffect(() => {
    setIsLoading(true)
    let cancelled = false
    ;(async () => {
      try {
        if (!managers?.walletManager) return
        const registrant = new RegistryClient(managers.walletManager)
        const trusted = settings?.trustSettings?.trustedCertifiers || []    
        const registryOperators: string[] = settings.trustSettings.trustedCertifiers.map(
          (x: any) => x.identityKey
        )
        const cacheKey = `certData_${certType}_${registryOperators.join('_')}+${activeProfile.id}`
        const cachedData = window.localStorage.getItem(cacheKey)
        if(cachedData)
        {
          const cachedCert = JSON.parse(cachedData)
          setCertName(cachedCert?.name || '')
          setIconURL(cachedCert?.iconURL || '')
          setResolvedCertType(cachedCert?.type || certType || '')
          setDocumentationURL(cachedCert?.documentationURL || '')
          setDescription(cachedCert?.description || '')
          setFields((cachedCert?.fields as any) || {})
          setVerifier((cachedCert as any)?.registryOperator || '')
          setIsLoading(false)
          return 
        }
        const results = (await registrant.resolve('certificate', {
          type: certType,
          registryOperators
        })) as CertificateDefinitionData[]
        
        // if (cancelled) {console.log("me returning but why?", results); return}

        if (Array.isArray(results) && results.length) {
          // choose most trusted
          let pick = 0
          let best = -Infinity
          for (let i = 0; i < results.length; i++) {
            const op = (results[i] as any).registryOperator
            const trust = trusted.find((t: any) => t.identityKey === op)?.trust ?? 0
            if (trust > best) { best = trust; pick = i }
          }
          const c = results[pick]

          setCertName(c?.name || '')
          setIconURL(c?.iconURL || '')
          setResolvedCertType(c?.type || certType || '')
          setDocumentationURL(c?.documentationURL || '')
          setDescription(c?.description || '')
          setFields((c?.fields as any) || {})
          setVerifier((c as any)?.registryOperator || '')
          window.localStorage.setItem(cacheKey, JSON.stringify(c))
          console.log('me saving data with key' ,cacheKey)
        } else {
          setResolvedCertType(certType || '')
        }
      } catch (err) {
        console.error('Failed to fetch certificate details:', err)
        setResolvedCertType(certType || '')
      }
      finally
      {
        setIsLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [managers?.walletManager, settings?.trustSettings?.trustedCertifiers, certType])

  // certFields derived from fields (keys)
  const certFieldKeys = useMemo(() => Object.keys(fields || {}), [fields])

  // Pretty label chips from descriptors
  const definitionFieldChips = useMemo(() => {
    if (!certFieldKeys.length) return null
    return certFieldKeys.map((k) => {
      const f = fields[k]
      const label = f?.friendlyName ? `${f.friendlyName}${f?.type ? ` (${f.type})` : ''}` : (f?.type ? `${k} (${f.type})` : k)
      return <Chip key={`def-field-${k}`} size="small" label={label} />
    })
  }, [fields, certFieldKeys])

  /* ---------- click navigation ---------- */
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!clickable) return
    if (typeof onClick === 'function') {
      onClick(e)
      return
    }
    e.stopPropagation()
    const typeForRoute = resolvedCertType || certType || ''
    history.push(`/dashboard/certificate/${encodeURIComponent(typeForRoute)}`)
  }
  if(isLoading)
  {
    return <Box p={3} display="flex" justifyContent="center" alignItems="center"><AppLogo rotate size={50} /></Box>
  }
  return (
    <Stack
      spacing={1}
      onClick={handleClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      sx={(theme) => ({
        width: '100%',
        p: 1.5,
        borderRadius: 3,
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: backgroundColor !== 'transparent' ? backgroundColor : (theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)'),
        cursor: clickable ? 'pointer' : 'default'
      })}
    >
      {/* Header: left (icon+name), right (docs+revoke) */}
      <Stack direction="row" spacing={1} alignItems="center" sx={{ ...ROW_SX, height: 'auto' }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Avatar
            src={iconSrcFrom(iconURL)}
            sx={(theme) => ({
              width: 36, height: 36, fontSize: 14,
              bgcolor: iconURL ? 'transparent' : (theme.palette.mode === 'dark' ? 'grey.800' : 'grey.200'),
              color: iconURL ? undefined : theme.palette.text.primary,
              boxShadow: 1
            })}
          >
            {!iconURL && (certname?.[0]?.toUpperCase() || 'C')}
          </Avatar>

          <Typography variant="h6" fontWeight="bold" sx={{ mr: 0.5 }}>
            {certname || 'Certificate'}
          </Typography>
        </Stack>

        <Stack direction="row" spacing={1} alignItems="center">
          {!!documentationURL && (
            <Tooltip title="Open documentation">
              <IconButton
                component={MuiLink}
                href={documentationURL}
                target="_blank"
                rel="noreferrer"
                size="small"
                aria-label="open documentation"
                onClick={(e) => e.stopPropagation()} // prevent bubbling to card click
              >
                <OpenInNewIcon fontSize="inherit" />
              </IconButton>
            </Tooltip>
          )}

          {canrevoke && (
            <Button
              variant="text"
              color="primary"
              size="small"
              onClick={(e) => { e.stopPropagation(); onRevokeClick?.() }}
              sx={{ textTransform: 'none', p: 0, minWidth: 0 }}
              aria-label="Revoke certificate"
            >
              Revoke
            </Button>
          )}
        </Stack>
      </Stack>

      {!!description && (
        <>
          <Typography variant="body2" sx={{ opacity: 0.9 }}>{description}</Typography>
          <Divider />
        </>
      )}

      {/* Expiry */}
      {expiry !== undefined && (
        <>
          <Stack direction="row" spacing={1} sx={ROW_SX}>
            <Typography variant="body1" fontWeight="bold">Expires</Typography>
            <Box px={3}><Typography variant="body1" sx={{ fontSize: '1rem' }}>{rel} {abs ? `(${abs})` : ''}</Typography></Box>
          </Stack>
          <Divider />
        </>
      )}

      {/* Definition fields (pretty labels from descriptors) */}
      {definitionFieldChips && (
        <>
          <Stack direction="row" spacing={1} sx={{ width: '100%', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <Typography variant="body1" fontWeight="bold" sx={{ lineHeight: '32px' }}>Definition fields</Typography>
            <Box px={3} sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, maxWidth: '70%' }}>{definitionFieldChips}</Box>
          </Stack>
          <Divider />
        </>
      )}

      {/* certFields derived from "fields" keys */}
      {certFieldKeys.length > 0 && (
        <>
          <Stack direction="row" spacing={1} sx={{ width: '100%', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <Typography variant="body1" fontWeight="bold" sx={{ lineHeight: '32px' }}>Fields</Typography>
            <Box px={3} sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, maxWidth: '70%' }}>
              {certFieldKeys.map((k) => (<Chip key={`field-${k}`} size="small" label={k} />))}
            </Box>
          </Stack>
          <Divider />
        </>
      )}

      {/* certType */}
      <Stack direction="row" spacing={1} sx={ROW_SX}>
        <Typography variant="body1" fontWeight="bold">certType</Typography>
        <Box px={3}><Typography variant="body1" sx={{ ...MONO_SX, fontSize: '0.95rem' }}>{resolvedCertType}</Typography></Box>
      </Stack>

      {/* Verifier derived from registrant */}
      {verifier && (
        <>
          <Divider />
          <Stack direction="row" spacing={1} sx={{ ...ROW_SX, height: 'auto' }}>
            <Typography variant="body1" fontWeight="bold" sx={{ mt: 0.5 }}>Verifier</Typography>
            <Box px={3}><CounterpartyChip counterparty={verifier} label="Verifier" clickable={false} size={0.85 * size} /></Box>
          </Stack>
        </>
      )}
    </Stack>
  )
}

export default withRouter(CertificateChip)
