const bcrypt = require('bcrypt');
const prisma = require('../../config/prisma');
const { signToken } = require('../../utils/jwt');
const AppError = require('../../utils/AppError');

const SALT_ROUNDS = 10; // Optimized: OWASP standard, 4x faster CPU processing than 12 rounds

async function register({ name, email, password, role }) {
  const existingUser = await prisma.user.findUnique({
    where: { email },
  });

  if (existingUser) {
    throw new AppError('A user with this email address already exists.', 409);
  }

  const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

  const user = await prisma.user.create({
    data: {
      name,
      email,
      password: hashedPassword,
      role: role || 'PATIENT',
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
    },
  });

  const token = signToken({ id: user.id, email: user.email, role: user.role });

  return { user, token };
}

async function login({ email, password }) {
  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    throw new AppError('Invalid email or password.', 401);
  }

  const isPasswordValid = await bcrypt.compare(password, user.password);
  if (!isPasswordValid) {
    throw new AppError('Invalid email or password.', 401);
  }

  const token = signToken({ id: user.id, email: user.email, role: user.role });

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
    },
    token,
  };
}

module.exports = {
  register,
  login,
};
