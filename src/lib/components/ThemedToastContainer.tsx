import { ToastContainer, Slide } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { GlobalStyles, useTheme } from '@mui/material'
import { alpha } from '@mui/material/styles'

/**
 * Toasts drawn as the app's own surfaces: paper background, divider border and
 * theme type, with the status colour kept to the icon and a thin progress line.
 * Rules are scoped under `.Toastify` so they win over react-toastify's stylesheet.
 */
const ThemedToastContainer = () => {
  const theme = useTheme()
  const { palette } = theme
  const status = {
    success: palette.success.main,
    info: palette.secondary.main,
    warning: palette.warning.main,
    error: palette.error.main,
  }

  return (
    <>
      <GlobalStyles styles={{
        '.Toastify': {
          '--toastify-font-family': theme.typography.fontFamily,
          '--toastify-toast-width': '360px',
          '--toastify-toast-min-height': '56px',
          '--toastify-toast-padding': '12px',
          '--toastify-toast-bd-radius': '14px',
          '--toastify-toast-shadow': palette.mode === 'light'
            ? '0 10px 28px rgba(15, 23, 42, 0.12)'
            : '0 10px 28px rgba(0, 0, 0, 0.45)',
          '--toastify-color-light': palette.background.paper,
          '--toastify-color-dark': palette.background.paper,
          '--toastify-text-color-light': palette.text.primary,
          '--toastify-text-color-dark': palette.text.primary,
          '--toastify-color-progress-light': palette.primary.main,
          '--toastify-color-progress-dark': palette.primary.main,
          '--toastify-color-progress-bgo': '0',
          '--toastify-spinner-color': palette.primary.main,
          '--toastify-spinner-color-empty-area': palette.divider,
          ...Object.fromEntries(Object.entries(status).flatMap(([type, color]) => [
            [`--toastify-color-${type}`, color],
            [`--toastify-icon-color-${type}`, color],
            [`--toastify-color-progress-${type}`, color],
          ])),
        },
        '.Toastify .Toastify__toast': {
          border: `1px solid ${palette.divider}`,
          ...theme.typography.body2,
          fontWeight: 500,
          color: palette.text.primary,
          columnGap: 12,
        },
        '.Toastify .Toastify__toast-icon': {
          width: 32,
          height: 32,
          marginInlineEnd: 0,
          borderRadius: 10,
          alignItems: 'center',
          justifyContent: 'center',
          alignSelf: 'flex-start',
          '& svg': { width: 18, height: 18 },
        },
        ...Object.fromEntries(Object.entries(status).map(([type, color]) => [
          `.Toastify .Toastify__toast--${type} .Toastify__toast-icon`,
          { backgroundColor: alpha(color, palette.mode === 'light' ? 0.1 : 0.16) },
        ])),
        '.Toastify .Toastify__toast-body': { padding: 0 },
        // In the flex row rather than absolutely placed, so text wraps before it instead of under it.
        '.Toastify .Toastify__close-button': {
          position: 'static',
          flexShrink: 0,
          alignSelf: 'flex-start',
          marginInlineStart: 'auto',
          width: 24,
          height: 24,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 7,
          color: palette.text.secondary,
          opacity: 1,
          '&:hover, &:focus-visible': { backgroundColor: palette.action.hover, color: palette.text.primary },
        },
        '.Toastify .Toastify__progress-bar--wrp': { height: 3 },
        '.Toastify .Toastify__progress-bar': { opacity: 0.6 },
      }} />
      <ToastContainer
        closeButton={true}
        position="top-right"
        autoClose={3000}
        hideProgressBar={false}
        newestOnTop={true}
        closeOnClick={true}
        rtl={false}
        pauseOnFocusLoss
        draggable={true}
        pauseOnHover
        transition={Slide}
        theme={palette.mode === 'dark' ? 'dark' : 'light'}
      />
    </>
  );
};

export default ThemedToastContainer;
