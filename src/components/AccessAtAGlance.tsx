import React, { useContext, useEffect, useState } from 'react'
import {
  Typography,
  Button,
  LinearProgress,
  List,
  ListSubheader,
  Divider,
  Box
} from '@mui/material'
import BasketChip from './BasketChip'
// import ProtocolPermissionList from './ProtocolPermissionList'
import CertificateAccessList from './CertificateAccessList'
// import BasketAccessList from './BasketAccessList'
import { History } from 'history'
import { WalletContext } from '../WalletContext'

// Define the props interface for AccessAtAGlance.
// Adjust the setRefresh type if you use a different setter signature.
interface AccessAtAGlanceProps {
  originator: string
  loading: boolean
  setRefresh: React.Dispatch<React.SetStateAction<boolean>>
  history: History
}

const AccessAtAGlance: React.FC<AccessAtAGlanceProps> = ({ originator, loading, setRefresh, history }) => {
  const [recentBasketAccess, setRecentBasketAccess] = useState<string[]>([])
  const [protocolIsEmpty, setProtocolIsEmpty] = useState<boolean>(false)
  const [certificateIsEmpty, setCertificateIsEmpty] = useState<boolean>(false)

  const { managers, adminOriginator } = useContext(WalletContext)

  useEffect(() => {
    (async () => {
      try {
        const actionsResponse = await managers.permissionsManager.listActions(
          {
            labels: [`admin originator ${originator}`],
            labelQueryMode: 'any',
            includeOutputs: true,
          },
          adminOriginator
        );

        const filteredResults: string[] = []
        actionsResponse.actions.forEach(action => {
          if (action.outputs) {
            action.outputs.forEach(output => {
              if (output.basket && output.basket !== 'default' && !filteredResults.some(basket => basket === output.basket)) {
                filteredResults.push(output.basket)
              }
            })
          }
        })


        // const filteredResults = result.filter(x => x.basket)
        setRecentBasketAccess(filteredResults)
      } catch (error) {
        console.error(error)
      }
    })()
  }, [originator])

  return (
    <div style={{ paddingTop: '1em' }}>
      <Typography variant="h3" color="textPrimary" gutterBottom style={{ paddingBottom: '0.2em' }}>
        Access At A Glance
      </Typography>
      <List sx={{ bgcolor: 'background.paper', borderRadius: '0.25em', padding: '1em', minHeight: '13em' }}>
        {recentBasketAccess.length !== 0 && (
          <>
            <ListSubheader>Most Recent Basket</ListSubheader>
            {recentBasketAccess.map((basket, itemIndex) => (
              <div key={itemIndex}>
                {basket && (
                  <BasketChip basketId={basket} clickable />
                )}
              </div>
            ))}
          </>
        )}
        {/* <ProtocolPermissionList
          app={originator}
          limit={1}
          canRevoke={false}
          clickable
          displayCount={false}
          listHeaderTitle="Most Recent Protocol"
          onEmptyList={() => setProtocolIsEmpty(true)}
        /> */}
      </List>
      <Box sx={{ bgcolor: 'background.paper', borderRadius: '0.25em', minHeight: '13em' }}>
        <CertificateAccessList
          app={originator}
          itemsDisplayed="certificates"
          counterparty=""
          type="certificate"
          limit={1}
          canRevoke={false}
          displayCount={false}
          listHeaderTitle="Most Recent Certificate"
          onEmptyList={() => setCertificateIsEmpty(true)}
        />
        {recentBasketAccess.length === 0 && certificateIsEmpty && protocolIsEmpty && (
          <Typography color="textSecondary" align="center" style={{ paddingTop: '5em' }}>
            No recent access
          </Typography>
        )}
      </Box>

      {loading && <LinearProgress sx={{ paddingTop: '1em' }} />}
      <center style={{ padding: '1em' }}>
        <Button
          onClick={() => {
            history.push({
              pathname: `/dashboard/manage-app/${encodeURIComponent(originator)}`,
              state: {}
            })
          }}
          sx={{
            backgroundColor: history.location.pathname === `/dashboard/manage-app/${encodeURIComponent(originator)}` ? 'action.selected' : 'inherit'
          }}
        >
          Manage App
        </Button>
      </center>
    </div>
  )
}

export default AccessAtAGlance
