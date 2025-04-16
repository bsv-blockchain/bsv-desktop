import { styled } from '@mui/material/styles'
import { Dialog, DialogTitle, DialogActions } from '@mui/material'

// Root component - styled Dialog
export const StyledDialog = styled(Dialog)(({ theme }) => ({
  '& .MuiDialog-paper': {
    backgroundColor: theme.palette.background.paper,
    color: theme.palette.text.primary,
    borderRadius: theme.shape.borderRadius * 2,
    [theme.breakpoints.up('sm')]: {
      minWidth: '400px'
    }
  }
}))

// Title component - styled DialogTitle
export const StyledDialogTitle = styled(DialogTitle)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(2),
  padding: theme.spacing(2),
  backgroundColor: theme.palette.background.paper,
  color: theme.palette.text.primary,
  borderBottom: `1px solid ${theme.palette.divider}`,
  '& img': {
    width: '32px',
    height: '32px'
  }
}))

// Actions component - styled DialogActions
export const StyledDialogActions = styled(DialogActions)(({ theme }) => ({
  padding: theme.spacing(2),
  borderTop: `1px solid ${theme.palette.divider}`,
  display: 'flex',
  justifyContent: 'flex-end',
  gap: theme.spacing(1)
}))
