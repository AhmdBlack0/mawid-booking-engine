import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    primary: {
      main: '#4f46e5', // Indigo 600
      light: '#818cf8',
      dark: '#3730a3',
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#64748b', // Slate 500
      light: '#94a3b8',
      dark: '#334155',
    },
    success: {
      main: '#10b981', // Emerald 500
      light: '#6ee7b7',
      dark: '#047857',
    },
    warning: {
      main: '#f59e0b', // Amber 500
      light: '#fcd34d',
      dark: '#b45309',
    },
    error: {
      main: '#f43f5e', // Rose 500
      light: '#fda4af',
      dark: '#be123c',
    },
    background: {
      default: '#f8fafc', // Slate 50
      paper: '#ffffff',
    },
  },
  typography: {
    fontFamily: [
      '-apple-system',
      'BlinkMacSystemFont',
      '"Segoe UI"',
      'Roboto',
      'Helvetica',
      'Arial',
      'sans-serif',
    ].join(','),
    button: {
      textTransform: 'none',
      fontWeight: 600,
    },
  },
  shape: {
    borderRadius: 12,
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: '10px',
          boxShadow: 'none',
          '&:hover': {
            boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: 600,
          borderRadius: '8px',
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        rounded: {
          borderRadius: '16px',
        },
      },
    },
  },
});
