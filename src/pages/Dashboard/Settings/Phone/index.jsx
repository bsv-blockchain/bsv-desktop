import React, { useState, useContext } from 'react'
import {
  Typography,
  Button,
  CircularProgress
} from '@mui/material'
import { makeStyles } from '@mui/styles'
import { toast } from 'react-toastify'
import PhoneEntry from '../../../../components/PhoneEntry.jsx'
import { formatPhoneNumber } from 'react-phone-number-input'
import UIContext from '../../../../UIContext'

const useStyles = makeStyles(theme => ({
  button_grid: {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr auto',
    gridGap: theme.spacing(2)
  }
}), { name: 'PhoneSettings' })

const PhoneSettings = ({ history }) => {
  const { saveLocalSnapshot } = useContext(UIContext)
  const classes = useStyles()
  const [newPhone, setNewPhone] = useState('')
  const [currentNumber, setCurrentNumber] = useState('')
  const [showLoading, setShowLoading] = useState(false)
  const [changeLoading, setChangeLoading] = useState(false)

  const handleView = async () => {
    try {
      if (currentNumber) {
        setCurrentNumber('')
        return
      }
      setShowLoading(true)
      const num = await window.CWI.getPhoneNumber()
      setCurrentNumber(formatPhoneNumber(num))
    } finally {
      setShowLoading(false)
    }
  }

  const handleSubmitNewPhone = async e => {
    try {
      e.preventDefault()
      setChangeLoading(true)
      const result = await window.CWI.changePhoneNumber(newPhone)
      if (result === true) {
        await saveLocalSnapshot()
        toast.dark('Phone number changed!')
      }
    } catch (e) {
      toast.error(e.message)
    } finally {
      setChangeLoading(false)
    }
  }

  return (
    <>
      <Typography variant='h2' color='textPrimary' paragraph>
        Phone Number
      </Typography>
      <Typography variant='body' color='textSecondary'>
        Your phone number is used as an extra verification step when logging in.
      </Typography>
      <Typography paragraph>
        Current phone number:{' '}<b>{currentNumber || '••••••••••••'}</b>
      </Typography>
      <form onSubmit={handleSubmitNewPhone}>
        <PhoneEntry
          onChange={setNewPhone}
          value={newPhone}
          placeholder='New phone'
        />
        <br />
        <div className={classes.button_grid}>
          {showLoading
            ? <CircularProgress />
            : (
              <Button
                color='primary'
                onClick={handleView}
              >
                {currentNumber ? 'Hide' : 'View'}
              </Button>
              )}
          <div />
          {changeLoading
            ? <CircularProgress />
            : (
              <Button
                color='primary'
                variant='contained'
                type='submit'
              >
                Change
              </Button>
              )}
        </div>
      </form>
      <br />
      <br />
    </>
  )
}

export default PhoneSettings
