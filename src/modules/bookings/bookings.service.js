const { Prisma } = require('@prisma/client');
const prisma = require('../../config/prisma');
const AppError = require('../../utils/AppError');
const {
  acquireSlotLock,
  releaseSlotLock,
  getCached,
  setCached,
  invalidateCache,
  invalidatePattern,
} = require('../../config/redis');

const HOLD_DURATION_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Explicit Interactive Transaction Options:
 * - maxWait: Maximum time (ms) to wait to acquire a connection from the pool.
 * - timeout: Maximum execution duration (ms) before rolling back and releasing locks.
 */
const DEFAULT_TX_OPTIONS = {
  maxWait: 5000,
  timeout: 10000,
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
};

/**
 * Lazy cleanup helper:
 * Immediately marks any expired PENDING holds on a slot as EXPIRED.
 * This guarantees that expired holds do not block new bookings at the database level,
 * even if the background cron job has not executed yet.
 */
async function lazyExpireSlotHold(dbClient, slotId) {
  const now = new Date();
  await dbClient.booking.updateMany({
    where: {
      slotId,
      status: 'PENDING',
      expiresAt: { lte: now },
    },
    data: {
      status: 'EXPIRED',
    },
  });
}

/**
 * VERSION A (Naive, on purpose):
 * Demonstrates check-then-act race condition.
 */
async function createBookingNaive(userId, slotId) {
  const slot = await prisma.slot.findUnique({
    where: { id: slotId },
  });

  if (!slot) {
    throw new AppError('Slot not found.', 404);
  }

  const now = new Date();
  await lazyExpireSlotHold(prisma, slotId);

  const existingActiveBooking = await prisma.booking.findFirst({
    where: {
      slotId,
      OR: [{ status: 'CONFIRMED' }, { status: 'PENDING', expiresAt: { gt: now } }],
    },
  });

  if (existingActiveBooking) {
    throw new AppError('This slot has already been booked.', 409);
  }

  const booking = await prisma.booking.create({
    data: {
      slotId,
      userId,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + HOLD_DURATION_MS),
    },
    include: {
      slot: {
        include: { doctor: true },
      },
    },
  });

  const doctorId = booking.slot?.doctorId;
  await Promise.all([
    invalidateCache(`user_bookings:${userId}`),
    doctorId ? invalidatePattern(`slots:${doctorId}:*`) : invalidatePattern('slots:*'),
  ]);

  return booking;
}

/**
 * VERSION B (Constraint-based protection):
 * Enforces single active booking via PostgreSQL partial unique index:
 * UNIQUE (slotId) WHERE status IN ('PENDING', 'CONFIRMED').
 * Performs lazy expiration first so expired holds never cause false-positive conflicts.
 */
async function createBooking(userId, slotId) {
  // 1. High-speed Redis Distributed Lock check (intercept collisions before hitting PostgreSQL)
  const lockAcquired = await acquireSlotLock(slotId, userId, 600);
  if (!lockAcquired) {
    throw new AppError('This slot has already been booked.', 409);
  }

  try {
    // Parallelize slot verification and lazy-expiration of stale holds (saves 1 roundtrip)
    const [slot] = await Promise.all([
      prisma.slot.findUnique({
        where: { id: slotId },
        select: { id: true },
      }),
      lazyExpireSlotHold(prisma, slotId),
    ]);

    if (!slot) {
      await releaseSlotLock(slotId, userId);
      throw new AppError('Slot not found.', 404);
    }

    // Atomically attempt insertion. The database-level partial unique index:
    // UNIQUE (slotId) WHERE status IN ('PENDING', 'CONFIRMED')
    // acts as the definitive concurrency boundary, throwing P2002 on collision.
    const booking = await prisma.booking.create({
      data: {
        slotId,
        userId,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + HOLD_DURATION_MS),
      },
      include: {
        slot: {
          include: { doctor: true },
        },
      },
    });

    await Promise.all([
      invalidateCache(`user_bookings:${userId}`),
      invalidatePattern('slots:*'),
    ]);

    return booking;
  } catch (error) {
    await releaseSlotLock(slotId, userId);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError('This slot has already been booked.', 409);
    }
    throw error;
  }
}

/**
 * VERSION C (Pessimistic Locking):
 * Acquires exclusive row lock with SELECT ... FOR UPDATE within a transaction.
 */
async function createBookingWithLock(userId, slotId) {
  return prisma.$transaction(
    async (tx) => {
      const lockedSlots = await tx.$queryRaw`
        SELECT * FROM "Slot" WHERE id = ${slotId} FOR UPDATE
      `;

      if (!lockedSlots || lockedSlots.length === 0) {
        throw new AppError('Slot not found.', 404);
      }

      const now = new Date();
      await lazyExpireSlotHold(tx, slotId);

      const existingActive = await tx.booking.findFirst({
        where: {
          slotId,
          OR: [{ status: 'CONFIRMED' }, { status: 'PENDING', expiresAt: { gt: now } }],
        },
      });

      if (existingActive) {
        throw new AppError('This slot has already been booked.', 409);
      }

      const booking = await tx.booking.create({
        data: {
          slotId,
          userId,
          status: 'PENDING',
          expiresAt: new Date(Date.now() + HOLD_DURATION_MS),
        },
        include: {
          slot: {
            include: { doctor: true },
          },
        },
      });

      return booking;
    },
    DEFAULT_TX_OPTIONS
  );

  const doctorId = booking.slot?.doctorId;
  await Promise.all([
    invalidateCache(`user_bookings:${userId}`),
    doctorId ? invalidatePattern(`slots:${doctorId}:*`) : invalidatePattern('slots:*'),
  ]);

  return booking;
}

/**
 * VERSION D (Optimistic Locking):
 * Atomic compare-and-swap on Slot version column.
 */
async function createBookingOptimistic(userId, slotId) {
  const slot = await prisma.slot.findUnique({
    where: { id: slotId },
  });

  if (!slot) {
    throw new AppError('Slot not found.', 404);
  }

  const now = new Date();
  await lazyExpireSlotHold(prisma, slotId);

  const existingActive = await prisma.booking.findFirst({
    where: {
      slotId,
      OR: [{ status: 'CONFIRMED' }, { status: 'PENDING', expiresAt: { gt: now } }],
    },
  });

  if (existingActive) {
    throw new AppError('This slot has already been booked.', 409);
  }

  const booking = await prisma.$transaction(async (tx) => {
    const updateResult = await tx.slot.updateMany({
      where: {
        id: slotId,
        version: slot.version,
      },
      data: {
        version: { increment: 1 },
      },
    });

    if (updateResult.count === 0) {
      throw new AppError('This slot has already been booked.', 409);
    }

    const created = await tx.booking.create({
      data: {
        slotId,
        userId,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + HOLD_DURATION_MS),
      },
      include: {
        slot: {
          include: { doctor: true },
        },
      },
    });

    return created;
  }, DEFAULT_TX_OPTIONS);

  const doctorId = booking.slot?.doctorId;
  await Promise.all([
    invalidateCache(`user_bookings:${userId}`),
    doctorId ? invalidatePattern(`slots:${doctorId}:*`) : invalidatePattern('slots:*'),
  ]);

  return booking;
}

/**
 * Confirm a PENDING booking before expiresAt
 */
async function confirmBooking(userId, userRole, bookingId) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      slot: {
        include: { doctor: true },
      },
    },
  });

  if (!booking) {
    throw new AppError('Booking not found.', 404);
  }

  if (userRole !== 'ADMIN' && booking.userId !== userId) {
    throw new AppError('Forbidden: You can only confirm your own bookings.', 403);
  }

  if (booking.status === 'CONFIRMED') {
    return booking;
  }

  if (booking.status === 'CANCELLED') {
    throw new AppError('Cannot confirm a cancelled booking.', 400);
  }

  const now = new Date();
  if (booking.status === 'EXPIRED' || (booking.expiresAt && now > booking.expiresAt)) {
    // Lazily ensure status is marked EXPIRED in the database
    if (booking.status !== 'EXPIRED') {
      await prisma.booking.update({
        where: { id: bookingId },
        data: { status: 'EXPIRED' },
      });
    }
    throw new AppError('Booking hold has expired. Please book a new slot.', 400);
  }

  const confirmedBooking = await prisma.booking.update({
    where: { id: bookingId },
    data: {
      status: 'CONFIRMED',
      expiresAt: null,
    },
    include: {
      slot: {
        include: { doctor: true },
      },
    },
  });

  const doctorId = confirmedBooking.slot?.doctorId;
  await Promise.all([
    invalidateCache(`user_bookings:${confirmedBooking.userId}`),
    doctorId ? invalidatePattern(`slots:${doctorId}:*`) : invalidatePattern('slots:*'),
  ]);

  return confirmedBooking;
}

/**
 * Cancel a booking
 */
async function cancelBooking(userId, userRole, bookingId) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { slot: true },
  });

  if (!booking) {
    throw new AppError('Booking not found.', 404);
  }

  if (userRole !== 'ADMIN' && booking.userId !== userId) {
    throw new AppError('Forbidden: You can only cancel your own bookings.', 403);
  }

  if (booking.status === 'CANCELLED') {
    throw new AppError('This booking is already cancelled.', 400);
  }

  const updatedBooking = await prisma.booking.update({
    where: { id: bookingId },
    data: { status: 'CANCELLED', expiresAt: null },
    include: {
      slot: {
        include: { doctor: true },
      },
    },
  });

  // Release Redis lock so slot is free instantly
  if (booking.slotId) {
    await releaseSlotLock(booking.slotId, booking.userId);
  }

  const cancelDoctorId = updatedBooking.slot?.doctorId;
  await Promise.all([
    invalidateCache(`user_bookings:${booking.userId}`),
    cancelDoctorId ? invalidatePattern(`slots:${cancelDoctorId}:*`) : invalidatePattern('slots:*'),
  ]);

  return updatedBooking;
}

/**
 * Reschedule Flow with Deadlock Prevention
 */
async function rescheduleBooking(userId, userRole, bookingId, newSlotId) {
  const newBooking = await prisma.$transaction(
    async (tx) => {
      const currentBooking = await tx.booking.findUnique({
        where: { id: bookingId },
      });

      if (!currentBooking) {
        throw new AppError('Booking not found.', 404);
      }

      if (userRole !== 'ADMIN' && currentBooking.userId !== userId) {
        throw new AppError('Forbidden: You can only reschedule your own bookings.', 403);
      }

      if (currentBooking.status === 'CANCELLED') {
        throw new AppError('Cannot reschedule a cancelled booking.', 400);
      }

      const oldSlotId = currentBooking.slotId;
      if (oldSlotId === newSlotId) {
        throw new AppError('Cannot reschedule to the exact same slot.', 400);
      }

      // Lock both slots in strict lexicographical order to prevent deadlocks
      const [firstSlotId, secondSlotId] = [oldSlotId, newSlotId].sort();

      await tx.$queryRaw`
        SELECT * FROM "Slot" WHERE id = ${firstSlotId} FOR UPDATE
      `;
      await tx.$queryRaw`
        SELECT * FROM "Slot" WHERE id = ${secondSlotId} FOR UPDATE
      `;

      const newSlot = await tx.slot.findUnique({
        where: { id: newSlotId },
      });

      if (!newSlot) {
        throw new AppError('Target reschedule slot not found.', 404);
      }

      const now = new Date();
      await lazyExpireSlotHold(tx, newSlotId);

      const activeOnNew = await tx.booking.findFirst({
        where: {
          slotId: newSlotId,
          OR: [{ status: 'CONFIRMED' }, { status: 'PENDING', expiresAt: { gt: now } }],
        },
      });

      if (activeOnNew) {
        throw new AppError('The requested new slot is not available.', 409);
      }

      // Atomically cancel old booking and create new confirmed booking
      await tx.booking.update({
        where: { id: bookingId },
        data: { status: 'CANCELLED', expiresAt: null },
      });

      const createdBooking = await tx.booking.create({
        data: {
          slotId: newSlotId,
          userId: currentBooking.userId,
          status: 'CONFIRMED',
          expiresAt: null,
        },
        include: {
          slot: {
            include: { doctor: true },
          },
        },
      });

      return createdBooking;
    },
    DEFAULT_TX_OPTIONS
  );

  const rescheduleDoctorId = newBooking.slot?.doctorId;
  await Promise.all([
    invalidateCache(`user_bookings:${newBooking.userId}`),
    rescheduleDoctorId ? invalidatePattern(`slots:${rescheduleDoctorId}:*`) : invalidatePattern('slots:*'),
  ]);

  return newBooking;
}

/**
 * Get all bookings belonging to the authenticated patient
 */
async function getMyBookings(userId) {
  const cacheKey = `user_bookings:${userId}`;
  const cached = await getCached(cacheKey);
  if (cached) {
    return typeof cached === 'string' ? JSON.parse(cached) : cached;
  }

  const bookings = await prisma.booking.findMany({
    where: { userId },
    include: {
      slot: {
        include: { doctor: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  await setCached(cacheKey, bookings, 120);
  return bookings;
}

module.exports = {
  createBookingNaive,
  createBooking,
  createBookingWithLock,
  createBookingOptimistic,
  confirmBooking,
  cancelBooking,
  rescheduleBooking,
  getMyBookings,
};
