import React from 'react'
import ProtocolPermissionList from '../../../components/ProtocolPermissionList/index.jsx'
import SpendingAuthorizationList from '../../../components/SpendingAuthorizationList/index.jsx'
import BasketAccessList from '../../../components/BasketAccessList/index.jsx'
import CertificateAccessList from '../../../components/CertificateAccessList'
import { Typography } from '@mui/material'

export default ({ domain }) => {
  return (
    <>
      <Typography variant='h2'>Spending Authorizations</Typography>
      <Typography paragraph>
        These are the allowances you have made giving this app the ability to spend money.
      </Typography>
      <SpendingAuthorizationList app={domain} />
      <br />
      <br />
      <Typography variant='h2'>Data Permissions</Typography>
      <Typography paragraph>
        These are the kinds of information you have allowed this app to be concerned with.
      </Typography>
      <ProtocolPermissionList app={domain} />
      <br />
      <br />
      <Typography variant='h2'>Basket Access Grants</Typography>
      <Typography paragraph>
        These are the token baskets you have allowed this app to have access to.
      </Typography>
      <BasketAccessList app={domain} />
      <br />
      <br />
      <Typography variant='h2'>Certificate Access Grants</Typography>
      <Typography paragraph>
        These are the certificate fields you have allowed this app to have access to.
      </Typography>
      <CertificateAccessList app={domain} />
    </>
  )
}
