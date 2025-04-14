import { useContext } from 'react'
import { DialogContent, DialogActions, Button, Box, Stack, Tooltip, Avatar, Divider } from '@mui/material'
import CustomDialog from '../CustomDialog/index'
import { WalletContext } from '../../WalletContext'
import { UserContext } from '../../UserContext'
import AppChip from '../AppChip/index'
import ProtoChip from '../ProtoChip/index'
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser'
import CodeIcon from '@mui/icons-material/Code'
import CachedIcon from '@mui/icons-material/Cached'
import ShoppingBasketIcon from '@mui/icons-material/ShoppingBasket'
import deterministicColor from '../../utils/deterministicColor'

// Permission request types
type PermissionType = 'identity' | 'protocol' | 'renewal' | 'basket';

// Permission type documents
const permissionTypeDocs = {
  identity: {
    title: 'Trusted Entities Access Request',
    description: 'An app is requesting access to lookup identity information using the entities you trust.',
    icon: <VerifiedUserIcon fontSize="medium" />
  },
  renewal: {
    title: 'Protocol Access Renewal',
    description: 'An app is requesting to renew its previous access to a protocol.',
    icon: <CachedIcon fontSize="medium" />
  },
  basket: {
    title: 'Basket Access Request',
    description: 'An app wants to view your tokens within a specific basket.',
    icon: <ShoppingBasketIcon fontSize="medium" />
  },
  protocol: {
    title: 'Protocol Access Request',
    icon: <CodeIcon fontSize="medium" />
  }
};

const ProtocolPermissionHandler = () => {
  const { protocolRequests, advanceProtocolQueue, managers } = useContext(WalletContext)
  const { protocolAccessModalOpen } = useContext(UserContext)

  // Handle denying the top request in the queue
  const handleDeny = () => {
    if (protocolRequests.length > 0) {
      managers.permissionsManager?.denyPermission(protocolRequests[0].requestID)
    }
    advanceProtocolQueue()
  }

  // Handle granting the top request in the queue
  const handleGrant = () => {
    if (protocolRequests.length > 0) {
      managers.permissionsManager?.grantPermission({
        requestID: protocolRequests[0].requestID
      })
    }
    advanceProtocolQueue()
  }

  if (!protocolAccessModalOpen || !protocolRequests.length) return null
  const currentPerm = protocolRequests[0]
  // Get permission type document
  const getPermissionTypeDoc = () => {
    // Default to protocol if type is undefined
    const type = currentPerm.type || 'protocol';
    return permissionTypeDocs[type];
  };

  const getIconAvatar = () => (
    <Avatar 
      sx={{ 
        width: 40,
        height: 40,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center'
      }}
    >
      {getPermissionTypeDoc().icon}
    </Avatar>
  );

  return (
    <CustomDialog
      open={protocolAccessModalOpen}
      title={getPermissionTypeDoc().title}
      icon={getPermissionTypeDoc().icon}
      onClose={handleDeny} // If the user closes via the X, treat as "deny"
    >
      <DialogContent>
        {/* Main content with app and protocol details */}
        <Stack spacing={1}>
          {/* App section */}
          {currentPerm.description && <Stack>
            {currentPerm.description}
          </Stack>}

          <AppChip
            size={1.5}
            showDomain
            label={currentPerm.originator || 'unknown'}
            clickable={false}
          />

          <Divider />

          {/* Protocol details */}
          <ProtoChip
            protocolID={currentPerm.protocolID}
            securityLevel={currentPerm.protocolSecurityLevel}
          />

          {/* Counterparty section (if available) */}
          {currentPerm.counterparty && (
            <>
              <Divider />
              <Stack direction="row" alignItems="center" spacing={1} justifyContent="space-between" sx={{
                height: '3em',
                width: '100%'
              }}>
                <Box sx={{ fontWeight: 'bold' }}>
                  Counterparty:
                </Box>
                <Stack px={3}>
                  {currentPerm.counterparty}
                </Stack>
              </Stack>
            </>
          )}
        </Stack>
      </DialogContent>

      {/* Visual signature */}
      <Tooltip title="Unique visual signature for this request" placement="top">
        <Box sx={{ mb: 3, py: 0.5, background: deterministicColor(JSON.stringify(currentPerm)) }} />
      </Tooltip>

      <DialogActions sx={{ justifyContent: 'space-between' }}>
        <Button 
          onClick={handleDeny}
          variant="outlined"
          color="inherit"
        >
          Deny
        </Button>
        <Button 
          onClick={handleGrant}
          variant="contained"
          color="primary"
        >
          Grant Access
        </Button>
      </DialogActions>
    </CustomDialog>
  )
}

export default ProtocolPermissionHandler
