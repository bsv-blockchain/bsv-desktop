import React, { useState } from 'react'
import {
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
} from '@mui/material'

const Logout = () => {
  const [loading, setLoading] = useState(false)
  const [openDialog, setOpenDialog] = useState(false)

  const handleButtonClick = () => {
    setLoading(true)
    // Delay for UX reasons to let the button turn grey
    setTimeout(() => {
      setOpenDialog(true)
    }, 750)
  }

  const handleCancel = () => {
    setOpenDialog(false)
    setLoading(false)
  }

  const handleConfirm = () => {
    localStorage.clear()
    sessionStorage.clear()
    setOpenDialog(false)
    setLoading(false)
    location.href = '/'
  }

  return (
    <>
      <Button
        variant='contained'
        color='secondary'
        onClick={handleButtonClick}
        disabled={loading}
      >
        Exit This Metanet Portal
      </Button>
      <Dialog
        open={openDialog}
        onClose={handleCancel}
        aria-labelledby="logout-dialog-title"
        aria-describedby="logout-dialog-description"
      >
        <DialogTitle id="logout-dialog-title">Confirm Exit</DialogTitle>
        <DialogContent>
          <DialogContentText id="logout-dialog-description">
            Are you absolutely sure you want to exit this Metanet portal?
            <br />
            <br />
            You will also be logged out of all apps and systems that use this portal.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCancel} color="primary">
            Cancel
          </Button>
          <Button onClick={handleConfirm} color="primary" autoFocus>
            Confirm
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}

export default Logout
