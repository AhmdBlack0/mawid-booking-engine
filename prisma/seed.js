const bcrypt = require('bcrypt');
const prisma = require('../src/config/prisma');

const SALT_ROUNDS = 12;

async function main() {
  console.log('🌱 Starting database seeding on Neon PostgreSQL...');

  // 1. Seed Users (Admin & Patients)
  console.log('👤 Seeding Users...');
  const adminPassword = await bcrypt.hash('admin123', SALT_ROUNDS);
  const patientPassword = await bcrypt.hash('patient123', SALT_ROUNDS);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@clinic.com' },
    update: {},
    create: {
      name: 'Dr. Administrator',
      email: 'admin@clinic.com',
      password: adminPassword,
      role: 'ADMIN',
    },
  });

  const patient1 = await prisma.user.upsert({
    where: { email: 'patient@clinic.com' },
    update: {},
    create: {
      name: 'Jane Patient',
      email: 'patient@clinic.com',
      password: patientPassword,
      role: 'PATIENT',
    },
  });

  const patient2 = await prisma.user.upsert({
    where: { email: 'john.doe@clinic.com' },
    update: {},
    create: {
      name: 'John Doe',
      email: 'john.doe@clinic.com',
      password: patientPassword,
      role: 'PATIENT',
    },
  });

  console.log(`✅ Users created:
  - Admin: admin@clinic.com (pass: admin123)
  - Patient 1: patient@clinic.com (pass: patient123)
  - Patient 2: john.doe@clinic.com (pass: patient123)`);

  // 2. Seed Doctors
  console.log('\n🩺 Seeding Doctors...');
  const doctorsData = [
    { name: 'Dr. Sarah Connor', specialty: 'Cardiology' },
    { name: 'Dr. Gregory House', specialty: 'Diagnostics & Internal Medicine' },
    { name: 'Dr. Meredith Grey', specialty: 'General Surgery' },
  ];

  const doctors = [];
  for (const doc of doctorsData) {
    let existingDoc = await prisma.doctor.findFirst({
      where: { name: doc.name },
    });
    if (!existingDoc) {
      existingDoc = await prisma.doctor.create({
        data: doc,
      });
    }
    doctors.push(existingDoc);
    console.log(`  - ${existingDoc.name} (${existingDoc.specialty}) [ID: ${existingDoc.id}]`);
  }

  // 3. Seed Slots for Today & Tomorrow (09:00 to 17:00, 30 min intervals)
  console.log('\n📅 Generating Appointment Slots (Today & Tomorrow)...');
  const now = new Date();

  // Helper to generate dates at 00:00 UTC
  const todayStr = now.toISOString().split('T')[0];
  const tomorrowDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowStr = tomorrowDate.toISOString().split('T')[0];

  const days = [todayStr, tomorrowStr];
  let totalSlotsCount = 0;
  const createdSlots = [];

  for (const doc of doctors) {
    for (const day of days) {
      // 09:00 to 17:00 (8 hours = 16 slots per doctor per day)
      for (let hour = 9; hour < 17; hour++) {
        for (let min of [0, 30]) {
          const startsAt = new Date(`${day}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00.000Z`);
          const endsAt = new Date(startsAt.getTime() + 30 * 60 * 1000);

          try {
            const slot = await prisma.slot.upsert({
              where: {
                doctorId_startsAt: {
                  doctorId: doc.id,
                  startsAt,
                },
              },
              update: {},
              create: {
                doctorId: doc.id,
                startsAt,
                endsAt,
              },
            });
            createdSlots.push(slot);
            totalSlotsCount++;
          } catch {
            // Skip duplicates
          }
        }
      }
    }
  }

  console.log(`✅ Generated ${totalSlotsCount} available slots across 3 doctors.`);

  // 4. Create sample initial bookings so UI showcases real states
  console.log('\n📑 Creating Demo Bookings (1 Confirmed, 1 Pending Hold)...');

  // Find a slot for Dr. Sarah Connor today at 10:00
  const sarahDoc = doctors[0];
  const targetSlot1 = createdSlots.find(
    (s) => s.doctorId === sarahDoc.id && s.startsAt.getUTCHours() === 10 && s.startsAt.getUTCMinutes() === 0
  );

  if (targetSlot1) {
    const existingBooking = await prisma.booking.findFirst({
      where: { slotId: targetSlot1.id },
    });
    if (!existingBooking) {
      await prisma.booking.create({
        data: {
          slotId: targetSlot1.id,
          userId: patient1.id,
          status: 'CONFIRMED',
        },
      });
      console.log(`  - Confirmed Booking: Jane Patient with Dr. Sarah Connor at 10:00 UTC`);
    }
  }

  // Find a slot for Dr. Gregory House today at 11:30 (Active Hold: 10 min expiry)
  const houseDoc = doctors[1];
  const targetSlot2 = createdSlots.find(
    (s) => s.doctorId === houseDoc.id && s.startsAt.getUTCHours() === 11 && s.startsAt.getUTCMinutes() === 30
  );

  if (targetSlot2) {
    const existingBooking = await prisma.booking.findFirst({
      where: { slotId: targetSlot2.id },
    });
    if (!existingBooking) {
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      await prisma.booking.create({
        data: {
          slotId: targetSlot2.id,
          userId: patient2.id,
          status: 'PENDING',
          expiresAt,
        },
      });
      console.log(`  - Active Hold (10-min countdown): John Doe with Dr. Gregory House at 11:30 UTC`);
    }
  }

  console.log('\n🎉 Database seeding completed successfully!\n');
}

main()
  .catch((err) => {
    console.error('❌ Seeding failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
