const prisma = require('../../config/prisma');
const AppError = require('../../utils/AppError');
const { getCached, setCached, invalidateCache, invalidatePattern } = require('../../config/redis');

// Cache invalidation helper for doctors
async function invalidateDoctorsCache() {
  await invalidateCache('all_doctors');
}

async function createDoctor({ name, specialty }) {
  await invalidateDoctorsCache();
  return prisma.doctor.create({
    data: {
      name,
      specialty,
    },
  });
}

async function getAllDoctors() {
  // 1. Check Two-Tier Cache (L1 in-memory < 1ms, L2 Upstash Redis ~300ms)
  const cached = await getCached('all_doctors');
  if (cached) {
    return typeof cached === 'string' ? JSON.parse(cached) : cached;
  }

  // 2. Database query on cache miss (cached for 10 minutes)
  const doctors = await prisma.doctor.findMany({
    orderBy: { name: 'asc' },
  });

  await setCached('all_doctors', doctors, 600);
  return doctors;
}

async function getDoctorById(id) {
  const cacheKey = `doctor:${id}`;
  const cached = await getCached(cacheKey);
  if (cached) {
    return typeof cached === 'string' ? JSON.parse(cached) : cached;
  }

  const doctor = await prisma.doctor.findUnique({
    where: { id },
  });

  if (!doctor) {
    throw new AppError('Doctor not found.', 404);
  }

  await setCached(cacheKey, doctor, 600);
  return doctor;
}

async function createSlotsBulk(doctorId, { startDate, endDate, durationMinutes }) {
  await getDoctorById(doctorId);

  const start = new Date(startDate);
  const end = new Date(endDate);
  const durationMs = durationMinutes * 60 * 1000;

  // 1. Generate candidate slot intervals
  const candidateSlots = [];
  let current = new Date(start.getTime());

  while (current.getTime() + durationMs <= end.getTime()) {
    const slotEnd = new Date(current.getTime() + durationMs);
    candidateSlots.push({
      doctorId,
      startsAt: new Date(current.getTime()),
      endsAt: slotEnd,
    });
    current = slotEnd;
  }

  if (candidateSlots.length === 0) {
    return {
      totalCandidates: 0,
      createdCount: 0,
      skippedCount: 0,
    };
  }

  // 2. Fetch existing slots for this doctor that intersect the overall time window
  const existingSlots = await prisma.slot.findMany({
    where: {
      doctorId,
      startsAt: { lt: end },
      endsAt: { gt: start },
    },
  });

  // 3. Skip overlapping candidates: interval [A, B) overlaps with [C, D) iff A < D && B > C
  const nonOverlappingCandidates = candidateSlots.filter((candidate) => {
    const hasOverlap = existingSlots.some((existing) => {
      return candidate.startsAt < existing.endsAt && candidate.endsAt > existing.startsAt;
    });
    return !hasOverlap;
  });

  // 4. Bulk insert into Postgres
  if (nonOverlappingCandidates.length > 0) {
    await prisma.slot.createMany({
      data: nonOverlappingCandidates,
      skipDuplicates: true,
    });
    await invalidatePattern(`slots:${doctorId}:*`);
  }

  return {
    totalCandidates: candidateSlots.length,
    createdCount: nonOverlappingCandidates.length,
    skippedCount: candidateSlots.length - nonOverlappingCandidates.length,
  };
}

async function getAvailableSlots(doctorId, dateString, includeAll = false) {
  // UTC day boundaries
  const dayStart = new Date(`${dateString}T00:00:00.000Z`);
  const dayEnd = new Date(`${dateString}T23:59:59.999Z`);

  if (isNaN(dayStart.getTime())) {
    throw new AppError('Invalid date format. Expected YYYY-MM-DD.', 400);
  }

  const cacheKey = `slots:${doctorId}:${dateString}:${includeAll ? 'all' : 'free'}`;
  const cached = await getCached(cacheKey);
  if (cached) {
    return typeof cached === 'string' ? JSON.parse(cached) : cached;
  }

  const now = new Date();

  // Run doctor existence check and slots retrieval in PARALLEL to eliminate sequential roundtrips
  if (includeAll) {
    const [doctor, allSlots] = await Promise.all([
      prisma.doctor.findUnique({
        where: { id: doctorId },
        select: { id: true },
      }),
      prisma.slot.findMany({
        where: {
          doctorId,
          startsAt: {
            gte: dayStart,
            lte: dayEnd,
          },
        },
        include: {
          bookings: {
            where: {
              OR: [
                { status: 'CONFIRMED' },
                { status: 'PENDING', expiresAt: { gt: now } },
              ],
            },
            select: {
              id: true,
              status: true,
              expiresAt: true,
            },
          },
        },
        orderBy: { startsAt: 'asc' },
      }),
    ]);

    if (!doctor) {
      throw new AppError('Doctor not found.', 404);
    }

    const result = allSlots.map((slot) => {
      const activeBooking = slot.bookings[0] || null;
      return {
        id: slot.id,
        doctorId: slot.doctorId,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        createdAt: slot.createdAt,
        isBooked: !!activeBooking,
        status: activeBooking ? activeBooking.status : 'AVAILABLE',
        expiresAt: activeBooking ? activeBooking.expiresAt : null,
      };
    });

    await setCached(cacheKey, result, 180);
    return result;
  }

  const [doctor, slots] = await Promise.all([
    prisma.doctor.findUnique({
      where: { id: doctorId },
      select: { id: true },
    }),
    prisma.slot.findMany({
      where: {
        doctorId,
        startsAt: {
          gte: dayStart,
          lte: dayEnd,
        },
        bookings: {
          none: {
            OR: [
              { status: 'CONFIRMED' },
              {
                status: 'PENDING',
                expiresAt: { gt: now },
              },
            ],
          },
        },
      },
      orderBy: { startsAt: 'asc' },
      select: {
        id: true,
        doctorId: true,
        startsAt: true,
        endsAt: true,
        createdAt: true,
      },
    }),
  ]);

  if (!doctor) {
    throw new AppError('Doctor not found.', 404);
  }

  await setCached(cacheKey, slots, 180);
  return slots;
}

module.exports = {
  createDoctor,
  getAllDoctors,
  getDoctorById,
  createSlotsBulk,
  getAvailableSlots,
};
