const logger = require('../config/logger');

function requestLogger(req, res, next) {
  if (process.env.NODE_ENV === 'test') return next();

  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logPayload = {
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      durationMs: duration,
      ip: req.ip || req.socket?.remoteAddress,
    };

    if (res.statusCode >= 500) {
      logger.error(logPayload, `${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`);
    } else if (res.statusCode >= 400) {
      logger.warn(logPayload, `${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`);
    } else {
      logger.info(logPayload, `${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`);
    }
  });

  next();
}

module.exports = requestLogger;
