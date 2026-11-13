process.env.NODE_ENV = 'test';
process.env.TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://postgres:password@localhost:5432/mawid_test?schema=public';

const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/config/prisma');
const { cleanDatabase } = require('./helpers');

describe('Doctors & Slots Module Integration Tests', () => {
  let adminToken;
  let patientToken;
  let patientUser;

  beforeEach(async () => {
    await cleanDatabase();

    // Setup Admin user
    const adminRes = await request(app).post('/auth/register').send({
      name: 'Dr. Administrator',
      email: 'admin@clinic.com',
      password: 'adminpassword123',
      role: 'ADMIN',
    });
    adminToken = adminRes.body.data.token;

    // Setup Patient user
    const patientRes = await request(app).post('/auth/register').send({
      name: 'John Patient',
      email: 'patient@clinic.com',
      password: 'patientpassword123',
      role: 'PATIENT',
    });
    patientToken = patientRes.body.data.token;
    patientUser = patientRes.body.data.user;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('POST /doctors', () => {
    it('should allow ADMIN to create a new doctor', async () => {
      const res = await request(app)
        .post('/doctors')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Dr. Gregory House',
          specialty: 'Diagnostic Medicine',
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data.doctor).toMatchObject({
        name: 'Dr. Gregory House',
        specialty: 'Diagnostic Medicine',
      });
      expect(res.body.data.doctor.id).toBeDefined();
    });

    it('should return 403 Forbidden when a PATIENT tries to create a doctor', async () => {
      const res = await request(app)
        .post('/doctors')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          name: 'Dr. Pretender',
          specialty: 'Surgery',
        });

      expect(res.status).toBe(403);
      expect(res.body.status).toBe('fail');
      expect(res.body.message).toMatch(/forbidden/i);
    });

    it('should return 401 Unauthorized when unauthenticated request tries to create a doctor', async () => {
      const res = await request(app).post('/doctors').send({
        name: 'Dr. Anonymous',
        specialty: 'Dermatology',
      });

      expect(res.status).toBe(401);
      expect(res.body.status).toBe('fail');
    });
  });

  describe('GET /doctors', () => {
    it('should publicly return a list of all doctors', async () => {
      // Create two doctors as admin
      await request(app)
        .post('/doctors')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Dr. Alice', specialty: 'Cardiology' });

      await request(app)
        .post('/doctors')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Dr. Bob', specialty: 'Neurology' });

      const res = await request(app).get('/doctors');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.results).toBe(2);
      expect(res.body.data.doctors).toHaveLength(2);
    });
  });

  describe('POST /doctors/:id/slots', () => {
    let doctor;

    beforeEach(async () => {
      const docRes = await request(app)
        .post('/doctors')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Dr. Stephen Strange', specialty: 'Neuroscience' });
      doctor = docRes.body.data.doctor;
    });

    it('should allow ADMIN to bulk create slots for a date range with a duration', async () => {
      // 09:00 to 11:00 with 30 min duration = 4 slots (09:00, 09:30, 10:00, 10:30)
      const res = await request(app)
        .post(`/doctors/${doctor.id}/slots`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          startDate: '2026-11-13T09:00:00.000Z',
          endDate: '2026-11-13T11:00:00.000Z',
          durationMinutes: 30,
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data).toMatchObject({
        totalCandidates: 4,
        createdCount: 4,
        skippedCount: 0,
      });

      const slotsInDb = await prisma.slot.findMany({
        where: { doctorId: doctor.id },
      });
      expect(slotsInDb).toHaveLength(4);
    });

    it('should skip overlapping slots when re-creating or intersecting existing slots', async () => {
      // Create initial 2 slots from 09:00 to 10:00 (09:00-09:30, 09:30-10:00)
      await request(app)
        .post(`/doctors/${doctor.id}/slots`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          startDate: '2026-11-13T09:00:00.000Z',
          endDate: '2026-11-13T10:00:00.000Z',
          durationMinutes: 30,
        });

      // Try creating 09:00 to 11:00 (4 candidates: 2 existing overlap, 2 new)
      const res = await request(app)
        .post(`/doctors/${doctor.id}/slots`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          startDate: '2026-11-13T09:00:00.000Z',
          endDate: '2026-11-13T11:00:00.000Z',
          durationMinutes: 30,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.createdCount).toBe(2);
      expect(res.body.data.skippedCount).toBe(2);

      const totalSlots = await prisma.slot.count({ where: { doctorId: doctor.id } });
      expect(totalSlots).toBe(4);
    });

    it('should return 403 when a PATIENT attempts to create slots', async () => {
      const res = await request(app)
        .post(`/doctors/${doctor.id}/slots`)
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          startDate: '2026-11-13T09:00:00.000Z',
          endDate: '2026-11-13T11:00:00.000Z',
          durationMinutes: 30,
        });

      expect(res.status).toBe(403);
    });
  });

  describe('GET /doctors/:id/slots', () => {
    let doctor;
    let slot1;
    let slot2;
    let slot3;

    beforeEach(async () => {
      const docRes = await request(app)
        .post('/doctors')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Dr. Meredith Grey', specialty: 'General Surgery' });
      doctor = docRes.body.data.doctor;

      // Create 3 slots on 2026-11-13
      // Slot 1: 09:00 - 09:30 (Will have a CONFIRMED booking -> unavailable)
      // Slot 2: 09:30 - 10:00 (Will have a CANCELLED booking -> available)
      // Slot 3: 10:00 - 10:30 (No bookings -> available)
      await request(app)
        .post(`/doctors/${doctor.id}/slots`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          startDate: '2026-11-13T09:00:00.000Z',
          endDate: '2026-11-13T10:30:00.000Z',
          durationMinutes: 30,
        });

      const slots = await prisma.slot.findMany({
        where: { doctorId: doctor.id },
        orderBy: { startsAt: 'asc' },
      });
      [slot1, slot2, slot3] = slots;

      // Active booking on slot 1
      await prisma.booking.create({
        data: {
          slotId: slot1.id,
          userId: patientUser.id,
          status: 'CONFIRMED',
        },
      });

      // Cancelled booking on slot 2
      await prisma.booking.create({
        data: {
          slotId: slot2.id,
          userId: patientUser.id,
          status: 'CANCELLED',
        },
      });
    });

    it('should return only slots with NO active bookings (slot2 and slot3)', async () => {
      const res = await request(app).get(`/doctors/${doctor.id}/slots?date=2026-11-13`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.results).toBe(2);

      const returnedSlotIds = res.body.data.slots.map((s) => s.id);
      expect(returnedSlotIds).not.toContain(slot1.id); // Confirmed booking excludes slot1
      expect(returnedSlotIds).toContain(slot2.id); // Cancelled booking frees slot2
      expect(returnedSlotIds).toContain(slot3.id); // No bookings includes slot3
    });

    it('should return 400 when date parameter is missing or invalid format', async () => {
      const res = await request(app).get(`/doctors/${doctor.id}/slots?date=invalid-date`);

      expect(res.status).toBe(400);
      expect(res.body.status).toBe('fail');
      expect(res.body.message).toBe('Validation failed');
    });
  });
});
