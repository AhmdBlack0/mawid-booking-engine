const path = require('path');
const dotenv = require('dotenv');
const { z } = require('zod');

// Load environment variables (.env.test strictly in test environment, else .env)
if (process.env.NODE_ENV === 'test') {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.test'), override: true });
} else {
  dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: true });
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DIRECT_URL: z.string().optional(),
  TEST_DATABASE_URL: z.string().optional(),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('24h'),
  UPSTASH_REDIS_REST_URL: z.string().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  parsed.error.issues.forEach((issue) => {
    console.error(` - ${issue.path.join('.')}: ${issue.message}`);
  });
  process.exit(1);
}

const env = parsed.data;

module.exports = env;
