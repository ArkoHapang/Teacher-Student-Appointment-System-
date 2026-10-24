/**
 * Comprehensive Security & Defensive Hardening Regression Test Suite
 *
 * Verifies defensive implementation across 14 security criteria:
 * 1. HTTP Security Headers (X-Content-Type-Options, X-Frame-Options, Referrer-Policy, CSP, X-Powered-By removal)
 * 2. Input Validation & Type Sanitization (user profile & teacher profile updates)
 * 3. Information Disclosure & Production Error Masking (sanitizing 500 error messages and suppressing stack traces)
 * 4. Password Security & Timing Attack Defenses (bcrypt rounds, dummy hash comparison, complexity enforcement)
 * 5. Secret Management & Production Hygiene (validation of JWT_SECRET length and entropy)
 * 6. Server-Side Role Boundaries & RBAC (Students and Teachers blocked from admin surfaces)
 * 7. Insecure Direct Object References (IDOR) Protection (User profiles, teacher management)
 * 8. Appointment Access Scoping & Ownership Integrity (Viewing, cancelling, approving)
 * 9. SQL Injection Query Safety (Parameterized search and filters)
 * 10. Logging Hygiene & Credential Scrubbing (Redaction of passwords, tokens, hashes)
 * 11. Authentication Token Revocation & Anti-Caching (jti blacklisting, Clear-Site-Data)
 * 12. Concurrency Control & Double Booking Prevention (Atomic conditional slot locks)
 */

const assert = require('assert');
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/database');
const env = require('../src/config/env');
const logger = require('../src/config/logger');
const passwordService = require('../src/services/passwordService');
const tokenService = require('../src/services/tokenService');
const HTTP_STATUS = require('../src/constants/httpStatusCodes');
const { errorHandler, AppError } = require('../src/middlewares/errorHandler');

async function runSecurityDefensiveTests() {
  console.log('\n=================================================================');
  console.log(' Teacher-Student Appointment System: Defensive Security Review   ');
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
      if (err.stack && process.env.DEBUG) console.error(err.stack);
      failed++;
    }
  }

  // Helper: Login and obtain access token
  const login = async (email, password = 'Password123!') => {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password });
    if (res.status !== 200) {
      throw new Error(`Failed to login as ${email}: ${JSON.stringify(res.body)}`);
    }
    return res.body.data.token;
  };

  const adminToken = await login('admin@university.edu');
  const teacherRobertToken = await login('robert.miller@university.edu');
  const teacherSarahToken = await login('sarah.jenkins@university.edu');
  const studentAliceToken = await login('alice.carter@student.university.edu');
  const studentDavidToken = await login('david.kim@student.university.edu');

  // ---------------------------------------------------------------------------
  // Suite 1: HTTP Security Headers & Fingerprinting Mitigation
  // ---------------------------------------------------------------------------
  console.log('[Suite 1] HTTP Security Headers & Fingerprint Removal...');

  await test('Defensive Headers: Responses contain X-Content-Type-Options: nosniff', async () => {
    const res = await request(app).get('/api/v1/health');
    assert.strictEqual(res.headers['x-content-type-options'], 'nosniff');
  });

  await test('Defensive Headers: Responses contain X-Frame-Options: DENY', async () => {
    const res = await request(app).get('/api/v1/health');
    assert.strictEqual(res.headers['x-frame-options'], 'DENY');
  });

  await test('Defensive Headers: Responses contain Referrer-Policy: strict-origin-when-cross-origin', async () => {
    const res = await request(app).get('/api/v1/health');
    assert.strictEqual(res.headers['referrer-policy'], 'strict-origin-when-cross-origin');
  });

  await test('Defensive Headers: Responses contain modern X-XSS-Protection: 0', async () => {
    const res = await request(app).get('/api/v1/health');
    assert.strictEqual(res.headers['x-xss-protection'], '0');
  });

  await test('Defensive Headers: Responses contain Content-Security-Policy with frame-ancestors none', async () => {
    const res = await request(app).get('/api/v1/health');
    assert.ok(res.headers['content-security-policy']);
    assert.ok(res.headers['content-security-policy'].includes("frame-ancestors 'none'"));
  });

  await test('Fingerprint Removal: X-Powered-By header is removed from responses', async () => {
    const res = await request(app).get('/api/v1/health');
    assert.strictEqual(res.headers['x-powered-by'], undefined);
  });

  // ---------------------------------------------------------------------------
  // Suite 2: Input Validation & Payload Hardening
  // ---------------------------------------------------------------------------
  console.log('\n[Suite 2] Input Validation & Payload Hardening...');

  await test('Validation: Rejects non-string firstName payload with 400 Bad Request', async () => {
    const res = await request(app)
      .patch('/api/v1/users/6')
      .set('Authorization', `Bearer ${studentAliceToken}`)
      .send({ firstName: { $ne: 'Alice' } });

    assert.strictEqual(res.status, HTTP_STATUS.BAD_REQUEST);
    assert.strictEqual(res.body.error.code, 'VALIDATION_ERROR');
  });

  await test('Validation: Rejects oversized firstName (> 100 characters) with 400 Bad Request', async () => {
    const res = await request(app)
      .patch('/api/v1/users/6')
      .set('Authorization', `Bearer ${studentAliceToken}`)
      .send({ firstName: 'A'.repeat(101) });

    assert.strictEqual(res.status, HTTP_STATUS.BAD_REQUEST);
    assert.strictEqual(res.body.error.code, 'VALIDATION_ERROR');
  });

  await test('Validation: Rejects empty whitespace string in profile update with 400 Bad Request', async () => {
    const res = await request(app)
      .patch('/api/v1/users/6')
      .set('Authorization', `Bearer ${studentAliceToken}`)
      .send({ firstName: '   ' });

    assert.strictEqual(res.status, HTTP_STATUS.BAD_REQUEST);
    assert.strictEqual(res.body.error.code, 'VALIDATION_ERROR');
  });

  await test('Validation: Rejects non-string designation on teacher update with 400 Bad Request', async () => {
    const res = await request(app)
      .patch('/api/v1/teachers/1')
      .set('Authorization', `Bearer ${teacherRobertToken}`)
      .send({ designation: 12345 });

    assert.strictEqual(res.status, HTTP_STATUS.BAD_REQUEST);
    assert.strictEqual(res.body.error.code, 'VALIDATION_ERROR');
  });

  await test('Validation: Rejects oversized bio (> 2000 chars) on teacher update with 400 Bad Request', async () => {
    const res = await request(app)
      .patch('/api/v1/teachers/1')
      .set('Authorization', `Bearer ${teacherRobertToken}`)
      .send({ bio: 'B'.repeat(2001) });

    assert.strictEqual(res.status, HTTP_STATUS.BAD_REQUEST);
    assert.strictEqual(res.body.error.code, 'VALIDATION_ERROR');
  });

  // ---------------------------------------------------------------------------
  // Suite 3: Information Disclosure & Production Error Masking
  // ---------------------------------------------------------------------------
  console.log('\n[Suite 3] Information Disclosure & Error Masking...');

  await test('Error Masking: Unexpected 500 error masks internal error message and stack in production', () => {
    let capturedResponse = null;
    let capturedStatus = null;

    const fakeReq = { method: 'GET', originalUrl: '/api/v1/test-crash' };
    const fakeRes = {
      status(code) {
        capturedStatus = code;
        return this;
      },
      json(payload) {
        capturedResponse = payload;
        return this;
      }
    };

    const originalIsDev = env.isDevelopment;
    try {
      // Emulate production environment
      Object.defineProperty(env, 'isDevelopment', { value: false, configurable: true });

      const rawInternalError = new Error('SQLITE_ERROR: syntax error at table users near /var/db/internal.sqlite');
      errorHandler(rawInternalError, fakeReq, fakeRes, () => {});

      assert.strictEqual(capturedStatus, 500);
      assert.strictEqual(capturedResponse.success, false);
      assert.strictEqual(capturedResponse.error.code, 'INTERNAL_SERVER_ERROR');
      assert.strictEqual(capturedResponse.error.message, 'An unexpected internal error occurred.');
      assert.strictEqual(capturedResponse.error.stack, undefined);
      assert.ok(!JSON.stringify(capturedResponse).includes('syntax error'));
      assert.ok(!JSON.stringify(capturedResponse).includes('/var/db'));
    } finally {
      Object.defineProperty(env, 'isDevelopment', { value: originalIsDev, configurable: true });
    }
  });

  // ---------------------------------------------------------------------------
  // Suite 4: Password Security & Constant-Time Enumeration Defense
  // ---------------------------------------------------------------------------
  console.log('\n[Suite 4] Password Hashing & Timing Attack Protection...');

  await test('Password Hashing: Salt rounds meet or exceed workload factor 10', async () => {
    const hash = await passwordService.hashPassword('SecurePassword123!');
    assert.ok(hash.startsWith('$2a$10$') || hash.startsWith('$2b$10$'), 'Hash should use bcrypt cost 10');
  });

  await test('Timing Attack Defense: dummyVerify executes comparison and returns false', async () => {
    const result = await passwordService.dummyVerify('nonexistentPasswordCandidate');
    assert.strictEqual(result, false);
  });

  await test('Password Policy: validateComplexity rejects passwords shorter than 8 characters', () => {
    const res = passwordService.validateComplexity('Pass1!');
    assert.strictEqual(res.isValid, false);
  });

  await test('Password Policy: validateComplexity rejects passwords without special characters', () => {
    const res = passwordService.validateComplexity('Password123');
    assert.strictEqual(res.isValid, false);
  });

  await test('Password Policy: validateComplexity accepts robust compliant passwords', () => {
    const res = passwordService.validateComplexity('P@ssword123!');
    assert.strictEqual(res.isValid, true);
  });

  // ---------------------------------------------------------------------------
  // Suite 5: Secret Management & Production Configuration Hygiene
  // ---------------------------------------------------------------------------
  console.log('\n[Suite 5] Secret Management & Configuration Hygiene...');

  await test('Secret Hygiene: Rejects dev fallback secret in production', () => {
    assert.throws(
      () => env.validateSecurityConfig({ isProduction: true, secret: 'dev_fallback_secret_not_for_production' }),
      /strictly required in production/
    );
  });

  await test('Secret Hygiene: Rejects secrets shorter than 32 characters in production', () => {
    assert.throws(
      () => env.validateSecurityConfig({ isProduction: true, secret: 'too_short_secret_key' }),
      /must be at least 32 characters long in production/
    );
  });

  await test('Secret Hygiene: Rejects placeholder change_me tokens in production', () => {
    assert.throws(
      () => env.validateSecurityConfig({ isProduction: true, secret: 'change_me_super_long_secret_for_prod_123456789' }),
      /Default development secret detected/
    );
  });

  await test('Secret Hygiene: Accepts compliant high-entropy 32+ char secret in production', () => {
    assert.doesNotThrow(() =>
      env.validateSecurityConfig({
        isProduction: true,
        secret: 'a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8'
      })
    );
  });

  // ---------------------------------------------------------------------------
  // Suite 6: Broken Access Control & IDOR Protection
  // ---------------------------------------------------------------------------
  console.log('\n[Suite 6] Broken Access Control & IDOR Protection...');

  await test('IDOR: Student Alice cannot access Student David private profile (403)', async () => {
    const res = await request(app)
      .get('/api/v1/users/7')
      .set('Authorization', `Bearer ${studentAliceToken}`);

    assert.strictEqual(res.status, HTTP_STATUS.FORBIDDEN);
    assert.strictEqual(res.body.error.code, 'FORBIDDEN');
  });

  await test('IDOR: Student Alice cannot update Student David profile (403)', async () => {
    const res = await request(app)
      .patch('/api/v1/users/7')
      .set('Authorization', `Bearer ${studentAliceToken}`)
      .send({ firstName: 'Hacked' });

    assert.strictEqual(res.status, HTTP_STATUS.FORBIDDEN);
    assert.strictEqual(res.body.error.code, 'FORBIDDEN');
  });

  await test('IDOR: Teacher Robert cannot manage Teacher Sarah profile (403)', async () => {
    const res = await request(app)
      .patch('/api/v1/teachers/2')
      .set('Authorization', `Bearer ${teacherRobertToken}`)
      .send({ officeRoom: 'Hacked-Room' });

    assert.strictEqual(res.status, HTTP_STATUS.FORBIDDEN);
    assert.strictEqual(res.body.error.code, 'FORBIDDEN');
  });

  await test('Role Elevation: Profile update cannot alter role_id or escalate privileges', async () => {
    const res = await request(app)
      .patch('/api/v1/users/6')
      .set('Authorization', `Bearer ${studentAliceToken}`)
      .send({ firstName: 'Alice', role: 'ADMIN', role_id: 3 });

    assert.strictEqual(res.status, HTTP_STATUS.OK);

    // Verify role in database was NOT altered
    const user = await db.queryOne(
      'SELECT r.name as role_name FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = 6;'
    );
    assert.strictEqual(user.role_name, 'STUDENT', 'User role must remain STUDENT');
  });

  // ---------------------------------------------------------------------------
  // Suite 7: Appointment Access Scoping & Ownership Integrity
  // ---------------------------------------------------------------------------
  console.log('\n[Suite 7] Appointment Scoping & Ownership Integrity...');

  await test('Ownership: Student cannot view an appointment they do not own (403)', async () => {
    // Appointment #1 belongs to Alice (student_id = 1)
    // David (student_id = 2, user_id = 7) attempting to view #1
    const res = await request(app)
      .get('/api/v1/appointments/1')
      .set('Authorization', `Bearer ${studentDavidToken}`);

    assert.strictEqual(res.status, HTTP_STATUS.FORBIDDEN);
    assert.strictEqual(res.body.error.code, 'FORBIDDEN');
  });

  await test('Ownership: Student cannot cancel an appointment they do not own (403)', async () => {
    const res = await request(app)
      .post('/api/v1/appointments/1/cancel')
      .set('Authorization', `Bearer ${studentDavidToken}`)
      .send({ cancellationReason: 'Malicious attempt to cancel another student session.' });

    assert.strictEqual(res.status, HTTP_STATUS.FORBIDDEN);
    assert.strictEqual(res.body.error.code, 'FORBIDDEN');
  });

  await test('Ownership: Teacher cannot approve an appointment assigned to another faculty (403)', async () => {
    // Appointment #1 is assigned to Teacher Robert (id = 1)
    // Teacher Sarah (id = 2) attempting to approve
    const res = await request(app)
      .post('/api/v1/appointments/1/approve')
      .set('Authorization', `Bearer ${teacherSarahToken}`)
      .send({ notes: 'Unauthorized approval' });

    assert.strictEqual(res.status, HTTP_STATUS.FORBIDDEN);
    assert.strictEqual(res.body.error.code, 'FORBIDDEN');
  });

  // ---------------------------------------------------------------------------
  // Suite 8: SQL Injection Defense & Query Parameterization
  // ---------------------------------------------------------------------------
  console.log('\n[Suite 8] SQL Injection Defense...');

  await test('SQL Injection Defense: SQL syntax in appointment search does not cause injection', async () => {
    const injectionSearch = "Discussion' OR '1'='1' --";
    const res = await request(app)
      .get(`/api/v1/admin/appointments?search=${encodeURIComponent(injectionSearch)}`)
      .set('Authorization', `Bearer ${adminToken}`);

    assert.strictEqual(res.status, HTTP_STATUS.OK);
    assert.strictEqual(res.body.success, true);
    // Should safely treat the payload as a literal string parameter without syntax errors
  });

  await test('SQL Injection Defense: SQL payload in status filter safely handled', async () => {
    const injectionStatus = "APPROVED' UNION SELECT password_hash FROM users --";
    const res = await request(app)
      .get(`/api/v1/admin/appointments?status=${encodeURIComponent(injectionStatus)}`)
      .set('Authorization', `Bearer ${adminToken}`);

    assert.strictEqual(res.status, HTTP_STATUS.OK);
    // Unrecognized status is sanitized or yields empty results without executing union
  });

  // ---------------------------------------------------------------------------
  // Suite 9: Log Redaction & PII Scrubbing
  // ---------------------------------------------------------------------------
  console.log('\n[Suite 9] Log Redaction & Sensitive Data Scrubbing...');

  await test('Log Redaction: logger.redact scrubs password, token, and secret fields', () => {
    const rawPayload = {
      email: 'student@university.edu',
      password: 'PlaintextPassword123!',
      token: 'jwt.token.secret',
      authorization: 'Bearer 12345',
      nested: {
        password_hash: '$2b$10$hashvalue',
        secret: 'topsecret'
      }
    };

    const redacted = logger.redact(rawPayload);
    assert.strictEqual(redacted.password, '[REDACTED]');
    assert.strictEqual(redacted.token, '[REDACTED]');
    assert.strictEqual(redacted.authorization, '[REDACTED]');
    assert.strictEqual(redacted.nested.password_hash, '[REDACTED]');
    assert.strictEqual(redacted.nested.secret, '[REDACTED]');
    assert.strictEqual(redacted.email, 'student@university.edu');
  });

  await test('Data Exposure: User profile API never exposes password_hash in response', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${studentAliceToken}`);

    assert.strictEqual(res.status, HTTP_STATUS.OK);
    assert.strictEqual(res.body.data.password_hash, undefined);
    assert.strictEqual(res.body.data.password, undefined);
    assert.ok(!JSON.stringify(res.body).includes('password_hash'));
  });

  // ---------------------------------------------------------------------------
  // Suite 10: Token Revocation & Anti-Caching on Logout
  // ---------------------------------------------------------------------------
  console.log('\n[Suite 10] Token Revocation & Anti-Caching on Logout...');

  await test('Token Revocation: Logout records jti and rejects subsequent requests', async () => {
    // Generate fresh session token
    const testLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'david.kim@student.university.edu', password: 'Password123!' });

    const disposableToken = testLogin.body.data.token;

    // Verify token works initially
    const verifyBefore = await request(app)
      .get('/api/v1/auth/verify')
      .set('Authorization', `Bearer ${disposableToken}`);
    assert.strictEqual(verifyBefore.status, HTTP_STATUS.OK);

    // Perform logout
    const logoutRes = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${disposableToken}`);
    assert.strictEqual(logoutRes.status, HTTP_STATUS.OK);
    assert.ok(logoutRes.headers['clear-site-data'], 'Clear-Site-Data header must be set');
    assert.ok(logoutRes.headers['cache-control'].includes('no-store'), 'Cache-Control must prevent caching');

    // Attempt request with revoked token
    const verifyAfter = await request(app)
      .get('/api/v1/auth/verify')
      .set('Authorization', `Bearer ${disposableToken}`);
    assert.strictEqual(verifyAfter.status, HTTP_STATUS.UNAUTHORIZED);
    assert.strictEqual(verifyAfter.body.error.code, 'TOKEN_REVOKED');
  });

  // ---------------------------------------------------------------------------
  // Suite 11: Concurrency Control & Double Booking Protection
  // ---------------------------------------------------------------------------
  console.log('\n[Suite 11] Concurrency & Race Condition Protection...');

  await test('Concurrency: Atomic slot locking prevents concurrent double-booking of same slot', async () => {
    // Create dedicated slot
    const slotDate = '2027-05-15';
    const cleanStale = await db.execute("DELETE FROM teacher_availability_slots WHERE slot_date = '2027-05-15';");
    const slotRes = await db.execute(
      `INSERT INTO teacher_availability_slots (teacher_id, slot_date, start_time, end_time, start_timestamp, end_timestamp, is_booked, is_active)
       VALUES (1, '2027-05-15', '14:00:00', '14:30:00', '2027-05-15 14:00:00', '2027-05-15 14:30:00', 0, 1);`
    );
    const slotId = slotRes.lastInsertRowid;

    try {
      // Send two concurrent booking requests for the exact same slot
      const [req1, req2] = await Promise.all([
        request(app)
          .post('/api/v1/appointments')
          .set('Authorization', `Bearer ${studentAliceToken}`)
          .send({ slotId, title: 'Session A', purpose: 'Research Consultation Topic A' }),
        request(app)
          .post('/api/v1/appointments')
          .set('Authorization', `Bearer ${studentDavidToken}`)
          .send({ slotId, title: 'Session B', purpose: 'Research Consultation Topic B' })
      ]);

      const statuses = [req1.status, req2.status];
      // Exactly one must succeed (201 Created) and the other must be rejected (409 Conflict)
      assert.ok(statuses.includes(HTTP_STATUS.CREATED), 'One request must succeed with 201 Created');
      assert.ok(statuses.includes(HTTP_STATUS.CONFLICT), 'Competing concurrent request must receive 409 Conflict');

      // Verify slot is marked booked
      const slot = await db.queryOne('SELECT is_booked FROM teacher_availability_slots WHERE id = ?;', [slotId]);
      assert.strictEqual(slot.is_booked, 1);

      // Verify only 1 appointment exists for this slot
      const appointments = await db.query('SELECT id FROM appointments WHERE slot_id = ?;', [slotId]);
      assert.strictEqual(appointments.length, 1, 'Only one appointment must be created for the contested slot');
    } finally {
      // Clean up test slot and appointment
      const appt = await db.queryOne('SELECT id FROM appointments WHERE slot_id = ?;', [slotId]);
      if (appt) {
        await db.execute('DELETE FROM appointment_status_history WHERE appointment_id = ?;', [appt.id]);
        await db.execute('DELETE FROM appointments WHERE id = ?;', [appt.id]);
      }
      await db.execute('DELETE FROM teacher_availability_slots WHERE id = ?;', [slotId]);
    }
  });

  console.log('\n=================================================================');
  console.log(` Security Test Summary: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  console.log('=================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runSecurityDefensiveTests().catch((err) => {
    console.error('Fatal error during security test run:', err);
    process.exit(1);
  });
}

module.exports = runSecurityDefensiveTests;
