import React from 'react';
import ReactDOM from 'react-dom/client';
import { ThemeProvider, StyledEngineProvider } from '@mui/material/styles';
import App from './App.jsx';
import { theme } from './theme';
import { ToastProvider } from './context/ToastContext';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <StyledEngineProvider injectFirst>
      <ThemeProvider theme={theme}>
        <ToastProvider>
          <App />
        </ToastProvider>
      </ThemeProvider>
    </StyledEngineProvider>
  </React.StrictMode>,
);
