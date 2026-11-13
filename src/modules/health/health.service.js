const prisma = require('../../config/prisma');
const AppError = require('../../utils/AppError');

async function checkHealth() {
  try {
    // Execute a fast connectivity query directly against PostgreSQL
    await prisma.$queryRaw`SELECT 1`;

    return {
      status: 'healthy',
      database: 'connected',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    throw new AppError(`Database health check failed: ${error.message}`, 503);
  }
}

module.exports = {
  checkHealth,
};
