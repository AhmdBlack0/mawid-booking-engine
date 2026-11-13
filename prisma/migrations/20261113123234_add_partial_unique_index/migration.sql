-- Partial Unique Index: a slot can have at most ONE active booking (PENDING or CONFIRMED).
-- Cancelled and expired bookings free the slot so it can be re-booked.
CREATE UNIQUE INDEX "unique_active_booking_per_slot"
ON "Booking"("slotId")
WHERE status IN ('PENDING', 'CONFIRMED');
