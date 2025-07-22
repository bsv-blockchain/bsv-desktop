import React, { useState, useEffect, useContext } from 'react';
import {
  Typography,
  IconButton,
  Grid,
  Link as MuiLink, // Renamed to avoid conflict
  Paper,
  Box,
  CircularProgress
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import { useHistory, useParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import PageHeader from '../../../components/PageHeader'; // Assuming this component exists and is TSX
// import ProtocolPermissionList from '../../../components/ProtocolPermissionList'; // Needs migration/creation
import { WalletContext } from '../../../WalletContext';
import { DEFAULT_APP_ICON } from '../../../constants/popularApps';
import ProtocolPermissionList from '../../../components/ProtocolPermissionList';
import { RegistryClient, SecurityLevel } from '@bsv/sdk';

// Placeholder type for protocol details - adjust based on actual SDK response
interface ProtocolDetails {
  protocolName: string;
  iconURL?: string;
  securityLevel: number;
  protocolID: string;
  // counterparty?: string; // Counterparty might be specific to a permission, not the protocol itself
  description: string;
  documentationURL?: string;
}

// Interface for location state passed from navigation
interface LocationState {
  protocolName?: string;
  iconURL?: string;
  description?: string;
  documentationURL?: string;
}

/**
 * Display the access information for a particular protocol.
 */
const ProtocolAccess: React.FC = () => {
  const { protocolId: encodedProtocolId, securityLevel: encodedSecurityLevel } = useParams<{ protocolId: string, securityLevel: string }>();
  const protocolId = decodeURIComponent(encodedProtocolId);
  const securityLevel = Number(decodeURIComponent(encodedSecurityLevel));
  const history = useHistory<LocationState>();
  const { managers, settings } = useContext(WalletContext);

  // Get passed data from navigation state
  const locationState = history.location.state;

  // Initialize state with passed data if available
  const [protocolDetails, setProtocolDetails] = useState<ProtocolDetails | null>(
    locationState ? {
      protocolName: locationState.protocolName || `Protocol: ${protocolId}`,
      iconURL: locationState.iconURL || DEFAULT_APP_ICON,
      securityLevel,
      protocolID: protocolId,
      description: locationState.description || 'Loading protocol description...',
      documentationURL: locationState.documentationURL || 'https://docs.example.com/protocols'
    } : null
  );
  const [copied, setCopied] = useState<{ [key: string]: boolean }>({ id: false });
  const [loading, setLoading] = useState<boolean>(!locationState); // Don't show loading if we have data
  const [error, setError] = useState<string | null>(null);
  // Copies the data and timeouts the checkmark icon
  const handleCopy = (data: string, type: string) => {
    navigator.clipboard.writeText(data);
    setCopied(prev => ({ ...prev, [type]: true }));
    setTimeout(() => {
      setCopied(prev => ({ ...prev, [type]: false }));
    }, 2000);
  };

  useEffect(() => {
    console.log('securityLevel', encodedSecurityLevel)

    // Only fetch data if we don't already have it from navigation state
    if (protocolDetails && locationState) {
      console.log('Using passed protocol data, skipping fetch');
      return;
    }

    const fetchProtocolDetails = async () => {
      if (!managers.walletManager) return; // Or relevant manager
      
      setLoading(true);
      setError(null);
      try {
        const registrant = new RegistryClient(managers.walletManager)
        const certifiers = settings.trustSettings.trustedCertifiers.map(x => x.identityKey)
        const results = await registrant.resolve('protocol', {
        protocolID: [securityLevel as SecurityLevel, protocolId],
        registryOperators: certifiers
        })

        let mostTrustedIndex = 0
        let maxTrustPoints = 0
        for(let i = 0; i < results.length; i ++) { 
          const resultTrustLevel = settings.trustSettings.trustedCertifiers.find(x => x.identityKey === results[i].registryOperator)?.trust || 0
          if(resultTrustLevel > maxTrustPoints){
            mostTrustedIndex = i
            maxTrustPoints = resultTrustLevel
          }
        }
        const trusted = results[mostTrustedIndex]
        // Placeholder logic:
        const placeholderDetails: ProtocolDetails = {
          protocolName: `Protocol: ${trusted.name}`,
          iconURL: trusted.iconURL,
          securityLevel,
          protocolID: protocolId,
          description: trusted.description,
          documentationURL: trusted.documentationURL,
        };
        setProtocolDetails(placeholderDetails);

      } catch (err: any) {
        console.error('Failed to fetch protocol details:', err);
        setError(`Failed to load protocol details: ${err.message}`);
        toast.error(`Failed to load protocol details: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };

    fetchProtocolDetails();
  }, [protocolId, managers.walletManager]);

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '80vh' }}><CircularProgress /></Box>;
  }

  if (error) {
    return <Typography color="error" sx={{ p: 2 }}>{error}</Typography>;
  }

  if (!protocolDetails) {
    return <Typography sx={{ p: 2 }}>Protocol details not found for ID: {protocolId}</Typography>;
  }

  const { protocolName, iconURL, protocolID, description, documentationURL } = protocolDetails;

  return (
    <Grid container spacing={3} direction='column' sx={{ p: 2 }}> {/* Added padding */}
      <Grid item>
        <PageHeader
          history={history}
          title={protocolName}
          subheading={
            <Box>
              <Typography variant='caption' color='textSecondary' display='block'>
                Security Level: <Typography variant='caption' fontWeight='bold'>{securityLevel}</Typography>
              </Typography>
              <Typography variant='caption' color='textSecondary' sx={{ display: 'flex', alignItems: 'center', mt: -0.5 }}>
                Protocol ID: <Typography variant='caption' fontWeight='bold' sx={{ ml: 0.5 }}>{protocolID}</Typography>
                <IconButton size='small' onClick={() => handleCopy(protocolID, 'id')} disabled={copied.id} sx={{ ml: 0.5 }}>
                  {copied.id ? <CheckIcon fontSize='small' /> : <ContentCopyIcon fontSize='small' />}
                </IconButton>
              </Typography>
            </Box>
          }
          icon={iconURL || DEFAULT_APP_ICON}
          showButton={false}
          buttonTitle="" // Added dummy prop
          onClick={() => { }} // Added dummy prop
        />
      </Grid>

      <Grid item>
        <Typography variant='h5' fontWeight='bold' gutterBottom>
          Protocol Description
        </Typography>
        <Typography variant='body1' gutterBottom>
          {description}
        </Typography>
      </Grid>

      {documentationURL && (
        <Grid item>
          <Typography variant='h5' fontWeight='bold' gutterBottom>
            Learn More
          </Typography>
          <Typography variant='body1'>You can learn more about how to interact with this protocol from the following URL:</Typography>
          <MuiLink href={documentationURL} target='_blank' rel='noopener noreferrer' sx={{ display: 'block', mt: 1 }}>{documentationURL}</MuiLink>
        </Grid>
      )}

      <Grid item sx={{ p: '1em' }}> {/* Consider adjusting padding */}
        <Paper elevation={3} sx={{ p: 2, borderRadius: 2 }}> {/* Use sx prop */}
          <Typography variant='h4' gutterBottom sx={{ pl: 0.5 }}> {/* Use sx prop */}
            Apps with Access
          </Typography>
          <Box sx={{ p: 4 }}>
            <ProtocolPermissionList
              protocol={protocolID}
              securityLevel={securityLevel}
              // counterparty={counterparty} // Counterparty might not be relevant here, depends on list context
              itemsDisplayed='apps'
              canRevoke
              showEmptyList
            />
          </Box>
        </Paper>
      </Grid>
    </Grid>
  );
};

export default ProtocolAccess;

