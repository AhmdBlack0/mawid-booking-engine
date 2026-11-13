const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5433/mawid_test',
  });

  await client.connect();

  const query = `
    EXPLAIN
    UPDATE "Booking"
    SET status = 'EXPIRED'
    WHERE "slotId" = '00000000-0000-0000-0000-000000000000'
      AND status = 'PENDING'
      AND "expiresAt" <= NOW();
  `;

  const res = await client.query(query);
  console.log('--- EXPLAIN Query Plan for Per-Slot Expired-Hold Cleanup ---');
  res.rows.forEach((r) => console.log(r['QUERY PLAN']));

  const cronQuery = `
    EXPLAIN
    UPDATE "Booking"
    SET status = 'EXPIRED'
    WHERE status = 'PENDING'
      AND "expiresAt" <= NOW();
  `;

  const resCron = await client.query(cronQuery);
  console.log('\n--- EXPLAIN Query Plan for Global Cron Sweep ---');
  resCron.rows.forEach((r) => console.log(r['QUERY PLAN']));

  await client.end();
}

main().catch(console.error);
