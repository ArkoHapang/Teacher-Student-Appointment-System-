/**
 * Centralized Error Handling Middleware
 * Provides uniform error response schemas across the entire API.
 * Never swallows exceptions or leaks raw stack traces in non-dev environments.
 */

const HTTP_STATUS = require('../constants/httpStatusCodes');
const logger = require('../config/logger');
const env = require('../config/env');

/**
 * Custom Operational Application Error class
 */
class AppError extends Error {
  constructor(message, statusCode = HTTP_STATUS.INTERNAL_SERVER_ERROR, code = 'INTERNAL_ERROR', details = []) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * 404 Not Found Middleware for unmatched routes
 */
function notFoundHandler(req, res, next) {
  res.status(HTTP_STATUS.NOT_FOUND).json({
    success: false,
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: `The requested endpoint '${req.method} ${req.originalUrl}' does not exist on this server.`
    }
  });
}

/**
 * Global Error Handler
 */
function errorHandler(err, req, res, next) {
  let statusCode = err.statusCode || HTTP_STATUS.INTERNAL_SERVER_ERROR;
  let code = err.code || 'INTERNAL_SERVER_ERROR';
  let message = err.message || 'An unexpected internal error occurred.';
  let details = err.details || [];

  // Handle JSON parsing errors in body-parser
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    statusCode = HTTP_STATUS.BAD_REQUEST;
    code = 'MALFORMED_JSON';
    message = 'The request payload contains malformed JSON syntax.';
  }

  // Handle SQLite constraint violations
  if (err.message && err.message.includes('UNIQUE constraint failed')) {
    statusCode = HTTP_STATUS.CONFLICT;
    code = 'UNIQUE_CONSTRAINT_VIOLATION';
    message = 'A record with duplicate unique fields already exists.';
  } else if (err.message && err.message.includes('FOREIGN KEY constraint failed')) {
    statusCode = HTTP_STATUS.BAD_REQUEST;
    code = 'FOREIGN_KEY_VIOLATION';
    message = 'Referenced relational record does not exist.';
  } else if (err.message && err.message.includes('CHECK constraint failed')) {
    statusCode = HTTP_STATUS.UNPROCESSABLE_ENTITY;
    code = 'CHECK_CONSTRAINT_VIOLATION';
    message = 'Value violates domain boundary constraints.';
  }

  // Mask internal implementation details for unexpected 500 errors outside development mode
  if (!env.isDevelopment && statusCode === HTTP_STATUS.INTERNAL_SERVER_ERROR && !(err instanceof AppError)) {
    message = 'An unexpected internal error occurred.';
    code = 'INTERNAL_SERVER_ERROR';
    details = [];
  }

  // Log error with context
  logger.error(`Error processing ${req.method} ${req.originalUrl}: ${message}`, {
    statusCode,
    code,
    stack: env.isDevelopment ? err.stack : undefined
  });

  // Construct client response
  const hasDetails = Array.isArray(details)
    ? details.length > 0
    : (details && typeof details === 'object' && Object.keys(details).length > 0);

  const response = {
    success: false,
    error: {
      code,
      message,
      ...(hasDetails ? { details } : {})
    }
  };

  // Only attach stack trace in local development mode
  if (env.isDevelopment && statusCode === HTTP_STATUS.INTERNAL_SERVER_ERROR) {
    response.error.stack = err.stack;
  }

  res.status(statusCode).json(response);
}

module.exports = {
  AppError,
  notFoundHandler,
  errorHandler
};
