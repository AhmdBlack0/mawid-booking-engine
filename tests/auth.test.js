process.env.NODE_ENV = 'test';
process.env.TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://postgres:password@localhost:5432/mawid_test?schema=public';

const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/config/prisma');
const { cleanDatabase } = require('./helpers');

describe('Auth Module Integration Tests', () => {
  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('POST /auth/register', () => {
    it('should register a new user as PATIENT by default', async () => {
      const res = await request(app).post('/auth/register').send({
        name: 'Sarah Connor',
        email: 'sarah@example.com',
        password: 'password123',
      });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data.user).toMatchObject({
        name: 'Sarah Connor',
        email: 'sarah@example.com',
        role: 'PATIENT',
      });
      expect(res.body.data.user.password).toBeUndefined();
      expect(typeof res.body.data.token).toBe('string');
    });

    it('should register an ADMIN when specified', async () => {
      const res = await request(app).post('/auth/register').send({
        name: 'Clinic Admin',
        email: 'admin@clinic.com',
        password: 'adminpassword123',
        role: 'ADMIN',
      });

      expect(res.status).toBe(201);
      expect(res.body.data.user.role).toBe('ADMIN');
    });

    it('should reject registration when email is already registered', async () => {
      await request(app).post('/auth/register').send({
        name: 'Original User',
        email: 'duplicate@example.com',
        password: 'password123',
      });

      const res = await request(app).post('/auth/register').send({
        name: 'Second User',
        email: 'duplicate@example.com',
        password: 'password456',
      });

      expect(res.status).toBe(409);
      expect(res.body.status).toBe('fail');
      expect(res.body.message).toMatch(/already exists/i);
    });

    it('should fail with 400 when body does not pass Zod schema validation', async () => {
      const res = await request(app).post('/auth/register').send({
        name: 'J',
        email: 'not-an-email',
        password: '123',
      });

      expect(res.status).toBe(400);
      expect(res.body.status).toBe('fail');
      expect(res.body.message).toBe('Validation failed');
      expect(Array.isArray(res.body.details)).toBe(true);
    });
  });

  describe('POST /auth/login', () => {
    beforeEach(async () => {
      await request(app).post('/auth/register').send({
        name: 'John Doe',
        email: 'john@example.com',
        password: 'correctpassword',
      });
    });

    it('should log in successfully with valid credentials and return a JWT', async () => {
      const res = await request(app).post('/auth/login').send({
        email: 'john@example.com',
        password: 'correctpassword',
      });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.user.email).toBe('john@example.com');
      expect(res.body.data.token).toBeDefined();
    });

    it('should return 401 when given an incorrect password', async () => {
      const res = await request(app).post('/auth/login').send({
        email: 'john@example.com',
        password: 'wrongpassword',
      });

      expect(res.status).toBe(401);
      expect(res.body.status).toBe('fail');
      expect(res.body.message).toMatch(/invalid email or password/i);
    });

    it('should return 401 when given a non-existent email', async () => {
      const res = await request(app).post('/auth/login').send({
        email: 'nobody@example.com',
        password: 'correctpassword',
      });

      expect(res.status).toBe(401);
      expect(res.body.status).toBe('fail');
    });
  });
});
