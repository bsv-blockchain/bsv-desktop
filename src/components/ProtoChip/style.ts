export default (theme: any) => ({
  table_picture: {
    maxWidth: '5em',
    borderRadius: '3em'
  },
  expires: {
    fontSize: '0.95em',
    color: theme.palette.text.secondary,
    textAlign: 'center',
    visibility: 'hidden',
    opacity: 0,
    transition: 'all 0.8s'
  },
  // Show expires on hover
  chipContainer: {
    fontSize: '0.95em',
    display: 'flex',
    flexDirection: 'column',
    alignContent: 'center',
    alignItems: 'center',
    '&:hover $expires': {
      visibility: 'visible',
      opacity: 1
    }
  },
  chipLabel: {
    width: '100% !important'
  }
})
