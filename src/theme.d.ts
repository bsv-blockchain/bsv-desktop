import '@mui/material/styles';

declare module '@mui/material/styles' {
  interface Theme {
    approvals: {
      protocol: string;
      basket: string;
      identity: string;
      renewal: string;
    };
  }
  
  // allow configuration using `createTheme`
  interface ThemeOptions {
    approvals?: {
      protocol?: string;
      basket?: string;
      identity?: string;
      renewal?: string;
    };
  }
}
