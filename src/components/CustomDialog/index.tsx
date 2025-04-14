import React, { ReactNode } from 'react';
import {
  Dialog,
  DialogTitle,
  Typography,
  useMediaQuery,
  DialogProps,
  DialogContent,
  DialogActions,
  Paper,
  Stack,
  Box
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { makeStyles } from '@mui/styles';
import Logo from '../Logo';
import style from './style';

const useStyles = makeStyles(style, { name: 'CustomDialog' });

interface CustomDialogProps extends DialogProps {
  title: string;
  children: ReactNode;
  description?: string;
  actions?: ReactNode;
  minWidth?: string;
  color?: string;
  icon?: ReactNode;
}

const CustomDialog: React.FC<CustomDialogProps> = ({ 
  title, 
  description,
  color,
  icon,
  children, 
  actions,
  className = '',
  ...props 
}) => {
  const classes = useStyles();
  const theme = useTheme();
  const isFullscreen = useMediaQuery(theme.breakpoints.down('sm'));

  return (
    <Dialog
      maxWidth={isFullscreen ? undefined : 'sm'}
      fullWidth={!isFullscreen}
      fullScreen={isFullscreen}
      className={`${classes.root} ${className}`}
      {...props}
    >
      <DialogTitle className={classes.title} sx={{ color: theme.palette.getContrastText(theme.palette.secondary.main), backgroundColor: theme.palette.secondary.main }}>
        <Stack direction="row" spacing={1} alignItems="center">
          {icon} <Typography variant="h5" fontWeight="bold">{title}</Typography>
        </Stack>
      </DialogTitle>
      {description && <Box sx={{ px: 5, py: 3 }}><Typography variant="body1" color="textSecondary">{description}</Typography></Box>}
      <DialogContent>{children}</DialogContent>
      {actions && (
        <DialogActions className={classes.actions}>
          {actions}
        </DialogActions>
      )}
    </Dialog>
  );
};

export default CustomDialog;
