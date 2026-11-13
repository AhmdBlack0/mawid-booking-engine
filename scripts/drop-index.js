const { Client } = require('pg');

async function main() {
  for (const db of ['mawid_dev', 'mawid_test']) {
    const client = new Client({
      connectionString: `postgresql://postgres:password@localhost:5432/${db}`,
    });
    await client.connect();
    await client.query('DROP INDEX IF EXISTS "unique_active_booking_per_slot";');
    console.log(`Dropped partial index from ${db}`);
    await client.end();
  }
}

main().catch(console.error);
