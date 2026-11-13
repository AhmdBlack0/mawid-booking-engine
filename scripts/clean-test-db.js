const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: 'postgresql://postgres:password@localhost:5432/mawid_test',
  });
  await client.connect();
  await client.query('TRUNCATE "Booking", "Slot", "Doctor", "User" CASCADE;');
  await client.query(
    "DELETE FROM _prisma_migrations WHERE migration_name LIKE '%add_partial_unique_index%';"
  );
  console.log('Cleaned test db and reset failed migration record');
  await client.end();
}

main().catch(console.error);
