import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import { Certifier } from '@bsv/wallet-toolbox-client/out/src/WalletSettingsManager'
import fetchTrustManifest, { TrustManifestError } from '../../../utils/parseTrustManifest'
import { addTrustedCertifier, trustedCertifierFromManifest } from '../../../utils/trustedCertifiers'

const AddEntityModal = ({
  open, setOpen, trustedEntities, setTrustedEntities
}: { open: boolean, setOpen: Function, trustedEntities: any, setTrustedEntities: Function }) => {
  const { t } = useTranslation()
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
  const domainRequestGeneration = useRef(0)

  const handleDomainSubmit = async e => {
    e.preventDefault()
    const requestGeneration = ++domainRequestGeneration.current
    try {
      if (!domain) {
        return
      }
      setLoading(true)
      const { trust } = await fetchTrustManifest(domain)
      await validateTrust(trust)
      if (requestGeneration !== domainRequestGeneration.current) {
        return
      }
      setDomainError(null)
      setName(trust.name)
      setDescription(trust.note)
      setIcon(trust.icon)
      setIdentityKey(trust.publicKey)
      setFieldsValid(true)
    } catch (e) {
      if (requestGeneration !== domainRequestGeneration.current) {
        return
      }
      setFieldsValid(false)
      let msg = e instanceof Error ? e.message : String(e)
      if (e instanceof TrustManifestError && e.code === 'timeout') {
        msg = t('trust_add_entity_domain_timeout')
      }
      if (e instanceof TrustManifestError && e.code === 'fetch-failed') {
        msg = t('trust_add_entity_domain_fetch_failed')
      }
      setDomainError(msg)
    } finally {
      if (requestGeneration === domainRequestGeneration.current) {
        setLoading(false)
      }
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
    setTrustedEntities(current => {
      const candidate = trustedCertifierFromManifest({
        name,
        note: description,
        icon,
        publicKey: identityKey
      }) as Certifier
      const result = addTrustedCertifier(current, candidate)

      if (!result.added) {
        toast.error(t('trust_add_entity_duplicate_key'))
        return current
      }
      setDomain('')
      setName('')
      setDescription('')
      setIcon('')
      setIdentityKey('')
      setFieldsValid(false)
      setOpen(false)
      return result.entities
    })
  }

  return (
    <CustomDialog
      title={t('trust_add_entity_title')}
      open={open}
      onClose={() => setOpen(false)}
      style={{ minWidth: 'lg' }}
    >
      <DialogContent>
        <Box sx={{ mb: 2 }} />
        {!advanced &&
          <form onSubmit={handleDomainSubmit}>
            <DialogContentText>{t('trust_add_entity_domain_prompt')}</DialogContentText>
            <Box sx={{ mt: 2 }} />
            <Box sx={{ display: 'flex', justifyContent: 'center' }}>
              <TextField
                label={t('trust_add_entity_domain_label')}
                placeholder='trustedentity.com'
                value={domain}
                onChange={e => {
                  domainRequestGeneration.current++
                  setDomain(e.target.value)
                  setLoading(false)
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
                  {t('trust_add_entity_get_details')}
                </Button>
              </Box>}
          </form>}
        {advanced && (
          <form onSubmit={handleDirectSubmit}>
            <DialogContentText>{t('trust_add_entity_advanced_prompt')}</DialogContentText>
            <Box sx={{ mt: 2 }} />
            <TextField
              label={t('trust_add_entity_name_label')}
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
              label={t('trust_add_entity_icon_label')}
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
              label={t('trust_add_entity_public_key_label')}
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
                  {t('trust_add_entity_validate_details')}
                </Button>
              </Box>}
          </form>
        )}
        <Box sx={{ mt: 2 }} />
        <Button
          onClick={() => setAdvanced(x => !x)}
          startIcon={!advanced ? <ExpandMore /> : <ExpandLess />}
        >
          {advanced ? t('trust_add_entity_hide_advanced') : t('trust_add_entity_show_advanced')}
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
              label={t('trust_add_entity_description_label')}
              fullWidth
              error={description.length < 5 || description.length > 50}
              helperText={description.length < 5 || description.length > 50 ? t('trust_add_entity_description_error') : null}
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
        <Button onClick={() => setOpen(false)}>{t('trust_add_entity_cancel')}</Button>
        <Button
          disabled={!fieldsValid}
          variant='contained'
          endIcon={<Shield />}
          onClick={handleTrust}
        >
          {t('trust_add_entity_add_certifier')}
        </Button>
      </DialogActions>
    </CustomDialog>
  )
}
export default AddEntityModal
