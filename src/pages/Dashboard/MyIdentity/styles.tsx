import { styled } from '@mui/material/styles'
import { Box, Paper } from '@mui/material'

// Root container
export const Root = styled(Box)(({ theme }) => ({
  padding: theme.spacing(3),
  maxWidth: '800px',
  margin: '0 auto'
}));

// Section container
export const Section = styled(Box)(({ theme }) => ({
  marginBottom: theme.spacing(4)
}));

// Oracle link container
export const OracleLinkContainer = styled(Box)(() => ({
  display: 'flex',
  padding: '6px 0px',
  flexDirection: 'row',
  '@media (max-width: 680px) and (min-width: 0px)': {
    flexDirection: 'column',
    alignItems: 'center'
  },
  justifyContent: 'center',
  gap: '2px'
}));

// Oracle link
export const OracleLink = styled(Box)(({ theme }) => ({
  margin: '0 auto',
  minWidth: '10em',
  padding: '0.8em',
  border: `1px solid ${theme.palette.primary.main}`,
  borderRadius: '8px',
  '&:hover': {
    border: '1px solid #eeeeee00',
    background: theme.palette.background.default
  }
}));

// Oracle icon
export const OracleIcon = styled('img')(() => ({
  width: '2em',
  height: '2em',
  borderRadius: '6px'
}));

// Oracle title
export const OracleTitle = styled(Box)(() => ({
  fontSize: '0.7em'
}));

// Oracle button
export const OracleButton = styled(Box)(() => ({
  borderRadius: '10px'
}));

// Oracle open title
export const OracleOpenTitle = styled(Box)(() => ({
  textDecoration: 'bold',
  marginTop: '2em'
}));

// Content wrap
export const ContentWrap = styled(Box)(() => ({
  display: 'grid'
}));

// Trust threshold
export const TrustThreshold = styled(Box)(({ theme }) => ({
  maxWidth: '25em',
  minWidth: '20em',
  marginBottom: theme.spacing(5),
  placeSelf: 'center'
}));

// Master grid
export const MasterGrid = styled(Box)(({ theme }) => ({
  display: 'grid',
  gridTemplateColumns: '1fr',
  alignItems: 'center',
  gridGap: theme.spacing(2),
  gridColumnGap: theme.spacing(3),
  [theme.breakpoints.down('md')]: {
    gridTemplateColumns: '1fr',
    gridRowGap: theme.spacing(3)
  }
}));

// Entity icon name grid
export const EntityIconNameGrid = styled(Box)(({ theme }) => ({
  display: 'grid',
  gridTemplateColumns: '4em 1fr',
  alignItems: 'center',
  gridGap: theme.spacing(2),
  padding: theme.spacing(1),
  borderRadius: '6px'
}));

// Clickable entity icon name grid
export const ClickableEntityIconNameGrid = styled(Box)(({ theme }) => ({
  display: 'grid',
  gridTemplateColumns: '4em 1fr',
  alignItems: 'center',
  gridGap: theme.spacing(2),
  cursor: 'pointer',
  transition: 'all 0.3s',
  padding: theme.spacing(1),
  borderRadius: '6px',
  '&:hover': {
    boxShadow: theme.shadows[3]
  }
}));

// Entity icon
export const EntityIcon = styled('img')(() => ({
  width: '4em',
  height: '4em',
  borderRadius: '6px'
}));

// Slider label grid
export const SliderLabelGrid = styled(Box)(({ theme }) => ({
  display: 'grid',
  gridTemplateColumns: 'auto 1fr',
  alignItems: 'center',
  gridGap: theme.spacing(2)
}));

// Slider label delete grid
export const SliderLabelDeleteGrid = styled(Box)(({ theme }) => ({
  display: 'grid',
  gridTemplateColumns: 'auto 1fr auto',
  alignItems: 'center',
  gridGap: theme.spacing(2)
}));
