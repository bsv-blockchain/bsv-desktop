/* eslint-disable indent */
/* eslint-disable react/prop-types */
import { useState, useContext, useEffect } from 'react'
import { Prompt } from 'react-router-dom'
import { Typography, Button, Slider, TextField, LinearProgress, Snackbar, Box, Paper } from '@mui/material'
import { makeStyles } from '@mui/styles'
import style from './style.js'
import AddIcon from '@mui/icons-material/Add'
import SearchIcon from '@mui/icons-material/Search'
import { toast } from 'react-toastify'
import { WalletContext } from '../../../WalletContext'

import TrustedEntity from './TrustedEntity.js'
import arraysOfObjectsAreEqual from '../../../utils/arraysOfObjectsAreEqual.js'
import AddEntityModal from './AddEntityModal.js'
import NavigationConfirmModal from './NavigationConfirmModal.js'

const useStyles = makeStyles(style, {
  name: 'Trust'
})

const Trust = ({ history }) => {
  const { settings, updateSettings } = useContext(WalletContext)

  // These are some hard-coded defaults, if the user doesn't have any in Settings.
  const [trustLevel, setTrustLevel] = useState(settings.trustSettings.trustLevel || 2)
  const [trustedEntities, setTrustedEntities] = useState(JSON.parse(JSON.stringify(settings.trustSettings.trustedCertifiers)))
  const [search, setSearch] = useState('')
  const [addEntityModalOpen, setAddEntityModalOpen] = useState(false)
  const [settingsLoading, setSettingsLoading] = useState(false)
  const [settingsNeedsUpdate, setSettingsNeedsUpdate] = useState(true)
  const [nextLocation, setNextLocation] = useState(null)
  const [saveModalOpen, setSaveModalOpen] = useState(false)
  const classes = useStyles()
  const totalTrustPoints = trustedEntities.reduce((a, e) => a + e.trust, 0)

  useEffect(() => {
    if (trustLevel > totalTrustPoints) {
      setTrustLevel(totalTrustPoints)
    }
  }, [totalTrustPoints])

  useEffect(() => {
    setSettingsNeedsUpdate((settings.trustSettings.trustLevel !== trustLevel) || (!arraysOfObjectsAreEqual(settings.trustSettings.trustedCertifiers, trustedEntities)))
  }, [trustedEntities, totalTrustPoints, trustLevel, settings])

  useEffect(() => {
    const unblock = history.block((location) => {
      // Block navigation when saving settings
      if (settingsNeedsUpdate) {
        setNextLocation(location)
        setSaveModalOpen(true)
        return false
      }
      return true
    })
    return () => {
      unblock()
    }
  }, [settingsNeedsUpdate, history])

  const shownTrustedEntities = trustedEntities.filter(x => {
    if (!search) {
      return true
    }
    return x.name.toLowerCase().indexOf(search.toLowerCase()) !== -1 || x.description.toLowerCase().indexOf(search.toLowerCase()) !== -1
  })

  const handleSave = async () => {
    try {
      setSettingsLoading(true)
      // Show a toast progress bar if not using save modal
      if (!saveModalOpen) {
        toast.promise(
          (async () => {
            try {
              await updateSettings(JSON.parse(JSON.stringify({
                ...settings,
                trustSettings: {
                  trustLevel,
                  trustedCertifiers: trustedEntities
                }
              })))
            } catch (e) {
              console.error(e)
              throw e
            }
          })(),
          {
            pending: 'Saving settings...',
            success: {
              render: 'Trust relationships updated!',
              autoClose: 2000
            },
            error: 'Failed to save settings! 🤯'
          }
        )
      } else {
        await updateSettings(JSON.parse(JSON.stringify({
          ...settings,
          trustSettings: {
            trustLevel,
            trustedCertifiers: trustedEntities
          }
        })))
        toast.success('Trust relationships updated!')
      }
      setSettingsNeedsUpdate(false)
    } catch (e) {
      toast.error(e.message)
    } finally {
      setSettingsLoading(false)
    }
  }

  return (
    <div className={classes.root}>
      <Typography variant='h1' color='textPrimary' sx={{ mb: 2 }}>
        Trust
      </Typography>
      <Typography variant='body1' color='textSecondary' sx={{ mb: 2 }}>
        Give points to show which certifiers you trust the most to confirm the identity of counterparties. More points mean a higher priority.
      </Typography>

      {settingsLoading && (
        <Box sx={{ width: '100%', mb: 2 }}>
          <LinearProgress />
        </Box>
      )}

      <Paper elevation={0} className={classes.section} sx={{ p: 3, bgcolor: 'background.paper' }}>
        <Typography variant='h4' sx={{ mb: 2 }}>Trust Threshold</Typography>
        <Typography variant='body1' color='textSecondary' sx={{ mb: 2 }}>
          You've given out a total of <b>{totalTrustPoints} {totalTrustPoints === 1 ? 'point' : 'points'}</b>. Set the minimum points any counterparty must have across your trust network to be shown in any apps you use.
        </Typography>
        <Box className={classes.trust_threshold}>
          <Box className={classes.slider_label_grid}>
            <Typography><b>{trustLevel}</b> / {totalTrustPoints}</Typography>
            <Slider min={1} max={totalTrustPoints} step={1} onChange={(e, v) => setTrustLevel(v as number)} value={trustLevel} />
          </Box>
        </Box>
      </Paper>

      <Paper elevation={0} className={classes.section} sx={{ p: 3, bgcolor: 'background.paper', mt: 3 }}>
        <Typography variant='h4' sx={{ mb: 2 }}>Certifier Network</Typography>
        <Typography variant='body1' color='textSecondary' sx={{ mb: 3 }}>
          People, businesses, and websites will need endorsement by these certifiers to show up in your apps. Otherwise, you'll see them as "Unknown Identity".
        </Typography>
        
        {/* UI Controls - Search and Add Buttons */}
        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 2, mb: 2 }}>
          <TextField
            value={search}
            onChange={(e => setSearch(e.target.value))}
            label='Search'
            placeholder='Filter providers...'
            fullWidth
            sx={{ flex: 1 }}
            slotProps={{
              input: {
                startAdornment: <SearchIcon color='action' sx={{ mr: 1 }} />
              }
            }}
          />
          <Button
            variant='contained'
            color='primary'
            onClick={() => setAddEntityModalOpen(true)}
            startIcon={<AddIcon />}
            sx={{ minWidth: '200px' }}
          >
            Add Search Provider
          </Button>
        </Box>
        <Box flex={1}>
          {shownTrustedEntities.map((entity, i) => (
            <Box key={`${entity.name}.${entity.description}.${entity.identityKey}`}>
              <TrustedEntity
                entity={entity}
                trustedEntities={trustedEntities}
                setTrustedEntities={setTrustedEntities}
                classes={classes}
                history={history}
              />
            </Box>
          ))}
        </Box>
      </Paper>

      <NavigationConfirmModal
        open={saveModalOpen}
        onConfirm={async () => {
          setSettingsNeedsUpdate(false)
          await handleSave()
          setSaveModalOpen(false)
          history.push(nextLocation.pathname)
        }}
        onCancel={() => {
          setSettingsNeedsUpdate(false)
          // Make sure state updates complete first
          setTimeout(() => {
            history.push(nextLocation.pathname)
          }, 100)
        }}
        loading={settingsLoading}
      >
        {settingsLoading
          ? <div>
            <Typography>Saving settings...</Typography>
            <LinearProgress style={{ paddingTop: '1em' }} />
          </div>
          : 'You have unsaved changes. Do you want to save them before leaving?'}
      </NavigationConfirmModal>

      <Prompt
        when={settingsNeedsUpdate}
        message="You have unsaved changes, are you sure you want to leave?"
      />

      <AddEntityModal
        open={addEntityModalOpen}
        setOpen={setAddEntityModalOpen}
        trustedEntities={trustedEntities}
        setTrustedEntities={setTrustedEntities}
        classes={classes}
      />

      <Snackbar
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'center'
        }}
        open={settingsNeedsUpdate}
        message='You have unsaved changes!'
        action={
            <Button
              disabled={settingsLoading}
              color='secondary' size='small'
              onClick={handleSave}
            >
              {settingsLoading ? 'Saving...' : 'Save'}
            </Button>
        }
      />
    </div>
  )
}

export default Trust
