process.env.NODE_ENV = 'test';
process.env.TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://postgres:password@localhost:5432/mawid_test?schema=public';

const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/config/prisma');

describe('GET /health', () => {
  afterAll(async () => {
    // Close the Prisma connection pool to allow Jest to exit cleanly
    await prisma.$disconnect();
  });

  it('should return 200 and healthy database status against the test database', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'success');
    expect(res.body.data).toMatchObject({
      status: 'healthy',
      database: 'connected',
    });
    expect(res.body.data.timestamp).toBeDefined();
    expect(typeof res.body.data.uptime).toBe('number');
  });

  it('should return 404 for an unknown endpoint with standard error shape', async () => {
    const res = await request(app).get('/api/unknown-route');

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      status: 'fail',
      message: 'Cannot find GET /api/unknown-route on this server',
    });
  });
});
