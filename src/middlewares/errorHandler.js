const { ZodError } = require('zod');
const { Prisma } = require('@prisma/client');
const env = require('../config/env');
const AppError = require('../utils/AppError');
const logger = require('../config/logger');

/**
 * Global Error-Handling Middleware
 * Express recognizes this as an error handler because of the 4 arguments (err, req, res, next).
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let error = err;

  // Normalize Zod validation errors to AppError
  if (err instanceof ZodError) {
    const formattedDetails = err.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));
    error = new AppError('Validation failed', 400, formattedDetails);
  }

  // Normalize Prisma known request errors
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const target = err.meta?.target ? ` (${err.meta.target})` : '';
      error = new AppError(`A conflict occurred with unique field${target}`, 409);
    } else if (err.code === 'P2025') {
      error = new AppError('Record not found', 404);
    }
  }

  const statusCode = error.statusCode || 500;
  const status = error.status || 'error';
  const isOperational = error.isOperational || false;

  // In production, do not leak unknown non-operational error messages to clients
  const message =
    isOperational || env.NODE_ENV !== 'production'
      ? error.message
      : 'Internal server error';

  const response = {
    status,
    message,
    ...(error.details && { details: error.details }),
    ...(env.NODE_ENV === 'development' && { stack: error.stack }),
  };

  if (!isOperational && env.NODE_ENV !== 'test') {
    logger.error({ err }, '💥 UNHANDLED ERROR');
  }

  res.status(statusCode).json(response);
}

module.exports = errorHandler;
