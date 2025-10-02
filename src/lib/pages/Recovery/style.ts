export default (theme: any) => ({
  content_wrap: theme.templates.page_wrap,
  back_button: {
    display: 'block',
    margin: `${theme.spacing(1)} auto`
  },
  panel_header: {
    position: 'relative'
  },
  panel_body: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    height: '50vh'
  },
  expansion_icon: {
    marginRight: '0.5em'
  },
  complete_icon: {
    position: 'absolute',
    right: '24px',
    color: 'green',
    transition: 'all 0.25s'
  },
  panel_heading: {
    fontWeight: 'blod'
  }
})
