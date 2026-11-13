const prisma = require('../src/config/prisma');
const { cleanDatabase } = require('./helpers');

describe('Schema Adjustments & Foreign Key Verification', () => {
  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await cleanDatabase();
    await prisma.$disconnect();
  });

  describe('Verification b: Partial Unique Index Behavior', () => {
    it('proves: 1st PENDING succeeds, 2nd PENDING fails with P2002, and succeeds after CANCELLED', async () => {
      // 1. Setup Doctor, Slot, and 2 Patients
      const doctor = await prisma.doctor.create({
        data: { name: 'Dr. Test Index', specialty: 'General' },
      });

      const slot = await prisma.slot.create({
        data: {
          doctorId: doctor.id,
          startsAt: new Date('2026-11-20T10:00:00Z'),
          endsAt: new Date('2026-11-20T10:30:00Z'),
        },
      });

      const patient1 = await prisma.user.create({
        data: {
          name: 'Patient One',
          email: 'patient1_idx@clinic.com',
          password: 'hashedpassword',
          role: 'PATIENT',
        },
      });

      const patient2 = await prisma.user.create({
        data: {
          name: 'Patient Two',
          email: 'patient2_idx@clinic.com',
          password: 'hashedpassword',
          role: 'PATIENT',
        },
      });

      // 2. First PENDING booking succeeds
      const firstBooking = await prisma.booking.create({
        data: {
          slotId: slot.id,
          userId: patient1.id,
          status: 'PENDING',
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        },
      });
      expect(firstBooking).toBeDefined();
      expect(firstBooking.status).toBe('PENDING');

      // 3. Second PENDING booking for the same slot fails with Prisma error P2002
      let secondBookingError = null;
      try {
        await prisma.booking.create({
          data: {
            slotId: slot.id,
            userId: patient2.id,
            status: 'PENDING',
            expiresAt: new Date(Date.now() + 10 * 60 * 1000),
          },
        });
      } catch (err) {
        secondBookingError = err;
      }

      expect(secondBookingError).not.toBeNull();
      expect(secondBookingError.code).toBe('P2002');
      expect(secondBookingError.message).toContain('Unique constraint failed');

      // 4. Update the first booking to CANCELLED
      await prisma.booking.update({
        where: { id: firstBooking.id },
        data: { status: 'CANCELLED' },
      });

      // 5. New booking for the same slot now succeeds
      const reBooking = await prisma.booking.create({
        data: {
          slotId: slot.id,
          userId: patient2.id,
          status: 'PENDING',
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        },
      });

      expect(reBooking).toBeDefined();
      expect(reBooking.id).not.toBe(firstBooking.id);
      expect(reBooking.status).toBe('PENDING');
      expect(reBooking.userId).toBe(patient2.id);
    });
  });

  describe('Verification c: onDelete Restrict Protection', () => {
    it('proves: database rejects deletion of Slot and User when bookings exist', async () => {
      // 1. Setup Doctor, Slot, Patient, and Booking
      const doctor = await prisma.doctor.create({
        data: { name: 'Dr. Restrict Test', specialty: 'Neurology' },
      });

      const slot = await prisma.slot.create({
        data: {
          doctorId: doctor.id,
          startsAt: new Date('2026-11-20T11:00:00Z'),
          endsAt: new Date('2026-11-20T11:30:00Z'),
        },
      });

      const patient = await prisma.user.create({
        data: {
          name: 'Patient Protected',
          email: 'patient_restrict@clinic.com',
          password: 'hashedpassword',
          role: 'PATIENT',
        },
      });

      const booking = await prisma.booking.create({
        data: {
          slotId: slot.id,
          userId: patient.id,
          status: 'CONFIRMED',
        },
      });
      expect(booking).toBeDefined();

      // 2. Attempt to delete Slot -> DB must reject with foreign key constraint violation (P2003)
      let deleteSlotError = null;
      try {
        await prisma.slot.delete({
          where: { id: slot.id },
        });
      } catch (err) {
        deleteSlotError = err;
      }

      expect(deleteSlotError).not.toBeNull();
      // Postgres returns 23001 (RESTRICT_VIOLATION) which Prisma wraps with the RESTRICT constraint violation message
      expect(deleteSlotError.message).toMatch(/violates RESTRICT setting of foreign key constraint/i);

      // 3. Attempt to delete User -> DB must reject with foreign key constraint violation (RESTRICT)
      let deleteUserError = null;
      try {
        await prisma.user.delete({
          where: { id: patient.id },
        });
      } catch (err) {
        deleteUserError = err;
      }

      expect(deleteUserError).not.toBeNull();
      expect(deleteUserError.message).toMatch(/violates RESTRICT setting of foreign key constraint/i);

      // 4. Attempt to delete Doctor -> Doctor cascades to Slot, but Slot has Restrict on Booking -> DB rejects!
      let deleteDoctorError = null;
      try {
        await prisma.doctor.delete({
          where: { id: doctor.id },
        });
      } catch (err) {
        deleteDoctorError = err;
      }

      expect(deleteDoctorError).not.toBeNull();
      expect(deleteDoctorError.message).toMatch(/violates RESTRICT setting of foreign key constraint/i);
    });
  });
});
