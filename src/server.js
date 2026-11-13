const net = require('net');
const app = require('./app');
const env = require('./config/env');
const prisma = require('./config/prisma');
const logger = require('./config/logger');
const { startExpiryJob, stopExpiryJob } = require('./jobs/expiryJob');

function isPortOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1000);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      resolve(false);
    });
    socket.connect(port, host);
  });
}

let server;

async function bootstrap() {
  if (env.NODE_ENV !== 'production') {
    const isLocalhost =
      env.DATABASE_URL.includes('localhost') ||
      env.DATABASE_URL.includes('127.0.0.1');

    if (isLocalhost) {
      const isDbOpen = await isPortOpen(5432);
      if (!isDbOpen) {
        logger.info('⚡ PostgreSQL is not running on port 5432. Auto-starting local database...');
        try {
          const startDb = require('../scripts/start-db');
          await startDb();
          logger.info('✅ Local PostgreSQL started successfully on port 5432.');
        } catch (err) {
          logger.warn({ err: err.message }, '⚠️ Could not auto-start embedded PostgreSQL');
        }
      }
    }
  }

  server = app.listen(env.PORT, () => {
    logger.info(
      `🚀 Server listening on http://localhost:${env.PORT} in ${env.NODE_ENV} mode`
    );

    // Start background cron job to sweep expired booking holds
    startExpiryJob();
    logger.info('⏰ Expiry sweep cron job scheduled (every minute).');
  });
}

bootstrap().catch((err) => {
  logger.fatal({ err }, 'Fatal startup error');
  process.exit(1);
});

// Graceful shutdown helper
async function shutdown(signal) {
  logger.info(`Received ${signal}. Shutting down gracefully...`);

  // Stop cron runner
  stopExpiryJob();

  server.close(async () => {
    logger.info('HTTP server closed.');
    try {
      await prisma.$disconnect();
      logger.info('Database connection pool disconnected.');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during database disconnect');
      process.exit(1);
    }
  });

  // Force close after 10s if graceful shutdown hangs
  setTimeout(() => {
    logger.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
