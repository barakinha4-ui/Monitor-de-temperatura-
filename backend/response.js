'use strict';

/**
 * Resposta de sucesso padronizada
 */
function sendSuccess(res, data = {}, statusCode = 200, meta = {}) {
  return res.status(statusCode).json({
    success:   true,
    data,
    ...meta,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Resposta de erro padronizada
 */
function sendError(res, statusCode = 500, message = 'Internal server error', details = null) {
  return res.status(statusCode).json({
    success:   false,
    error:     message,
    ...(details && process.env.NODE_ENV !== 'production' && { details }),
    timestamp: new Date().toISOString(),
  });
}

/**
 * Cria um AppError com status code
 */
class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    this.name       = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Wrapper assíncrono para evitar try/catch repetitivo em rotas
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { sendSuccess, sendError, AppError, asyncHandler };
