const path = require('path');
const dotenv = require('dotenv');

// 1. Force load .env.test before anything else
dotenv.config({ path: path.resolve(__dirname, '../.env.test'), override: true });

// 2. Safety Guard: Never run tests against a remote / cloud database (especially Neon)
const dbUrl = process.env.DATABASE_URL || '';
const directUrl = process.env.DIRECT_URL || '';

function validateTestDatabaseUrl(url, envVarName) {
  if (!url) return;

  if (url.includes('neon.tech')) {
    const errorMsg = `\n🚨 [SAFETY GUARD ERROR] ${envVarName} is pointing to a Neon Cloud database:\n"${url}"\n` +
      `Tests are strictly forbidden from running against cloud / remote databases to protect production data and avoid false latency results.\n` +
      `Aborting test suite immediately!\n`;
    console.error(errorMsg);
    throw new Error(errorMsg);
  }

  const allowedLocalHosts = ['localhost', '127.0.0.1', '::1', 'db-test', 'postgres'];
  const isLocal = allowedLocalHosts.some((host) => url.includes(host));

  if (!isLocal) {
    const errorMsg = `\n🚨 [SAFETY GUARD ERROR] ${envVarName} ("${url}") is not a local database!\n` +
      `Tests must run strictly against local Docker Postgres (e.g. localhost:5433).\n` +
      `Aborting test suite immediately!\n`;
    console.error(errorMsg);
    throw new Error(errorMsg);
  }
}

validateTestDatabaseUrl(dbUrl, 'DATABASE_URL');
validateTestDatabaseUrl(directUrl, 'DIRECT_URL');
