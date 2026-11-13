const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/config/prisma');
const { cleanDatabase } = require('./helpers');

describe('Concurrency Test - Version B (The Database Partial Unique Index Fix)', () => {
  let doctorId;
  let slotId;
  let patientTokens = [];

  beforeAll(async () => {
    await cleanDatabase();

    // 1. Create a doctor
    const doctor = await prisma.doctor.create({
      data: {
        name: 'Dr. John Watson',
        specialty: 'General Medicine',
      },
    });
    doctorId = doctor.id;

    // 2. Create 1 single slot
    const slot = await prisma.slot.create({
      data: {
        doctorId,
        startsAt: new Date('2026-11-20T09:00:00Z'),
        endsAt: new Date('2026-11-20T09:30:00Z'),
      },
    });
    slotId = slot.id;

    // 3. Register 50 different patients BEFORE the timer starts
    // (Bcrypt hashing and JWT signing must not contaminate concurrency latency metrics)
    console.log('\n[Setup] Pre-registering 50 patients and acquiring JWTs before timing...');
    const patientPromises = Array.from({ length: 50 }, (_, i) =>
      request(app)
        .post('/auth/register')
        .send({
          name: `Patient ${i + 1}`,
          email: `fix_patient${i + 1}@clinic.com`,
          password: 'password123',
        })
    );

    const registered = await Promise.all(patientPromises);
    patientTokens = registered.map((res) => res.body.data.token);
    console.log('[Setup] 50 patient tokens acquired. Ready for concurrent test.');
  }, 40000);

  afterAll(async () => {
    await cleanDatabase();
    await prisma.$disconnect();
  });

  it('guarantees concurrency safety: exactly 1 request returns 201 and 49 return 409', async () => {
    console.log(
      '\n--- FIRING 50 CONCURRENT REQUESTS AGAINST VERSION B (DATABASE ENFORCED PARTIAL UNIQUE INDEX) ---'
    );

    // Track individual request latencies and outcomes
    const individualLatencies = [];
    let winnerLatency = null;

    const tStart = performance.now();

    // Fire 50 simultaneous booking requests for the EXACT SAME slot using Promise.allSettled
    const requests = patientTokens.map(async (token, idx) => {
      const reqStart = performance.now();
      const res = await request(app)
        .post('/bookings') // Uses Version B (createBooking with DB partial unique index)
        .set('Authorization', `Bearer ${token}`)
        .send({ slotId });
      const reqEnd = performance.now();
      const latencyMs = Math.round(reqEnd - reqStart);

      individualLatencies.push(latencyMs);

      if (res.status === 201) {
        winnerLatency = latencyMs;
      }

      return {
        idx: idx + 1,
        status: res.status,
        latencyMs,
        body: res.body,
      };
    });

    const outcomes = await Promise.allSettled(requests);
    const totalElapsedMs = Math.round(performance.now() - tStart);

    // Calculate metrics
    const statusCounts = { '201': 0, '409': 0, other: 0 };
    let serverErrors = 0;

    outcomes.forEach((outcome) => {
      if (outcome.status === 'fulfilled') {
        const { status } = outcome.value;
        if (status === 201) statusCounts['201']++;
        else if (status === 409) statusCounts['409']++;
        else {
          statusCounts.other++;
          if (status >= 500) serverErrors++;
        }
      } else {
        serverErrors++;
      }
    });

    // Latency Percentiles (p50, p95)
    individualLatencies.sort((a, b) => a - b);
    const p50 = individualLatencies[Math.floor(individualLatencies.length * 0.5)] || 0;
    const p95 = individualLatencies[Math.floor(individualLatencies.length * 0.95)] || 0;

    // Check actual database records created for this slot
    const activeBookingsInDb = await prisma.booking.findMany({
      where: {
        slotId,
        status: { in: ['PENDING', 'CONFIRMED'] },
      },
      include: { user: true },
    });

    console.log('\n================ Concurrency Benchmark Results ================');
    console.log(`Total Elapsed Time:   ${totalElapsedMs} ms`);
    console.log(`Winner Latency (201): ${winnerLatency} ms`);
    console.log(`p50 Latency (median): ${p50} ms`);
    console.log(`p95 Latency:          ${p95} ms`);
    console.log(`HTTP 201 (Created):   ${statusCounts['201']}`);
    console.log(`HTTP 409 (Conflict):  ${statusCounts['409']}`);
    console.log(`Other HTTP Status:    ${statusCounts.other}`);
    console.log(`Active DB Bookings:   ${activeBookingsInDb.length}`);
    console.log(`Winning Patient:      ${activeBookingsInDb[0]?.user.email}`);
    console.log('================================================================\n');

    // Fail if any 500 Internal Server Errors occurred
    expect(serverErrors).toBe(0);

    // Concurrency invariants:
    // Exactly 1 request succeeds with 201 Created
    expect(statusCounts['201']).toBe(1);
    // Exactly 49 requests fail with 409 Conflict
    expect(statusCounts['409']).toBe(49);
    // The database contains exactly 1 active booking
    expect(activeBookingsInDb).toHaveLength(1);
  }, 40000);
});
