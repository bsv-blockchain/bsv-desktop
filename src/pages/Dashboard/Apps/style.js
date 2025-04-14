export default theme => ({
  apps_view: {
    padding: '1em 1em 2em 1em'
  },
  gridItem: {
    height: '14em',
    minWidth: '10em',

    '@media (max-width: 4000px) and (min-width: 1401px)': {
      height: '10em',
      maxWidth: '16em',
      minWidth: '15em'
    },
    '@media (max-width: 1400px) and (min-width: 1201px)': {
      height: '10em',
      maxWidth: '16em',
      minWidth: '10em'
    },
    '@media (max-width: 1200px) and (min-width: 1001px)': {
      height: '10em',
      minWidth: '10em'
    },
    '@media (max-width: 1000px) and (min-width: 900px)': {
      height: '10em',
      minWidth: '8em'
    },
    '@media (max-width: 899px) and (min-width: 500px)': {
      height: '10em',
      minWidth: '8em'
    },
    '@media (max-width: 499px) and (min-width: 0)': {
      height: '8em',
      minWidth: '4em'
    }
  }
})
