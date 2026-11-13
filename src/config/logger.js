const pino = require('pino');
const env = require('./env');

const isTest = process.env.NODE_ENV === 'test';
const isDev = env.NODE_ENV === 'development';

const transport =
  isDev && !isTest
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
          ignore: 'pid,hostname',
        },
      }
    : undefined;

const logger = pino({
  level: isTest ? 'silent' : isDev ? 'debug' : 'info',
  timestamp: pino.stdTimeFunctions.isoTime,
  transport,
  formatters: {
    level(label) {
      return { level: label.toUpperCase() };
    },
  },
});

module.exports = logger;
