/* eslint-disable react/prop-types */
import React, { useContext } from 'react'
import { ListItem, List, Link, Typography, Button, DialogContent, DialogContentText, DialogActions } from '@mui/material'
import CustomDialog from '../../../components/CustomDialog'
import UIContext from '../../../UIContext.js'

const AddPopularSigniaCertifiersModal = ({
  open, setOpen, classes
}) => {
  const { env } = useContext(UIContext)
  const popularCertifiers = [
    {
      URL: env === 'prod' ? 'https://identicert.me' : 'https://staging.identicert.me',
      name: 'IdentiCert (Government ID)'
    },
    {
      URL: env === 'prod' ? 'https://socialcert.net' : 'https://staging.socialcert.net',
      name: 'SocialCert (Social platforms, Phone, Email)'
    },
    {
      URL: env === 'prod' ? 'https://googcert.babbage.systems' : 'https://staging-googcert.babbage.systems',
      name: 'GoogCert (Google account)',
      hide: true
    }
  ]

  return (
    <CustomDialog
      open={open}
      title='Register Your Identity'
      onClose={() => setOpen(false)}
      minWidth='lg'
    >
      <DialogContent>
        <br />
        <form>
          <DialogContentText>Register your details to connect with the community and be easily discoverable to others!
          </DialogContentText>
          <center>
            <List className={classes.oracle_link_container}>
              {popularCertifiers.map((c, i) => {
                if (c.hide) {
                  return null
                }
                return (
                  <ListItem key={i}>
                    <div className={classes.oracle_link}>
                      <Link
                        href={c.URL}
                        target='_blank' rel='noopener noreferrer'
                      >
                        <center>
                          <img src={`${c.URL}/favicon.ico`} className={classes.oracle_icon} />
                          <Typography className={classes.oracle_title}>{c.name}</Typography>
                        </center>
                      </Link>
                    </div>
                  </ListItem>
                )
              })}
            </List>
          </center>
        </form>
        <br />
        <br />
      </DialogContent>
      <DialogActions style={{ paddingLeft: '1.5em', justifyContent: 'space-between', paddingRight: '1em' }}>
        <Button onClick={() => setOpen(false)}>
          Done
        </Button>
      </DialogActions>
    </CustomDialog>
  )
}
export default AddPopularSigniaCertifiersModal
