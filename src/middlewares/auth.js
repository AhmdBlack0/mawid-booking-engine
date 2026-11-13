const { verifyToken } = require('../utils/jwt');
const prisma = require('../config/prisma');
const AppError = require('../utils/AppError');
const { getCached, setCached } = require('../config/redis');

async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next(
        new AppError('Authentication required. Please provide a valid Bearer token.', 401)
      );
    }

    const token = authHeader.split(' ')[1];
    let decoded;
    try {
      decoded = verifyToken(token);
    } catch {
      return next(new AppError('Invalid or expired authentication token.', 401));
    }

    const cacheKey = `user:${decoded.id}`;
    const cachedUser = await getCached(cacheKey);
    if (cachedUser) {
      req.user = typeof cachedUser === 'string' ? JSON.parse(cachedUser) : cachedUser;
      return next();
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: { id: true, email: true, name: true, role: true },
    });

    if (!user) {
      return next(
        new AppError('The user belonging to this token no longer exists.', 401)
      );
    }

    await setCached(cacheKey, user, 300); // 5 minutes TTL

    req.user = user;
    return next();
  } catch (error) {
    return next(error);
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AppError('Authentication required.', 401));
    }

    if (!roles.includes(req.user.role)) {
      return next(
        new AppError(
          'Forbidden: You do not have permission to access this resource.',
          403
        )
      );
    }

    return next();
  };
}

module.exports = {
  authenticate,
  requireRole,
};
