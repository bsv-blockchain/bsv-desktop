import React, { useEffect, useState, useContext } from 'react';
import { Button, Typography, IconButton, Grid, Link, Paper, Box, CircularProgress, MenuItem } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import DownloadIcon from '@mui/icons-material/Download';
import { useHistory, useParams, useLocation } from 'react-router-dom';
import { toast } from 'react-toastify';
import PageHeader from '../../../components/PageHeader';
import { WalletContext } from '../../../WalletContext';
import { UserContext } from '../../../UserContext';
import { WalletOutput } from '@bsv/sdk';
import BasketAccessList from '../../../components/BasketAccessList';

// Placeholder type for basket details - adjust based on actual SDK response
interface BasketDetails {
  id: string;
  name: string;
  description: string;
  documentationURL?: string;
  iconURL?: string;
  originator?: string; // Or relevant identifier
}

/**
 * Display the access information for a particular basket.
 */
const BasketAccess: React.FC = () => {
  const { basketId } = useParams<{ basketId: string }>();
  const history = useHistory();
  const location = useLocation<{
    id?: string;
    name?: string;
    description?: string;
    iconURL?: string;
    documentationURL?: string;
  }>();
  const { managers, adminOriginator } = useContext(WalletContext);
  const { onDownloadFile } = useContext(UserContext);

  const [basketDetails, setBasketDetails] = useState<BasketDetails | null>(null);
  const [itemsInBasket, setItemsInBasket] = useState<WalletOutput[]>([]);
  const [copied, setCopied] = useState<{ [key: string]: boolean }>({ id: false });
  const [loading, setLoading] = useState<boolean>(true);
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
    const fetchBasketData = async () => {
      if (!managers.permissionsManager || !basketId) return;

      setLoading(true);
      setError(null);
      try {
        // We don't need to call listBasketAccess here since BasketAccessList component handles that
        // The BasketAccessList component will fetch and display permissions for this basket
        // Update the itemsInBasket state with the outputs
        const { outputs } = await managers.permissionsManager.listOutputs({
          basket: basketId,
          includeTags: true
        }, adminOriginator)

        // Type assertion is needed since permissions and outputs may have different structures
        setItemsInBasket(outputs as WalletOutput[])

        // --- Get Basket Details --- 
        // First check if we already have the details in the router state
        if (location.state && location.state.id === basketId) {
          // Use the data passed via router state
          setBasketDetails({
            id: basketId,
            name: location.state.name || `Basket ${basketId.substring(0, 6)}...`,
            description: location.state.description || 'No description available',
            documentationURL: location.state.documentationURL,
            iconURL: location.state.iconURL,
          });
        }
        // else {
        //   // TODO: Replace with actual SDK call to get basket details by ID
        //   // Example: const details = await managers.walletManager.getBasketDetails(basketId);
        //   // Using placeholder data for now
        //   const placeholderDetails: BasketDetails = {
        //     id: basketId,
        //     name: `Basket ${basketId.substring(0, 6)}...`,
        //     description: 'This is a placeholder description for the basket. Details should be fetched from the wallet manager.',
        //     documentationURL: 'https://docs.example.com/basket',
        //     iconURL: '', // Add a default icon URL if available
        //   };
        //   setBasketDetails(placeholderDetails);
        // }

      } catch (err: any) {
        console.error('Failed to fetch basket data:', err);
        setError(`Failed to load basket data: ${err.message}`);
        toast.error(`Failed to load basket data: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };

    fetchBasketData();
  }, [basketId, managers.permissionsManager]);

  const handleExport = () => {
    if (!itemsInBasket) return;
    try {
      const dataStr = JSON.stringify(itemsInBasket, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      onDownloadFile(blob, `basket_${basketId}_contents.json`);
    } catch (err: any) {
      console.error('Failed to export data:', err);
      toast.error(`Failed to export data: ${err.message}`);
    }
  };

  // TODO: Implement revoke logic using managers.permissionsManager
  const handleRevokeAll = () => {
    // Example: Use a confirmation dialog
    if (window.confirm('Are you sure you want to revoke all access to this basket? This action cannot be undone.')) {
      console.warn('Revoke All Access functionality not implemented yet.');
      // try {
      //   await managers.permissionsManager.revokeBasketAccess({ basketId }); // Adjust method name and params
      //   toast.success('All access revoked.');
      //   // Optionally navigate away or update UI
      // } catch (err: any) { 
      //   toast.error(`Failed to revoke access: ${err.message}`);
      // }
    }
  };

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '80vh' }}><CircularProgress /></Box>;
  }

  if (error) {
    return <Typography color="error" sx={{ p: 2 }}>{error}</Typography>;
  }

  if (!basketDetails) {
    return <Typography sx={{ p: 2 }}>Basket not found.</Typography>;
  }

  const { id, name, description, documentationURL, iconURL } = basketDetails;

  return (
    <Grid container spacing={3} direction='column' sx={{ p: 2 }}> {/* Added padding */}
      <Grid item>
        <PageHeader
          // history={history} // history might not be needed if PageHeader handles back navigation internally
          history={history}
          title={name}
          subheading={
            <Box>
              <Typography variant='caption' color='textSecondary' display='block'>
                {`Items in Basket: ${itemsInBasket.length}`}
              </Typography>
              <Typography variant='caption' color='textSecondary' sx={{ display: 'flex', alignItems: 'center', mt: -0.5 }}>
                Basket ID: {id}
                <IconButton size='small' onClick={() => handleCopy(id, 'id')} disabled={copied.id} sx={{ ml: 0.5 }}>
                  {copied.id ? <CheckIcon fontSize='small' /> : <ContentCopyIcon fontSize='small' />}
                </IconButton>
              </Typography>
            </Box>
          }
          icon={iconURL} // Pass icon URL
          buttonTitle='Export Contents'
          buttonIcon={<DownloadIcon />}
          onClick={handleExport}
        />
      </Grid>

      <Grid item>
        <Typography variant='h5' gutterBottom>
          Basket Description
        </Typography>
        <Typography variant='body1' gutterBottom> {/* Changed to body1 */}
          {description}
        </Typography>
      </Grid>

      {documentationURL && (
        <Grid item>
          <Typography variant='h5' gutterBottom>
            Learn More
          </Typography>
          <Typography variant='body1'> {/* Changed to body1 */}
            You can learn more about how to manipulate and use the items in this basket from the following URL:
          </Typography>
          <Link href={documentationURL} target='_blank' rel='noopener noreferrer' sx={{ display: 'block', mt: 1 }}>{documentationURL}</Link>
        </Grid>
      )}

      <Grid item>
        <Paper elevation={3} sx={{ padding: 2, borderRadius: 2 }}> {/* Updated sx */}
          <Typography variant='h4' gutterBottom sx={{ pl: 0.5 }}>
            Apps with Access
          </Typography>
          <BasketAccessList
            basket={id}
            itemsDisplayed='apps'
            canRevoke
            showEmptyList
          />
        </Paper>
      </Grid>

      <Grid item alignSelf='center'>
        <Button color='error' onClick={handleRevokeAll}>
          Revoke All Access
        </Button>
      </Grid>

    </Grid>
  );
};

export default BasketAccess;
