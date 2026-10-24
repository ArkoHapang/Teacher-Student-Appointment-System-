/**
 * HTTP Request Logging Middleware
 * Logs incoming requests and response metrics with automated PII & secret redaction.
 */

const logger = require('../config/logger');

function requestLogger(req, res, next) {
  const start = Date.now();
  const { method, originalUrl, ip } = req;

  // Mask sensitive query params
  const sanitizedQuery = logger.redact(req.query);

  // Hook into response finish
  res.on('finish', () => {
    const duration = Date.now() - start;
    const statusCode = res.statusCode;

    const logPayload = {
      method,
      url: originalUrl,
      status: statusCode,
      durationMs: duration,
      ip: ip || req.connection?.remoteAddress,
      query: Object.keys(sanitizedQuery).length > 0 ? sanitizedQuery : undefined
    };

    if (statusCode >= 500) {
      logger.error(`HTTP ${method} ${originalUrl} -> ${statusCode} (${duration}ms)`, logPayload);
    } else if (statusCode >= 400) {
      logger.warn(`HTTP ${method} ${originalUrl} -> ${statusCode} (${duration}ms)`, logPayload);
    } else {
      logger.info(`HTTP ${method} ${originalUrl} -> ${statusCode} (${duration}ms)`, logPayload);
    }
  });

  next();
}

module.exports = requestLogger;
