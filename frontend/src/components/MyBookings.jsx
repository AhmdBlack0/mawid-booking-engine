import React, { useState, useEffect } from 'react';
import {
  Card,
  CardContent,
  Chip,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  FormControl,
  Select,
  MenuItem,
  Alert,
  CircularProgress,
  Box,
} from '@mui/material';
import {
  Bookmark,
  RefreshCw,
  CheckCircle,
  XCircle,
  Calendar,
  ArrowRightLeft,
  AlertCircle,
  Clock,
} from 'lucide-react';
import { apiRequest } from '../api';
import HoldBadge from './HoldBadge';
import { useToast } from '../context/ToastContext';

export default function MyBookings({ token, onBookingUpdated, doctors, currentDoctorId }) {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(null);
  const [message, setMessage] = useState(null);
  const { showToast } = useToast();

  // Reschedule modal state
  const [rescheduleBookingId, setRescheduleBookingId] = useState(null);
  const [availableSlots, setAvailableSlots] = useState([]);
  const [targetSlotId, setTargetSlotId] = useState('');
  const [rescheduleLoading, setRescheduleLoading] = useState(false);

  // Cancel Confirmation modal state
  const [cancelTargetId, setCancelTargetId] = useState(null);

  const fetchBookings = async () => {
    if (!token) {
      setBookings([]);
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const res = await apiRequest('/bookings/me', { token });
      setBookings(res.data.bookings || []);
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBookings();
  }, [token]);

  const handleConfirm = async (bookingId) => {
    setActionLoading(bookingId);
    setMessage(null);
    try {
      await apiRequest(`/bookings/${bookingId}/confirm`, {
        method: 'POST',
        token,
      });
      showToast({
        severity: 'success',
        title: 'Booking Confirmed!',
        message: 'Your clinic appointment has been permanently confirmed.',
      });
      await fetchBookings();
      if (onBookingUpdated) onBookingUpdated();
    } catch (err) {
      showToast({
        severity: 'error',
        title: 'Confirmation Failed',
        message: err.message,
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancel = async () => {
    if (!cancelTargetId) return;
    const bookingId = cancelTargetId;
    setCancelTargetId(null);
    setActionLoading(bookingId);
    setMessage(null);
    try {
      await apiRequest(`/bookings/${bookingId}/cancel`, {
        method: 'POST',
        token,
      });
      showToast({
        severity: 'warning',
        title: 'Booking Cancelled',
        message: 'Appointment was cancelled. The slot has been freed for other patients.',
      });
      await fetchBookings();
      if (onBookingUpdated) onBookingUpdated();
    } catch (err) {
      showToast({
        severity: 'error',
        title: 'Cancellation Failed',
        message: err.message,
      });
    } finally {
      setActionLoading(null);
    }
  };

  const openRescheduleModal = async (booking) => {
    setRescheduleBookingId(booking.id);
    setTargetSlotId('');
    setRescheduleLoading(true);
    try {
      const docId = booking.slot?.doctorId || currentDoctorId;
      const today = new Date().toISOString().split('T')[0];
      const res = await apiRequest(`/doctors/${docId}/slots?date=${today}&all=true`);
      const slots = (res.data.slots || []).filter((s) => s.id !== booking.slotId);
      setAvailableSlots(slots);
      setTargetSlotId('');
    } catch (err) {
      showToast({
        severity: 'error',
        title: 'Could Not Load Slots',
        message: 'Could not load replacement slots: ' + err.message,
      });
    } finally {
      setRescheduleLoading(false);
    }
  };

  const handleExecuteReschedule = async () => {
    if (!targetSlotId || !rescheduleBookingId) return;
    setRescheduleLoading(true);
    try {
      await apiRequest(`/bookings/${rescheduleBookingId}/reschedule`, {
        method: 'POST',
        token,
        body: { newSlotId: targetSlotId },
      });
      showToast({
        severity: 'success',
        title: 'Atomic Swap Successful!',
        message: 'Old slot cancelled and new slot confirmed in a single safe transaction.',
      });
      setRescheduleBookingId(null);
      await fetchBookings();
      if (onBookingUpdated) onBookingUpdated();
    } catch (err) {
      showToast({
        severity: 'error',
        title: 'Reschedule Conflict',
        message: err.message,
      });
    } finally {
      setRescheduleLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-12 text-center text-slate-500">
        <Bookmark className="w-12 h-12 text-slate-300 mx-auto mb-3" />
        <h3 className="text-lg font-bold text-slate-800 mb-1">Please Sign In</h3>
        <p className="text-sm text-slate-500">Select a demo patient from the top bar to view your live bookings.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-100">
        <div>
          <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Bookmark className="w-5 h-5 text-indigo-600" />
            My Bookings & Reservations
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Real-time status of your reserved appointment holds and confirmed clinic visits.
          </p>
        </div>
        <Button
          onClick={fetchBookings}
          disabled={loading}
          size="small"
          variant="outlined"
          color="inherit"
          startIcon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />}
          sx={{
            fontSize: '12px',
            textTransform: 'none',
            fontWeight: 600,
            borderRadius: '8px',
            borderColor: '#cbd5e1',
          }}
        >
          Refresh
        </Button>
      </div>

      {message && (
        <Alert
          severity={message.type === 'success' ? 'success' : 'error'}
          onClose={() => setMessage(null)}
          sx={{ mb: 4, borderRadius: '12px', fontSize: '13px' }}
        >
          {message.text}
        </Alert>
      )}

      {loading && bookings.length === 0 ? (
        <div className="py-16 text-center text-slate-400 text-sm">
          <CircularProgress size={32} sx={{ color: '#4f46e5', mb: 2 }} />
          <p className="font-medium text-slate-600">Loading your reservations...</p>
        </div>
      ) : bookings.length === 0 ? (
        <div className="py-12 text-center border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
          <Calendar className="w-10 h-10 mx-auto mb-2 text-slate-300" />
          <p className="text-sm font-semibold text-slate-700">No bookings found</p>
          <p className="text-xs text-slate-400 mt-1">Book an appointment from the "Book Appointment" tab to see it here.</p>
        </div>
      ) : (
        <div className="space-y-3.5">
          {bookings.map((booking) => {
            const isHold = booking.status === 'PENDING';
            const isConfirmed = booking.status === 'CONFIRMED';
            const isFinished = booking.status === 'CANCELLED' || booking.status === 'EXPIRED';

            const startStr = booking.slot ? new Date(booking.slot.startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
            const endStr = booking.slot ? new Date(booking.slot.endsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
            const dateStr = booking.slot ? new Date(booking.slot.startsAt).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : '';

            return (
              <Card
                key={booking.id}
                variant="outlined"
                sx={{
                  borderRadius: '14px',
                  borderColor: isHold ? '#fde68a' : isConfirmed ? '#a7f3d0' : '#e2e8f0',
                  bgcolor: isHold ? '#fffdf5' : isConfirmed ? '#f8fdfa' : '#f8fafc',
                  transition: 'all 0.15s ease',
                  '&:hover': {
                    boxShadow: '0 2px 4px -1px rgb(0 0 0 / 0.06)',
                  },
                }}
              >
                <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <HoldBadge
                          status={booking.status}
                          expiresAt={booking.expiresAt}
                          onExpired={fetchBookings}
                        />
                        <span className="text-xs text-slate-400 font-mono">
                          ID: {booking.id.slice(0, 8)}...
                        </span>
                      </div>

                      <div className="text-sm font-bold text-slate-900 flex items-center gap-2">
                        <Clock className="w-4 h-4 text-slate-500" />
                        <span>{dateStr} &bull; {startStr} - {endStr}</span>
                      </div>

                      <div className="text-xs text-slate-600 mt-1.5 flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-slate-800 flex items-center gap-1">
                          👨‍⚕️ {booking.slot?.doctor?.name || `Doctor ID: ${booking.slot?.doctorId?.slice(0, 8)}...`}
                        </span>
                        {booking.slot?.doctor?.specialty && (
                          <span className="text-slate-400 font-normal">
                            ({booking.slot.doctor.specialty})
                          </span>
                        )}
                        {booking.slot?.version !== undefined && (
                          <span className="text-slate-400 font-mono text-[11px] bg-slate-100 px-1.5 py-0.5 rounded ml-1">
                            v{booking.slot.version}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {isHold && (
                        <Button
                          onClick={() => handleConfirm(booking.id)}
                          disabled={actionLoading === booking.id}
                          variant="contained"
                          color="success"
                          size="small"
                          startIcon={<CheckCircle className="w-3.5 h-3.5" />}
                          sx={{ fontSize: '12px', fontWeight: 700, borderRadius: '8px' }}
                        >
                          Confirm Hold
                        </Button>
                      )}

                      {!isFinished && (
                        <Button
                          onClick={() => openRescheduleModal(booking)}
                          disabled={actionLoading === booking.id}
                          variant="outlined"
                          color="primary"
                          size="small"
                          startIcon={<ArrowRightLeft className="w-3.5 h-3.5" />}
                          sx={{ fontSize: '12px', fontWeight: 600, borderRadius: '8px' }}
                        >
                          Reschedule
                        </Button>
                      )}

                      {!isFinished && (
                        <Button
                          onClick={() => setCancelTargetId(booking.id)}
                          disabled={actionLoading === booking.id}
                          variant="outlined"
                          color="error"
                          size="small"
                          startIcon={<XCircle className="w-3.5 h-3.5" />}
                          sx={{ fontSize: '12px', fontWeight: 600, borderRadius: '8px' }}
                        >
                          Cancel
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Reschedule Modal (MUI Dialog) */}
      <Dialog
        open={!!rescheduleBookingId}
        onClose={() => setRescheduleBookingId(null)}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: { borderRadius: '18px', p: 1 },
        }}
      >
        <DialogTitle sx={{ fontWeight: 800, fontSize: '18px', pb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
          <ArrowRightLeft className="w-5 h-5 text-indigo-600" />
          Atomic Reschedule Appointment
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ fontSize: '13px', color: '#64748b', mb: 3 }}>
            Pessimistic swap with ordered locking: atomically cancels the current reservation and locks the new slot in a single safe transaction.
          </DialogContentText>

          {rescheduleLoading ? (
            <div className="py-8 text-center text-slate-400 text-sm">
              <CircularProgress size={28} sx={{ color: '#4f46e5', mb: 1.5 }} />
              <p>Loading available replacement slots...</p>
            </div>
          ) : availableSlots.length === 0 ? (
            <Alert severity="warning" sx={{ borderRadius: '12px', fontSize: '13px' }}>
              No alternative available slots found for today. Try selecting a different doctor or date.
            </Alert>
          ) : (
            <FormControl fullWidth size="small">
              <Select
                value={targetSlotId}
                onChange={(e) => setTargetSlotId(e.target.value)}
                displayEmpty
                sx={{
                  bgcolor: '#f8fafc',
                  borderRadius: '10px',
                  fontSize: '13px',
                  fontWeight: 600,
                }}
              >
                <MenuItem value="" disabled sx={{ fontSize: '13px', color: '#94a3b8' }}>
                  -- اختر موعداً بديلاً من القائمة --
                </MenuItem>
                {availableSlots.map((s) => {
                  const st = new Date(s.startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                  const et = new Date(s.endsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                  const isBooked = !!s.isBooked;
                  return (
                    <MenuItem
                      key={s.id}
                      value={s.id}
                      disabled={isBooked}
                      sx={{
                        fontSize: '12px',
                        fontWeight: isBooked ? 400 : 600,
                        color: isBooked ? '#94a3b8' : '#0f172a',
                      }}
                    >
                      {st} - {et} &bull; {isBooked ? '🔴 [محجوز - Booked]' : '🟢 [متاح - Available]'}
                    </MenuItem>
                  );
                })}
              </Select>
            </FormControl>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={() => setRescheduleBookingId(null)}
            color="inherit"
            sx={{ fontWeight: 600 }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleExecuteReschedule}
            disabled={!targetSlotId || rescheduleLoading}
            variant="contained"
            color="primary"
            sx={{ fontWeight: 700 }}
          >
            Confirm Swap (Atomic)
          </Button>
        </DialogActions>
      </Dialog>

      {/* Cancel Confirmation Dialog (MUI Dialog) */}
      <Dialog
        open={!!cancelTargetId}
        onClose={() => setCancelTargetId(null)}
        maxWidth="xs"
        fullWidth
        PaperProps={{
          sx: { borderRadius: '18px', p: 1 },
        }}
      >
        <DialogTitle sx={{ fontWeight: 800, fontSize: '18px', pb: 1, color: '#be123c', display: 'flex', alignItems: 'center', gap: 1 }}>
          <XCircle className="w-5 h-5 text-rose-600" />
          Cancel Reservation?
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ fontSize: '13px', color: '#64748b' }}>
            Are you sure you want to cancel this booking? This will immediately release the slot and make it available for other clinic patients.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setCancelTargetId(null)} color="inherit" sx={{ fontWeight: 600 }}>
            Keep Booking
          </Button>
          <Button onClick={handleCancel} variant="contained" color="error" sx={{ fontWeight: 700 }}>
            Yes, Cancel Slot
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
