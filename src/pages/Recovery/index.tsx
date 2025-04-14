import style from './style'
import { makeStyles } from '@mui/styles'
import {
  Lock as LockIcon,
  SettingsPhone as PhoneIcon
} from '@mui/icons-material'
import {
  List, ListItem, ListItemIcon, ListItemText, Button, Typography
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
        <List style={{ marginTop: '1rem', marginBottom: '1rem' }}>
          <ListItem
            // button
            onClick={() => history.push('/recovery/lost-phone')}
          >
            <ListItemIcon>
              <PhoneIcon />
            </ListItemIcon>
            <ListItemText>
              Lost Phone
            </ListItemText>
          </ListItem>
          <ListItem
            // button
            onClick={() => history.push('/recovery/lost-password')}
          >
            <ListItemIcon>
              <LockIcon />
            </ListItemIcon>
            <ListItemText>
              Lost Password
            </ListItemText>
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
