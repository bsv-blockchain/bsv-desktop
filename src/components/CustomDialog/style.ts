import { Theme } from '@mui/material/styles';

export default (theme: Theme) => ({
  root: {
    '& .MuiDialog-paper': {
      backgroundColor: theme.palette.background.paper,
      color: theme.palette.text.primary,
      borderRadius: theme.shape.borderRadius * 2,
      [theme.breakpoints.up('sm')]: {
        minWidth: '400px'
      }
    }
  },
  title: {
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
  },
  content: {
    '& .MuiDialogContent-root': {
      padding: theme.spacing(3)
    }
  },
  actions: {
    padding: theme.spacing(2),
    gap: theme.spacing(1),
    borderTop: `1px solid ${theme.palette.divider}`,
    '& .MuiButton-root': {
      minWidth: '100px'
    }
  }
});
