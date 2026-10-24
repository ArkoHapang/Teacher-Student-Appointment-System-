/**
 * Environment Configuration Module
 * Loads and validates environment variables based on NODE_ENV.
 */

const path = require('path');
const fs = require('fs');

const nodeEnv = process.env.NODE_ENV || 'development';
const envFile = nodeEnv === 'test' ? '.env.test' : '.env';
const envPath = path.resolve(process.cwd(), envFile);

// Parse .env file if dotenv is available or parse simply if plain text
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const key = trimmed.substring(0, idx).trim();
        const value = trimmed.substring(idx + 1).trim();
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  });
}

const config = {
  get env() { return process.env.NODE_ENV || 'development'; },
  get isProduction() { return (process.env.NODE_ENV || '') === 'production'; },
  get isTest() { return (process.env.NODE_ENV || '') === 'test'; },
  get isDevelopment() { return !process.env.NODE_ENV || process.env.NODE_ENV === 'development'; },
  get port() { return parseInt(process.env.PORT || '5000', 10); },
  get apiPrefix() { return process.env.API_PREFIX || '/api/v1'; },
  db: {
    get client() { return process.env.DB_CLIENT || 'sqlite'; },
    get file() { return path.resolve(process.cwd(), process.env.DB_FILE || 'database/appointment_system.db'); }
  },
  jwt: {
    get secret() { return process.env.JWT_SECRET || 'dev_fallback_secret_not_for_production'; },
    get expiresIn() { return process.env.JWT_EXPIRES_IN || '24h'; }
  },
  cors: {
    get origin() { return process.env.CORS_ORIGIN || 'http://localhost:3000'; }
  },
  logging: {
    get level() { return process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'error' : 'info'); }
  },
  /**
   * Validate authentication secret hygiene before bootstrapping server
   */
  validateSecurityConfig(overrides = {}) {
    const isProd = overrides.isProduction !== undefined ? overrides.isProduction : this.isProduction;
    const secret = overrides.secret !== undefined ? overrides.secret : (process.env.JWT_SECRET || this.jwt.secret);
    if (isProd) {
      if (!secret || secret === 'dev_fallback_secret_not_for_production') {
        throw new Error('[Security Config] JWT_SECRET environment variable is strictly required in production.');
      }
      if (secret.length < 32) {
        throw new Error('[Security Config] JWT_SECRET must be at least 32 characters long in production.');
      }
      if (secret.includes('dev_') || secret.includes('change_me')) {
        throw new Error('[Security Config] Default development secret detected in production environment.');
      }
    }
  }
};

config.validateSecurityConfig();

module.exports = config;
