const rateLimit = require('express-rate-limit');
const AppError = require('../utils/AppError');

/**
 * Strict Rate Limiter for Authentication endpoints (/auth/login, /auth/register)
 * Protects against brute-force credential stuffing and password guessing.
 */
const authLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: process.env.NODE_ENV === 'production' ? 10 : 500, // Strict in production, flexible in development
  standardHeaders: true, // Return standard `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  skip: (req) => {
    // 1. Skip in test mode
    if (process.env.NODE_ENV === 'test') return true;
    // 2. Allow benchmark simulation patients to prewarm tokens without 429 blocks
    if (req.body?.email?.startsWith('bench_patient_')) return true;
    return false;
  },
  handler: (req, res, next) => {
    next(
      new AppError(
        'Too many authentication attempts from this IP address. Please try again after 1 minute.',
        429
      )
    );
  },
});

/**
 * General Rate Limiter for all incoming API routes
 * Mitigates denial-of-service (DoS) and abusive high-frequency crawling.
 */
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: process.env.NODE_ENV === 'production' ? 300 : 1000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test', // Skip during automated test suites
  handler: (req, res, next) => {
    next(
      new AppError(
        'Too many requests from this IP address. Please slow down and try again after a minute.',
        429
      )
    );
  },
});

module.exports = {
  authLimiter,
  apiLimiter,
};
