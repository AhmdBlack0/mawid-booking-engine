const express = require('express');
const bookingsController = require('./bookings.controller');
const { authenticate } = require('../../middlewares/auth');
const validate = require('../../middlewares/validate');
const {
  createBookingSchema,
  bookingIdParamSchema,
  rescheduleBookingSchema,
} = require('./bookings.schemas');

const router = express.Router();

router.use(authenticate);

// List patient's bookings
router.get('/me', bookingsController.getMyBookings);

// Create a booking (accepts ?strategy=pessimistic | optimistic | constraint)
router.post(
  '/',
  validate({ body: createBookingSchema }),
  bookingsController.createBooking
);

// Cancel a booking
router.post(
  '/:id/cancel',
  validate({ params: bookingIdParamSchema }),
  bookingsController.cancelBooking
);

// Confirm a pending booking hold
router.post(
  '/:id/confirm',
  validate({ params: bookingIdParamSchema }),
  bookingsController.confirmBooking
);

// Reschedule a booking
router.post(
  '/:id/reschedule',
  validate({ params: bookingIdParamSchema, body: rescheduleBookingSchema }),
  bookingsController.rescheduleBooking
);

module.exports = router;
