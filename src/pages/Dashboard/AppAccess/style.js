export default theme => ({
  tabs: {
    paddingLeft: '0px'
  },
  tab_fixed_nav: {
    backgroundColor: theme.palette.common.white,
    position: 'fixed',
    left: '0px',
    top: '0px',
    width: '100vw',
    zIndex: 1300,
    boxSizing: 'border-box',
    // boxShadow: '10 10 10 10',
    boxShadow: 'rgba(0.51, 0.51, 0.51, 35%) 0px 4px 10px'
  },
  title_close_grid: {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gridGap: theme.spacing(2),
    padding: '0px 0.5em 0px 1.5em'
  },
  placeholder: {
    height: '6em'
  },
  title_text: {
    paddingTop: '0.5em'
  },

  top_grid: {
    display: 'grid',
    gridTemplateColumns: 'auto auto 1fr auto',
    alignItems: 'start',
    gridGap: theme.spacing(2),
    boxSizing: 'border-box'
  },
  app_icon: {
    width: '5em',
    height: '5em'
  },
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%'
  },
  header: {
    display: 'flex',
    flexDirection: 'row'
  },
  fixed_nav: {
    backgroundColor: theme.palette.common.white, // Support theming
    position: 'sticky',
    top: theme.spacing(-3),
    margin: theme.spacing(-3),
    marginBottom: theme.spacing(4),
    zIndex: 1000
  },
  launch_button: {
    [theme.breakpoints.down('sm')]: {
      display: 'none'
    }
  }
})
