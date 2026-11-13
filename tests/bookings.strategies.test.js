process.env.NODE_ENV = 'test';
process.env.TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://postgres:password@localhost:5432/mawid_test?schema=public';

const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/config/prisma');
const { cleanDatabase } = require('./helpers');

describe('Concurrency Strategies Benchmark (B vs C vs D)', () => {
  let adminToken;
  let doctor;
  let patientTokens = [];
  const benchmarkResults = [];

  beforeAll(async () => {
    await cleanDatabase();

    // 1. Admin
    const adminRes = await request(app).post('/auth/register').send({
      name: 'Strategy Admin',
      email: 'strategy.admin@clinic.com',
      password: 'password123',
      role: 'ADMIN',
    });
    adminToken = adminRes.body.data.token;

    // 2. Doctor
    const docRes = await request(app)
      .post('/doctors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Dr. Concurrency Specialist', specialty: 'Distributed Systems' });
    doctor = docRes.body.data.doctor;

    // 3. Register 50 patients
    const patientPromises = Array.from({ length: 50 }, (_, i) =>
      request(app)
        .post('/auth/register')
        .send({
          name: `Bench Patient ${i + 1}`,
          email: `bench_patient${i + 1}@clinic.com`,
          password: 'password123',
        })
    );
    const registered = await Promise.all(patientPromises);
    patientTokens = registered.map((res) => res.body.data.token);
  }, 40000);

  afterAll(async () => {
    await prisma.$disconnect();

    // Print summary comparison table
    console.log(
      '\n========================================================================================'
    );
    console.log(
      '                          CONCURRENCY STRATEGIES BENCHMARK RESULTS                       '
    );
    console.log(
      '========================================================================================'
    );
    console.log(
      '| Strategy                | Correctness | 201s (Success) | 409s (Conflict) | 500s | Total Time |'
    );
    console.log(
      '|-------------------------|-------------|----------------|-----------------|------|------------|'
    );
    benchmarkResults.forEach((r) => {
      const name = r.strategy.padEnd(23, ' ');
      const correct = r.correct ? 'YES (1 active)' : 'FAILED        ';
      const s201 = `${r.status201}`.padEnd(14, ' ');
      const s409 = `${r.status409}`.padEnd(15, ' ');
      const s500 = `${r.status500}`.padEnd(4, ' ');
      const time = `${r.totalTimeMs} ms`.padEnd(10, ' ');
      console.log(`| ${name} | ${correct} | ${s201} | ${s409} | ${s500} | ${time} |`);
    });
    console.log(
      '========================================================================================\n'
    );
  });

  async function runStrategyBenchmark(strategyName, strategyQuery) {
    // Create dedicated slot for this test
    const startTime = new Date(Date.now() + Math.random() * 10000000);
    const endTime = new Date(startTime.getTime() + 30 * 60 * 1000);

    const slot = await prisma.slot.create({
      data: {
        doctorId: doctor.id,
        startsAt: startTime,
        endsAt: endTime,
      },
    });

    const t0 = Date.now();

    // Fire 50 simultaneous requests
    const requests = patientTokens.map((token) =>
      request(app)
        .post(`/bookings?strategy=${strategyQuery}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ slotId: slot.id })
    );

    const outcomes = await Promise.allSettled(requests);
    const totalTimeMs = Date.now() - t0;

    let status201 = 0;
    let status409 = 0;
    let status500 = 0;

    outcomes.forEach((o) => {
      if (o.status === 'fulfilled') {
        const code = o.value.status;
        if (code === 201) status201++;
        else if (code === 409) status409++;
        else if (code >= 500) status500++;
      } else {
        status500++;
      }
    });

    const activeInDb = await prisma.booking.count({
      where: {
        slotId: slot.id,
        status: { in: ['PENDING', 'CONFIRMED'] },
      },
    });

    const isCorrect = activeInDb === 1 && status201 === 1;

    benchmarkResults.push({
      strategy: strategyName,
      correct: isCorrect,
      status201,
      status409,
      status500,
      totalTimeMs,
    });

    expect(isCorrect).toBe(true);
    expect(status201).toBe(1);
    expect(status409).toBe(49);
    expect(status500).toBe(0);
  }

  it('Strategy B: Partial Unique Index (Constraint-based)', async () => {
    await runStrategyBenchmark('B: Partial Unique Index', 'constraint');
  });

  it('Strategy C: Pessimistic Locking (SELECT ... FOR UPDATE)', async () => {
    await runStrategyBenchmark('C: Pessimistic (FOR UPDATE)', 'pessimistic');
  });

  it('Strategy D: Optimistic Locking (Version Column)', async () => {
    await runStrategyBenchmark('D: Optimistic (Version)', 'optimistic');
  });
});
