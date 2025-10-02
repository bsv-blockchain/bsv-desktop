export default (theme: any) => ({
  app_icon: {
    minWidth: '8em',
    minHeight: '8em',
    maxHeight: '8em',
    maxWidth: '8em',
    borderRadius: '4px',
    marginTop: theme.spacing(2),
    marginBottom: theme.spacing(1)
  },
  title: {
    marginTop: theme.spacing(0.5)
  },
  fabs_wrap: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    marginTop: `${theme.spacing(5)}`,
    marginBottom: `${theme.spacing(2.5)}`,
    placeItems: 'center'
  },
  slider: {
    marginTop: theme.spacing(1),
    marginBottom: theme.spacing(5),
    width: '80%'
  },
  select: {
    width: '100%'
  },
  button_icon: {
    marginRight: theme.spacing(1)
  }
})
