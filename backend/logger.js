'use strict';

const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  // Pretty print em desenvolvimento
  ...(process.env.NODE_ENV !== 'production' && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize:    true,
        translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
        ignore:      'pid,hostname',
      },
    },
  }),
  // Em produção: JSON puro para ingestão por log aggregators
  serializers: {
    err:   pino.stdSerializers.err,
    error: pino.stdSerializers.err,
    // Nunca logar dados sensíveis
    req: (req) => ({
      method:     req.method,
      url:        req.url,
      remoteAddress: req.remoteAddress,
      // Nunca logar: headers (contém auth tokens), body
    }),
  },
  // Redact campos sensíveis em qualquer log
  redact: {
    paths: [
      'password',
      'token',
      'authorization',
      'stripe_secret_key',
      'api_key',
      '*.password',
      '*.token',
      'req.headers.authorization',
    ],
    censor: '[REDACTED]',
  },
});

module.exports = logger;
