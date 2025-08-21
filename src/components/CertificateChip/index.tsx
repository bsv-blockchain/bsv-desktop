// src/components/CertificateChip/index.tsx
import React from 'react'
import {
  Chip,
  Box,
  Typography,
  IconButton,
  Tooltip,
  Link as MuiLink,
  Stack,
  Avatar,
  Divider
} from '@mui/material'
import { withRouter, RouteComponentProps } from 'react-router-dom'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import CounterpartyChip from '../CounterpartyChip'
import { Base64String } from '@bsv/sdk'
// if your project already has this util (as in your uploaded example), use it:
import { deterministicImage } from '../../utils/deterministicImage'

interface CertificateChipProps extends RouteComponentProps {
  certFields?: string[]
  certType: Base64String
  expiry?: number // epoch seconds
  originator: string
  outputIndex: number
  outputScript: string // hex
  privileged: boolean
  satoshis: number
  tx?: number[] // bytes array
  txid: string
  verifier?: string

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
function bytesLen(a?: number[]): number | undefined {
  if (!a) return undefined
  return a.length
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
function ExplorerIconLink({ txid }: { txid: string }) {
  const href = `https://whatsonchain.com/tx/${txid}`
  return (
    <Tooltip title="Open in block explorer">
      <IconButton component={MuiLink} href={href} target="_blank" rel="noreferrer" size="small" aria-label="open in explorer">
        <OpenInNewIcon fontSize="inherit" />
      </IconButton>
    </Tooltip>
  )
}
function originAvatar(origin: string) {
  const src = deterministicImage?.(origin)
  const label = origin
    .replace(/^https?:\/\//, '')
    .replace(/\/.*/, '')
    .split('.')
    .filter(Boolean)
  const core = label.length >= 2 ? label[label.length - 2] : label[0] || '?'
  const letter = (core[0] || '?').toUpperCase()
  return { src, letter }
}

/* ---------- component ---------- */
const ROW_SX = {
  height: '3em',
  width: '100%',
  alignItems: 'center',
  justifyContent: 'space-between'
} as const

const MONO_SX = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  wordBreak: 'break-all'
} as const

const CertificateChip: React.FC<CertificateChipProps> = ({
  certFields = [],
  certType,
  expiry,
  originator,
  outputIndex,
  outputScript,
  privileged,
  satoshis,
  tx,
  txid,
  verifier,
  clickable = true,
  size = 1.0,
  backgroundColor = 'transparent',
  onClick
}) => {
  const rel = relativeFromEpochSeconds(expiry)
  const abs = isoFromEpochSeconds(expiry)
  const { src, letter } = originAvatar(originator)

  return (
    <Stack
      spacing={1}
      onClick={clickable ? onClick : undefined}
      sx={(theme) => ({
        width: '100%',
        p: 1.5,
        borderRadius: 3,
        border: '1px solid',
        borderColor: 'divider',
        bgcolor:
          backgroundColor !== 'transparent'
            ? backgroundColor
            : theme.palette.mode === 'dark'
            ? 'rgba(255,255,255,0.02)'
            : 'rgba(0,0,0,0.02)',
        cursor: clickable ? 'pointer' : 'default'
      })}
    >
      {/* Header */}
      {/* <Stack direction="row" spacing={1} alignItems="center" sx={{ ...ROW_SX, height: 'auto' }}>
        <Avatar
          src={src}
          sx={(theme) => ({
            width: 36,
            height: 36,
            fontSize: 14,
            bgcolor: src ? 'transparent' : privileged ? theme.palette.warning.main : theme.palette.primary.main,
            color: src ? undefined : theme.palette.getContrastText(privileged ? theme.palette.warning.main : theme.palette.primary.main),
            boxShadow: 1
          })}
        >
          {!src && letter}
        </Avatar>
        <Typography variant="h6" fontWeight="bold" sx={{ mr: 0.5 }}>
          {originator}
        </Typography>
      </Stack>

      <Divider /> */}

      {/* Expiry */}
      {expiry !== undefined && (
        <>
          <Stack direction="row" spacing={1} sx={ROW_SX}>
            <Typography variant="body1" fontWeight="bold">Expires</Typography>
            <Box px={3}>
              <Typography variant="body1" sx={{ fontSize: '1rem' }}>
                {rel} {abs ? `(${abs})` : ''}
              </Typography>
            </Box>
          </Stack>
          <Divider />
        </>
      )}

      {/* Fields (auto-height section like in your example) */}
      {certFields.length > 0 && (
        <>
          <Stack direction="row" spacing={1} sx={{ width: '100%', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <Typography variant="body1" fontWeight="bold" sx={{ lineHeight: '32px' }}>
              Fields
            </Typography>
            <Box px={3} sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, maxWidth: '70%' }}>
              {certFields.map((f, i) => (
                <Chip key={`field-${i}-${f}`} size="small" label={f} />
              ))}
            </Box>
          </Stack>
          <Divider />
        </>
      )}

      {/* certType */}
      <Stack direction="row" spacing={1} sx={ROW_SX}>
        <Typography variant="body1" fontWeight="bold">certType</Typography>
        <Box px={3}>
          <Typography variant="body1" sx={{ ...MONO_SX, fontSize: '0.95rem' }}>
            {certType}
          </Typography>
        </Box>
      </Stack>

      {/* <Divider /> */}

      {/* txid + bytes */}
      {/* <Stack direction="row" spacing={1} sx={ROW_SX}>
        <Typography variant="body1" fontWeight="bold">txid</Typography>
        <Box px={3} sx={{ display: 'flex', alignItems: 'center' }}>
          <Typography variant="body1" sx={{ ...MONO_SX, fontSize: '0.95rem' }}>
            {truncateMiddle(txid, 20)}
          </Typography>
          <ExplorerIconLink txid={txid} />
          {typeof bytesLen(tx) === 'number' && (
            <Typography variant="body2" sx={{ ml: 1, opacity: 0.8 }}>
              {bytesLen(tx)} bytes
            </Typography>
          )}
        </Box>
      </Stack>

      <Divider /> */}

      {/* outputScript */}
      {/* <Stack direction="row" spacing={1} sx={{ width: '100%', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <Typography variant="body1" fontWeight="bold" sx={{ lineHeight: '24px' }}>
          outputScript
        </Typography>
        <Box px={3} sx={{ maxWidth: '70%' }}>
          <Typography variant="body2" sx={{ ...MONO_SX }}>
            {truncateMiddle(outputScript, 24)}
          </Typography>
        </Box>
      </Stack> */}

      {/* verifier (optional) */}
      {verifier && (
        <>
          <Divider />
          <Stack direction="row" spacing={1} sx={{ ...ROW_SX, height: 'auto' }}>
            <Typography variant="body1" fontWeight="bold" sx={{ mt: 0.5 }}>
              Verifier
            </Typography>
            <Box px={3}>
              <CounterpartyChip counterparty={verifier} label="Verifier" clickable={false} size={0.85 * size} />
            </Box>
          </Stack>
        </>
      )}
    </Stack>
  )
}

export default withRouter(CertificateChip)
