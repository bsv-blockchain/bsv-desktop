import { useContext, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DialogContent,
  DialogActions,
  Button,
  Box,
  Stack,
  Collapse,
  Typography,
} from '@mui/material'
import AmountDisplay from '../AmountDisplay/index.js'
import CustomDialog from '../CustomDialog/index.js'
import { WalletContext } from '../../WalletContext.js'
import AppChip from '../AppChip/index.js'
import { UserContext } from '../../UserContext.js'
import PaymentsIcon from '@mui/icons-material/Payments'

const SpendingAuthorizationHandler: React.FC = () => {
  const { t } = useTranslation()
  const {
    managers, spendingRequests, advanceSpendingQueue
  } = useContext(WalletContext)

  const { spendingAuthorizationModalOpen } = useContext(UserContext)

  const [detailsOpen, setDetailsOpen] = useState(false)

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

  if (spendingRequests.length === 0) {
    return null
  }

  const currentPerm = spendingRequests[0]

  const isSpendingLimitIncrease = currentPerm.description === 'Increase spending limit'
  const isCreateSpendingLimit = currentPerm.description === 'Create a spending limit'

  const getDialogTitle = () => {
    if (isSpendingLimitIncrease) return t('spending_limit_increase_title')
    if (isCreateSpendingLimit) return t('spending_limit_set_title')
    return !currentPerm.renewal ? t('spending_request_title') : t('spending_checkin_title')
  }

  return (
    <CustomDialog
      open={spendingAuthorizationModalOpen}
      title={getDialogTitle()}
      icon={<PaymentsIcon fontSize="medium" />}
    >
      <DialogContent>
        <Stack spacing={1.5}>
          <AppChip
            size={1.5}
            label={currentPerm.originator}
            clickable={false}
            showDomain
          />

          {isSpendingLimitIncrease ? (
            <Stack alignItems="center" spacing={1} py={2}>
              <Typography variant="body2" color="text.secondary">
                {t('spending_limit_increase_text')}
              </Typography>
              <Typography variant="h3" fontWeight="bold">
                <AmountDisplay showFiatAsInteger>{currentPerm.authorizationAmount}</AmountDisplay>
              </Typography>
              <Typography variant="caption" color="text.secondary">{t('spending_limit_monthly_suffix')}</Typography>
            </Stack>
          ) : isCreateSpendingLimit ? (
            <Stack alignItems="center" spacing={1} py={2}>
              <Typography variant="body2" color="text.secondary">
                {t('spending_limit_create_text')}
              </Typography>
              <Typography variant="h3" fontWeight="bold">
                <AmountDisplay showFiatAsInteger>{currentPerm.authorizationAmount}</AmountDisplay>
              </Typography>
              <Typography variant="caption" color="text.secondary">{t('spending_limit_monthly_suffix')}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic', maxWidth: 280, textAlign: 'center' }}>
                {t('spending_limit_create_note')}
              </Typography>
            </Stack>
          ) : (
            <Stack alignItems="center" spacing={0.5} py={2}>
              {currentPerm.description && (
                <Typography variant="h6" color="text.secondary" sx={{ mb: 0.5 }}>
                  {currentPerm.description}
                </Typography>
              )}
              <Typography variant="h2" fontWeight="bold">
                <AmountDisplay>{currentPerm.authorizationAmount}</AmountDisplay>
              </Typography>

              {currentPerm.lineItems?.length > 1 && (
                <Box sx={{ width: '100%', mt: 1 }}>
                  <Button
                    size="small"
                    variant="text"
                    onClick={() => setDetailsOpen(o => !o)}
                    sx={{ color: 'text.secondary', fontSize: '0.75rem', px: 0 }}
                  >
                    {detailsOpen ? t('spending_details_button_collapse') : t('spending_details_button_expand')}
                  </Button>
                  <Collapse in={detailsOpen}>
                    <Stack spacing={0} sx={{ mt: 0.5, border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
                      {currentPerm.lineItems.map((item, idx) => (
                        <Box
                          key={idx}
                          sx={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            px: 2,
                            py: 1,
                            borderBottom: idx < currentPerm.lineItems.length - 1 ? '1px solid' : 'none',
                            borderColor: 'divider',
                          }}
                        >
                          <Typography variant="body2" color="text.secondary">{item.description || '—'}</Typography>
                          <Typography variant="body2" fontWeight={500}>
                            <AmountDisplay>{item.satoshis}</AmountDisplay>
                          </Typography>
                        </Box>
                      ))}
                    </Stack>
                  </Collapse>
                </Box>
              )}
            </Stack>
          )}
        </Stack>
      </DialogContent>

      <DialogActions sx={{ justifyContent: 'space-between', borderTop: 'none', px: 3, pb: 3 }}>
        <Button
          variant="outlined"
          color="inherit"
          size="large"
          onClick={handleCancel}
          sx={{ minWidth: 120 }}
        >
          {isSpendingLimitIncrease || isCreateSpendingLimit ? t('spending_cancel_button') : t('spending_deny_button')}
        </Button>

        {isSpendingLimitIncrease ? (
          <Button
            variant="contained"
            color="success"
            size="large"
            onClick={() => handleGrant({ singular: false, amount: currentPerm.authorizationAmount })}
            sx={{ minWidth: 160, backgroundColor: '#2e7d32 !important', color: '#fff !important', '&:hover': { backgroundColor: '#1b5e20 !important' } }}
          >
            {t('spending_approve_increase_button')}
          </Button>
        ) : isCreateSpendingLimit ? (
          <Button
            variant="contained"
            color="success"
            size="large"
            onClick={() => handleGrant({ singular: false, amount: currentPerm.authorizationAmount })}
            sx={{ minWidth: 160, backgroundColor: '#2e7d32 !important', color: '#fff !important', '&:hover': { backgroundColor: '#1b5e20 !important' } }}
          >
            {t('spending_set_limit_button')}
          </Button>
        ) : (
          <Button
            variant="contained"
            color="success"
            size="large"
            onClick={() => handleGrant({ singular: true })}
            sx={{ minWidth: 160, backgroundColor: '#2e7d32 !important', color: '#fff !important', '&:hover': { backgroundColor: '#1b5e20 !important' } }}
          >
            {t('spending_authorize_button')}
          </Button>
        )}
      </DialogActions>
    </CustomDialog>
  )
}

export default SpendingAuthorizationHandler
