process.env.NODE_ENV = 'test';
process.env.TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://postgres:password@localhost:5432/mawid_test?schema=public';

const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/config/prisma');
const { cleanDatabase } = require('./helpers');
const { sweepExpiredBookings } = require('../src/jobs/expiryJob');

describe('Booking Hold & Expiry Lifecycle', () => {
  let adminToken;
  let patient1Token;
  let patient2Token;
  let doctor;
  let slot;

  beforeEach(async () => {
    await cleanDatabase();

    // 1. Admin
    const adminRes = await request(app).post('/auth/register').send({
      name: 'Hold Admin',
      email: 'admin.hold@clinic.com',
      password: 'password123',
      role: 'ADMIN',
    });
    adminToken = adminRes.body.data.token;

    // 2. Patients
    const p1 = await request(app).post('/auth/register').send({
      name: 'Patient Hold One',
      email: 'patient1.hold@clinic.com',
      password: 'password123',
    });
    patient1Token = p1.body.data.token;

    const p2 = await request(app).post('/auth/register').send({
      name: 'Patient Hold Two',
      email: 'patient2.hold@clinic.com',
      password: 'password123',
    });
    patient2Token = p2.body.data.token;

    // 3. Doctor & Slot
    const docRes = await request(app)
      .post('/doctors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Dr. Timekeeper', specialty: 'Geriatrics' });
    doctor = docRes.body.data.doctor;

    slot = await prisma.slot.create({
      data: {
        doctorId: doctor.id,
        startsAt: new Date('2026-11-25T14:00:00.000Z'),
        endsAt: new Date('2026-11-25T14:30:00.000Z'),
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates booking with PENDING status and a 10-minute expiresAt window', async () => {
    const res = await request(app)
      .post('/bookings')
      .set('Authorization', `Bearer ${patient1Token}`)
      .send({ slotId: slot.id });

    expect(res.status).toBe(201);
    expect(res.body.data.booking.status).toBe('PENDING');
    expect(res.body.data.booking.expiresAt).toBeDefined();

    const expiresAt = new Date(res.body.data.booking.expiresAt).getTime();
    const approxExpected = Date.now() + 10 * 60 * 1000;
    // Difference should be within 5 seconds
    expect(Math.abs(expiresAt - approxExpected)).toBeLessThan(5000);
  });

  it('confirms a pending booking before expiry', async () => {
    const bookRes = await request(app)
      .post('/bookings')
      .set('Authorization', `Bearer ${patient1Token}`)
      .send({ slotId: slot.id });

    const bookingId = bookRes.body.data.booking.id;

    const confirmRes = await request(app)
      .post(`/bookings/${bookingId}/confirm`)
      .set('Authorization', `Bearer ${patient1Token}`);

    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.data.booking.status).toBe('CONFIRMED');
    expect(confirmRes.body.data.booking.expiresAt).toBeNull();

    const inDb = await prisma.booking.findUnique({ where: { id: bookingId } });
    expect(inDb.status).toBe('CONFIRMED');
    expect(inDb.expiresAt).toBeNull();
  });

  it('rejects confirmation when expiresAt has passed and lazily marks it EXPIRED', async () => {
    // 1. Create booking
    const bookRes = await request(app)
      .post('/bookings')
      .set('Authorization', `Bearer ${patient1Token}`)
      .send({ slotId: slot.id });

    const bookingId = bookRes.body.data.booking.id;

    // 2. Manipulate expiresAt to be in the past
    await prisma.booking.update({
      where: { id: bookingId },
      data: {
        expiresAt: new Date(Date.now() - 5000), // 5 seconds ago
      },
    });

    // 3. Confirm should fail
    const confirmRes = await request(app)
      .post(`/bookings/${bookingId}/confirm`)
      .set('Authorization', `Bearer ${patient1Token}`);

    expect(confirmRes.status).toBe(400);
    expect(confirmRes.body.message).toMatch(/hold has expired/i);

    // 4. Verify DB was updated to EXPIRED
    const inDb = await prisma.booking.findUnique({ where: { id: bookingId } });
    expect(inDb.status).toBe('EXPIRED');
  });

  it('treats an expired hold as free in availability queries and allows re-booking before cron runs', async () => {
    // 1. Patient 1 creates hold
    const bookRes = await request(app)
      .post('/bookings')
      .set('Authorization', `Bearer ${patient1Token}`)
      .send({ slotId: slot.id });

    const bookingId = bookRes.body.data.booking.id;

    // 2. Manipulate expiresAt to be 10 seconds in the past (cron has NOT run yet)
    await prisma.booking.update({
      where: { id: bookingId },
      data: {
        expiresAt: new Date(Date.now() - 10000),
      },
    });

    // 3. GET /doctors/:id/slots should list the slot as AVAILABLE
    const availRes = await request(app).get(
      `/doctors/${doctor.id}/slots?date=2026-11-25`
    );
    expect(availRes.status).toBe(200);
    const slotIds = availRes.body.data.slots.map((s) => s.id);
    expect(slotIds).toContain(slot.id);

    // 4. Patient 2 books the same slot successfully! (Lazy expiration removes old hold)
    const book2Res = await request(app)
      .post('/bookings')
      .set('Authorization', `Bearer ${patient2Token}`)
      .send({ slotId: slot.id });

    expect(book2Res.status).toBe(201);
    expect(book2Res.body.data.booking.status).toBe('PENDING');

    // Verify Patient 1's old booking is now EXPIRED in DB
    const oldBooking = await prisma.booking.findUnique({
      where: { id: bookingId },
    });
    expect(oldBooking.status).toBe('EXPIRED');
  });

  it('background cron sweep job marks expired pending bookings as EXPIRED', async () => {
    // Create hold with past expiry
    const bookRes = await request(app)
      .post('/bookings')
      .set('Authorization', `Bearer ${patient1Token}`)
      .send({ slotId: slot.id });

    const bookingId = bookRes.body.data.booking.id;

    await prisma.booking.update({
      where: { id: bookingId },
      data: {
        expiresAt: new Date(Date.now() - 30000), // 30s ago
      },
    });

    // Trigger cron sweep
    const count = await sweepExpiredBookings();
    expect(count).toBeGreaterThanOrEqual(1);

    const inDb = await prisma.booking.findUnique({ where: { id: bookingId } });
    expect(inDb.status).toBe('EXPIRED');
  });
});
