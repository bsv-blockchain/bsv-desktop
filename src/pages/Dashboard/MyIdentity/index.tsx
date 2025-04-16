/* eslint-disable indent */
/* eslint-disable react/prop-types */
import { useState, useContext, useEffect } from 'react'
import { Typography, IconButton, Box, Button, Paper } from '@mui/material'
import Grid from '@mui/material/Grid'
import CheckIcon from '@mui/icons-material/Check'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import EyeCon from '@mui/icons-material/Visibility'
import { WalletContext } from '../../../WalletContext'
import { ProtoWallet, VerifiableCertificate } from '@bsv/sdk'
// import CertificateChip from '../../../components/CertificateChip'
import CertificateCard from './CertificateCard'
// Import just the styled components we need
import { Root } from './styles'

// Modern MUI styling no longer needs useStyles

const MyIdentity = () => {
  const { managers, network, adminOriginator } = useContext(WalletContext)

  const [search, setSearch] = useState('')
  const [addPopularSigniaCertifiersModalOpen, setAddPopularSigniaCertifiersModalOpen] = useState(false)
  const [certificates, setCertificates] = useState([])
  const [primaryIdentityKey, setPrimaryIdentityKey] = useState('...')
  const [privilegedIdentityKey, setPrivilegedIdentityKey] = useState('...')
  const [copied, setCopied] = useState({ id: false, privileged: false })
  // No longer need classes from useStyles

  const handleCopy = (data, type) => {
    navigator.clipboard.writeText(data)
    setCopied({ ...copied, [type]: true })
    setTimeout(() => {
      setCopied({ ...copied, [type]: false })
    }, 2000)
  }

  useEffect(() => {
    if (typeof adminOriginator === 'string') {
      const cacheKey = 'provenCertificates'

      const getProvenCertificates = async () => {
        // Attempt to load the proven certificates from cache
        const cachedProvenCerts = window.localStorage.getItem(cacheKey)
        if (cachedProvenCerts) {
          setCertificates(JSON.parse(cachedProvenCerts))
        }

        // Find and prove certificates if not in cache
        const certs = await managers.permissionsManager.listCertificates({
          certifiers: [],
          types: [],
          limit: 100
        }, adminOriginator)
        const provenCerts = []
        if (certs && certs.certificates && certs.certificates.length > 0) {
          for (const certificate of certs.certificates) {
            try {
              const fieldsToReveal = Object.keys(certificate.fields)
              const proof = await managers.permissionsManager.proveCertificate({
                certificate,
                fieldsToReveal,
                verifier: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798' // anyone public key
              }, adminOriginator)
              const decrypted = await (new VerifiableCertificate(
                certificate.type,
                certificate.serialNumber,
                certificate.subject,
                certificate.certifier,
                certificate.revocationOutpoint,
                certificate.fields,
                proof.keyringForVerifier,
                certificate.signature
              )).decryptFields(new ProtoWallet('anyone'))
              provenCerts.push({
                ...certificate,
                decryptedFields: decrypted
              })
            } catch (e) {
              console.error(e)
            }
          }
          if (provenCerts.length > 0) {
            setCertificates(provenCerts)
            window.localStorage.setItem(cacheKey, JSON.stringify(provenCerts))
          }
        }
      }

      getProvenCertificates()

      // Set primary identity key
      const setIdentityKey = async () => {
        const { publicKey: identityKey } = await managers.permissionsManager.getPublicKey({ identityKey: true }, adminOriginator)
        setPrimaryIdentityKey(identityKey)
      }

      setIdentityKey()
    }
  }, [setCertificates, setPrimaryIdentityKey, adminOriginator])

  const handleRevealPrivilegedKey = async () => {
    const { publicKey } = await managers.permissionsManager.getPublicKey({
      identityKey: true,
      privileged: true,
      privilegedReason: 'Reveal your privileged identity key alongside your everyday one.'
    })
    setPrivilegedIdentityKey(publicKey)
  }

  // Handle certificate revocation by removing it from the state
  const handleCertificateRevoke = (serialNumber) => {
    setCertificates(prevCertificates => {
      const updatedCertificates = prevCertificates.filter(cert =>
        cert.serialNumber !== serialNumber
      )

      // Update the local storage cache with the updated certificates
      window.localStorage.setItem('provenCertificates', JSON.stringify(updatedCertificates))

      return updatedCertificates
    })
  }

  const shownCertificates = certificates.filter(x => {
    if (!search) {
      return true
    }
    // filter...
    return false
    // return x.name.toLowerCase().indexOf(search.toLowerCase()) !== -1 || x.note.toLowerCase().indexOf(search.toLowerCase()) !== -1
  })

  return (
    <Root>
      <Typography variant="h1" color="textPrimary" sx={{ mb: 2 }}>
        {network === 'testnet' ? 'Testnet Identity' : 'Identity'}
      </Typography>
      <Typography variant="body1" color="textSecondary" sx={{ mb: 4 }}>
        Manage your identity keys and certificates.
      </Typography>

      <Box sx={{ mb: 4 }}>
        <Paper elevation={0} sx={{ p: 3, bgcolor: 'background.paper' }}>
          <Typography variant="h4" sx={{ mb: 2 }}>
            Identity Keys
          </Typography>
          <Box sx={{ mb: 3 }}>
            <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
              <b>Everyday Identity Key:</b>
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
              <Typography
                variant="body2"
                sx={{
                  fontFamily: 'monospace',
                  bgcolor: 'action.hover',
                  py: 1,
                  px: 2,
                  flexGrow: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}
              >
                {primaryIdentityKey}
              </Typography>
              <IconButton size='small' onClick={() => handleCopy(primaryIdentityKey, 'id')} disabled={copied.id} sx={{ ml: 1 }}>
                {copied.id ? <CheckIcon /> : <ContentCopyIcon fontSize='small' />}
              </IconButton>
            </Box>

            <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
              <b>Privileged Identity Key:</b>
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              {privilegedIdentityKey === '...' ? (
                <Button
                  variant="outlined"
                  startIcon={<EyeCon />}
                  onClick={handleRevealPrivilegedKey}
                  size="small"
                  sx={{ mr: 1 }}
                >
                  Reveal Key
                </Button>
              ) : (
                <>
                  <Typography
                    variant="body2"
                    sx={{
                      fontFamily: 'monospace',
                      bgcolor: 'action.hover',
                      py: 1,
                      px: 2,
                      borderRadius: 1,
                      flexGrow: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}
                  >
                    {privilegedIdentityKey}
                  </Typography>
                  <IconButton size='small' onClick={() => handleCopy(privilegedIdentityKey, 'privileged')} disabled={copied.privileged} sx={{ ml: 1 }}>
                    {copied.privileged ? <CheckIcon /> : <ContentCopyIcon fontSize='small' />}
                  </IconButton>
                </>
              )}
            </Box>
          </Box>
        </Paper>
      </Box>

      <Box sx={{ mb: 4 }}>
        <Paper elevation={0} sx={{ p: 3, bgcolor: 'background.paper' }}>
          <Typography variant="h4" sx={{ mb: 2 }}>
            Certificates
          </Typography>
          <Typography variant="body1" color="textSecondary" sx={{ mb: 3 }}>
            As you go about your life, people and businesses you interact with can give you certificates and credentials. These verify your qualifications and help you establish trust.
          </Typography>

          <Grid container spacing={2} justifyContent="space-between" columns={{ xs: 1, sm: 1, md: 1, lg: 2 }}>
            {shownCertificates.map((cert) => (
              <Grid key={cert.serialNumber} size={1}>
                <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: 'action.hover', border: 1, borderColor: 'action.main' }}>
                  <CertificateCard certificate={cert} />
                  {/* <CertificateChip
                  certType={cert.type}
                  serialNumber={cert.serialNumber}
                  certifier={cert.certifier}
                  fieldsToDisplay={cert.decryptedFields}
                  canRevoke={true}
                  onRevoke={handleCertificateRevoke}
                /> */}
                </Box>
              </Grid>
            ))}
          </Grid>

          {shownCertificates.length === 0 && (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <Typography color="textSecondary">
                No certificates found. Register with identity certifiers to receive certificates.
              </Typography>
            </Box>
          )}
        </Paper>
      </Box>
    </Root>
  )
}

export default MyIdentity
