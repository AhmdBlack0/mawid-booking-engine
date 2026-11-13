import React, { useState, useEffect } from 'react';
import {
  FormControl,
  Select,
  MenuItem,
  InputLabel,
  Button,
  Chip,
  Alert,
  AlertTitle,
  Tooltip,
  Paper,
  CircularProgress,
  Box,
} from '@mui/material';
import {
  Play,
  Zap,
  ShieldAlert,
  CheckCircle2,
  Clock,
  Users,
  RefreshCw,
  AlertCircle,
  Info,
  ShieldCheck,
} from 'lucide-react';
import { apiRequest } from '../api';
import { useToast } from '../context/ToastContext';

export default function ConcurrencySimulator({
  doctors = [],
  currentDoctorId,
  onSelectDoctor,
  onBookingChanged,
}) {
  const [selectedSlotId, setSelectedSlotId] = useState('');
  const [availableSlots, setAvailableSlots] = useState([]);
  const [strategy, setStrategy] = useState('constraint');
  const [isRunning, setIsRunning] = useState(false);
  const [simResults, setSimResults] = useState(null);
  const [filterStatus, setFilterStatus] = useState('ALL'); // 'ALL' | '201' | '409' | 'OTHER'
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [warmupStatus, setWarmupStatus] = useState('');
  const { showToast } = useToast();

  // Cached simulation tokens to prevent registering 50 users on every run
  const [simTokensCache, setSimTokensCache] = useState([]);

  const getOrPrewarmTokens = async (count) => {
    if (simTokensCache.length === count) {
      return simTokensCache;
    }

    const tokens = [];
    // Pre-acquire in safe chunks of 10 to avoid connection pool saturation
    for (let chunk = 0; chunk < count; chunk += 10) {
      setWarmupStatus(`Preparing test patients (${tokens.length}/${count})...`);
      const chunkPromises = Array.from({ length: Math.min(10, count - chunk) }, async (_, idx) => {
        const i = chunk + idx + 1;
        const email = `bench_patient_${i}@clinic.com`;
        const password = 'password123';
        try {
          const loginRes = await apiRequest('/auth/login', {
            method: 'POST',
            body: { email, password },
          });
          return { id: i, email, token: loginRes.data.token };
        } catch {
          try {
            const regRes = await apiRequest('/auth/register', {
              method: 'POST',
              body: { email, password, name: `Bench Patient ${i}`, role: 'PATIENT' },
            });
            return { id: i, email, token: regRes.data.token };
          } catch {
            const retryLogin = await apiRequest('/auth/login', {
              method: 'POST',
              body: { email, password },
            });
            return { id: i, email, token: retryLogin.data.token };
          }
        }
      });

      const chunkResults = await Promise.all(chunkPromises);
      tokens.push(...chunkResults);
    }

    setSimTokensCache(tokens);
    setWarmupStatus('');
    return tokens;
  };

  const fetchDoctorSlots = async (docId) => {
    if (!docId) return;
    setLoadingSlots(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      const res = await apiRequest(`/doctors/${docId}/slots?date=${today}&all=true`);
      const slots = res.data.slots || [];
      setAvailableSlots(slots);
      
      // Preserve currently selected slot if it exists; only default if empty or invalid
      if (!selectedSlotId || !slots.some((s) => s.id === selectedSlotId)) {
        const firstFree = slots.find((s) => !s.isBooked);
        setSelectedSlotId(firstFree ? firstFree.id : (slots[0]?.id || ''));
      }
    } catch {
      setAvailableSlots([]);
      setSelectedSlotId('');
    } finally {
      setLoadingSlots(false);
    }
  };

  useEffect(() => {
    if (currentDoctorId) {
      fetchDoctorSlots(currentDoctorId);
    }
  }, [currentDoctorId]);

  const runSimulation = async () => {
    if (!selectedSlotId) return;

    setIsRunning(true);
    setSimResults(null);
    setFilterStatus('ALL');

    const count = 50;

    // 1. Acquire / verify test patient tokens
    let tokens = [];
    try {
      tokens = await getOrPrewarmTokens(count);
    } catch (e) {
      setIsRunning(false);
      setWarmupStatus('');
      showToast({
        severity: 'error',
        title: 'Token Prewarm Failed',
        message: 'Failed to initialize test patient tokens: ' + e.message,
      });
      return;
    }

    // 2. Fire 50 simultaneous booking requests with randomized dispatch order & micro-jitter
    const t0 = performance.now();
    const randomizedTokens = [...tokens].sort(() => Math.random() - 0.5);

    const reqPromises = randomizedTokens.map(async (simUser) => {
      // Random micro-jitter (0-5ms) simulates realistic network packet variance
      const jitterMs = Math.floor(Math.random() * 6);
      if (jitterMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, jitterMs));
      }

      const startTime = performance.now();
      try {
        const bookRes = await fetch(
          `http://localhost:3000/bookings?strategy=${strategy}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${simUser.token}`,
            },
            body: JSON.stringify({ slotId: selectedSlotId }),
          }
        );

        const latency = Math.round(performance.now() - startTime);
        const data = await bookRes.json().catch(() => ({}));

        return {
          id: simUser.id,
          email: simUser.email,
          status: bookRes.status,
          latency,
          message: data.message || (bookRes.status === 201 ? 'Slot Reserved Successfully' : 'Conflict: Slot already taken'),
        };
      } catch (err) {
        return {
          id: simUser.id,
          email: simUser.email,
          status: err.status || 500,
          latency: 0,
          message: err.message || 'Network error',
        };
      }
    });

    const outcomes = await Promise.allSettled(reqPromises);
    const totalTime = Math.round(performance.now() - t0);

    const rawResults = outcomes.map((o) => (o.status === 'fulfilled' ? o.value : { status: 500, message: 'Unhandled error' }));
    // Sort results by ID so the 1-50 grid is clean and easy to follow
    const results = [...rawResults].sort((a, b) => a.id - b.id);

    const s201 = results.filter((r) => r.status === 201).length;
    const s409 = results.filter((r) => r.status === 409).length;
    const sOther = results.length - s201 - s409;
    const winner = results.find((r) => r.status === 201);

    setSimResults({
      total: count,
      s201,
      s409,
      sOther,
      totalTime,
      winnerId: winner?.id,
      details: results,
      targetSlotId: selectedSlotId,
    });

    if (s201 === 1 && s409 === 49) {
      showToast({
        severity: 'success',
        title: 'Zero Double-Booking Verified!',
        message: `Patient #${winner?.id} won the slot in ${totalTime}ms. 49 parallel attempts were safely rejected by the database constraint.`,
      });
    } else if (s201 === 0 && s409 === 50) {
      showToast({
        severity: 'warning',
        title: 'Slot Already Reserved',
        message: 'All 50 simultaneous requests were safely rejected with 409 Conflict.',
      });
    } else if (s201 > 1) {
      showToast({
        severity: 'error',
        title: 'Race Condition Detected!',
        message: `Naive Strategy Bug: ${s201} patients were double-booked into the same slot!`,
      });
    }

    setIsRunning(false);

    // Auto-refresh available slots so user immediately sees that the slot was claimed!
    await fetchDoctorSlots(currentDoctorId);
    if (onBookingChanged) onBookingChanged();
  };

  const currentSlot = availableSlots.find((s) => s.id === selectedSlotId);
  const isTargetBooked = !!currentSlot?.isBooked;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-100">
        <div>
          <Chip
            icon={<Zap className="w-3.5 h-3.5 text-indigo-600" />}
            label="High-Concurrency Battle Arena"
            size="small"
            sx={{
              fontWeight: 700,
              fontSize: '11px',
              bgcolor: '#eef2ff',
              color: '#4338ca',
              borderColor: '#c7d2fe',
              mb: 1,
            }}
          />
          <h2 className="text-xl font-bold text-slate-900">
            Simulate 50 Concurrent Booking Requests
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Fires 50 simultaneous HTTP requests at the exact same slot to verify race condition defense.
          </p>
        </div>

        {/* Strategy Selector */}
        <div className="w-full sm:w-80">
          <label className="text-xs font-bold text-slate-600 block mb-1">Concurrency Strategy</label>
          <FormControl fullWidth size="small">
            <Select
              value={strategy}
              onChange={(e) => setStrategy(e.target.value)}
              disabled={isRunning}
              sx={{
                bgcolor: '#f8fafc',
                borderRadius: '10px',
                fontSize: '12px',
                fontWeight: 600,
              }}
            >
              <MenuItem value="constraint" sx={{ fontSize: '12px', fontWeight: 600 }}>
                🛡️ Strategy B: PostgreSQL Partial Unique Index
              </MenuItem>
              <MenuItem value="pessimistic" sx={{ fontSize: '12px' }}>
                🔒 Strategy C: Pessimistic Lock (SELECT FOR UPDATE)
              </MenuItem>
              <MenuItem value="optimistic" sx={{ fontSize: '12px' }}>
                ⚡ Strategy D: Optimistic Lock (Version CAS)
              </MenuItem>
              <MenuItem value="naive" sx={{ fontSize: '12px', color: '#be123c' }}>
                ⚠️ Version A: Naive Check-Then-Insert (Demonstrate Bug)
              </MenuItem>
            </Select>
          </FormControl>
        </div>
      </div>

      {/* Doctor & Slot Selection Bar */}
      <div className="py-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-end">
        {/* Doctor Selector */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Target Doctor
          </label>
          <FormControl fullWidth size="small">
            <Select
              value={currentDoctorId || ''}
              onChange={(e) => onSelectDoctor(e.target.value)}
              disabled={isRunning}
              sx={{ bgcolor: '#f8fafc', borderRadius: '10px', fontSize: '13px', fontWeight: 600 }}
            >
              {doctors.map((doc) => (
                <MenuItem key={doc.id} value={doc.id} sx={{ fontSize: '13px' }}>
                  {doc.name} ({doc.specialty})
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </div>

        {/* Slot Selector */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs font-semibold text-slate-700">
              Target Slot for 50-Request Attack
            </label>
            <Button
              onClick={() => fetchDoctorSlots(currentDoctorId)}
              disabled={loadingSlots || isRunning}
              size="small"
              startIcon={<RefreshCw className={`w-3 h-3 ${loadingSlots ? 'animate-spin' : ''}`} />}
              sx={{ fontSize: '11px', textTransform: 'none', py: 0, minWidth: 0 }}
            >
              Refresh ({availableSlots.filter((s) => !s.isBooked).length} free)
            </Button>
          </div>

          {availableSlots.length === 0 ? (
            <div className="p-2.5 bg-amber-50 text-amber-800 rounded-lg text-xs border border-amber-200 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>No slots found for today. Use <strong>"Seed Demo Slots"</strong> at the top!</span>
            </div>
          ) : (
            <FormControl fullWidth size="small">
              <Select
                value={selectedSlotId}
                onChange={(e) => setSelectedSlotId(e.target.value)}
                disabled={isRunning}
                sx={{
                  bgcolor: '#f8fafc',
                  borderRadius: '10px',
                  fontSize: '13px',
                  fontWeight: 600,
                  borderColor: isTargetBooked ? '#f59e0b' : undefined,
                }}
              >
                {availableSlots.map((s) => {
                  const isBooked = !!s.isBooked;
                  const statusLabel = s.status === 'CONFIRMED'
                    ? '🔴 [محجوز مؤكد - Booked]'
                    : s.status === 'PENDING'
                    ? '🟡 [معلق مؤقتاً - Reserved 10m]'
                    : '🟢 [متاح للحجز - Available]';

                  return (
                    <MenuItem
                      key={s.id}
                      value={s.id}
                      sx={{
                        fontSize: '12px',
                        fontWeight: isBooked ? 500 : 700,
                        color: isBooked ? '#b45309' : '#0f172a',
                        bgcolor: isBooked ? '#fffbeb' : undefined,
                      }}
                    >
                      {new Date(s.startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} -{' '}
                      {new Date(s.endsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{' '}
                      &bull; {statusLabel}
                    </MenuItem>
                  );
                })}
              </Select>
            </FormControl>
          )}
        </div>

        {/* Action Button */}
        <div>
          <Button
            fullWidth
            onClick={runSimulation}
            disabled={isRunning || !selectedSlotId || availableSlots.length === 0}
            variant="contained"
            color={isTargetBooked ? 'warning' : 'primary'}
            size="medium"
            startIcon={
              isRunning ? (
                <CircularProgress size={16} color="inherit" />
              ) : isTargetBooked ? (
                <ShieldAlert className="w-4 h-4" />
              ) : (
                <Play className="w-4 h-4" />
              )
            }
            sx={{
              py: 1,
              fontWeight: 700,
              fontSize: '13px',
              borderRadius: '10px',
              boxShadow: '0 2px 4px -1px rgb(0 0 0 / 0.1)',
            }}
          >
            {isRunning
              ? warmupStatus || 'Firing 50 Concurrent Patients...'
              : isTargetBooked
              ? 'Test Protection on Booked Slot (All 50 Protected)'
              : 'Launch 50 Parallel Requests (1 Winner)'}
          </Button>
        </div>
      </div>

      {/* Real-Time Educational Validation Banners (MUI Alert) */}
      {simResults && (
        <div className="mt-2 mb-6">
          {/* Case 1: Exactly 1 Success and 49 Conflicts (Normal Expected Behavior) */}
          {simResults.s201 === 1 && simResults.s409 === 49 && (
            <Alert
              severity="success"
              icon={<ShieldCheck className="w-5 h-5 text-emerald-600" />}
              sx={{ borderRadius: '14px', border: '1px solid #a7f3d0' }}
            >
              <AlertTitle sx={{ fontWeight: 700, fontSize: '14px' }}>
                ✅ Concurrency Protection Verified: Zero Double-Booking!
              </AlertTitle>
              Exactly <strong>1 patient (Patient #{simResults.winnerId})</strong> won the reservation with status <code>201 Created</code>.
              The other <strong>49 simultaneous requests</strong> were intercepted and rejected by the PostgreSQL Partial Unique Index with status <code>409 Conflict</code>.
              The slot is now safely locked to the winner!
            </Alert>
          )}

          {/* Case 2: All 50 Returned 409 (Slot was already booked before simulation) */}
          {simResults.s201 === 0 && simResults.s409 === 50 && (
            <Alert
              severity="warning"
              icon={<Info className="w-5 h-5 text-amber-600" />}
              sx={{ borderRadius: '14px', border: '1px solid #fde68a' }}
            >
              <AlertTitle sx={{ fontWeight: 700, fontSize: '14px' }}>
                🔒 Slot Was Already Booked (409 Conflict for All 50)
              </AlertTitle>
              All 50 requests were safely rejected with <code>409 Conflict</code> because this slot already has an active booking.
              The database successfully protected the existing reservation from being overwritten!
            </Alert>
          )}

          {/* Case 3: More than 1 Success (Version A Race Condition Bug) */}
          {simResults.s201 > 1 && (
            <Alert
              severity="error"
              icon={<AlertCircle className="w-5 h-5 text-rose-600" />}
              sx={{ borderRadius: '14px', border: '1px solid #fecdd3' }}
            >
              <AlertTitle sx={{ fontWeight: 700, fontSize: '14px' }}>
                🚨 Race Condition Detected: {simResults.s201} Patients Double-Booked!
              </AlertTitle>
              The naive check-then-insert strategy failed to prevent concurrent access. Multiple patients successfully reserved the exact same appointment slot!
            </Alert>
          )}
        </div>
      )}

      {/* Results Display Grid */}
      {simResults && (
        <div className="pt-2 border-t border-slate-100">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <Paper variant="outlined" sx={{ p: 2, borderRadius: '12px', bgcolor: '#f8fafc' }}>
              <span className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" /> Total Parallel Requests
              </span>
              <p className="text-2xl font-bold text-slate-900 mt-1">{simResults.total}</p>
            </Paper>

            <Paper
              variant="outlined"
              sx={{
                p: 2,
                borderRadius: '12px',
                bgcolor: simResults.s201 === 1 ? '#ecfdf5' : '#fff1f2',
                borderColor: simResults.s201 === 1 ? '#a7f3d0' : '#fecdd3',
              }}
            >
              <span className={`text-xs font-bold flex items-center gap-1.5 ${simResults.s201 === 1 ? 'text-emerald-700' : 'text-rose-700'}`}>
                <CheckCircle2 className="w-3.5 h-3.5" /> 201 Created (Winner)
              </span>
              <p className={`text-2xl font-bold mt-1 ${simResults.s201 === 1 ? 'text-emerald-700' : 'text-rose-700'}`}>
                {simResults.s201}
                {simResults.s201 > 1 && (
                  <span className="text-xs ml-2 font-normal text-rose-600">(DOUBLE BOOKING!)</span>
                )}
              </p>
            </Paper>

            <Paper variant="outlined" sx={{ p: 2, borderRadius: '12px', bgcolor: '#fffbeb', borderColor: '#fde68a' }}>
              <span className="text-xs font-bold text-amber-700 flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5" /> 409 Intercepted (Protected)
              </span>
              <p className="text-2xl font-bold text-amber-800 mt-1">{simResults.s409}</p>
            </Paper>

            <Paper variant="outlined" sx={{ p: 2, borderRadius: '12px', bgcolor: '#f8fafc' }}>
              <span className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" /> Total Roundtrip Time
              </span>
              <p className="text-2xl font-bold text-slate-900 mt-1">{simResults.totalTime} ms</p>
            </Paper>
          </div>

          {/* Filter Chips */}
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h4 className="text-xs font-bold text-slate-600 uppercase tracking-wider">
              Outcome Breakdown for All 50 Patients
            </h4>
            <div className="flex items-center gap-1.5">
              <Chip
                label={`All (${simResults.total})`}
                size="small"
                clickable
                color={filterStatus === 'ALL' ? 'primary' : 'default'}
                onClick={() => setFilterStatus('ALL')}
                sx={{ fontWeight: 600, fontSize: '11px' }}
              />
              <Chip
                label={`201 Winner (${simResults.s201})`}
                size="small"
                clickable
                color={filterStatus === '201' ? 'success' : 'default'}
                onClick={() => setFilterStatus('201')}
                sx={{ fontWeight: 600, fontSize: '11px' }}
              />
              <Chip
                label={`409 Protected (${simResults.s409})`}
                size="small"
                clickable
                color={filterStatus === '409' ? 'warning' : 'default'}
                onClick={() => setFilterStatus('409')}
                sx={{ fontWeight: 600, fontSize: '11px' }}
              />
            </div>
          </div>

          {/* Visual Cards Grid with MUI Tooltip */}
          <div className="grid grid-cols-2 sm:grid-cols-5 md:grid-cols-10 gap-2 max-h-64 overflow-y-auto p-2.5 bg-slate-50 rounded-xl border border-slate-200">
            {simResults.details
              .filter((p) => {
                if (filterStatus === '201') return p.status === 201;
                if (filterStatus === '409') return p.status === 409;
                return true;
              })
              .map((p) => (
                <Tooltip
                  key={p.id}
                  title={`Patient #${p.id} (${p.email}): ${p.message} — ${p.latency}ms latency`}
                  arrow
                  placement="top"
                >
                  <div
                    className={`p-2 rounded-xl text-center border text-xs font-medium transition-all cursor-pointer ${
                      p.status === 201
                        ? 'bg-emerald-500 text-white border-emerald-600 shadow-md ring-2 ring-emerald-300 transform scale-105'
                        : 'bg-white text-slate-700 border-slate-200 hover:border-amber-400 hover:shadow-xs'
                    }`}
                  >
                    <div className="font-bold flex items-center justify-center gap-1">
                      #{p.id}
                      {p.status === 201 && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
                    </div>
                    <div className={`text-[10px] mt-0.5 font-mono ${p.status === 201 ? 'text-emerald-100 font-bold' : 'text-amber-700'}`}>
                      HTTP {p.status}
                    </div>
                    <div className="text-[9px] opacity-75">{p.latency}ms</div>
                  </div>
                </Tooltip>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
