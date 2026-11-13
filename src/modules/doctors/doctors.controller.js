const doctorsService = require('./doctors.service');

async function createDoctor(req, res, next) {
  try {
    const doctor = await doctorsService.createDoctor(req.body);
    return res.status(201).json({
      status: 'success',
      data: { doctor },
    });
  } catch (error) {
    return next(error);
  }
}

async function getAllDoctors(req, res, next) {
  try {
    const doctors = await doctorsService.getAllDoctors();
    return res.status(200).json({
      status: 'success',
      results: doctors.length,
      data: { doctors },
    });
  } catch (error) {
    return next(error);
  }
}

async function createSlots(req, res, next) {
  try {
    const result = await doctorsService.createSlotsBulk(req.params.id, req.body);
    return res.status(201).json({
      status: 'success',
      data: result,
    });
  } catch (error) {
    return next(error);
  }
}

async function getAvailableSlots(req, res, next) {
  try {
    const includeAll = req.query.all === 'true' || req.query.includeBooked === 'true';
    const slots = await doctorsService.getAvailableSlots(req.params.id, req.query.date, includeAll);
    return res.status(200).json({
      status: 'success',
      results: slots.length,
      data: { slots },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createDoctor,
  getAllDoctors,
  createSlots,
  getAvailableSlots,
};
