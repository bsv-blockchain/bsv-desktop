import { useState, useEffect, useCallback, FC, useContext } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
  Typography,
  LinearProgress,
  Grid,
  Box,
  CircularProgress
} from '@mui/material'
import { format } from 'date-fns'
import AmountDisplay from './AmountDisplay'
import { toast } from 'react-toastify'
import { WalletContext } from '../WalletContext'
import { PermissionToken, Services } from '@bsv/wallet-toolbox-client'

type Props = {
  app: string
  limit?: number
  onEmptyList?: () => void
}

const SpendingAuthorizationList: FC<Props> = ({ app, limit = 5, onEmptyList = () => { } }) => {
  const { managers } = useContext(WalletContext)

  const [authorization, setAuthorization] = useState<PermissionToken | null>(null)
  const [currentSpending, setCurrentSpending] = useState<number>(0)
  const [authorizedAmount, setAuthorizedAmount] = useState<number>(0)
  const [dialogOpen, setDialogOpen] = useState<boolean>(false)
  const [dialogLoading, setDialogLoading] = useState<boolean>(false)
  const [loading, setLoading] = useState<boolean>(true)
  const [usdPerBsv, setUsdPerBSV] = useState<number>(70)
  const services = new Services('main') // TODO: Move to wallet context

  // Determine the next upgrade tier in sats or USD
  const determineUpgradeAmount = (previousAmountInSats: number, returnType: 'sats' | 'usd' = 'sats'): number => {
    let nextTierUsdAmount: number
    const previousAmountInUsd = Math.round(previousAmountInSats * (usdPerBsv / 100000000))

    if (previousAmountInUsd < 5) nextTierUsdAmount = 5
    else if (previousAmountInUsd < 10) nextTierUsdAmount = 10
    else if (previousAmountInUsd < 20) nextTierUsdAmount = 20
    else nextTierUsdAmount = 50

    return returnType === 'sats'
      ? Math.round((nextTierUsdAmount * 100000000) / usdPerBsv)
      : nextTierUsdAmount
  }

  const refreshAuthorizations = useCallback(async (): Promise<void> => {
    try {
      const results = await managers.permissionsManager.listSpendingAuthorizations({ originator: app })
      if (!results || results.length === 0) {
        onEmptyList()
      } else {
        const currentAuthorization = results[0]
        const currentSpending = await managers.permissionsManager.querySpentSince(currentAuthorization)
        setAuthorization(currentAuthorization)
        setCurrentSpending(currentSpending)
        setAuthorizedAmount(currentAuthorization.authorizedAmount)
      }
    } catch {
      onEmptyList()
    } finally {
      setLoading(false)
    }
  }, [app, onEmptyList, managers.permissionsManager])

  const revokeAuthorization = (auth: PermissionToken): void => {
    setAuthorization(auth)
    setDialogOpen(true)
  }

  const updateSpendingAuthorization = async (auth: PermissionToken): Promise<void> => {
    if (!auth) return
    setDialogLoading(true)
    try {
      await managers.permissionsManager.ensureSpendingAuthorization({
        originator: app,
        satoshis: Math.round(determineUpgradeAmount(auth.authorizedAmount)),
        reason: 'Increase spending limit',
        seekPermission: true
      })
      // Add a delay before refreshing to ensure backend data is updated
      await new Promise(resolve => setTimeout(resolve, 1000))
      await refreshAuthorizations()
    } catch (e: unknown) {
      // Add a delay before refreshing to ensure backend data is updated
      await new Promise(resolve => setTimeout(resolve, 1000))
      await refreshAuthorizations()
      const errorMessage = e instanceof Error ? e.message : 'Unknown error'
      toast.error(`Failed to increase spending authorization: ${errorMessage}`)
    } finally {
      setDialogLoading(false)
    }
  }

  const handleConfirmRevoke = async (): Promise<void> => {
    if (!authorization) return
    setDialogLoading(true)
    try {
      await managers.permissionsManager.revokePermission(authorization)
      setDialogOpen(false)
      // Add a delay before refreshing to ensure backend data is updated
      await new Promise(resolve => setTimeout(resolve, 1000))
      await refreshAuthorizations()
    } catch (e: unknown) {
      // Add a delay before refreshing to ensure backend data is updated
      await new Promise(resolve => setTimeout(resolve, 1000))
      await refreshAuthorizations()
      const errorMessage = e instanceof Error ? e.message : 'Unknown error'
      toast.error(`Failed to revoke spending authorization: ${errorMessage}`)
      setDialogOpen(false)
    } finally {
      setDialogLoading(false)
    }
  }

  const handleDialogClose = (): void => {
    setDialogOpen(false)
  }

  const createSpendingAuthorization = async ({ limit: newLimit = limit }: { limit?: number }): Promise<void> => {
    try {
      await managers.permissionsManager.ensureSpendingAuthorization({
        originator: app,
        satoshis: Math.round(newLimit / (usdPerBsv / 100000000)),
        reason: 'Create a spending limit',
        seekPermission: true
      })
      // Add a delay before refreshing to ensure backend data is updated
      await new Promise(resolve => setTimeout(resolve, 1000))
      await refreshAuthorizations()
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error'
      toast.error(`Failed to create spending authorization: ${errorMessage}`)
    }
  }

  useEffect(() => {
    (async () => {
      try {
        const rate: number = await services.getBsvExchangeRate()
        setUsdPerBSV(rate)
      } catch {
        // fallback or leave default
      }
    })()
    refreshAuthorizations()
  }, [refreshAuthorizations])

  return (
    <>
      <Dialog open={dialogOpen}>
        <DialogTitle>Revoke Authorization?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            You can re-authorize spending next time you use this app.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDialogClose} disabled={dialogLoading}>
            Cancel
          </Button>
          <Button onClick={handleConfirmRevoke} disabled={dialogLoading}>
            {dialogLoading ? (
              <>
                <CircularProgress size={16} sx={{ mr: 1 }} />
                Revoking...
              </>
            ) : (
              'Revoke'
            )}
          </Button>
        </DialogActions>
      </Dialog>



      {loading ? (
        <Box textAlign="center" pt={6}>
          <CircularProgress size={40} />
          <Typography variant="body1" sx={{ mt: 2 }}>
            Loading spending authorizations...
          </Typography>
        </Box>
      ) : authorization ? (
        <Grid container direction="column" spacing={2} sx={{ p: 2 }}>
          {/* Monthly Spending Limits and Revoke Button */}
          <Grid container justifyContent="space-between" alignItems="center">
            <Box sx={{ flexGrow: 1 }}>
              <Typography variant="h2" gutterBottom>
                Monthly Spending Limits
              </Typography>
              <Typography variant="body1">
                This app is allowed to spend up to:
              </Typography>
              <Typography variant="h1" sx={{ pt: 1 }}>
                <AmountDisplay showFiatAsInteger>{authorizedAmount}</AmountDisplay>/mo.
              </Typography>
            </Box>
            <Button onClick={() => revokeAuthorization(authorization)}>
              Revoke
            </Button>
          </Grid>

          {/* Current Spending Display */}
          <Box sx={{ pt: 2 }}>
            <Typography variant="h5" paragraph>
              <b>
                Current Spending (since {format(new Date(new Date().setDate(1)), 'MMMM do')}):
              </b>{' '}
              <AmountDisplay>{currentSpending}</AmountDisplay>
            </Typography>
            {authorizedAmount > 0 && (
              <LinearProgress
                variant="determinate"
                value={Math.max(1, Math.min(100, (currentSpending / authorizedAmount) * 100))}
              />
            )}
          </Box>

          {/* Increase Limits Button */}
          <Grid container justifyContent="center" sx={{ pt: 2 }}>
            <Grid item xs={12} sm={6} md={4}>
              <Button 
                fullWidth 
                onClick={() => updateSpendingAuthorization(authorization)}
                disabled={dialogLoading}
              >
                {dialogLoading ? (
                  <>
                    <CircularProgress size={16} sx={{ mr: 1 }} />
                    Increasing...
                  </>
                ) : (
                  'Increase Limits'
                )}
              </Button>
            </Grid>
          </Grid>
        </Grid>
      ) : (
        <Box textAlign="center" pt={6}>
          <Typography variant="body1">
            This app must ask for permission before spending.
          </Typography>
          <Typography variant="h3" gutterBottom sx={{ pt: 2 }}>
            Choose Your Spending Limit
          </Typography>
          <Box>
            {[5, 10, 20].map((amt) => (
              <Button
                key={amt}
                variant="contained"
                sx={{ m: 1, textTransform: 'none' }}
                onClick={() => createSpendingAuthorization({ limit: amt })}
              >
                ${amt}/mo.
              </Button>
            ))}
          </Box>
        </Box>
      )}
    </>
  )
}

export default SpendingAuthorizationList
