const path = require('path');
const net = require('net');
const { execSync } = require('child_process');
const dotenv = require('dotenv');
const { Client } = require('pg');
const startDb = require('../scripts/start-db');

// 1. Force load .env.test
dotenv.config({ path: path.resolve(__dirname, '../.env.test'), override: true });

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

module.exports = async function globalSetup() {
  const dbUrl = process.env.DATABASE_URL || '';
  const directUrl = process.env.DIRECT_URL || '';

  // 2. Safety Guard against cloud databases
  if (dbUrl.includes('neon.tech') || directUrl.includes('neon.tech')) {
    throw new Error(
      '🚨 [FATAL SAFETY GUARD] DATABASE_URL or DIRECT_URL is pointing to Neon Cloud!\n' +
      'Tests are strictly forbidden from running against cloud databases. Aborting immediately.'
    );
  }

  const allowedLocalHosts = ['localhost', '127.0.0.1', '::1', 'db-test', 'postgres'];
  const isLocal = allowedLocalHosts.some((h) => dbUrl.includes(h));
  if (!isLocal) {
    throw new Error(
      `🚨 [FATAL SAFETY GUARD] DATABASE_URL (${dbUrl}) is not a local host! Aborting immediately.`
    );
  }

  // 3. Ensure test database port is running
  // Parse port from DATABASE_URL (default 5433)
  const portMatch = dbUrl.match(/:(\d+)\//);
  const testPort = portMatch ? parseInt(portMatch[1], 10) : 5433;

  const isOpen = await isPortOpen(testPort);
  if (!isOpen) {
    console.log(`\n[Test Setup] Local test DB port ${testPort} not open. Starting local Postgres on port ${testPort}...`);
    await startDb({ port: testPort });
    console.log(`[Test Setup] Local Postgres on port ${testPort} started successfully.`);
  }

  // 4. Run prisma migrate deploy against test DB
  console.log('[Test Setup] Running prisma migrate deploy on test database...');
  execSync('npx prisma migrate deploy', {
    env: {
      ...process.env,
      DATABASE_URL: dbUrl,
      DIRECT_URL: directUrl || dbUrl,
    },
    stdio: 'inherit',
  });

  // 5. Assert that unique_active_booking_per_slot index exists
  const client = new Client({ connectionString: dbUrl });
  try {
    await client.connect();
    const res = await client.query(
      "SELECT indexname FROM pg_indexes WHERE tablename = 'Booking' AND indexname = 'unique_active_booking_per_slot';"
    );

    if (res.rows.length === 0) {
      throw new Error(
        '🚨 [FATAL TEST SETUP ERROR] Partial unique index "unique_active_booking_per_slot" was NOT found in the test database!'
      );
    }
    console.log('✅ [Test Setup] Verified: Partial unique index "unique_active_booking_per_slot" is active in test database.');
  } finally {
    await client.end();
  }
};
