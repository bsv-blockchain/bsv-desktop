import { useEffect, useSyncExternalStore } from 'react';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import useAppDisplayName from '../hooks/useAppDisplayName';
import useManifestProtocolDescription from '../hooks/useManifestProtocolDescription';
import { EcpmSession } from './ecpmSession';

export function EcpmPrompt({
  session,
  onFocusRequested,
}: {
  session: EcpmSession;
  onFocusRequested?: () => Promise<void>;
}) {
  const pending = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const request = pending?.request;
  const once = pending?.durationMs === 0;
  const appName = useAppDisplayName(request?.originator);
  const description = useManifestProtocolDescription(
    request?.originator,
    request?.logicalProtocolID
  );
  useEffect(() => {
    if (pending && onFocusRequested) void onFocusRequested().catch(() => pending.answer(false));
  }, [pending, onFocusRequested]);
  return (
    <Dialog
      open={pending !== null}
      onClose={() => pending?.answer(false)}
      fullWidth
      maxWidth="sm"
      aria-labelledby="ecpm-consent-title"
      aria-describedby="ecpm-consent-description"
      PaperProps={{ sx: { m: 2, maxHeight: 'calc(100dvh - 32px)', width: 'calc(100% - 32px)' } }}
    >
      <DialogTitle id="ecpm-consent-title">Allow secure app calculations?</DialogTitle>
      <DialogContent dividers sx={{ overflowWrap: 'anywhere' }}>
        <Stack spacing={2}>
          <Box>
            <Typography fontWeight={700}>{appName || 'Requesting application'}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
              {request?.originator}
            </Typography>
          </Box>
          {description && (
            <Box>
              <Typography variant="caption" color="text.secondary">
                Purpose provided by the app
              </Typography>
              <Typography>{description}</Typography>
            </Box>
          )}
          <Stack direction="row" spacing={1} alignItems="center">
            <LockOutlinedIcon color="primary" />
            <Typography id="ecpm-consent-description">
              Use a wallet key to mask and unmask data for this app feature. The app receives the
              results; your secret key stays in your wallet.
            </Typography>
          </Stack>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            <Chip size="small" label={once ? "This request only" : "5 minutes"} />
            <Chip size="small" label="No payment permission" />
          </Stack>
          <Typography variant="body2">
            {once ? 'Approves the displayed operation, point and key ID once. Protected key access still follows the wallet’s unlock policy.' : 'This allows both masking and unmasking for all values and key IDs in this feature. Approval ends after five minutes or when the wallet changes.'}
          </Typography>
          <Typography variant="body2">
            Feature: <strong>{request?.logicalProtocolID}</strong>
          </Typography>
          {request?.securityLevel === 1 && (
            <Typography variant="body2">
              This feature may use keys for all counterparties.
            </Typography>
          )}
          {request?.securityLevel === 2 && (
            <Typography variant="body2">
              Key scope:{' '}
              {request.counterparty === 'self'
                ? 'your wallet’s own key'
                : request.counterparty === 'anyone'
                  ? 'the public “anyone” counterparty'
                  : 'one specific counterparty (see details)'}
              .
            </Typography>
          )}
          {request?.privileged && (
            <Box
              sx={{
                bgcolor: 'warning.main',
                color: 'warning.contrastText',
                borderRadius: 1,
                p: 1.5,
              }}
            >
              <Typography fontWeight={700}>Uses a protected wallet key</Typography>
              <Typography>Reason: {request.privilegedReason}</Typography>
            </Box>
          )}
          <Box
            component="details"
            sx={{
              '& summary': { cursor: 'pointer', fontWeight: 600 },
              '& dd': {
                m: 0,
                mb: 1,
                fontFamily: 'monospace',
                fontSize: 12,
                overflowWrap: 'anywhere',
              },
              '& dt': { typography: 'caption', color: 'text.secondary' },
            }}
          >
            <summary>Technical details</summary>
            <Box component="dl" sx={{ mb: 0 }}>
              <dt>Protocol / security level</dt>
              <dd>
                {request?.logicalProtocolID} / {request?.securityLevel}
              </dd>
              <dt>First operation</dt>
              <dd>{request?.operation}</dd>
              <dt>First key ID</dt>
              <dd>{request?.keyID}</dd>
              <dt>Counterparty</dt>
              <dd>{request?.securityLevel === 1 ? 'All counterparties' : request?.counterparty}</dd>
              <dt>First encoded point</dt>
              <dd>{request?.point}</dd>
            </Box>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ p: 2, gap: 1, flexShrink: 0 }}>
        <Button variant="outlined" onClick={() => pending?.answer(false)}>
          Don’t allow
        </Button>
        <Button variant="contained" onClick={() => pending?.answer(true)}>
          {once ? 'Allow once' : 'Allow for 5 minutes'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
