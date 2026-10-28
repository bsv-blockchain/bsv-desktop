import ColorProtocolPermissionHandler from './ColorProtocolPermissionHandler';
import { useContext, useState } from 'react';
import { Button, Box, Stack, Typography, Checkbox, FormControlLabel, Select, MenuItem } from '@mui/material';
import { toast } from 'react-toastify';
import CustomDialog from '../CustomDialog/index';
import { WalletContext } from '../../WalletContext';
import { UserContext } from '../../UserContext';
import CounterpartyChip from '../CounterpartyChip/index';
import useAppDisplayName from '../../hooks/useAppDisplayName';
import useRegistryProtocolDescription from '../../hooks/useRegistryProtocolDescription';
import useManifestProtocolDescription from '../../hooks/useManifestProtocolDescription';

const titles: Record<string, string> = {
  protocol: 'Allow access to an app feature?',
  renewal: 'Renew access to an app feature?',
  identity: 'Share wallet identity information?',
  basket: 'Allow access to saved app data?',
};
const operationTitles: Record<string, string> = {
  publicKey: 'Share an app public key?',
  identityKey: 'Share your public wallet identity?',
  signing: 'Allow message signatures?',
  encrypting: 'Protect or open app data?',
  hmac: 'Allow data integrity checks?',
  linkageRevelation: 'Share a key relationship?',
  labelApply: 'Allow transaction labels?',
  labelList: 'Allow access to labeled history?',
};
const ProtocolPermissionHandler = () => {
  const { protocolRequests, advanceProtocolQueue, managers } = useContext(WalletContext);
  const { protocolAccessModalOpen } = useContext(UserContext);
  const currentPerm = protocolRequests[0];
  const appName = useAppDisplayName(currentPerm?.originator);
  const protocolName = Array.isArray(currentPerm?.protocolID)
    ? currentPerm.protocolID[1]
    : String(currentPerm?.protocolID ?? '');
  const manifestDescription = useManifestProtocolDescription(
    currentPerm?.originator,
    currentPerm?.description ? undefined : protocolName
  );
  // Choices belong to one request, so a following prompt never inherits Remember.
  const registry = useRegistryProtocolDescription(protocolName, currentPerm?.protocolSecurityLevel ?? 1);
  const [choice, setChoice] = useState({ requestID: '', remember: false });
  const [sessionChoice, setSessionChoice] = useState({ requestID: '', value: 'session' });
  const [busyID, setBusyID] = useState('');
  if (!protocolAccessModalOpen || !currentPerm) return null;
  const { requestID, originator, protocolID, protocolSecurityLevel, counterparty } = currentPerm;
  const busy = busyID === requestID;
  const remember = choice.requestID === requestID && choice.remember;
  const description = currentPerm.description || manifestDescription;
  const isEcpm = protocolName.startsWith('p ecpm ');
  const label = currentPerm.actionLabel?.label;
  const session = !currentPerm.privileged && (sessionChoice.requestID !== requestID || sessionChoice.value === 'session');
  const notify = (op: string) =>
    window.dispatchEvent(
      new CustomEvent('protocol-permissions-changed', {
        detail: { op, originator, protocolID, protocolSecurityLevel, counterparty },
      })
    );
  const handleDeny = async () => {
    if (busy) return;
    setBusyID(requestID);
    try {
      await managers.permissionsManager?.denyPermission(requestID);
      notify('deny');
    } catch {
      toast.error('Could not dismiss this request. Try again.');
    } finally {
      setBusyID('');
      advanceProtocolQueue();
    }
  };
  const handleGrant = async () => {
    if (busy) return;
    setBusyID(requestID);
    try {
      if (!managers.permissionsManager) throw new Error('Wallet is unavailable');
      await managers.permissionsManager.grantPermission({ requestID, ephemeral: !remember && !session, sessionDurationMs: !remember && session ? 1_800_000 : undefined });
      notify('grant');
    } catch {
      // The manager resolves the requested operation before minting a remembered
      // permission. Never imply that a failed mint revoked the allowed operation.
      toast.error(
        remember
          ? 'This request was allowed, but the permission could not be saved. You may be asked again.'
          : 'Could not allow this request. Try again.'
      );
    } finally {
      setBusyID('');
      advanceProtocolQueue();
    }
  };
  const actions = (
    <Stack direction="row" spacing={1} sx={{ width: '100%', p: 1 }}>
      <Button
        variant="outlined"
        fullWidth
        disabled={busy}
        onClick={handleDeny}
        data-testid="protocol-permission-deny"
        data-proofrun="protocol-permission-deny"
      >
        Don’t allow
      </Button>
      <Button
        variant="contained"
        fullWidth
        disabled={busy}
        onClick={handleGrant}
        data-testid="protocol-permission-allow"
        data-proofrun="protocol-permission-allow"
      >
        {busy
          ? remember
            ? 'Saving permission…'
            : 'Allowing…'
          : remember
            ? 'Allow and remember'
            : session ? 'Allow for this session' : 'Allow once'}
      </Button>
    </Stack>
  );
  return (
    <CustomDialog
      open
      title={
        (isEcpm ? 'Allow card and data masking?' : undefined) || operationTitles[currentPerm.usageType || ''] ||
        titles[currentPerm.type || 'protocol'] ||
        titles.protocol
      }
      onClose={busy ? undefined : handleDeny}
      actions={actions}
    >
      <Stack spacing={2} sx={{ pb: 1 }}>
        <Box>
          <Typography fontWeight={700}>{appName || 'Requesting application'}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
            {originator}
          </Typography>
        </Box>
        {label && <Typography>{currentPerm.usageType === 'labelApply'
          ? `Add “${label}” to transactions this app creates.`
          : `Read wallet transactions labeled “${label}”, including matching activity from other apps.`}</Typography>}
        {isEcpm && <Typography>Mask and unmask data for this app feature. Your private keys stay in the wallet. No payment permission is requested.</Typography>}
        {description ? (
          <Box>
            <Typography variant="caption" color="text.secondary">
              Purpose provided by the app
            </Typography>
            <Typography>{description}</Typography>
          </Box>
        ) : (
          <Typography>This app wants to use wallet keys for the feature shown below.</Typography>
        )}
        {registry && <Box><Typography variant="caption">Registry description · {registry.publisher.slice(0, 12)}…</Typography><Typography>{registry.description}</Typography></Box>}
        {!isEcpm && !label && <Typography variant="body2">Session or remembered access covers this protocol’s public keys, signatures, encryption and integrity checks across all its key IDs.</Typography>}
        {currentPerm.privileged && (
          <Typography color="warning.main" fontWeight={700}>
            Uses a protected wallet key. Your wallet’s unlock policy still applies.
          </Typography>
        )}
        <Box sx={{ p: 1.5, bgcolor: 'action.hover', borderRadius: 2 }}>
          <Typography variant="caption" color="text.secondary">
            Requested feature
          </Typography>
          <Typography fontWeight={600}>{label || (isEcpm ? protocolName.slice(7) : protocolName) || 'App feature'}</Typography>
          <Typography variant="body2" color="text.secondary">
            {counterparty === 'anyone'
              ? 'Public key scope — no specific person or service.'
              : counterparty === 'self'
                ? 'Uses your wallet’s own key.'
                : protocolSecurityLevel === 1
                  ? 'Applies to this feature across counterparties.'
                  : 'Uses a key shared with the counterparty in the details.'}
          </Typography>
        </Box>
        {!currentPerm.privileged && <Select size="small" fullWidth aria-label="Permission duration" value={session ? 'session' : 'once'} onChange={event => setSessionChoice({ requestID, value: event.target.value })}>
          <MenuItem value="once">Allow once</MenuItem><MenuItem value="session">This wallet session · up to 30 minutes</MenuItem>
        </Select>}
        <Typography variant="body2">Session access ends when the wallet changes or locks, when revoked, or after 30 minutes. Manage it under App access.</Typography>
        <Typography variant="body2">
          Allow once approves this request only. It does not save a permission token or pay a fee to
          remember it.
        </Typography>
        <Box>
          <FormControlLabel
            control={
              <Checkbox
                checked={remember}
                disabled={busy}
                onChange={(_, checked) => setChoice({ requestID, remember: checked })}
              />
            }
            label="Remember this feature for this app"
          />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', pl: 4 }}>
            Optional: saves an on-chain permission token. Transaction and wallet service fees may
            apply. Allows future uses of this feature’s keys until you revoke it in Settings.
          </Typography>
        </Box>
        <Box component="details" sx={{ '& summary': { cursor: 'pointer', fontWeight: 600 } }}>
          <summary>Technical details</summary>
          <Typography variant="body2" sx={{ mt: 1, overflowWrap: 'anywhere' }}>
            Protocol: {protocolName}
            <br />
            Security level: {protocolSecurityLevel}
            <br />
            Counterparty: {counterparty || 'self'}
            {registry && <><br />Registry publisher: {registry.publisher}</>}
            {currentPerm.moduleDetails && <><br />Operation: {currentPerm.moduleDetails.operation}<br />Key ID: {currentPerm.moduleDetails.keyID}<br />Point: {currentPerm.moduleDetails.point}</>}
          </Typography>
          {counterparty && !['anyone', 'self'].includes(counterparty) && (
            <CounterpartyChip counterparty={counterparty} clickable={false} />
          )}
        </Box>
      </Stack>
    </CustomDialog>
  );
};
export default function ProtocolOrColorPermissionHandler() {
  const { protocolRequests } = useContext(WalletContext);
  return protocolRequests[0]?.colorLinkage ? <ColorProtocolPermissionHandler /> : <ProtocolPermissionHandler />;
}
