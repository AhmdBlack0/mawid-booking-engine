import React, { useState, useEffect } from 'react';
import { Tabs, Tab, Paper, Chip } from '@mui/material';
import Navbar from './components/Navbar';
import DoctorSlots from './components/DoctorSlots';
import ConcurrencySimulator from './components/ConcurrencySimulator';
import MyBookings from './components/MyBookings';
import { apiRequest } from './api';
import { Calendar, Zap, Bookmark, ShieldCheck, Database, Layers } from 'lucide-react';

export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [token, setToken] = useState(null);
  const [doctors, setDoctors] = useState([]);
  const [currentDoctorId, setCurrentDoctorId] = useState('');
  const [activeTab, setActiveTab] = useState('book'); // 'book' | 'simulate' | 'bookings'
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Auto-login or register demo patient on initial load
  useEffect(() => {
    const initDemoUser = async () => {
      try {
        let res;
        try {
          res = await apiRequest('/auth/login', {
            method: 'POST',
            body: { email: 'patient@clinic.com', password: 'patient123' },
          });
        } catch {
          await apiRequest('/auth/register', {
            method: 'POST',
            body: {
              email: 'patient@clinic.com',
              password: 'patient123',
              name: 'Jane Patient',
              role: 'PATIENT',
            },
          });
          res = await apiRequest('/auth/login', {
            method: 'POST',
            body: { email: 'patient@clinic.com', password: 'patient123' },
          });
        }
        setToken(res.data.token);
        setCurrentUser(res.data.user);
      } catch (err) {
        console.error('Initial patient login failed', err);
      }
    };

    initDemoUser();
  }, []);

  // Fetch doctors list
  const fetchDoctors = async () => {
    try {
      const res = await apiRequest('/doctors');
      const docs = res.data.doctors || [];
      setDoctors(docs);
      if (docs.length > 0 && !currentDoctorId) {
        setCurrentDoctorId(docs[0].id);
      }
    } catch (err) {
      console.error('Fetch doctors error:', err);
    }
  };

  useEffect(() => {
    fetchDoctors();
  }, [refreshTrigger]);

  const handleBookingCreated = () => {
    setRefreshTrigger((prev) => prev + 1);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
      {/* Top Navbar */}
      <Navbar
        currentUser={currentUser}
        onUserChange={({ token, user }) => {
          setToken(token);
          setCurrentUser(user);
        }}
        onDataSeeded={() => {
          setRefreshTrigger((prev) => prev + 1);
        }}
      />

      {/* Hero / Portfolio Banner */}
      <div className="bg-gradient-to-b from-indigo-900 to-indigo-800 text-white py-8 px-4 sm:px-6 lg:px-8 border-b border-indigo-700">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-500/30 text-indigo-200 border border-indigo-400/30 mb-2">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> Production-Grade Architecture
              </span>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
                Clinic Appointment Booking Engine
              </h1>
              <p className="mt-1 text-sm text-indigo-200 max-w-2xl">
                Demonstrating concurrency control under high traffic: 10-minute temporary holds, zero double-booking database guarantees, and atomic slot rescheduling.
              </p>
            </div>

            {/* Quick architectural pills */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
              <div className="bg-indigo-950/40 border border-indigo-700/50 rounded-lg p-2.5">
                <span className="text-slate-400 block text-[10px] uppercase font-bold tracking-wider">Safety Net</span>
                <span className="font-semibold text-emerald-300">Partial Unique Index</span>
              </div>
              <div className="bg-indigo-950/40 border border-indigo-700/50 rounded-lg p-2.5">
                <span className="text-slate-400 block text-[10px] uppercase font-bold tracking-wider">Hold TTL</span>
                <span className="font-semibold text-amber-300">10-Min Lazy Expiry</span>
              </div>
              <div className="bg-indigo-950/40 border border-indigo-700/50 rounded-lg p-2.5 col-span-2 sm:col-span-1">
                <span className="text-slate-400 block text-[10px] uppercase font-bold tracking-wider">Atomic Swaps</span>
                <span className="font-semibold text-indigo-300">Lexicographical Locks</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-1 w-full">
        {/* Navigation Tabs (MUI Tabs + Tailwind) */}
        <div className="mb-6">
          <Paper
            elevation={0}
            sx={{
              bgcolor: 'white',
              border: '1px solid #e2e8f0',
              borderRadius: '16px',
              p: 0.6,
              display: 'inline-flex',
              maxWidth: '100%',
              boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
            }}
          >
            <Tabs
              value={activeTab}
              onChange={(e, newVal) => setActiveTab(newVal)}
              variant="scrollable"
              scrollButtons="auto"
              sx={{
                minHeight: 42,
                '& .MuiTab-root': {
                  minHeight: 42,
                  textTransform: 'none',
                  fontWeight: 600,
                  fontSize: '13px',
                  borderRadius: '10px',
                  px: 2.2,
                  py: 1,
                  color: '#64748b',
                  transition: 'all 0.15s ease',
                  '&.Mui-selected': {
                    bgcolor: '#4f46e5',
                    color: '#ffffff',
                    boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.1)',
                  },
                },
                '& .MuiTabs-indicator': {
                  display: 'none',
                },
              }}
            >
              <Tab
                value="book"
                icon={<Calendar className="w-4 h-4" />}
                iconPosition="start"
                label="1. Book Appointment"
              />
              <Tab
                value="simulate"
                icon={<Zap className="w-4 h-4" />}
                iconPosition="start"
                label="2. Concurrency Battle (50 Patients)"
              />
              <Tab
                value="bookings"
                icon={<Bookmark className="w-4 h-4" />}
                iconPosition="start"
                label="3. My Bookings & Holds"
              />
            </Tabs>
          </Paper>
        </div>

        {/* Tab Content */}
        {activeTab === 'book' && (
          <DoctorSlots
            doctors={doctors}
            currentDoctorId={currentDoctorId}
            onSelectDoctor={setCurrentDoctorId}
            token={token}
            onBookingCreated={handleBookingCreated}
          />
        )}

        {activeTab === 'simulate' && (
          <ConcurrencySimulator
            doctors={doctors}
            currentDoctorId={currentDoctorId}
            onSelectDoctor={setCurrentDoctorId}
            onBookingChanged={handleBookingCreated}
          />
        )}

        {activeTab === 'bookings' && (
          <MyBookings
            token={token}
            doctors={doctors}
            currentDoctorId={currentDoctorId}
            onBookingUpdated={handleBookingCreated}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-6 text-center text-xs text-slate-500">
        <p>
          Mawid Clinic Booking System &bull; Portfolio Project Built with Node.js 20, Express, PostgreSQL 16, Prisma & React.
        </p>
      </footer>
    </div>
  );
}
