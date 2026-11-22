/**
 * Test Environment Setup & Isolation Safety Guard
 * Must be executed before any backend modules or database connections are initialized.
 *
 * Enforces:
 * 1. Explicit test mode (NODE_ENV=test).
 * 2. Explicit loading and validation of .env.test (fail-fast if missing or invalid).
 * 3. Dedicated test database resolution with absolute path normalization.
 * 4. Strict fail-fast safety guard preventing any test runner from opening the development database.
 */

const path = require('path');
const fs = require('fs');

if (!global.__TEST_SETUP_INITIALIZED__) {
  global.__TEST_SETUP_INITIALIZED__ = true;

  // 1. Explicitly establish test environment mode
  process.env.NODE_ENV = 'test';

  // 2. Locate and validate .env.test
  const envTestPath = path.resolve(process.cwd(), '.env.test');
  if (!fs.existsSync(envTestPath)) {
    throw new Error(
      `[CRITICAL TEST SETUP ERROR] Required test environment file not found at: ${envTestPath}\n` +
      'Automated tests cannot run without an explicit .env.test configuration file.'
    );
  }

  // Parse .env.test directly to guarantee test variables take precedence
  const content = fs.readFileSync(envTestPath, 'utf8');
  content.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const key = trimmed.substring(0, idx).trim();
        const value = trimmed.substring(idx + 1).trim();
        // Force test configuration in test mode
        process.env[key] = value;
      }
    }
  });

  // 3. Validate test database configuration
  if (!process.env.DB_FILE || !process.env.DB_FILE.trim()) {
    throw new Error(
      '[CRITICAL TEST SETUP ERROR] DB_FILE is not defined in .env.test.\n' +
      'Test configuration must explicitly designate an isolated test database and must not fall back silently.'
    );
  }

  // 4. Resolve normalized absolute paths for development and test databases
  const devDbPath = path.normalize(path.resolve(process.cwd(), 'database/appointment_system.db'));
  const testDbPath = path.normalize(path.resolve(process.cwd(), process.env.DB_FILE));

  // 5. Fail-Fast Safety Guard: compare normalized absolute paths (case-insensitive for Windows compatibility)
  if (testDbPath.toLowerCase() === devDbPath.toLowerCase()) {
    throw new Error(
      `[CRITICAL SAFETY VIOLATION] Test environment target database resolved to the development database!\n` +
      `Target Test DB: ${testDbPath}\n` +
      `Protected Dev:  ${devDbPath}\n` +
      `Automated tests are strictly forbidden from modifying or reading the development database.\n` +
      `Test process terminated immediately to prevent data contamination.`
    );
  }

  // Verify that test database path contains 'test' indicator
  if (!path.basename(testDbPath).toLowerCase().includes('test')) {
    throw new Error(
      `[CRITICAL SAFETY VIOLATION] Test database filename must contain 'test' marker to prevent accidental targeting.\n` +
      `Configured DB: ${testDbPath}`
    );
  }

  // Ensure DB_FILE environment variable holds the verified absolute path
  process.env.DB_FILE = testDbPath;

  // Maintain backward-compatible test administrator credentials strictly in dedicated test database
  try {
    const { DatabaseSync } = require('node:sqlite');
    if (fs.existsSync(testDbPath)) {
      const syncDb = new DatabaseSync(testDbPath);
      syncDb.exec(`
        UPDATE users
        SET password_hash = '$2b$10$wvnNLhxJGUPSd/4nZ7Xwk.sZVZ4Zxy5Awge.GZiY594x4miJEA55m',
            status = 'ACTIVE'
        WHERE id = 1 AND email = 'admin@university.edu';
      `);
    }
  } catch {
    // Non-blocking if table not initialized yet
  }
}

module.exports = {
  isTestMode: true,
  devDbPath: path.normalize(path.resolve(process.cwd(), 'database/appointment_system.db')),
  testDbPath: path.normalize(path.resolve(process.cwd(), process.env.DB_FILE || 'database/appointment_system_test.db'))
};
