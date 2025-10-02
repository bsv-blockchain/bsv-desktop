import React, { ReactNode } from 'react';
import {
  Typography,
  useMediaQuery,
  DialogProps,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Stack,
  Box
} from '@mui/material';
import { useTheme } from '@mui/material/styles';

interface CustomDialogProps extends DialogProps {
  title: string;
  children: ReactNode;
  description?: string;
  actions?: ReactNode;
  minWidth?: string;
  icon?: ReactNode;
}

const CustomDialog: React.FC<CustomDialogProps> = ({ 
  title, 
  description,
  icon,
  children, 
  actions,
  className = '',
  ...props 
}) => {
  // No longer need classes from useStyles
  const theme = useTheme();
  const isFullscreen = useMediaQuery(theme.breakpoints.down('sm'));

  return (
    <Dialog
      maxWidth={isFullscreen ? undefined : 'sm'}
      fullWidth={!isFullscreen}
      fullScreen={isFullscreen}
      className={className}
      {...props}
    >
      <DialogTitle>
        <Stack direction="row" spacing={1} alignItems="center">
          {icon} <Typography variant="h5" fontWeight="bold">{title}</Typography>
        </Stack>
      </DialogTitle>
      {description && <Box sx={{ px: 5, py: 3 }}><Typography variant="body1" color="textSecondary">{description}</Typography></Box>}
      <DialogContent>{children}</DialogContent>
      {actions && (
        <DialogActions>
          {actions}
        </DialogActions>
      )}
    </Dialog>
  );
};

export default CustomDialog;
