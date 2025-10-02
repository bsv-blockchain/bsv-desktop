export default theme => ({
  content_wrap: {
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    position: 'fixed',
    display: 'grid',
    placeItems: 'center'
  },
  content: {
    margin: 'auto'
  },
  field: {
    width: '80%',
    marginBottom: theme.spacing(5)
  },
  button: {
    marginBottom: theme.spacing(3)
    // backgroundColor: 'transparent',
    // color: 'black'
  },
  preferenceButton: {
    marginBottom: theme.spacing(4),
    padding: '0 1em 0 2.5em',
    backgroundColor: theme.palette.mode === 'light' ? 'transparent' : 'dark',
    color: 'black',
    border: '1px solid black',
    borderRadius: '2em', // Add corner radius
    '&:hover': {
      backgroundColor: 'lightGray',
      color: 'white'
    }
  }
})
