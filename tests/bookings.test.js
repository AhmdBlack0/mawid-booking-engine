process.env.NODE_ENV = 'test';
process.env.TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://postgres:password@localhost:5432/mawid_test?schema=public';

const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/config/prisma');
const { cleanDatabase } = require('./helpers');

describe('Bookings Module Functional Tests', () => {
  let adminToken;
  let patient1Token;
  let patient2Token;
  let doctor;
  let slot;

  beforeEach(async () => {
    await cleanDatabase();

    // 1. Admin
    const adminRes = await request(app).post('/auth/register').send({
      name: 'Admin User',
      email: 'admin@booking-tests.com',
      password: 'password123',
      role: 'ADMIN',
    });
    adminToken = adminRes.body.data.token;

    // 2. Patient 1
    const p1Res = await request(app).post('/auth/register').send({
      name: 'Alice Patient',
      email: 'alice@booking-tests.com',
      password: 'password123',
      role: 'PATIENT',
    });
    patient1Token = p1Res.body.data.token;

    // 3. Patient 2
    const p2Res = await request(app).post('/auth/register').send({
      name: 'Bob Patient',
      email: 'bob@booking-tests.com',
      password: 'password123',
      role: 'PATIENT',
    });
    patient2Token = p2Res.body.data.token;

    // 4. Doctor
    const docRes = await request(app)
      .post('/doctors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Dr. John Watson', specialty: 'General Practice' });
    doctor = docRes.body.data.doctor;

    // 5. Create 1 slot
    await request(app)
      .post(`/doctors/${doctor.id}/slots`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        startDate: '2026-11-15T10:00:00.000Z',
        endDate: '2026-11-15T10:30:00.000Z',
        durationMinutes: 30,
      });

    slot = await prisma.slot.findFirst({ where: { doctorId: doctor.id } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('Booking Lifecycle: Book -> Cancel -> Re-book', () => {
    it('allows booking, then cancellation frees the slot for another patient', async () => {
      // 1. Patient 1 books the slot (starts as PENDING hold)
      const bookRes1 = await request(app)
        .post('/bookings')
        .set('Authorization', `Bearer ${patient1Token}`)
        .send({ slotId: slot.id });

      expect(bookRes1.status).toBe(201);
      expect(bookRes1.body.data.booking.status).toBe('PENDING');
      const bookingId = bookRes1.body.data.booking.id;

      // 2. Patient 2 tries to book the same slot -> 409 Conflict
      const conflictRes = await request(app)
        .post('/bookings')
        .set('Authorization', `Bearer ${patient2Token}`)
        .send({ slotId: slot.id });

      expect(conflictRes.status).toBe(409);
      expect(conflictRes.body.message).toMatch(/already been booked/i);

      // 3. Patient 1 cancels their booking -> 200 OK
      const cancelRes = await request(app)
        .post(`/bookings/${bookingId}/cancel`)
        .set('Authorization', `Bearer ${patient1Token}`);

      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.data.booking.status).toBe('CANCELLED');

      // 4. Now Patient 2 books the same slot -> 201 Created (slot was freed!)
      const bookRes2 = await request(app)
        .post('/bookings')
        .set('Authorization', `Bearer ${patient2Token}`)
        .send({ slotId: slot.id });

      expect(bookRes2.status).toBe(201);
      expect(bookRes2.body.data.booking.status).toBe('PENDING');
    });

    it('returns 403 Forbidden when a patient tries to cancel someone else booking', async () => {
      // Patient 1 books
      const bookRes = await request(app)
        .post('/bookings')
        .set('Authorization', `Bearer ${patient1Token}`)
        .send({ slotId: slot.id });

      const bookingId = bookRes.body.data.booking.id;

      // Patient 2 tries to cancel Patient 1's booking
      const cancelRes = await request(app)
        .post(`/bookings/${bookingId}/cancel`)
        .set('Authorization', `Bearer ${patient2Token}`);

      expect(cancelRes.status).toBe(403);
      expect(cancelRes.body.message).toMatch(/forbidden/i);
    });

    it('allows an ADMIN to cancel any patient booking', async () => {
      const bookRes = await request(app)
        .post('/bookings')
        .set('Authorization', `Bearer ${patient1Token}`)
        .send({ slotId: slot.id });

      const bookingId = bookRes.body.data.booking.id;

      // Admin cancels
      const cancelRes = await request(app)
        .post(`/bookings/${bookingId}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.data.booking.status).toBe('CANCELLED');
    });

    it('returns 400 when attempting to cancel an already cancelled booking', async () => {
      const bookRes = await request(app)
        .post('/bookings')
        .set('Authorization', `Bearer ${patient1Token}`)
        .send({ slotId: slot.id });

      const bookingId = bookRes.body.data.booking.id;

      // First cancel -> 200
      await request(app)
        .post(`/bookings/${bookingId}/cancel`)
        .set('Authorization', `Bearer ${patient1Token}`);

      // Second cancel -> 400
      const res = await request(app)
        .post(`/bookings/${bookingId}/cancel`)
        .set('Authorization', `Bearer ${patient1Token}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/already cancelled/i);
    });
  });

  describe('GET /bookings/me', () => {
    it('returns only the authenticated user bookings', async () => {
      // Patient 1 books slot
      await request(app)
        .post('/bookings')
        .set('Authorization', `Bearer ${patient1Token}`)
        .send({ slotId: slot.id });

      // Patient 1 gets own bookings
      const res1 = await request(app)
        .get('/bookings/me')
        .set('Authorization', `Bearer ${patient1Token}`);

      expect(res1.status).toBe(200);
      expect(res1.body.results).toBe(1);
      expect(res1.body.data.bookings[0].slotId).toBe(slot.id);
      expect(res1.body.data.bookings[0].slot.doctor.name).toBe('Dr. John Watson');

      // Patient 2 gets own bookings -> should be empty
      const res2 = await request(app)
        .get('/bookings/me')
        .set('Authorization', `Bearer ${patient2Token}`);

      expect(res2.status).toBe(200);
      expect(res2.body.results).toBe(0);
      expect(res2.body.data.bookings).toHaveLength(0);
    });

    it('returns 401 Unauthorized when not logged in', async () => {
      const res = await request(app).get('/bookings/me');
      expect(res.status).toBe(401);
    });
  });
});
