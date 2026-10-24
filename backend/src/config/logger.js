/**
 * Application Logger with Sensitive Data Redaction
 * Ensures credentials, tokens, and sensitive keys are NEVER written to logs.
 */

const env = require('./env');

const SENSITIVE_KEYS = new Set([
  'password',
  'password_hash',
  'passwordhash',
  'token',
  'jwt',
  'secret',
  'authorization',
  'cookie',
  'apikey',
  'api_key'
]);

/**
 * Deep-clone and sanitize an object by masking sensitive keys.
 */
function redact(data) {
  if (!data || typeof data !== 'object') {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map(item => redact(item));
  }

  const sanitized = {};
  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = redact(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

const levels = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

const currentLevelPriority = levels[env.logging.level] !== undefined ? levels[env.logging.level] : levels.info;

function formatMessage(level, message, meta) {
  const timestamp = new Date().toISOString();
  const metaString = meta ? ` | ${JSON.stringify(redact(meta))}` : '';
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaString}`;
}

const logger = {
  debug(message, meta) {
    if (currentLevelPriority <= levels.debug) {
      console.debug(formatMessage('debug', message, meta));
    }
  },
  info(message, meta) {
    if (currentLevelPriority <= levels.info) {
      console.log(formatMessage('info', message, meta));
    }
  },
  warn(message, meta) {
    if (currentLevelPriority <= levels.warn) {
      console.warn(formatMessage('warn', message, meta));
    }
  },
  error(message, meta) {
    if (currentLevelPriority <= levels.error) {
      console.error(formatMessage('error', message, meta));
    }
  },
  redact
};

module.exports = logger;
