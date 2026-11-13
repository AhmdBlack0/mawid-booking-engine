const express = require('express');
const authController = require('./auth.controller');
const validate = require('../../middlewares/validate');
const { registerSchema, loginSchema } = require('./auth.schemas');

const router = express.Router();

router.post('/register', validate({ body: registerSchema }), authController.register);
router.post('/login', validate({ body: loginSchema }), authController.login);

module.exports = router;
