import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { useTheme } from '@mui/material'

const ThemedToastContainer = () => {
  const theme = useTheme()

  return (
    <ToastContainer
      closeButton={true}
      position="top-right"
      autoClose={3000}
      hideProgressBar={false}
      newestOnTop
      closeOnClick
      rtl={false}
      pauseOnFocusLoss
      draggable
      pauseOnHover
      theme={theme.palette.mode === 'dark' ? 'dark' : 'light'}
    />
  );
};

export default ThemedToastContainer;
