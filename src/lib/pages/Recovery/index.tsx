import style from './style'
import { makeStyles } from '@mui/styles'
import {
  Lock as LockIcon,
  VpnKey as KeyIcon
} from '@mui/icons-material'
import {
  List, ListItem, ListItemButton, ListItemIcon, ListItemText, Button, Typography
} from '@mui/material'

const useStyles = makeStyles(style as any, {
  name: 'Recovery'
})

const Recovery: React.FC<any> = ({ history }) => {
  const classes = useStyles()
  return (
    <div className={classes.content_wrap}>
      <div className={classes.panel_body}>
        <Typography variant='h2' paragraph fontFamily='Helvetica' fontSize='2em'>
          Account Recovery
        </Typography>
        <Typography variant='body1' paragraph>
          Choose what you need to recover:
        </Typography>
        <List style={{ marginTop: '1rem', marginBottom: '1rem' }}>
          <ListItem disablePadding>
            <ListItemButton onClick={() => history.push('/recovery/presentation-key')}>
              <ListItemIcon>
                <KeyIcon />
              </ListItemIcon>
              <ListItemText
                primary="Presentation Key (Lost access to WAB or mnemonic)"
                secondary="Use your password and recovery key to regain access"
              />
            </ListItemButton>
          </ListItem>
          <ListItem disablePadding>
            <ListItemButton onClick={() => history.push('/recovery/password')}>
              <ListItemIcon>
                <LockIcon />
              </ListItemIcon>
              <ListItemText
                primary="Password (Forgotten)"
                secondary="Use your presentation key (mnemonic or WAB) and recovery key"
              />
            </ListItemButton>
          </ListItem>
        </List>
        <Button
          className={classes.back_button}
          onClick={() => history.go(-1)}
          style={{ marginTop: '1rem' }}
        >
          Go Back
        </Button>
      </div>
    </div>
  )
}

export default Recovery
