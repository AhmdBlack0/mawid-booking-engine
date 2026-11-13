const { z } = require('zod');

const createDoctorSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters long'),
  specialty: z.string().trim().min(2, 'Specialty must be at least 2 characters long'),
});

const createSlotsSchema = z
  .object({
    startDate: z
      .string()
      .datetime({ message: 'startDate must be a valid ISO-8601 datetime string' }),
    endDate: z
      .string()
      .datetime({ message: 'endDate must be a valid ISO-8601 datetime string' }),
    durationMinutes: z.coerce.number().int().min(5).max(480).default(30),
  })
  .refine((data) => new Date(data.endDate) > new Date(data.startDate), {
    message: 'endDate must be chronologically after startDate',
    path: ['endDate'],
  });

const getSlotsQuerySchema = z.object({
  date: z
    .string()
    .regex(
      /^\d{4}-\d{2}-\d{2}$/,
      'Date query parameter is required and must be in YYYY-MM-DD format'
    ),
  all: z.enum(['true', 'false']).optional(),
  includeBooked: z.enum(['true', 'false']).optional(),
});

const doctorIdParamSchema = z.object({
  id: z.string().min(1, 'Doctor ID is required'),
});

module.exports = {
  createDoctorSchema,
  createSlotsSchema,
  getSlotsQuerySchema,
  doctorIdParamSchema,
};
