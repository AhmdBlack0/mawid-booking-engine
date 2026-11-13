import React, { createContext, useContext, useState, useCallback } from 'react';
import { Snackbar, Slide } from '@mui/material';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';

const ToastContext = createContext(null);

function SlideDownTransition(props) {
  return <Slide {...props} direction="down" />;
}

export function ToastProvider({ children }) {
  const [toast, setToast] = useState({
    open: false,
    severity: 'success', // 'success' | 'error' | 'warning' | 'info'
    title: '',
    message: '',
  });

  const showToast = useCallback(({ severity = 'info', title = '', message = '' }) => {
    setToast({
      open: true,
      severity,
      title,
      message,
    });
  }, []);

  const hideToast = useCallback(() => {
    setToast((prev) => ({ ...prev, open: false }));
  }, []);

  const severityConfig = {
    success: {
      borderColor: '#10b981',
      glowColor: 'rgba(16, 185, 129, 0.15)',
      iconBg: '#d1fae5',
      icon: <CheckCircle2 className="w-5 h-5 text-emerald-600" />,
      defaultTitle: 'Success!',
    },
    error: {
      borderColor: '#f43f5e',
      glowColor: 'rgba(244, 63, 94, 0.15)',
      iconBg: '#ffe4e6',
      icon: <AlertCircle className="w-5 h-5 text-rose-600" />,
      defaultTitle: 'Action Failed',
    },
    warning: {
      borderColor: '#f59e0b',
      glowColor: 'rgba(245, 158, 11, 0.15)',
      iconBg: '#fef3c7',
      icon: <AlertTriangle className="w-5 h-5 text-amber-600" />,
      defaultTitle: 'Notice',
    },
    info: {
      borderColor: '#4f46e5',
      glowColor: 'rgba(79, 70, 229, 0.15)',
      iconBg: '#e0e7ff',
      icon: <Info className="w-5 h-5 text-indigo-600" />,
      defaultTitle: 'Information',
    },
  };

  const currentCfg = severityConfig[toast.severity] || severityConfig.info;

  return (
    <ToastContext.Provider value={{ showToast, hideToast }}>
      {children}

      <Snackbar
        open={toast.open}
        autoHideDuration={4500}
        onClose={hideToast}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        TransitionComponent={SlideDownTransition}
        sx={{ mt: 8, mr: 2 }}
      >
        <div
          className="relative overflow-hidden rounded-2xl bg-white/95 backdrop-blur-md border p-4 min-w-[320px] max-w-md shadow-2xl transition-all"
          style={{
            borderColor: currentCfg.borderColor,
            boxShadow: `0 20px 25px -5px ${currentCfg.glowColor}, 0 8px 10px -6px ${currentCfg.glowColor}`,
          }}
        >
          {/* Top colored accent line */}
          <div
            className="absolute top-0 left-0 right-0 h-1.5"
            style={{ backgroundColor: currentCfg.borderColor }}
          />

          <div className="flex items-start gap-3.5 mt-1">
            {/* Icon Bubble */}
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-xs"
              style={{ backgroundColor: currentCfg.iconBg }}
            >
              {currentCfg.icon}
            </div>

            {/* Content */}
            <div className="flex-1 pr-1">
              <h4 className="text-sm font-bold text-slate-900 tracking-tight leading-snug">
                {toast.title || currentCfg.defaultTitle}
              </h4>
              {toast.message && (
                <p className="text-xs text-slate-600 mt-1 leading-relaxed font-medium">
                  {toast.message}
                </p>
              )}
            </div>

            {/* Close Button */}
            <button
              onClick={hideToast}
              className="text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg p-1 transition"
              title="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </Snackbar>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
