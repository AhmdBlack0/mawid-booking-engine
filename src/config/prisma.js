const { PrismaClient } = require('@prisma/client');
const env = require('./env');

// Global object cache pattern to prevent connection pool exhaustion
let prisma;

if (process.env.NODE_ENV === 'production') {
  prisma = new PrismaClient();
} else {
  if (!global.__prisma) {
    global.__prisma = new PrismaClient({
      log: process.env.DEBUG_PRISMA === 'true' ? ['query', 'warn', 'error'] : ['warn', 'error'],
    });
  }
  prisma = global.__prisma;
}

module.exports = prisma;
