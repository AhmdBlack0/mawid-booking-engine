import React, { useState, useEffect } from 'react';
import { Clock, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';

export default function HoldBadge({ status, expiresAt, onExpired }) {
  const [timeLeft, setTimeLeft] = useState(null);

  useEffect(() => {
    if (status !== 'PENDING' || !expiresAt) {
      setTimeLeft(null);
      return;
    }

    const calculateTime = () => {
      const diff = new Date(expiresAt).getTime() - Date.now();
      if (diff <= 0) {
        setTimeLeft('00:00');
        if (onExpired) onExpired();
      } else {
        const mins = Math.floor(diff / 60000);
        const secs = Math.floor((diff % 60000) / 1000);
        setTimeLeft(
          `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
        );
      }
    };

    calculateTime();
    const interval = setInterval(calculateTime, 1000);
    return () => clearInterval(interval);
  }, [status, expiresAt, onExpired]);

  if (status === 'CONFIRMED') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
        <CheckCircle2 className="w-3.5 h-3.5" /> Confirmed
      </span>
    );
  }

  if (status === 'CANCELLED') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200">
        <XCircle className="w-3.5 h-3.5" /> Cancelled
      </span>
    );
  }

  if (status === 'EXPIRED' || timeLeft === '00:00') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
        <AlertTriangle className="w-3.5 h-3.5" /> Expired
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-300 animate-pulse">
      <Clock className="w-3.5 h-3.5" /> Hold Expires in: {timeLeft || '...'}
    </span>
  );
}
