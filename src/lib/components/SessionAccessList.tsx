import { useContext, useEffect, useState } from 'react';
import { Box, Button, Typography, Stack } from '@mui/material';
import { WalletContext } from '../WalletContext';

export default function SessionAccessList({ originator }: { originator?: string }) {
  const { managers } = useContext(WalletContext);
  const [, refresh] = useState(0);
  useEffect(() => { const timer = setInterval(() => refresh(x => x + 1), 1000); return () => clearInterval(timer); }, []);
  const manager = managers.permissionsManager;
  const grants = (manager?.listSessionPermissions() ?? []).filter(grant => !originator || grant.request.originator === originator);
  const origins = [...new Set(grants.map(x => x.request.originator))];
  if (!origins.length) return null;
  return <Box sx={{ my: 3 }}><Typography variant="h4">Current session access</Typography>
    <Typography variant="body2">Ends on lock, wallet change, revocation or after 30 minutes. Revoking session access leaves separately remembered permissions in place.</Typography>
    <Stack spacing={2} sx={{ mt: 2 }}>{origins.map(origin => <Box key={origin} sx={{ p: 2, bgcolor: 'action.hover', borderRadius: 2 }}>
      <Typography fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>{origin}</Typography>
      {grants.filter(x => x.request.originator === origin).map((grant, i) => <Typography variant="body2" key={i}>
        {grant.request.actionLabel ? `${grant.request.actionLabel.operation === 'apply' ? 'Apply label' : 'Read labeled history'}: ${grant.request.actionLabel.label}` : grant.request.protocolID ? `${grant.request.protocolID[1].startsWith('p ecpm ') ? 'Card/data masking: ' + grant.request.protocolID[1].slice(7) : grant.request.protocolID[1]} · ${grant.request.protocolID[0] === 1 ? 'All counterparties' : grant.request.counterparty === 'self' ? 'Your wallet’s own keys' : grant.request.counterparty === 'anyone' ? 'Public key scope' : grant.request.counterparty}` : grant.request.basket || 'Certificate access'} · {Math.max(1, Math.ceil((grant.expiresAt - Date.now()) / 60_000))} min remaining
      </Typography>)}
      <Button onClick={() => { manager?.revokeSessionPermissions(origin); refresh(x => x + 1); }}>End session access</Button>
    </Box>)}</Stack></Box>;
}
