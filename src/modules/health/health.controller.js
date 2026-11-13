const healthService = require('./health.service');

async function getHealth(req, res, next) {
  try {
    const data = await healthService.checkHealth();
    return res.status(200).json({
      status: 'success',
      data,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getHealth,
};
