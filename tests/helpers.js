const prisma = require('../src/config/prisma');

async function cleanDatabase() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Booking", "Slot", "Doctor", "User" RESTART IDENTITY CASCADE;'
  );
}

module.exports = {
  cleanDatabase,
};
