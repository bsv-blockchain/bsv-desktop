import { useContext, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { DialogActions, DialogContent, Button, Typography, Stack, Divider } from '@mui/material'
import CustomDialog from '../CustomDialog'
import AppChip from '../AppChip'
import CounterpartyChip from '../CounterpartyChip'
import ProtoChip from '../ProtoChip'
import { WalletContext } from '../../WalletContext'
import { UserContext } from '../../UserContext'
import { displayProtocols } from './protocols'

const CounterpartyPermissionHandler = () => {
  const {
    counterpartyPermissionRequests,
    advanceCounterpartyPermissionQueue,
    managers,
    startPactCooldownForCounterparty
  } = useContext(WalletContext)

  const { counterpartyPermissionModalOpen } = useContext(UserContext)
  const { t } = useTranslation()

  const currentRequest = counterpartyPermissionRequests[0]

  const protocols = useMemo(() => {
    return currentRequest?.permissions?.protocols || []
  }, [currentRequest])

  const handleDeny = async () => {
    if (currentRequest?.originator && currentRequest?.counterparty) {
      startPactCooldownForCounterparty(currentRequest.originator, currentRequest.counterparty)
    }

    if (currentRequest?.requestID) {
      try {
        if (currentRequest.requestID.startsWith('group-peer:')) {
          await (managers.permissionsManager as any)?.dismissGroupedPermission?.(currentRequest.requestID)
        } else {
          await (managers.permissionsManager as any)?.grantCounterpartyPermission?.({
            requestID: currentRequest.requestID,
            granted: { protocols: [] },
            expiry: 0
          })
        }
      } catch (e) {
        console.error('Error dismissing counterparty permission request:', e)
      }
    }

    advanceCounterpartyPermissionQueue()
  }

  const handleGrant = async () => {
    if (currentRequest?.requestID) {
      try {
        if (currentRequest.requestID.startsWith('group-peer:')) {
          await (managers.permissionsManager as any)?.grantGroupedPermission?.({
            requestID: currentRequest.requestID,
            granted: {
              protocolPermissions: protocols.map(p => ({
                protocolID: p.protocolID,
                counterparty: currentRequest.counterparty,
                description: p.description
              }))
            },
            expiry: 0
          })
        } else {
          await (managers.permissionsManager as any)?.grantCounterpartyPermission?.({
            requestID: currentRequest.requestID,
            granted: { protocols },
            expiry: 0
          })
        }

        try {
          const normOriginator = currentRequest.originator ? currentRequest.originator.replace(/^https?:\/\//, '') : currentRequest.originator
          window.dispatchEvent(new CustomEvent('protocol-permissions-changed', {
            detail: {
              op: 'grant-counterparty',
              originator: normOriginator,
              counterparty: currentRequest.counterparty
            }
          }))
        } catch {
        }
      } catch (e) {
        console.error('Error granting counterparty permission request:', e)
      }
    }

    advanceCounterpartyPermissionQueue()
  }

  if (!counterpartyPermissionModalOpen || !currentRequest) return null

  return (
    <CustomDialog
      open={counterpartyPermissionModalOpen}
      title='Select Counterparty Permissions'
      onClose={handleDeny}
    >
      <DialogContent>
        <Stack spacing={2}>
          <Stack spacing={1} alignItems='center'>
            <AppChip size={2} showDomain label={currentRequest.originator || 'unknown'} clickable={false} />
          </Stack>

          <Divider />

          <Typography variant='body1'>
            This app is asking to interact with a specific counterparty.
          </Typography>

          <CounterpartyChip
            counterparty={currentRequest.counterparty}
            label={currentRequest.counterpartyLabel || 'Counterparty'}
            clickable={false}
            canRevoke={false}
          />

          {protocols.length > 0 && (
            <>
              <Divider />
              <Typography variant='subtitle2' sx={{ fontWeight: 600 }}>
                Protocol permissions requested:
              </Typography>
              <Stack spacing={1}>
                {displayProtocols(protocols).map((p, i) => (
                  <div key={i}>
                    <ProtoChip
                      securityLevel={p.securityLevel}
                      protocolID={p.protocolName}
                      originator={currentRequest.originator}
                      counterparty={currentRequest.counterparty}
                      clickable={false}
                      canRevoke={false}
                    />
                    {p.description && (
                      // Same reason line and inset as GroupPermissionHandler.
                      <div style={{
                        marginLeft: '2.5em',
                        paddingLeft: '0.5em',
                        borderLeft: '3px solid #bbb',
                        paddingTop: '0.5em',
                        marginBottom: '1em'
                      }}>
                        <p style={{ marginBottom: '0px' }}><b>{t('group_protocol_reason_label')}</b>{p.description}</p>
                      </div>
                    )}
                  </div>
                ))}
              </Stack>
            </>
          )}
        </Stack>
      </DialogContent>

      <DialogActions sx={{ justifyContent: 'space-between' }}>
        <Button onClick={handleDeny} variant='outlined' color='inherit'>
          Deny
        </Button>
        <Button onClick={handleGrant} variant='contained' color='primary'>
          Allow
        </Button>
      </DialogActions>
    </CustomDialog>
  )
}

export default CounterpartyPermissionHandler
