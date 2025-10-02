/* eslint-disable react/prop-types */
import React, { useState } from 'react'
import {
  Typography,
  Box,
  Slider,
  DialogContent,
  DialogContentText,
  DialogActions,
  IconButton,
  Button,
  Chip,
  Tooltip,
  Card,
  CardContent,
  Divider,
  Collapse,
  Link
} from '@mui/material'
import Delete from '@mui/icons-material/Close'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import VerifiedIcon from '@mui/icons-material/Verified'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import CustomDialog from '../../../components/CustomDialog'
import { Certifier } from '@bsv/wallet-toolbox-client/out/src/WalletSettingsManager'

const TrustedEntity = ({ entity, setTrustedEntities, classes, history }: { history: any, classes: any, setTrustedEntities: Function, entity: Certifier, trustedEntities: Certifier[] }) => {
  const [trust, setTrust] = useState(entity.trust)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleTrustChange = (e, v) => {
    setTrust(v)
    setTrustedEntities(old => {
      const newEntities = [...old]
      newEntities[newEntities.indexOf(entity)].trust = v
      return newEntities
    })
  }

  const handleDelete = () => {
    setTrustedEntities(old => {
      const newEntities = [...old]
      newEntities.splice(newEntities.indexOf(entity), 1)
      return newEntities
    })
    setDeleteOpen(false)
  }

  const handleCopyIdentityKey = () => {
    navigator.clipboard.writeText(entity.identityKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Format identity key for display
  const formatIdentityKey = (key) => {
    if (!key) return '';
    const start = key.substring(0, 8);
    const end = key.substring(key.length - 8);
    return `${start}...${end}`;
  }

  return (
    <>
      <Card
        elevation={1}
        sx={{
          mb: 3,
          borderRadius: 2,
          transition: 'all 0.2s ease-in-out',
          '&:hover': {
            boxShadow: 3,
          }
        }}
      >
        <CardContent sx={{ p: 0 }}>
          <Box
            sx={{
              position: 'relative',
              p: 2,
            }}
          >
            {/* Delete Button - Positioned absolutely in the top right */}
            <IconButton
              onClick={() => setDeleteOpen(true)}
              size="small"
              sx={{
                position: 'absolute',
                top: 8,
                right: 8,
                zIndex: 1,
                bgcolor: 'background.paper',
                boxShadow: 1,
                '&:hover': {
                  bgcolor: 'error.light',
                  color: 'white'
                }
              }}
            >
              <Delete fontSize='small' />
            </IconButton>

            {/* Entity Information */}
            <Box
              sx={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 2,
                pr: 5 // Add padding to the right to make space for the delete button
              }}
            >
              <img
                src={entity.iconUrl}
                className={classes.entity_icon}
                alt={`${entity.name} icon`}
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '50%',
                  objectFit: 'cover',
                  border: '1px solid',
                  borderColor: 'divider'
                }}
              />
              <Box sx={{ flex: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
                  <Typography variant="h6" component="h3" sx={{ fontWeight: 'bold', mr: 1 }}>
                    {entity.name}
                  </Typography>
                  <Tooltip title="Verified entity">
                    <VerifiedIcon color="primary" fontSize="small" />
                  </Tooltip>
                </Box>
                <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
                  {entity.description}
                </Typography>

                {/* Identity Key with Copy Button */}
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    bgcolor: 'background.paper',
                    borderRadius: 1,
                    border: '1px solid',
                    borderColor: 'divider',
                    p: 0.75,
                    mb: 1
                  }}
                >
                  <Tooltip title="Entity Identity Key">
                    <InfoOutlinedIcon fontSize="small" color="action" sx={{ mr: 1 }} />
                  </Tooltip>
                  <Typography
                    variant="caption"
                    component="span"
                    sx={{
                      fontFamily: 'monospace',
                      fontWeight: 'medium',
                      flex: 1
                    }}
                  >
                    {formatIdentityKey(entity.identityKey)}
                  </Typography>
                  <Tooltip title={copied ? "Copied!" : "Copy Identity Key"}>
                    <IconButton
                      size="small"
                      onClick={handleCopyIdentityKey}
                      sx={{ ml: 1 }}
                    >
                      <ContentCopyIcon fontSize="small" color={copied ? "success" : "action"} />
                    </IconButton>
                  </Tooltip>
                </Box>

                {/* Trust Level Chip */}
                <Chip
                  label={`Trust Level: ${trust}/10`}
                  color={trust > 7 ? "success" : trust > 4 ? "primary" : "default"}
                  size="small"
                  sx={{ mr: 1 }}
                />

                {/* Expand Button for more details */}
                <Button
                  size="small"
                  endIcon={expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                  onClick={() => setExpanded(!expanded)}
                  sx={{ textTransform: 'none' }}
                >
                  {expanded ? 'Less Details' : 'More Details'}
                </Button>
              </Box>
            </Box>
          </Box>

          <Collapse in={expanded}>
            <Divider />
            <Box sx={{ p: 2 }}>
              {/* Additional Entity Details */}
              <Typography variant="subtitle2" gutterBottom>
                Full Identity Key
              </Typography>
              <Box
                sx={{
                  bgcolor: 'background.paper',
                  p: 1.5,
                  borderRadius: 1,
                  border: '1px solid',
                  borderColor: 'divider',
                  mb: 2,
                  wordBreak: 'break-all',
                  fontFamily: 'monospace',
                  fontSize: '0.75rem'
                }}
              >
                {entity.identityKey}
              </Box>

              {/* Additional entity details can be added here if needed */}
            </Box>
          </Collapse>

          <Divider />

          {/* Trust Slider Controls */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              p: 2,
              gap: 2
            }}
          >
            <Typography sx={{ minWidth: '45px' }}>
              <strong>{trust}</strong> / 10
            </Typography>
            <Slider
              onChange={handleTrustChange}
              min={1}
              max={10}
              step={1}
              value={trust}
              sx={{ flex: 1 }}
              valueLabelDisplay="auto"
            />
          </Box>
        </CardContent>
      </Card>

      <CustomDialog title='Delete Trust Relationship' open={deleteOpen} onClose={() => setDeleteOpen(false)}>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete this trust relationship? This action cannot be undone.
          </DialogContentText>
          <Box sx={{ display: 'flex', alignItems: 'center', mt: 2, p: 2, bgcolor: 'background.paper', borderRadius: 1 }}>
            <img
              src={entity.iconUrl}
              className={classes.entity_icon}
              alt={`${entity.name} icon`}
              style={{ width: '40px', height: '40px', borderRadius: '50%', marginRight: '16px' }}
            />
            <Box>
              <Typography variant="subtitle1"><strong>{entity.name}</strong></Typography>
              <Typography variant="body2" color="textSecondary">{formatIdentityKey(entity.identityKey)}</Typography>
              <Typography variant="caption" color="textSecondary">{entity.description}</Typography>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteOpen(false)} color="primary">Cancel</Button>
          <Button onClick={handleDelete} color="error" variant="contained">Delete</Button>
        </DialogActions>
      </CustomDialog>
    </>
  )
}

export default TrustedEntity
