import { useContext } from 'react'
import { useTranslation } from 'react-i18next'
import { DialogContent, DialogActions, Button, Typography, Divider, Box, Stack, Tooltip } from '@mui/material'
import CustomDialog from '../CustomDialog'
import AppChip from '../AppChip/index'
import BasketChip from '../BasketChip/index'
import ShoppingBasketIcon from '@mui/icons-material/ShoppingBasket'
import deterministicColor from '../../utils/deterministicColor'
import { WalletContext } from '../../WalletContext'
import { UserContext } from '../../UserContext'


const BasketAccessHandler = () => {
    const { t } = useTranslation()
    const { basketRequests, advanceBasketQueue, managers } = useContext(WalletContext)
    const { basketAccessModalOpen } = useContext(UserContext)

    // Handle denying the top request in the queue
    const handleDeny = async () => {
        if (basketRequests.length > 0) {
            managers.permissionsManager?.denyPermission(basketRequests[0].requestID)
        }
        advanceBasketQueue()
    }

    // Handle granting the top request in the queue
    const handleGrant = async () => {
        if (basketRequests.length > 0) {
            managers.permissionsManager?.grantPermission({
                requestID: basketRequests[0].requestID
            })
        }
        advanceBasketQueue()
    }

    if (!basketAccessModalOpen || !basketRequests.length) return null

    const { basket, originator, reason, renewal } = basketRequests[0]

    return (
        <CustomDialog
            open={basketAccessModalOpen}
            title={renewal ? t('basket_access_renewal_title') : t('basket_access_request_title')}
            onClose={handleDeny} // If the user closes via the X, treat as "deny"
            icon={<ShoppingBasketIcon fontSize="medium" />}
        >
            <DialogContent>
                <Stack spacing={1}>
                    {/* App section */}
                    <AppChip
                        size={1.5}
                        showDomain
                        label={originator || 'unknown'}
                        clickable={false}
                    />
                    
                    <Divider />

                    {/* Basket section */}
                    <BasketChip basketId={basket} />

                    {/* Reason section */}
                    {reason && (
                        <>
                         <Divider />
                            <Stack direction="row" alignItems="center" spacing={1} justifyContent="space-between" sx={{
                                height: '3em', width: '100%'
                            }}>
                                <Typography variant="body1" fontWeight="bold">
                                    {t('basket_access_reason_label')}
                                </Typography>
                                <Stack px={3}>
                                    <Typography variant="body1">
                                        {reason}
                                    </Typography>
                                </Stack>
                            </Stack>
                        </>
                    )}
                </Stack>
            </DialogContent>

            {/* Visual signature */}
            <Tooltip title={t('basket_access_visual_signature_tooltip')} placement="top">
                <Box sx={{ mb: 3, py: 0.5, background: deterministicColor(JSON.stringify(basketRequests[0])) }} />
            </Tooltip>

            <DialogActions sx={{ justifyContent: 'space-between' }}>
                <Button 
                    onClick={handleDeny}
                    variant="outlined"
                    color="inherit"
                >
                    {t('basket_access_deny_button')}
                </Button>
                <Button
                    onClick={handleGrant}
                    variant="contained"
                    color="primary"
                >
                    {t('basket_access_grant_button')}
                </Button>
            </DialogActions>
        </CustomDialog>
    )
}

export default BasketAccessHandler
