import React, { ReactNode, useContext, useMemo, useEffect, useState } from 'react';
import {
  ThemeProvider,
  createTheme,
  CssBaseline,
  PaletteMode,
  StyledEngineProvider,
  useMediaQuery,
} from '@mui/material';
import { WalletContext } from '../WalletContext';
import { CSSProperties } from 'react';

/* --------------------------------------------------------------------
 *                         Theme Type Augmentation
 * ------------------------------------------------------------------ */
declare module '@mui/material/styles' {
  interface Theme {
    templates: {
      page_wrap: {
        maxWidth: string;
        margin: string;
        boxSizing: string;
        padding: string | number;
      };
      subheading: {
        textTransform: string;
        letterSpacing: string;
        fontWeight: string;
      };
      boxOfChips: {
        display: string;
        justifyContent: string;
        flexWrap: string;
        gap: string | number;
      };
      chip: (props: { size: number; backgroundColor?: string }) => {
        height: string | number;
        minHeight: string | number;
        backgroundColor: string;
        borderRadius: string;
        padding: string | number;
        margin: string | number;
      };
      chipLabel: CSSProperties;
      chipLabelTitle: (props: { size: number }) => {
        fontSize: string | number;
        fontWeight: string;
      };
      chipLabelSubtitle: {
        fontSize: string;
        opacity: number;
      };
      chipContainer: {
        position: string;
        display: string;
        alignItems: string;
      };
    };
  }

  interface ThemeOptions {
    templates?: {
      page_wrap?: {
        maxWidth?: string;
        margin?: string;
        boxSizing?: string;
        padding?: string | number;
      };
      subheading?: {
        textTransform?: string;
        letterSpacing?: string;
        fontWeight?: string;
      };
      boxOfChips?: {
        display?: string;
        justifyContent?: string;
        flexWrap?: string;
        gap?: string | number;
      };
      chip?: (props: { size: number; backgroundColor?: string }) => {
        height?: string | number;
        minHeight?: string | number;
        backgroundColor?: string;
        borderRadius?: string;
        padding?: string | number;
        margin?: string | number;
      };
      chipLabel?: CSSProperties;
      chipLabelTitle?: (props: { size: number }) => {
        fontSize?: string | number;
        fontWeight?: string;
      };
      chipLabelSubtitle?: {
        fontSize?: string;
        opacity?: number;
      };
      chipContainer?: {
        position?: string;
        display?: string;
        alignItems?: string;
      };
    };
  }
}

/* --------------------------------------------------------------------
 *                                Props
 * ------------------------------------------------------------------ */
interface ThemeProps {
  children: ReactNode;
}

/* --------------------------------------------------------------------
 *                         AppThemeProvider
 * ------------------------------------------------------------------ */
export function AppThemeProvider({ children }: ThemeProps) {
  const { settings, managers } = useContext(WalletContext);

  /* Detect OS-level colour-scheme preference */
  const prefersDarkMode = useMediaQuery('(prefers-color-scheme: dark)');

  const walletReady = Boolean(managers.permissionsManager)
  const mode: PaletteMode = useMemo(() => {
    let preference = settings?.theme?.mode || 'system'
    if (!walletReady) {
      try { preference = localStorage.getItem('userTheme') || preference } catch { /* use OS preference */ }
    }
    if (preference === 'light' || preference === 'dark') return preference
    return prefersDarkMode ? 'dark' : 'light'
  }, [settings?.theme?.mode, prefersDarkMode, walletReady])

  // The cache makes the device unlock screen match the last open wallet.
  useEffect(() => {
    if (!walletReady) return
    try { localStorage.setItem('userTheme', settings?.theme?.mode || 'system') } catch { /* theme still works */ }
  }, [settings?.theme?.mode, walletReady])

  /* Re-compute the theme whenever `mode` flips */
  const theme = useMemo(() => {
    return createTheme({
      approvals: {
        protocol: '#8fafd3',
        basket: '#a2bbd6',
        identity: '#86a7c4',
        renewal: '#ad86c4',
      },
      palette: {
        mode,
        primary: { main: mode === 'light' ? '#1b365d' : '#93b4f4', contrastText: mode === 'light' ? '#ffffff' : '#0d1b3a' },
        secondary: { main: mode === 'light' ? '#2c5282' : '#b2c5e8' },
        background: { default: mode === 'light' ? '#f5f7fb' : '#0f172a', paper: mode === 'light' ? '#ffffff' : '#172238' },
        text: { primary: mode === 'light' ? '#1e293b' : '#eef2fa', secondary: mode === 'light' ? '#607086' : '#a8b5cc' },
        divider: mode === 'light' ? '#e2e8f0' : '#2b3953',
        success: { main: mode === 'light' ? '#1b365d' : '#93b4f4' },
      },
      typography: {
        fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        h1: { fontWeight: 650, fontSize: '2rem', letterSpacing: '-0.055em', lineHeight: 1.2 },
        h2: { fontWeight: 650, fontSize: '1.65rem', letterSpacing: '-0.04em' },
        h3: { fontWeight: 600, fontSize: '1.4rem', letterSpacing: '-0.03em' },
        h4: { fontWeight: 600, fontSize: '1.15rem', letterSpacing: '-0.02em' },
        h5: { fontWeight: 600, fontSize: '1rem' },
        h6: { fontWeight: 600, fontSize: '0.95rem' },
        body1: { fontSize: '0.95rem', lineHeight: 1.65 },
        body2: { fontSize: '0.85rem', lineHeight: 1.6 },
        button: { fontWeight: 600, fontSize: '0.875rem' },
      },
      components: {
        MuiCssBaseline: { styleOverrides: {
          body: { backgroundImage: 'none' },
          '*': { scrollbarWidth: 'thin', scrollbarColor: `${mode === 'light' ? '#c5cfdf' : '#405373'} transparent` },
          '*:focus-visible': { outline: '3px solid #87a9dc', outlineOffset: 3 },
          '@media (prefers-reduced-motion: reduce)': { '*, *::before, *::after': { animationDuration: '0.01ms !important', transitionDuration: '0.01ms !important' } },
        } },
        MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { textTransform: 'none', borderRadius: 10, padding: '10px 18px' } } },
        MuiIconButton: { styleOverrides: { root: { borderRadius: 10 } } },
        MuiPaper: { defaultProps: { elevation: 0 }, styleOverrides: { root: { backgroundImage: 'none' } } },
        MuiCard: { styleOverrides: { root: { borderRadius: 18, border: `1px solid ${mode === 'light' ? '#e2e8f0' : '#2b3953'}`, boxShadow: 'none' } } },
        MuiOutlinedInput: { styleOverrides: { root: { borderRadius: 10 } } },
        MuiChip: { styleOverrides: { root: { borderRadius: 7, fontWeight: 500, fontSize: '0.75rem' } } },
        MuiDialog: { styleOverrides: { paper: { borderRadius: 20, backgroundImage: 'none' } } },
        MuiDialogTitle: { styleOverrides: { root: { fontWeight: 650, padding: '24px 24px 12px' } } },
        MuiDialogActions: { styleOverrides: { root: { padding: '16px 24px 24px' } } },
        MuiTab: { styleOverrides: { root: { textTransform: 'none', fontWeight: 600 } } },
        MuiAlert: { styleOverrides: { root: { borderRadius: 10 } } },
        MuiTooltip: { defaultProps: { arrow: true } },
      },
      shape: { borderRadius: 6 },
      templates: {
        page_wrap: {
          maxWidth: '1120px',
          margin: 'auto',
          boxSizing: 'border-box',
          padding: '24px',
        },
        subheading: {
          textTransform: 'uppercase',
          letterSpacing: '1.5px',
          fontWeight: '700',
        },
        boxOfChips: {
          display: 'flex',
          justifyContent: 'left',
          flexWrap: 'wrap',
          gap: '8px',
        },
        chip: ({ size, backgroundColor }) => ({
          height: `${size * 32}px`,
          minHeight: `${size * 32}px`,
          backgroundColor: backgroundColor || 'transparent',
          borderRadius: '16px',
          padding: '8px',
          margin: '4px',
        }),
        chipLabel: {
          display: 'flex',
          flexDirection: 'column',
        },
        chipLabelTitle: ({ size }) => ({
          fontSize: `${Math.max(size * 0.8, 0.8)}rem`,
          fontWeight: '500',
        }),
        chipLabelSubtitle: {
          fontSize: '0.7rem',
          opacity: 0.7,
        },
        chipContainer: {
          position: 'relative',
          display: 'inline-flex',
          alignItems: 'center',
        },
      },
      spacing: 8,
    });
  }, [mode]);

  return (
    <StyledEngineProvider injectFirst>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </StyledEngineProvider>
  );
}
