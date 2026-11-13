const path = require('path');
const EmbeddedPostgres = require('embedded-postgres').default;
const { Client } = require('pg');

async function startDb(options = {}) {
  const port = options.port || parseInt(process.env.DB_PORT, 10) || 5432;
  const isTestPort = port === 5433;
  const dataDir = path.resolve(
    __dirname,
    isTestPort ? '../.postgres-data-test' : '../.postgres-data'
  );

  const pg = new EmbeddedPostgres({
    port,
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    persistent: true,
  });

  try {
    await pg.initialise();
  } catch {
    // Cluster already initialized
  }

  await pg.start();
  console.log(`PostgreSQL is running on port ${port}.`);

  const client = new Client({
    connectionString: `postgresql://postgres:postgres@localhost:${port}/postgres`,
  });

  try {
    await client.connect();
    const dbsToCreate = isTestPort ? ['mawid_test'] : ['mawid_dev', 'mawid_test'];
    for (const db of dbsToCreate) {
      const res = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
        db,
      ]);
      if (res.rows.length === 0) {
        await client.query(`CREATE DATABASE ${db};`);
        console.log(`Created database "${db}".`);
      }
    }
  } finally {
    await client.end();
  }

  return pg;
}

if (require.main === module) {
  startDb().catch((err) => {
    console.error('Failed to start PostgreSQL:', err);
    process.exit(1);
  });
}

module.exports = startDb;
