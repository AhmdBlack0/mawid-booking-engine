const cron = require('node-cron');
const prisma = require('../config/prisma');
const logger = require('../config/logger');
const { invalidatePattern } = require('../config/redis');

let scheduledTask = null;

/**
 * Sweep expired PENDING bookings and mark them as EXPIRED.
 * This runs periodically in the background.
 */
async function sweepExpiredBookings() {
  try {
    const now = new Date();
    const result = await prisma.booking.updateMany({
      where: {
        status: 'PENDING',
        expiresAt: {
          lte: now,
        },
      },
      data: {
        status: 'EXPIRED',
      },
    });

    if (result.count > 0) {
      if (process.env.NODE_ENV !== 'test') {
        logger.info(
          { count: result.count },
          `[ExpiryJob] Swept and marked ${result.count} expired booking holds as EXPIRED`
        );
      }
      await invalidatePattern('slots:*');
    }

    return result.count;
  } catch (error) {
    if (error.code === 'P2024' || error.code === 'P1001') {
      logger.warn({ code: error.code }, `[ExpiryJob] Database pool busy or reconnecting. Will retry next cycle.`);
    } else {
      logger.error({ error }, '[ExpiryJob] Error sweeping expired bookings');
    }
    return 0;
  }
}

/**
 * Start the background cron job (runs every minute: "* * * * *")
 */
function startExpiryJob() {
  if (scheduledTask) return scheduledTask;

  // Run every minute
  scheduledTask = cron.schedule('* * * * *', async () => {
    await sweepExpiredBookings();
  });

  return scheduledTask;
}

/**
 * Stop the background cron job
 */
function stopExpiryJob() {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
  }
}

module.exports = {
  sweepExpiredBookings,
  startExpiryJob,
  stopExpiryJob,
};
