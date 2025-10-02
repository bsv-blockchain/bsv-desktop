import { Theme } from '@mui/material/styles';

// Create a style object with explicit types that follow the grid layout preferences
export default (theme: Theme) => ({
  icon: {
    backgroundColor: theme.palette.primary.main
  },
  basketContainer: {
    marginTop: '1em',
    width: '100%',
    maxWidth: '100%',
    overflow: 'hidden',
    display: 'flex',
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
    flexWrap: 'wrap' as const,  // Use const assertion for proper typing
    gap: '0.5rem'
  }
});
