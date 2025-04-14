import { useContext, useState, useEffect, useCallback } from 'react'
import {
  DialogContent,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Box,
  Stack
} from '@mui/material'
import { Send, Cancel } from '@mui/icons-material'
import AmountDisplay from '../AmountDisplay/index.js'
import CustomDialog from '../CustomDialog/index.js'
import { WalletContext } from '../../WalletContext'
import AppChip from '../AppChip/index.js'
import { Services } from '@bsv/wallet-toolbox-client'
import { UserContext } from '../../UserContext.js'

const services = new Services('main')

const SpendingAuthorizationHandler: React.FC = () => {
  const {
    managers, spendingRequests, advanceSpendingQueue
  } = useContext(WalletContext)
  
  const { spendingAuthorizationModalOpen } = useContext(UserContext)
  
  const [usdPerBsv, setUsdPerBSV] = useState(35)

  const handleCancel = () => {
    if (spendingRequests.length > 0) {
      managers.permissionsManager!.denyPermission(spendingRequests[0].requestID)
    }
    advanceSpendingQueue()
  }

  const handleGrant = async ({ singular = true, amount }: { singular?: boolean, amount?: number }) => {
    if (spendingRequests.length > 0) {
      managers.permissionsManager!.grantPermission({
        requestID: spendingRequests[0].requestID,
        ephemeral: singular,
        amount
      })
    }
    advanceSpendingQueue()
  }

    // Helper function to figure out the upgrade amount (note: consider moving to utils)
  const determineUpgradeAmount = (previousAmountInSats: any, returnType = 'sats') => {
    let usdAmount
    const previousAmountInUsd = previousAmountInSats * (usdPerBsv / 100000000)

    // The supported spending limits are $5, $10, $20, $50
    if (previousAmountInUsd <= 5) {
      usdAmount = 5
    } else if (previousAmountInUsd <= 10) {
      usdAmount = 10
    } else if (previousAmountInUsd <= 20) {
      usdAmount = 20
    } else {
      usdAmount = 50
    }

    if (returnType === 'sats') {
      return Math.round(usdAmount / (usdPerBsv / 100000000))
    }
    return usdAmount
  }

  useEffect(() => {
    // Fetch exchange rate when we have spending requests
    if (spendingRequests.length > 0) {
      services.getBsvExchangeRate().then(rate => {
        setUsdPerBSV(rate)
      })
    }
  }, [spendingRequests])

  if (spendingRequests.length === 0) {
    return null
  }

  // Get the current permission request
  const currentPerm = spendingRequests[0]

  return (
    <CustomDialog
      open={spendingAuthorizationModalOpen}
      title={!currentPerm.renewal ? 'Spending Request' : 'Spending Check-in'}
    >
      <DialogContent>
        <Stack alignItems="center">
          <AppChip
            size={2.5}
            label={currentPerm.originator}
            clickable={false}
            showDomain
          />
          <Box mt={2} />
          <TableContainer 
            component={Paper} 
            sx={{ 
              overflow: 'hidden',
              my: 3,
              width: '100%'
            }}
          >
            <Table 
              sx={{ 
                width: '100%',
                '& th, & td': { 
                  px: 3,
                  py: 1.5
                }
              }} 
              aria-label='spending details table' 
              size='medium'
            >
              <TableHead>
                <TableRow
                  sx={{
                    color: 'text.primary',
                    '& th': {
                      fontSize: '0.875rem',
                      fontWeight: 600,
                      color: 'text.primary',
                      letterSpacing: '0.01em',
                      borderBottom: '1px solid',
                      borderColor: 'primary.light',
                    }
                  }}
                >
                  <TableCell>Description</TableCell>
                  <TableCell align='right'>Amount</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {currentPerm.lineItems.map((item, idx) => (
                  <TableRow
                    key={`item-${idx}-${item.description || 'unnamed'}`}
                    sx={{ 
                      '&:last-child td, &:last-child th': { 
                        border: 0 
                      },
                      '&:nth-of-type(odd)': { 
                        bgcolor: 'background.default' 
                      },
                      transition: 'background-color 0.2s ease',
                      '&:hover': {
                        bgcolor: 'action.hover',
                      }
                    }}
                  >
                    <TableCell 
                      component='th' 
                      scope='row'
                      sx={{
                        fontWeight: 500,
                        color: 'text.primary'
                      }}
                    >
                      {item.description || '—'}
                    </TableCell>
                    <TableCell 
                      align='right'
                      sx={{
                        fontWeight: 600,
                        color: 'secondary.main'
                      }}
                    >
                      <AmountDisplay>
                        {item.satoshis}
                      </AmountDisplay>
                    </TableCell>
                  </TableRow>
                ))}
                {/* Show total row if there are multiple items */}
                {currentPerm.lineItems.length > 1 && (
                  <TableRow
                    sx={{ 
                      bgcolor: 'primary.light',
                      '& td': {
                        py: 2,
                        fontWeight: 700,
                        color: 'primary.contrastText',
                        borderTop: '1px solid',
                        borderColor: 'divider'
                      }
                    }}
                  >
                    <TableCell>Total</TableCell>
                    <TableCell align="right">
                      <AmountDisplay>
                        {currentPerm.authorizationAmount}
                      </AmountDisplay>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Stack>
        
        <Box sx={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          mt: 3,
          px: 2
        }}>
          <Button
            variant="outlined"
            color="error"
            onClick={handleCancel}
            sx={{
              height: '40px'
            }}
          >
            Deny
          </Button>

          <Button
            variant="contained"
            color="secondary"
            onClick={() => handleGrant({ singular: false, amount: determineUpgradeAmount(currentPerm.amountPreviouslyAuthorized) })}
            sx={{ 
              minWidth: '120px',
              height: '40px'
            }}
          >
            Allow up to &nbsp;<AmountDisplay showFiatAsInteger>{determineUpgradeAmount(currentPerm.amountPreviouslyAuthorized)}</AmountDisplay>
          </Button>
          
          <Button
            variant="contained"
            color="success"
            onClick={() => handleGrant({ singular: true })}
            sx={{ 
              height: '40px'
            }}
          >
            Spend
          </Button>
        </Box>
      </DialogContent>
    </CustomDialog>
  )
}

export default SpendingAuthorizationHandler
