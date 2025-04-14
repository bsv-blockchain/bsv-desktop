import { useState, useEffect, useContext, useCallback } from 'react'
import AmountDisplay from './AmountDisplay'
// import confederacyHost from '../utils/confederacyHost'
import { Skeleton, Stack, Typography } from '@mui/material'
import { WalletContext } from '../WalletContext'
import AppLogo from './AppLogo'

const Profile = () => {
  const { managers, adminOriginator } = useContext(WalletContext)
  const [accountBalance, setAccountBalance] = useState<any>(null)
  const [balanceLoading, setBalanceLoading] = useState(true)

  const refreshBalance = useCallback(async () => {
    try {
      if (!managers?.permissionsManager) {
        return
      }
      setBalanceLoading(true)
      const limit = 10000
      let offset = 0
      let allOutputs = []

      // Fetch the first page
      const firstPage = await managers.permissionsManager.listOutputs({ basket: 'default', limit, offset }, adminOriginator)
      allOutputs = firstPage.outputs;
      const totalOutputs = firstPage.totalOutputs;

      // Fetch subsequent pages until we've retrieved all outputs
      while (allOutputs.length < totalOutputs) {
        offset += limit;
        const { outputs } = await managers.permissionsManager.listOutputs({ basket: 'default', limit, offset }, adminOriginator);
        allOutputs = allOutputs.concat(outputs);
      }

      const total = allOutputs.reduce((acc, output) => acc + output.satoshis, 0)
      setAccountBalance(total)
      setBalanceLoading(false)
    } catch (e) {
      setBalanceLoading(false)
    }
  }, [managers, adminOriginator])

  useEffect(() => {
    refreshBalance()
  }, [refreshBalance])

  return (<Stack>
    <Typography variant='h5' color='textSecondary'>
      Your Balance
    </Typography>
    <Typography
      onClick={() => refreshBalance()}
      color='textPrimary'
      variant='h2'
      style={{ cursor: 'pointer' }}
    >
      {!managers?.permissionsManager || balanceLoading
        ? <Skeleton width={120} />
        : <AmountDisplay abbreviate>{accountBalance}</AmountDisplay>}
    </Typography>
  </Stack>)
}

export default Profile
