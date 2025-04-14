import React from 'react'
import { Card, CardContent, Typography, Box } from '@mui/material'
import { withRouter, RouteComponentProps } from 'react-router-dom'
import isImageUrl from '../utils/isImageUrl'
import { useTheme } from '@mui/styles'
import { generateDefaultIcon } from '../constants/popularApps'
import { Img } from '@bsv/uhrp-react'


interface MetanetAppProps extends RouteComponentProps {
  iconImageUrl?: string
  domain: string
  appName?: string
  onClick?: (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => void
  clickable?: boolean
}

const MetanetApp: React.FC<MetanetAppProps> = ({
  iconImageUrl,
  domain,
  appName,
  history,
  onClick,
  clickable = true,
}) => {
  const theme = useTheme()

  // Although TypeScript enforces the domain type, this runtime check preserves original logic.
  if (typeof domain !== 'string') {
    throw new Error('Error in MetanetApp Component: domain prop must be a string!')
  }

  // Fallback to domain if appName is not provided.
  const displayName = appName || domain

  iconImageUrl = iconImageUrl || generateDefaultIcon(displayName)

  const handleClick = (e: React.MouseEvent<HTMLDivElement, MouseEvent>): void => {
    if (clickable) {
      if (typeof onClick === 'function') {
        onClick(e)
      } else {
        e.stopPropagation()
        history.push({
          pathname: `/dashboard/app/${encodeURIComponent(domain)}`,
          state: { domain },
        })
      }
    }
  }

  return (
    <Card
      sx={{
        cursor: clickable ? 'pointer' : 'default',
        boxShadow: 'none',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column', // Stack items vertically
        height: '100%', // Fill the container height
        width: '100%',
        // Responsive card width
        maxWidth: {
          xs: '100px', // Smaller on mobile
          sm: '110px', // Medium on tablets
          md: '130px', // Larger on desktop
          lg: '140px', // Even larger on big screens
          xl: '150px', // Extra large screens
        },
        justifyContent: 'center',
        transition: 'background 0.3s ease',
        backgroundColor: 'transparent',
        backgroundImage: 'none',
        margin: '0 auto', // Center the card
        '&:hover': {
          backgroundColor: (theme as any).palette.action?.hover || 'rgba(0, 0, 0, 0.04)'
        },
      }}
      onClick={handleClick}
    >
      <CardContent>
        <div>
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              paddingTop: '0.4em',
              // Responsive container sizing
              width: {
                xs: '48px',  // Smaller on mobile
                sm: '56px',  // Medium on tablets
                md: '72px',  // Larger on desktop
                lg: '80px',  // Even larger on big screens
                xl: '84px',  // Extra large screens
              },
              height: {
                xs: '48px',
                sm: '56px',
                md: '72px',
                lg: '80px',
                xl: '84px',
              },
              maxWidth: '96px',  // Increased maximum size
              maxHeight: '96px',
              margin: '0 auto',
            }}
          >
            <Img
              src={iconImageUrl}
              alt={displayName}
              style={{
                objectFit: 'contain',
                width: '100%',
                height: '100%',
              }}
            />
          </Box>
        </div>
        {/*
          TODO: Remove references to webkit once browsers mature to a good level
        */}
        <Typography
          variant="body2"
          sx={{
            color: (theme as any).palette.text?.primary || 'inherit',
            paddingTop: '0.4em',
            display: '-webkit-box',
            overflow: 'hidden',
            WebkitBoxOrient: 'vertical',
            WebkitLineClamp: 1,
            fontSize: {
              xs: '0.75rem',
              sm: '0.8rem',
              md: '0.875rem',
            },
            width: '100%',
            textAlign: 'center',
          }}
        >
          {displayName}
        </Typography>
      </CardContent>
    </Card>
  )
}

export default withRouter(MetanetApp)
