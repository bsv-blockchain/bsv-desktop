import { useState } from 'react'
import { Typography, Button, TextField, DialogContent, DialogContentText, DialogActions, LinearProgress, InputAdornment, Box } from '@mui/material'
import DomainIcon from '@mui/icons-material/Public'
import ExpandMore from '@mui/icons-material/ExpandMore'
import ExpandLess from '@mui/icons-material/ExpandLess'
import GetTrust from '@mui/icons-material/DocumentScanner'
import Shield from '@mui/icons-material/Security'
import NameIcon from '@mui/icons-material/Person'
import PictureIcon from '@mui/icons-material/InsertPhoto'
import PublicKeyIcon from '@mui/icons-material/Key'
import CustomDialog from '../../../components/CustomDialog'
import { toast } from 'react-toastify'
import validateTrust from '../../../utils/validateTrust'
import { Certifier } from '@bsv/wallet-toolbox/out/src/WalletSettingsManager'

const AddEntityModal = ({
  open, setOpen, trustedEntities, setTrustedEntities
}: { open: boolean, setOpen: Function, trustedEntities: any, setTrustedEntities: Function }) => {
  const [domain, setDomain] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [icon, setIcon] = useState('')
  const [identityKey, setIdentityKey] = useState('')
  const [fieldsValid, setFieldsValid] = useState(false)
  const [loading, setLoading] = useState(false)
  const [domainError, setDomainError] = useState(null)
  const [nameError, setNameError] = useState(null)
  const [iconError, setIconError] = useState(null)
  const [publicKeyError, setPublicKeyError] = useState(null)

  const handleDomainSubmit = async e => {
    e.preventDefault()
    try {
      if (!domain) {
        return
      }
      setLoading(true)
      const controller = new window.AbortController()
      const id = setTimeout(() => controller.abort(), 15000)
      const url = domain.startsWith('http') ? `${domain}/manifest.json` : `https://${domain}/manifest.json`
      const result = await window.fetch(
        url,
        { signal: controller.signal }
      )
      clearTimeout(id)
      const json = await result.json()
      if (!json.babbage || !json.babbage.trust || typeof json.babbage.trust !== 'object') {
        throw new Error('This domain does not support importing a trust relationship (it needs to follow the BRC-68 protocol)')
      }
      await validateTrust(json.babbage.trust)
      setName(json.babbage.trust.name)
      setDescription(json.babbage.trust.note)
      setIcon(json.babbage.trust.icon)
      setIdentityKey(json.babbage.trust.publicKey)
      setFieldsValid(true)
    } catch (e) {
      setFieldsValid(false)
      let msg = e.message
      if (msg === 'The user aborted a request.') {
        msg = 'The domain did not respond within 15 seconds'
      }
      if (msg === 'Failed to fetch') {
        msg = 'Could not fetch the trust data from that domain (it needs to follow the BRC-68 protocol)'
      }
      setDomainError(msg)
    } finally {
      setLoading(false)
    }
  }

  const handleDirectSubmit = async e => {
    e.preventDefault()
    try {
      setLoading(true)
      await validateTrust({
        name,
        icon,
        publicKey: identityKey
      }, { skipNote: true })
      setDescription(name)
      setFieldsValid(true)
    } catch (e) {
      setFieldsValid(false)
      if (e.field) {
        if (e.field === 'name') {
          setNameError(e.message)
        } else if (e.field === 'icon') {
          setIconError(e.message)
        } else { // public key for anything else
          setPublicKeyError(e.message)
        }
      } else {
        setPublicKeyError(e.message) // Public key for other errors
      }
    } finally {
      setLoading(false)
    }
  }

  const handleTrust = async () => {
    setTrustedEntities(t => {
      if (t.some(x => x.identityKey === identityKey)) {
        toast.error('An entity with this public key is already in the list!')
        return t
      }
      setDomain('')
      setName('')
      setDescription('')
      setIdentityKey('')
      setFieldsValid(false)
      setOpen(false)
      return [
        { name, icon, description, identityKey, trust: 5 } as Certifier,
        ...t
      ]
    })
  }

  return (
    <CustomDialog
      title='Add Provider'
      open={open}
      onClose={() => setOpen(false)}
      style={{ minWidth: 'lg' }}
    >
      <DialogContent>
        <Box sx={{ mb: 2 }} />
        {!advanced &&
          <form onSubmit={handleDomainSubmit}>
            <DialogContentText>Enter the domain name for the provider you'd like to add.</DialogContentText>
            <Box sx={{ mt: 2 }} />
            <Box sx={{ display: 'flex', justifyContent: 'center' }}>
              <TextField
                label='Domain Name'
                placeholder='trustedentity.com'
                value={domain}
                onChange={e => {
                  setDomain(e.target.value)
                  setDomainError(null)
                  setFieldsValid(false)
                }}
                fullWidth
                error={!!domainError}
                helperText={domainError}
                variant='outlined'
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position='start'>
                        <DomainIcon />
                      </InputAdornment>
                    )
                  }
                }}
              />
            </Box>
            <Box sx={{ mt: 2 }} />
            {loading
              ? <LinearProgress />
              : <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                <Button
                  variant='contained'
                  size='large'
                  endIcon={<GetTrust />}
                  type='submit'
                  disabled={loading}
                >
                  Get Provider Details
                </Button>
              </Box>}
          </form>}
        {advanced && (
          <form onSubmit={handleDirectSubmit}>
            <DialogContentText>Directly enter the details for the provider you'd like to add.</DialogContentText>
            <Box sx={{ mt: 2 }} />
            <TextField
              label='Entity Name'
              placeholder='Identity Certifier'
              value={name}
              onChange={e => {
                setName(e.target.value)
                setNameError(null)
                setFieldsValid(false)
              }}
              fullWidth
              error={!!nameError}
              helperText={nameError}
              variant='outlined'
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position='start'>
                      <NameIcon />
                    </InputAdornment>
                  )
                }
              }}
            />
            <Box sx={{ mt: 2 }} />
            <TextField
              label='Icon URL'
              placeholder='https://trustedentity.com/icon.png'
              value={icon}
              onChange={e => {
                setIcon(e.target.value)
                setIconError(null)
                setFieldsValid(false)
              }}
              fullWidth
              error={!!iconError}
              helperText={iconError}
              variant='outlined'
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position='start'>
                      <PictureIcon />
                    </InputAdornment>
                  )
                }
              }}
            />
            <Box sx={{ mt: 2 }} />
            <TextField
              label='Entity Public Key'
              placeholder='0295bf1c7842d14babf60daf2c733956c331f9dcb2c79e41f85fd1dda6a3fa4549'
              value={identityKey}
              onChange={e => {
                setIdentityKey(e.target.value)
                setPublicKeyError(null)
                setFieldsValid(false)
              }}
              fullWidth
              error={!!publicKeyError}
              helperText={publicKeyError}
              variant='outlined'
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position='start'>
                      <PublicKeyIcon />
                    </InputAdornment>
                  )
                }
              }}
            />
            <Box sx={{ mt: 2 }} />
            {loading
              ? <LinearProgress />
              : <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                <Button
                  variant='contained'
                  size='large'
                  endIcon={<GetTrust />}
                  type='submit'
                  disabled={loading}
                >
                  Validate Details
                </Button>
              </Box>}
          </form>
        )}
        <Box sx={{ mt: 2 }} />
        <Button
          onClick={() => setAdvanced(x => !x)}
          startIcon={!advanced ? <ExpandMore /> : <ExpandLess />}
        >
          {advanced ? 'Hide' : 'Show'} Advanced
        </Button>
        {fieldsValid && (
          <Box sx={{
            padding: 2,
            backgroundColor: 'background.paper',
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
            marginTop: 2
          }}>
            <Box sx={{
              display: 'grid',
              gridTemplateColumns: '4em 1fr',
              alignItems: 'center',
              gap: 2,
              padding: 1,
              borderRadius: '6px'
            }}>
              <img src={icon} style={{ width: '4em', height: '4em', borderRadius: '6px' }} />
              <Box>
                <Typography><b>{name}</b></Typography>
                <Typography variant='caption' color='textSecondary'>{identityKey}</Typography>
              </Box>
            </Box>
            <Box sx={{ mt: 2 }} />
            <TextField
              value={description}
              onChange={e => setDescription(e.target.value)}
              label='description'
              fullWidth
              error={description.length < 5 || description.length > 50}
              helperText={description.length < 5 || description.length > 50 ? 'description must be between 5 and 50 characters' : null}
              variant='outlined'
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position='start'>
                      <NameIcon />
                    </InputAdornment>
                  )
                }
              }}
            />
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setOpen(false)}>Cancel</Button>
        <Button
          disabled={!fieldsValid}
          variant='contained'
          endIcon={<Shield />}
          onClick={handleTrust}
        >
          Add Identity Certifier
        </Button>
      </DialogActions>
    </CustomDialog>
  )
}
export default AddEntityModal
