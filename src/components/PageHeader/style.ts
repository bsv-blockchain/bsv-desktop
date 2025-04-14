import { Theme } from '@mui/material/styles'

export default (theme: Theme) => ({
  top_grid: {
    display: 'grid',
    gridTemplateColumns: 'auto auto 1fr auto',
    alignItems: 'center',
    gridGap: theme.spacing(2),
    boxSizing: 'border-box',
  },
  app_icon: {
    width: '5em',
    height: '5em',
  },
  action_button: {
    [theme.breakpoints.down('sm')]: {
      display: 'none'
    }
  }
})
