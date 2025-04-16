import React, { ReactNode } from 'react';
import {
  Typography,
  useMediaQuery,
  DialogProps,
  DialogContent,
  Stack,
  Box
} from '@mui/material';
import { useTheme } from '@mui/material/styles';

// Import styled components
import { StyledDialog, StyledDialogTitle, StyledDialogActions } from './styles';

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
  // No longer need classes from useStyles
  const theme = useTheme();
  const isFullscreen = useMediaQuery(theme.breakpoints.down('sm'));

  return (
    <StyledDialog
      maxWidth={isFullscreen ? undefined : 'sm'}
      fullWidth={!isFullscreen}
      fullScreen={isFullscreen}
      className={className}
      {...props}
    >
      <StyledDialogTitle sx={{ color: theme.palette.getContrastText(theme.palette.secondary.main), backgroundColor: theme.palette.secondary.main }}>
        <Stack direction="row" spacing={1} alignItems="center">
          {icon} <Typography variant="h5" fontWeight="bold">{title}</Typography>
        </Stack>
      </StyledDialogTitle>
      {description && <Box sx={{ px: 5, py: 3 }}><Typography variant="body1" color="textSecondary">{description}</Typography></Box>}
      <DialogContent>{children}</DialogContent>
      {actions && (
        <StyledDialogActions>
          {actions}
        </StyledDialogActions>
      )}
    </StyledDialog>
  );
};

export default CustomDialog;
