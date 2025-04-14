import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { useTheme } from '@mui/material'

const ThemedToastContainer = () => {
  const theme = useTheme()
  
  return (
    <ToastContainer theme={theme.palette.mode === 'dark' ? 'dark' : 'light'} position='top-center' />
  );
};

export default ThemedToastContainer;
