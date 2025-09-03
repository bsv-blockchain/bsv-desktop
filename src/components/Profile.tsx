import { useState, useEffect, useContext, useCallback } from 'react'
import AmountDisplay from './AmountDisplay'
import { Skeleton, Stack, Typography } from '@mui/material'
import { WalletContext } from '../WalletContext'
import { getAccountBalance } from "../utils/getAccountBalance"

const Profile = () => {
  const { managers} = useContext(WalletContext)
  const {
    balance: accountBalance,
    loading: balanceLoading,
    refresh: refreshBalance,
  } = getAccountBalance("default");

  return (<Stack alignItems="center">
    <Typography variant='h5' color='textSecondary' align='center'>
      Your Balance
    </Typography>
    <Typography
      onClick={() => refreshBalance()}
      color='textPrimary'
      variant='h2'
      align='center'
      style={{ cursor: 'pointer' }}
    >
      {!managers?.permissionsManager || balanceLoading
        ? <Skeleton width={120} />
        : <AmountDisplay abbreviate>{accountBalance}</AmountDisplay>}
    </Typography>
  </Stack>)
}

export default Profile;
