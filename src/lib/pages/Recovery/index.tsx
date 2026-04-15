import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
  const classes = useStyles()
  return (
    <div className={classes.content_wrap}>
      <div className={classes.panel_body}>
        <Typography variant='h2' paragraph fontFamily='Helvetica' fontSize='2em'>
          {t('recovery_page_title')}
        </Typography>
        <Typography variant='body1' paragraph>
          {t('recovery_page_description')}
        </Typography>
        <List style={{ marginTop: '1rem', marginBottom: '1rem' }}>
          <ListItem disablePadding>
            <ListItemButton onClick={() => history.push('/recovery/presentation-key')}>
              <ListItemIcon>
                <KeyIcon />
              </ListItemIcon>
              <ListItemText
                primary={t('recovery_option_presentation_key_title')}
                secondary={t('recovery_option_presentation_key_desc')}
              />
            </ListItemButton>
          </ListItem>
          <ListItem disablePadding>
            <ListItemButton onClick={() => history.push('/recovery/password')}>
              <ListItemIcon>
                <LockIcon />
              </ListItemIcon>
              <ListItemText
                primary={t('recovery_option_password_title')}
                secondary={t('recovery_option_password_desc')}
              />
            </ListItemButton>
          </ListItem>
        </List>
        <Button
          className={classes.back_button}
          onClick={() => history.go(-1)}
          style={{ marginTop: '1rem' }}
        >
          {t('recovery_button_go_back')}
        </Button>
      </div>
    </div>
  )
}

export default Recovery
