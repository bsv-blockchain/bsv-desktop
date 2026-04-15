import { Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Button } from '@mui/material'
import { useTranslation } from 'react-i18next'

const NavigationConfirmModal = ({ open, onConfirm, onCancel, children, loading }) => {
  const { t } = useTranslation()
  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!loading) {
          onCancel()
        }
      }}
      aria-labelledby="alert-dialog-title"
      aria-describedby="alert-dialog-description"
      disableEscapeKeyDown={true}
    >
      <DialogTitle id="alert-dialog-title">{t('trust_dialog_unsaved_title')}</DialogTitle>
      <DialogContent>
        <DialogContentText id="alert-dialog-description">
          {children || 'You have unsaved changes. Do you want to save them before leaving?'}
        </DialogContentText>
      </DialogContent>
      {!loading
        ? <DialogActions>
          <Button onClick={onCancel} color="primary">
            Don't Save
          </Button>
          <Button onClick={onConfirm} color="primary" autoFocus>
            Save
          </Button>
        </DialogActions>
        : <Button onClick={onCancel} color="primary">
          Close
        </Button>
      }

    </Dialog>
  )
}

export default NavigationConfirmModal
