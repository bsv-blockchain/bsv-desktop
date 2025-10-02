export default (theme: any) => ({
  content_wrap: {
    ...theme.templates.page_wrap,
    backgroundColor: theme.palette.background.mainSection,
    ...theme.palette.background.withImage,
    maxWidth: '100vw',
    maxHeight: '100vh',
    overflow: 'hidden',
    padding: '0px !important',
    '& > :last-child': {
      'overflow-y': 'scroll',
      padding: theme.spacing(3),
      // maxWidth: `calc(1280px + ${theme.spacing(6)})`,
      '@media (min-width: 1500px)': {
        margin: ({ breakpoints }) => ((breakpoints.sm || breakpoints.xs) ? '0' : 'auto')
      }
    }
  },
  list_wrap: {
    minWidth: '16em',
    height: '100vh',
    backgroundColor: theme.palette.background.leftMenu,
    '& .MuiListItem-button': {
      '&:hover': {
        backgroundColor: theme.palette.background.leftMenuHover
      },
      '&.Mui-selected': {
        backgroundColor: theme.palette.background.leftMenuSelected
      }
    }
  },
  page_container: {
    height: '100vh',
    maxWidth: theme.maxContentWidth,
    '&::-webkit-scrollbar': {
      width: '0.35em'
    },
    '&::-webkit-scrollbar-track': {
      background: theme.palette.background.scrollbarTrack,
      borderRadius: '2em'
    },
    '&::-webkit-scrollbar-thumb': {
      background: theme.palette.background.scrollbarThumb,
      borderRadius: '2em'
    }
  },
  sig_wrap: {
    bottom: '1em',
    marginBottom: theme.spacing(2)
  },
  signature: {
    userSelect: 'none'
  }
})
