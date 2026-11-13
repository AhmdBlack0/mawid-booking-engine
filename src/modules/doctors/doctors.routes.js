const express = require('express');
const doctorsController = require('./doctors.controller');
const { authenticate, requireRole } = require('../../middlewares/auth');
const validate = require('../../middlewares/validate');
const {
  createDoctorSchema,
  createSlotsSchema,
  getSlotsQuerySchema,
  doctorIdParamSchema,
} = require('./doctors.schemas');

const router = express.Router();

// Public doctor listing
router.get('/', doctorsController.getAllDoctors);

// Admin-only doctor creation
router.post(
  '/',
  authenticate,
  requireRole('ADMIN'),
  validate({ body: createDoctorSchema }),
  doctorsController.createDoctor
);

// Admin-only bulk slot creation
router.post(
  '/:id/slots',
  authenticate,
  requireRole('ADMIN'),
  validate({ params: doctorIdParamSchema, body: createSlotsSchema }),
  doctorsController.createSlots
);

// Public available slot query (?date=YYYY-MM-DD)
router.get(
  '/:id/slots',
  validate({ params: doctorIdParamSchema, query: getSlotsQuerySchema }),
  doctorsController.getAvailableSlots
);

module.exports = router;
