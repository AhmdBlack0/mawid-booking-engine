const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const healthRoutes = require('./modules/health/health.routes');
const authRoutes = require('./modules/auth/auth.routes');
const doctorsRoutes = require('./modules/doctors/doctors.routes');
const bookingsRoutes = require('./modules/bookings/bookings.routes');
const errorHandler = require('./middlewares/errorHandler');
const requestLogger = require('./middlewares/requestLogger');
const { authLimiter, apiLimiter } = require('./middlewares/rateLimiter');
const AppError = require('./utils/AppError');

const app = express();

// 1. HTTP Security Headers (Helmet: XSS, Clickjacking, Sniffing prevention)
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// 2. High-performance gzip response compression
app.use(compression());

// 3. Enable CORS with 24-hour preflight OPTIONS caching
app.use(
  cors({
    origin: true,
    credentials: true,
    maxAge: 86400, // 24 hours: avoids redundant OPTIONS requests
  })
);

// 4. Structured HTTP Request Logging (Pino)
app.use(requestLogger);

// 5. General Rate Limiter for all incoming endpoints (DoS protection)
app.use(apiLimiter);

// 6. Parse JSON request bodies
app.use(express.json());

// 7. Mount API routes (with strict Auth Rate Limiter on /auth)
app.use('/health', healthRoutes);
app.use('/auth', authLimiter, authRoutes);
app.use('/doctors', doctorsRoutes);
app.use('/bookings', bookingsRoutes);

// Catch-all for undefined routes
app.use((req, res, next) => {
  next(new AppError(`Cannot find ${req.method} ${req.originalUrl} on this server`, 404));
});

// Centralized error handling middleware
app.use(errorHandler);

module.exports = app;
