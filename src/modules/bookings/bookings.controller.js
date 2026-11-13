const bookingsService = require('./bookings.service');

async function createBooking(req, res, next) {
  try {
    const strategy = req.query.strategy || process.env.BOOKING_STRATEGY || 'constraint';

    let booking;
    if (strategy === 'naive') {
      booking = await bookingsService.createBookingNaive(req.user.id, req.body.slotId);
    } else if (strategy === 'pessimistic' || strategy === 'lock') {
      booking = await bookingsService.createBookingWithLock(req.user.id, req.body.slotId);
    } else if (strategy === 'optimistic') {
      booking = await bookingsService.createBookingOptimistic(
        req.user.id,
        req.body.slotId
      );
    } else {
      // Default: Version B - Database Partial Unique Index Constraint
      booking = await bookingsService.createBooking(req.user.id, req.body.slotId);
    }

    return res.status(201).json({
      status: 'success',
      data: { booking },
    });
  } catch (error) {
    return next(error);
  }
}

async function cancelBooking(req, res, next) {
  try {
    const booking = await bookingsService.cancelBooking(
      req.user.id,
      req.user.role,
      req.params.id
    );
    return res.status(200).json({
      status: 'success',
      data: { booking },
    });
  } catch (error) {
    return next(error);
  }
}

async function confirmBooking(req, res, next) {
  try {
    const booking = await bookingsService.confirmBooking(
      req.user.id,
      req.user.role,
      req.params.id
    );
    return res.status(200).json({
      status: 'success',
      data: { booking },
    });
  } catch (error) {
    return next(error);
  }
}

async function rescheduleBooking(req, res, next) {
  try {
    const booking = await bookingsService.rescheduleBooking(
      req.user.id,
      req.user.role,
      req.params.id,
      req.body.newSlotId
    );
    return res.status(200).json({
      status: 'success',
      data: { booking },
    });
  } catch (error) {
    return next(error);
  }
}

async function getMyBookings(req, res, next) {
  try {
    const bookings = await bookingsService.getMyBookings(req.user.id);
    return res.status(200).json({
      status: 'success',
      results: bookings.length,
      data: { bookings },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createBooking,
  cancelBooking,
  confirmBooking,
  rescheduleBooking,
  getMyBookings,
};
