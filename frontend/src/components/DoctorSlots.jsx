import React, { useState, useEffect } from 'react';
import {
  Card,
  CardContent,
  CardActions,
  Chip,
  Button,
  Select,
  MenuItem,
  FormControl,
  Alert,
  Tooltip,
  CircularProgress,
  Box,
} from '@mui/material';
import { Calendar, UserCheck, Clock, BookmarkPlus, Lock, CheckCircle2 } from 'lucide-react';
import { apiRequest } from '../api';
import { useToast } from '../context/ToastContext';

export default function DoctorSlots({
  doctors,
  currentDoctorId,
  onSelectDoctor,
  token,
  onBookingCreated,
}) {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [bookingSlotId, setBookingSlotId] = useState(null);
  const [message, setMessage] = useState(null);
  const { showToast } = useToast();

  const loadSlots = async () => {
    if (!currentDoctorId) return;
    setLoading(true);
    setMessage(null);
    try {
      const res = await apiRequest(`/doctors/${currentDoctorId}/slots?date=${date}&all=true`);
      setSlots(res.data.slots || []);
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
      setSlots([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSlots();
  }, [currentDoctorId, date]);

  const handleHoldSlot = async (slotId) => {
    if (!token) {
      showToast({
        severity: 'warning',
        title: 'Authentication Required',
        message: 'Please select a Patient from the top bar before booking.',
      });
      return;
    }

    setBookingSlotId(slotId);
    setMessage(null);
    try {
      const res = await apiRequest('/bookings', {
        method: 'POST',
        token,
        body: { slotId },
      });

      showToast({
        severity: 'success',
        title: 'Slot Reserved (10-Min Temporary Hold)!',
        message: 'Your slot is held. Confirm it in "My Bookings & Holds" before the timer expires.',
      });

      await loadSlots();
      if (onBookingCreated) onBookingCreated(res.data.booking);
    } catch (err) {
      showToast({
        severity: 'error',
        title: 'Slot Conflict',
        message: err.message || 'Slot is already taken or no longer available.',
      });
      await loadSlots();
    } finally {
      setBookingSlotId(null);
    }
  };

  const selectedDoctor = doctors.find((d) => d.id === currentDoctorId);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
      {/* Header & Filter Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-100">
        <div>
          <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <UserCheck className="w-5 h-5 text-indigo-600" />
            Book a Clinic Appointment
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Select a specialist doctor and date to view live available slots.
          </p>
        </div>

        {/* Doctor and Date Pickers */}
        <div className="flex flex-wrap items-center gap-3">
          <FormControl size="small" sx={{ minWidth: 240 }}>
            <Select
              value={currentDoctorId || ''}
              onChange={(e) => onSelectDoctor(e.target.value)}
              displayEmpty
              sx={{
                bgcolor: '#f8fafc',
                borderRadius: '10px',
                fontSize: '13px',
                fontWeight: 600,
                '& .MuiOutlinedInput-notchedOutline': {
                  borderColor: '#cbd5e1',
                },
              }}
            >
              {doctors.map((doc) => (
                <MenuItem key={doc.id} value={doc.id} sx={{ fontSize: '13px', fontWeight: 500 }}>
                  {doc.name} ({doc.specialty})
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <div className="flex items-center gap-2 bg-slate-50 border border-slate-300 rounded-lg px-3 py-1.5 h-10 shadow-xs">
            <Calendar className="w-4 h-4 text-slate-500" />
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="bg-transparent text-xs font-semibold text-slate-700 focus:outline-none"
            />
          </div>
        </div>
      </div>

      {message && (
        <Alert
          severity={message.type === 'success' ? 'success' : 'error'}
          onClose={() => setMessage(null)}
          sx={{ mt: 3, borderRadius: '12px', fontSize: '13px' }}
        >
          {message.text}
        </Alert>
      )}

      {/* Slots Section */}
      <div className="mt-6">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
            Slots on {date}
          </h4>
          <div className="flex items-center gap-2">
            <Chip
              label={`${slots.filter((s) => !s.isBooked).length} Available`}
              size="small"
              color="success"
              variant="outlined"
              sx={{ fontSize: '11px', fontWeight: 700, borderColor: '#a7f3d0' }}
            />
            <Chip
              label={`${slots.filter((s) => s.isBooked).length} Booked`}
              size="small"
              color="default"
              variant="outlined"
              sx={{ fontSize: '11px', fontWeight: 600 }}
            />
          </div>
        </div>

        {loading ? (
          <div className="py-16 text-center text-slate-400 text-sm">
            <CircularProgress size={32} sx={{ color: '#4f46e5', mb: 2 }} />
            <p className="font-medium text-slate-600">Querying live slot availability...</p>
          </div>
        ) : slots.length === 0 ? (
          <div className="py-12 text-center border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
            <Clock className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <p className="text-sm font-semibold text-slate-700">No open slots found for this date.</p>
            <p className="text-xs text-slate-400 mt-1">
              Click <strong>"Seed Demo Slots"</strong> in the top navbar to generate fresh 30-min clinic slots!
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3.5">
            {slots.map((slot) => {
              const start = new Date(slot.startsAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              });
              const end = new Date(slot.endsAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              });

              const isBooked = !!slot.isBooked;

              return (
                <Card
                  key={slot.id}
                  variant="outlined"
                  sx={{
                    borderRadius: '14px',
                    borderColor: isBooked ? '#e2e8f0' : '#cbd5e1',
                    bgcolor: isBooked ? '#f8fafc' : '#ffffff',
                    transition: 'all 0.2s ease',
                    boxShadow: isBooked ? 'none' : '0 1px 3px 0 rgb(0 0 0 / 0.05)',
                    '&:hover': {
                      borderColor: isBooked ? '#e2e8f0' : '#818cf8',
                      boxShadow: isBooked ? 'none' : '0 4px 6px -1px rgb(0 0 0 / 0.08)',
                    },
                  }}
                >
                  <CardContent sx={{ p: 2.5, pb: 1.5 }}>
                    <div className="flex items-center justify-between gap-1 mb-2">
                      <div className="flex items-center gap-1.5 text-slate-900 font-bold text-sm">
                        <Clock className={`w-4 h-4 ${isBooked ? 'text-slate-400' : 'text-indigo-600'}`} />
                        <span>{start} - {end}</span>
                      </div>

                      {isBooked ? (
                        <Chip
                          label={slot.status === 'CONFIRMED' ? 'محجوز' : 'معلق 10د'}
                          size="small"
                          color={slot.status === 'CONFIRMED' ? 'error' : 'warning'}
                          sx={{
                            fontSize: '10px',
                            fontWeight: 700,
                            height: 20,
                            bgcolor: slot.status === 'CONFIRMED' ? '#ffe4e6' : '#fef3c7',
                            color: slot.status === 'CONFIRMED' ? '#be123c' : '#b45309',
                          }}
                        />
                      ) : (
                        <Chip
                          label="متاح"
                          size="small"
                          color="success"
                          sx={{
                            fontSize: '10px',
                            fontWeight: 700,
                            height: 20,
                            bgcolor: '#d1fae5',
                            color: '#065f46',
                          }}
                        />
                      )}
                    </div>

                    <div className="text-[11px] font-mono text-slate-400">
                      ID: {slot.id.slice(0, 8)}...
                    </div>
                  </CardContent>

                  <CardActions sx={{ p: 2, pt: 0 }}>
                    <Tooltip
                      title={
                        isBooked
                          ? 'This slot is already reserved'
                          : !token
                          ? 'Select Patient from top bar to book'
                          : 'Hold this slot for 10 minutes'
                      }
                    >
                      <span className="w-full">
                        <Button
                          fullWidth
                          onClick={() => handleHoldSlot(slot.id)}
                          disabled={isBooked || bookingSlotId === slot.id || !token}
                          variant={isBooked ? 'outlined' : 'contained'}
                          color={isBooked ? 'inherit' : 'primary'}
                          size="small"
                          startIcon={
                            bookingSlotId === slot.id ? (
                              <CircularProgress size={14} color="inherit" />
                            ) : isBooked ? (
                              <Lock className="w-3.5 h-3.5" />
                            ) : (
                              <BookmarkPlus className="w-3.5 h-3.5" />
                            )
                          }
                          sx={{
                            py: 0.8,
                            fontSize: '12px',
                            fontWeight: 600,
                            borderRadius: '8px',
                            bgcolor: isBooked ? '#f1f5f9' : undefined,
                            color: isBooked ? '#94a3b8' : undefined,
                            borderColor: isBooked ? '#e2e8f0' : undefined,
                          }}
                        >
                          {isBooked
                            ? 'محجوز (غير متاح)'
                            : bookingSlotId === slot.id
                            ? 'Holding Slot...'
                            : !token
                            ? 'Sign In to Book'
                            : 'Hold Slot (10m)'}
                        </Button>
                      </span>
                    </Tooltip>
                  </CardActions>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
