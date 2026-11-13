process.env.NODE_ENV = 'test';
process.env.TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://postgres:password@localhost:5432/mawid_test?schema=public';

const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/config/prisma');
const { cleanDatabase } = require('./helpers');

describe('Booking Reschedule Flow & Deadlock Prevention', () => {
  let adminToken;
  let patient1Token;
  let patient2Token;
  let doctor;

  beforeEach(async () => {
    await cleanDatabase();

    // 1. Admin
    const adminRes = await request(app).post('/auth/register').send({
      name: 'Reschedule Admin',
      email: 'admin.reschedule@clinic.com',
      password: 'password123',
      role: 'ADMIN',
    });
    adminToken = adminRes.body.data.token;

    // 2. Patient 1 & 2
    const p1 = await request(app).post('/auth/register').send({
      name: 'Alice Swapper',
      email: 'alice.swap@clinic.com',
      password: 'password123',
    });
    patient1Token = p1.body.data.token;

    const p2 = await request(app).post('/auth/register').send({
      name: 'Bob Swapper',
      email: 'bob.swap@clinic.com',
      password: 'password123',
    });
    patient2Token = p2.body.data.token;

    // 3. Doctor
    const docRes = await request(app)
      .post('/doctors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Dr. Chronos', specialty: 'Temporal Medicine' });
    doctor = docRes.body.data.doctor;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('atomically moves a booking from slot X to slot Y', async () => {
    // Create Slot X and Slot Y
    const slotX = await prisma.slot.create({
      data: {
        doctorId: doctor.id,
        startsAt: new Date('2026-11-20T09:00:00.000Z'),
        endsAt: new Date('2026-11-20T09:30:00.000Z'),
      },
    });

    const slotY = await prisma.slot.create({
      data: {
        doctorId: doctor.id,
        startsAt: new Date('2026-11-20T10:00:00.000Z'),
        endsAt: new Date('2026-11-20T10:30:00.000Z'),
      },
    });

    // Patient 1 books slot X
    const bookRes = await request(app)
      .post('/bookings')
      .set('Authorization', `Bearer ${patient1Token}`)
      .send({ slotId: slotX.id });

    const originalBookingId = bookRes.body.data.booking.id;

    // Reschedule from slot X to slot Y
    const rescheduleRes = await request(app)
      .post(`/bookings/${originalBookingId}/reschedule`)
      .set('Authorization', `Bearer ${patient1Token}`)
      .send({ newSlotId: slotY.id });

    expect(rescheduleRes.status).toBe(200);
    expect(rescheduleRes.body.status).toBe('success');
    expect(rescheduleRes.body.data.booking.slotId).toBe(slotY.id);
    expect(rescheduleRes.body.data.booking.status).toBe('CONFIRMED');

    // Verify slot X is now freed and original booking is CANCELLED
    const oldBookingInDb = await prisma.booking.findUnique({
      where: { id: originalBookingId },
    });
    expect(oldBookingInDb.status).toBe('CANCELLED');

    // Slot X can now be booked by Patient 2
    const rebookXRes = await request(app)
      .post('/bookings')
      .set('Authorization', `Bearer ${patient2Token}`)
      .send({ slotId: slotX.id });

    expect(rebookXRes.status).toBe(201);
  });

  it('fails atomically and preserves old booking when target slot Y is already occupied', async () => {
    // Create Slot X and Slot Y
    const slotX = await prisma.slot.create({
      data: {
        doctorId: doctor.id,
        startsAt: new Date('2026-11-20T11:00:00.000Z'),
        endsAt: new Date('2026-11-20T11:30:00.000Z'),
      },
    });

    const slotY = await prisma.slot.create({
      data: {
        doctorId: doctor.id,
        startsAt: new Date('2026-11-20T12:00:00.000Z'),
        endsAt: new Date('2026-11-20T12:30:00.000Z'),
      },
    });

    // Patient 1 books X and confirms it
    const bookX = await request(app)
      .post('/bookings')
      .set('Authorization', `Bearer ${patient1Token}`)
      .send({ slotId: slotX.id });
    const bookingXId = bookX.body.data.booking.id;
    await request(app)
      .post(`/bookings/${bookingXId}/confirm`)
      .set('Authorization', `Bearer ${patient1Token}`);

    // Patient 2 books Y and confirms it
    const bookY = await request(app)
      .post('/bookings')
      .set('Authorization', `Bearer ${patient2Token}`)
      .send({ slotId: slotY.id });
    await request(app)
      .post(`/bookings/${bookY.body.data.booking.id}/confirm`)
      .set('Authorization', `Bearer ${patient2Token}`);

    // Patient 1 attempts to reschedule to Y (which is already booked by Patient 2)
    const rescheduleRes = await request(app)
      .post(`/bookings/${bookingXId}/reschedule`)
      .set('Authorization', `Bearer ${patient1Token}`)
      .send({ newSlotId: slotY.id });

    expect(rescheduleRes.status).toBe(409);
    expect(rescheduleRes.body.message).toMatch(/not available/i);

    // CRITICAL: Slot X must STAY CONFIRMED! (No partial state where X was cancelled)
    const bookingXInDb = await prisma.booking.findUnique({
      where: { id: bookingXId },
    });
    expect(bookingXInDb.status).toBe('CONFIRMED');
  });

  it('prevents deadlock when two users concurrently attempt to swap slots (A -> B and B -> A)', async () => {
    // Slot A and Slot B
    const slotA = await prisma.slot.create({
      data: {
        doctorId: doctor.id,
        startsAt: new Date('2026-11-21T09:00:00.000Z'),
        endsAt: new Date('2026-11-21T09:30:00.000Z'),
      },
    });

    const slotB = await prisma.slot.create({
      data: {
        doctorId: doctor.id,
        startsAt: new Date('2026-11-21T10:00:00.000Z'),
        endsAt: new Date('2026-11-21T10:30:00.000Z'),
      },
    });

    // Patient 1 holds Slot A
    const bookA = await request(app)
      .post('/bookings')
      .set('Authorization', `Bearer ${patient1Token}`)
      .send({ slotId: slotA.id });
    const bookingAId = bookA.body.data.booking.id;

    // Patient 2 holds Slot B
    const bookB = await request(app)
      .post('/bookings')
      .set('Authorization', `Bearer ${patient2Token}`)
      .send({ slotId: slotB.id });
    const bookingBId = bookB.body.data.booking.id;

    // Concurrent swap:
    // Patient 1 wants Slot B: A -> B
    // Patient 2 wants Slot A: B -> A
    // Without strict lock ordering, this causes a deadlock error 40P01.
    // With lock ordering, locks are always acquired in order: min(A,B) then max(A,B).
    const [swap1, swap2] = await Promise.all([
      request(app)
        .post(`/bookings/${bookingAId}/reschedule`)
        .set('Authorization', `Bearer ${patient1Token}`)
        .send({ newSlotId: slotB.id }),
      request(app)
        .post(`/bookings/${bookingBId}/reschedule`)
        .set('Authorization', `Bearer ${patient2Token}`)
        .send({ newSlotId: slotA.id }),
    ]);

    // Neither request crashed or deadlocked with a 500
    expect(swap1.status).not.toBe(500);
    expect(swap2.status).not.toBe(500);

    // Because both target slots were occupied at transaction start, both get 409
    // or one serializes cleanly.
    expect([409, 200]).toContain(swap1.status);
    expect([409, 200]).toContain(swap2.status);
  });
});
