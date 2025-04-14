import React from 'react'
import Grid from '@mui/material/Grid2'
import CertificateCard from './CertificateCard'

const CertificatesGrid = ({ certificates }) => {
  return (
    <Grid container spacing={2}>
      {certificates.map((cert, index) => (
        <Grid item sx={{ xs: 12, sm: 6, md: 4 }} key={index}>
          <CertificateCard certificate={cert} />
        </Grid>
      ))}
    </Grid>
  )
}
export default CertificatesGrid
