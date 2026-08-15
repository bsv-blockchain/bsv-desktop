/**
 * Transfers — unified peer-to-peer surface that consolidates PeerPay
 * (Payments) and PeerToken (Tokens) into one page with two tabs. Replaces the
 * former separate "Payments" and "Peer Tokens" sidebar entries; the Assets
 * page is now purely for viewing holdings.
 *
 * Each tab renders its existing page component unchanged. We conditionally
 * mount (rather than hide) so only the active surface polls its MessageBox
 * inbox — switching tabs reloads that tab's state, which both pages already
 * do on mount.
 */
import React, { useState } from 'react'
import { Box, Tabs, Tab } from '@mui/material'
import Payments from '../Payments'
import PeerTokens from '../PeerTokens'

export default function Transfers() {
  const [tab, setTab] = useState(0)
  return (
    <Box>
      <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 2, pt: 1 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} aria-label="transfers tabs">
          <Tab label="Payments" />
          <Tab label="Tokens" />
        </Tabs>
      </Box>
      {tab === 0 ? <Payments /> : <PeerTokens />}
    </Box>
  )
}
