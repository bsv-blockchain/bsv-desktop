export default theme => ({
  fixed_nav: {
    // backgroundColor: theme.palette.background.leftMenu,
    position: 'sticky',
    top: theme.spacing(-3),
    margin: theme.spacing(-3),
    // marginBottom: theme.spacing(4),
    zIndex: 1000,
    boxSizing: 'border-box',
    padding: theme.spacing(3)
  }
})
