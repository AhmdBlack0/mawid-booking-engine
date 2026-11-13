const { z } = require('zod');

const createBookingSchema = z.object({
  slotId: z.string().min(1, 'slotId is required'),
});

const bookingIdParamSchema = z.object({
  id: z.string().min(1, 'Booking ID is required'),
});

const rescheduleBookingSchema = z.object({
  newSlotId: z.string().min(1, 'newSlotId is required'),
});

module.exports = {
  createBookingSchema,
  bookingIdParamSchema,
  rescheduleBookingSchema,
};
