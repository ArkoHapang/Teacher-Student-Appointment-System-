/**
 * Backend Foundation Test Suite (Node.js Test Runner)
 * Validates environment settings, database connectivity, migration status, and health endpoints.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const env = require('../src/config/env');
const db = require('../src/config/database');
const logger = require('../src/config/logger');
const migrationService = require('../src/services/migrationService');
const { validate } = require('../src/middlewares/validator');
const { AppError } = require('../src/middlewares/errorHandler');
const HTTP_STATUS = require('../src/constants/httpStatusCodes');

async function runTests() {
  console.log('\n=================================================================');
  console.log('       Teacher-Student Appointment System: Backend Tests         ');
  console.log('=================================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.log(`  [FAIL] ${name}`);
      console.error(`         ${err.message}`);
      failed++;
    }
  }

  // Suite 1: Environment & Settings
  console.log('[Suite 1] Environment & Configuration Settings...');
  await test('Environment loads correct API prefix', () => {
    assert.strictEqual(env.apiPrefix, '/api/v1');
  });

  await test('Database file path is resolved', () => {
    assert.ok(env.db.file.endsWith('.db'));
  });

  await test('Logging masks sensitive credentials and passwords', () => {
    const raw = { email: 'test@edu.com', password: 'SecretPassword123!', token: 'jwt.token.here' };
    const sanitized = logger.redact(raw);
    assert.strictEqual(sanitized.email, 'test@edu.com');
    assert.strictEqual(sanitized.password, '[REDACTED]');
    assert.strictEqual(sanitized.token, '[REDACTED]');
  });

  // Suite 2: Database Connectivity
  console.log('\n[Suite 2] Database Connection & Diagnostics...');
  await test('Database ping connects and returns healthy roundtrip', async () => {
    const ping = await db.ping();
    assert.strictEqual(ping.connected, true);
    assert.ok(typeof ping.latencyMs === 'number');
  });

  await test('Database executes real SQL query and returns roles', async () => {
    const roles = await db.query('SELECT name FROM roles ORDER BY id ASC;');
    assert.ok(roles.length >= 3);
    const roleNames = roles.map(r => r.name);
    assert.ok(roleNames.includes('STUDENT'));
    assert.ok(roleNames.includes('TEACHER'));
    assert.ok(roleNames.includes('ADMIN'));
  });

  // Suite 3: Migration Service Integration
  console.log('\n[Suite 3] Migration Service Ledger Integration...');
  await test('Migration service reports schema is up-to-date', async () => {
    const status = await migrationService.getStatus();
    assert.strictEqual(status.isUpToDate, true);
    assert.strictEqual(status.pendingCount, 0);
    assert.ok(status.appliedCount >= 2);
  });

  // Suite 4: Request Validation Middleware
  console.log('\n[Suite 4] Request Validation & Error Formatting...');
  await test('Validator middleware blocks missing required fields with 400 Bad Request', () => {
    const schema = {
      title: { required: true, type: 'string' },
      slotId: { required: true, type: 'number' }
    };
    const middleware = validate(schema);

    let statusCode = null;
    let jsonResponse = null;

    const req = { body: { title: 'Consultation' } }; // missing slotId
    const res = {
      status(code) {
        statusCode = code;
        return {
          json(payload) {
            jsonResponse = payload;
          }
        };
      }
    };
    const next = () => {
      assert.fail('Validator should not call next() on invalid input');
    };

    middleware(req, res, next);
    assert.strictEqual(statusCode, HTTP_STATUS.BAD_REQUEST);
    assert.strictEqual(jsonResponse.success, false);
    assert.strictEqual(jsonResponse.error.code, 'VALIDATION_ERROR');
    assert.strictEqual(jsonResponse.error.details.length, 1);
    assert.strictEqual(jsonResponse.error.details[0].field, 'slotId');
  });

  await test('Validator middleware passes valid input to next()', () => {
    const schema = {
      title: { required: true, type: 'string' }
    };
    const middleware = validate(schema);
    const req = { body: { title: 'Consultation Title' } };
    const res = {};
    let nextCalled = false;
    const next = () => { nextCalled = true; };

    middleware(req, res, next);
    assert.strictEqual(nextCalled, true);
  });

  console.log('\n-----------------------------------------------------------------');
  console.log(`Test Summary: ${passed} passed, ${failed} failed.`);
  console.log('=================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runTests();
}

module.exports = { runTests };
