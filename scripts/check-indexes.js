const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/mawid_dev',
  });
  await client.connect();
  const resBooking = await client.query("SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'Booking';");
  console.log('--- Booking Table Indexes ---');
  console.log(JSON.stringify(resBooking.rows, null, 2));

  const resUser = await client.query("SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'User';");
  console.log('\n--- User Table Indexes ---');
  console.log(JSON.stringify(resUser.rows, null, 2));
  await client.end();
}

main().catch(console.error);
