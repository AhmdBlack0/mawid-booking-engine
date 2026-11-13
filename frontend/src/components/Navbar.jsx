import React, { useState } from 'react';
import { Button, Chip, Tooltip, CircularProgress, Box } from '@mui/material';
import {
  ShieldCheck,
  User,
  Database,
  Activity,
  CheckCircle2,
} from 'lucide-react';
import { apiRequest } from '../api';
import { useToast } from '../context/ToastContext';

export default function Navbar({
  currentUser,
  onUserChange,
  onDataSeeded,
}) {
  const [seeding, setSeeding] = useState(false);
  const [seedSuccess, setSeedSuccess] = useState(false);
  const { showToast } = useToast();

  // Quick Switch between predefined demo accounts
  const switchAccount = async (role) => {
    const isPatient = role === 'PATIENT';
    const email = isPatient ? 'patient@clinic.com' : 'admin@clinic.com';
    const password = isPatient ? 'patient123' : 'admin123';
    const name = isPatient ? 'Jane Patient' : 'Dr. Administrator';

    try {
      let res;
      try {
        res = await apiRequest('/auth/login', {
          method: 'POST',
          body: { email, password },
        });
      } catch (e) {
        await apiRequest('/auth/register', {
          method: 'POST',
          body: { email, password, name, role },
        });
        res = await apiRequest('/auth/login', {
          method: 'POST',
          body: { email, password },
        });
      }

      onUserChange({
        token: res.data.token,
        user: res.data.user,
      });

      showToast({
        severity: 'info',
        title: `Switched User: ${name}`,
        message: `Now acting as ${role} (${email})`,
      });
    } catch (err) {
      showToast({
        severity: 'error',
        title: 'Authentication Error',
        message: err.message,
      });
    }
  };

  // One-click Seed Demo Data (Doctor + Slots for today)
  const handleSeedData = async () => {
    setSeeding(true);
    setSeedSuccess(false);
    try {
      let adminToken;
      try {
        const loginRes = await apiRequest('/auth/login', {
          method: 'POST',
          body: { email: 'admin@clinic.com', password: 'admin123' },
        });
        adminToken = loginRes.data.token;
      } catch {
        await apiRequest('/auth/register', {
          method: 'POST',
          body: { email: 'admin@clinic.com', password: 'admin123', name: 'Dr. Administrator', role: 'ADMIN' },
        });
        const loginRes = await apiRequest('/auth/login', {
          method: 'POST',
          body: { email: 'admin@clinic.com', password: 'admin123' },
        });
        adminToken = loginRes.data.token;
      }

      const docRes = await apiRequest('/doctors');
      let doctorId;
      if (docRes.data.doctors && docRes.data.doctors.length > 0) {
        doctorId = docRes.data.doctors[0].id;
      } else {
        const newDoc = await apiRequest('/doctors', {
          method: 'POST',
          token: adminToken,
          body: {
            name: 'Dr. Sarah Connor',
            specialization: 'Cardiology',
          },
        });
        doctorId = newDoc.data.doctor.id;
      }

      const today = new Date().toISOString().split('T')[0];
      await apiRequest(`/doctors/${doctorId}/slots`, {
        method: 'POST',
        token: adminToken,
        body: {
          startDate: `${today}T09:00:00Z`,
          endDate: `${today}T15:00:00Z`,
          durationMinutes: 30,
        },
      });

      await switchAccount('PATIENT');

      setSeedSuccess(true);
      showToast({
        severity: 'success',
        title: 'Demo Slots Generated!',
        message: 'Successfully generated 30-min available slots for today.',
      });
      if (onDataSeeded) onDataSeeded();
      setTimeout(() => setSeedSuccess(false), 4000);
    } catch (err) {
      showToast({
        severity: 'error',
        title: 'Seeding Failed',
        message: err.message,
      });
    } finally {
      setSeeding(false);
    }
  };

  return (
    <header className="bg-white/90 backdrop-blur-md border-b border-slate-200 sticky top-0 z-40 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Portfolio Title */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-600 flex items-center justify-center text-white shadow-md shadow-indigo-100">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-lg text-slate-900 tracking-tight">Mawid API</span>
                <Chip
                  label="ZERO DOUBLE-BOOKING"
                  size="small"
                  color="primary"
                  variant="outlined"
                  sx={{
                    fontSize: '10px',
                    fontWeight: 700,
                    height: 20,
                    borderColor: '#c7d2fe',
                    backgroundColor: '#eef2ff',
                    color: '#4338ca',
                  }}
                />
              </div>
              <p className="text-xs text-slate-500 hidden sm:block">
                High-Concurrency Clinic Booking &bull; PostgreSQL Strict Constraints
              </p>
            </div>
          </div>

          {/* Right Controls: Quick User Switcher & Seed Button */}
          <div className="flex items-center gap-3">
            <Tooltip title="Seeds Dr. Sarah Connor with 30-min available slots for today">
              <span>
                <Button
                  onClick={handleSeedData}
                  disabled={seeding}
                  variant={seedSuccess ? 'contained' : 'outlined'}
                  color={seedSuccess ? 'success' : 'inherit'}
                  size="small"
                  startIcon={
                    seeding ? (
                      <CircularProgress size={14} color="inherit" />
                    ) : seedSuccess ? (
                      <CheckCircle2 className="w-4 h-4 text-white" />
                    ) : (
                      <Database className="w-4 h-4 text-indigo-600" />
                    )
                  }
                  sx={{
                    textTransform: 'none',
                    fontWeight: 600,
                    fontSize: '12px',
                    px: 1.5,
                    py: 0.6,
                    borderColor: '#cbd5e1',
                    bgcolor: seedSuccess ? undefined : '#f8fafc',
                  }}
                >
                  {seeding ? 'Seeding...' : seedSuccess ? 'Slots Seeded!' : 'Seed Demo Slots'}
                </Button>
              </span>
            </Tooltip>

            {/* User Profile Pill */}
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200">
              <Button
                onClick={() => switchAccount('PATIENT')}
                size="small"
                variant={currentUser?.role === 'PATIENT' ? 'contained' : 'text'}
                color={currentUser?.role === 'PATIENT' ? 'primary' : 'inherit'}
                startIcon={<User className="w-3.5 h-3.5" />}
                sx={{
                  fontSize: '12px',
                  fontWeight: 600,
                  py: 0.4,
                  px: 1.2,
                  minWidth: 0,
                  boxShadow: currentUser?.role === 'PATIENT' ? '0 1px 2px 0 rgb(0 0 0 / 0.05)' : 'none',
                }}
              >
                Patient
              </Button>

              <Button
                onClick={() => switchAccount('ADMIN')}
                size="small"
                variant={currentUser?.role === 'ADMIN' ? 'contained' : 'text'}
                color={currentUser?.role === 'ADMIN' ? 'primary' : 'inherit'}
                startIcon={<ShieldCheck className="w-3.5 h-3.5" />}
                sx={{
                  fontSize: '12px',
                  fontWeight: 600,
                  py: 0.4,
                  px: 1.2,
                  minWidth: 0,
                  boxShadow: currentUser?.role === 'ADMIN' ? '0 1px 2px 0 rgb(0 0 0 / 0.05)' : 'none',
                }}
              >
                Admin
              </Button>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
