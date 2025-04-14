import React, { useEffect, useState } from 'react'
import { Button, Typography, IconButton, Grid, Link, Paper } from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import CheckIcon from '@mui/icons-material/Check'
import DownloadIcon from '@mui/icons-material/Download'
import { useHistory, useLocation } from 'react-router-dom'
import exportDataToFile from '../../../utils/exportDataToFile'
import PageHeader from '../../../components/PageHeader'
import BasketAccessList from '../../../components/BasketAccessList'

/**
 * Display the access information for a particular basket
 */
const BasketAccess = () => {
  const location = useLocation()
  const history = useHistory()
  // const useStyles = makeStyles(style, { name: 'basketAccess' })
  // const classes = useStyles()

  if (!location.state) {
    return <div>No data provided!</div>
  }

  const { id, name, description, documentationURL, iconURL, originator } = location.state
  const [copied, setCopied] = useState({ id: false, registryOperator: false })
  const [itemsInBasket, setItemsInBasket] = useState([])

  // Copies the data and timeouts the checkmark icon
  const handleCopy = (data, type) => {
    navigator.clipboard.writeText(data)
    setCopied({ ...copied, [type]: true })
    setTimeout(() => {
      setCopied({ ...copied, [type]: false })
    }, 2000)
  }

  useEffect(() => {
    (async () => {
      try {
        // Get a list of items in this basket
        const itemsInBasket = await window.CWI.ninja.getTransactionOutputs({
          basket: id,
          includeBasket: true,
          includeTags: true,
          spendable: true,
          order: 'descending'
        })
        setItemsInBasket(itemsInBasket)
      } catch (error) {
        console.error('Failed to fetch outputs:', error)
      }
    })()
  }, [])

  return (
    <Grid container spacing={3} direction='column'>
      <Grid item>
        <PageHeader
          history={history}
          title={name}
          subheading={
            <div>
              <Typography variant='caption' color='textSecondary' display='block'>
                {`Items in Basket: ${itemsInBasket.length}`}
              </Typography>
              <Typography variant='caption' color='textSecondary' style={{ display: 'block', marginTop: '-0.444em' }}>
                Basket ID: {id}
                <IconButton size='small' onClick={() => handleCopy(id, 'id')} disabled={copied.id}>
                  {copied.id ? <CheckIcon /> : <ContentCopyIcon fontSize='small' />}
                </IconButton>
              </Typography>
            </div>
          }
          icon={iconURL} buttonTitle='Export'
          buttonIcon={<DownloadIcon />}
          onClick={() => exportDataToFile({
            data: itemsInBasket,
            filename: 'basket_contents.json',
            type: 'application/json'
          })}
        />
      </Grid>

      <Grid item>
        <Typography variant='h5' gutterBottom>
          Basket Description
        </Typography>
        <Typography variant='body' gutterBottom>
          {description}
        </Typography>
      </Grid>

      <Grid item>
        <Typography variant='h5' gutterBottom>
          Learn More
        </Typography>
        <Typography variant='body'>You can learn more about how to manipulate and use the items in this basket from the following URL:</Typography>
        <br />
        <Link color='textPrimary' href={documentationURL} target='_blank' rel='noopener noreferrer'>{documentationURL}</Link>
      </Grid>

      <Grid item>
        <Paper elevation={3} sx={{ padding: '16px', borderRadius: '8px' }}>
          <Typography variant='h4' gutterBottom paddingLeft='0.25em'>
            Apps with Access
          </Typography>
          <BasketAccessList
            basket={id}
            itemsDisplayed='apps'
            canRevoke
            list
            displayCount
            showEmptyList
          />
        </Paper>
      </Grid>

      <Grid item alignSelf='center'>
        <Button color='error' onClick={() => { window.alert("Are you sure you want to revoke this app's access?") }}>
          Revoke All Access
        </Button>
      </Grid>

    </Grid>
  )
}

export default BasketAccess
