/**
 * Authentication and Server-Side Authorization Test Suite
 * Validates:
 * 1. User login, logout, and token handling
 * 2. Secure password hashing and verification
 * 3. Identity verification on protected API requests
 * 4. Server-side RBAC for Student, Teacher, and Admin
 * 5. Authentication failure and permission-denied responses
 * 6. Token expiration, tampering, and revocation (blacklisting)
 * 7. Brute-force protections and credential leakage prevention
 * 8. Safe handling of authentication secrets through environment config
 * 9. Authorization rules:
 *    - Students must not access administrative functions
 *    - Teachers must not manage other teachers unless authorized
 *    - Users must not access another user's private records without permission
 *    - Admin privileges enforced on the server
 */

const assert = require('assert');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const env = require('../src/config/env');
const db = require('../src/config/database');
const passwordService = require('../src/services/passwordService');
const tokenService = require('../src/services/tokenService');
const authService = require('../src/services/authService');
const { loginRateLimiter } = require('../src/middlewares/rateLimiter');
const HTTP_STATUS = require('../src/constants/httpStatusCodes');

async function runAuthTests() {
  console.log('\n=================================================================');
  console.log(' Teacher-Student Appointment System: Authentication & RBAC Tests ');
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

  // Pre-test setup: Reset rate limiters to clean state
  loginRateLimiter.reset();

  // Test accounts seeded in database
  const ADMIN_CREDENTIALS = { email: 'admin@university.edu', password: 'Password123!' };
  const TEACHER_MILLER = { email: 'robert.miller@university.edu', password: 'Password123!' };
  const TEACHER_JENKINS = { email: 'sarah.jenkins@university.edu', password: 'Password123!' };
  const STUDENT_ALICE = { email: 'alice.carter@student.university.edu', password: 'Password123!' };
  const STUDENT_DAVID = { email: 'david.kim@student.university.edu', password: 'Password123!' };
  const PENDING_TEACHER = { email: 'mark.peterson@university.edu', password: 'Password123!' };

  // Tokens acquired during login
  let adminToken = '';
  let teacherMillerToken = '';
  let teacherJenkinsToken = '';
  let studentAliceToken = '';
  let studentDavidToken = '';

  // ---------------------------------------------------------------------------
  // Suite 1: Cryptographic Password Hashing & Policy Validation
  // ---------------------------------------------------------------------------
  console.log('[Suite 1] Password Hashing, Verification & Policy Security...');

  await test('Generates salted bcrypt hash with workload factor 10 (never plaintext)', async () => {
    const raw = 'SecureP@ssw0rd2026!';
    const hash = await passwordService.hashPassword(raw);
    assert.notStrictEqual(hash, raw);
    assert.ok(hash.startsWith('$2b$10$') || hash.startsWith('$2a$10$'));
  });

  await test('Password verification correctly validates matching credentials', async () => {
    const raw = 'ValidKey123!';
    const hash = await passwordService.hashPassword(raw);
    const valid = await passwordService.verifyPassword(raw, hash);
    assert.strictEqual(valid, true);
  });

  await test('Password verification rejects mismatched credentials', async () => {
    const hash = await passwordService.hashPassword('OriginalPass123!');
    const valid = await passwordService.verifyPassword('WrongPass123!', hash);
    assert.strictEqual(valid, false);
  });

  await test('Password complexity engine rejects weak or non-compliant passwords', () => {
    assert.strictEqual(passwordService.validateComplexity('short').isValid, false);
    assert.strictEqual(passwordService.validateComplexity('nouppercase123!').isValid, false);
    assert.strictEqual(passwordService.validateComplexity('NOLOWERCASE123!').isValid, false);
    assert.strictEqual(passwordService.validateComplexity('NoNumbers!').isValid, false);
    assert.strictEqual(passwordService.validateComplexity('NoSymbols1234').isValid, false);
    assert.strictEqual(passwordService.validateComplexity('StrongPass123!').isValid, true);
  });

  // ---------------------------------------------------------------------------
  // Suite 2: User Login & Token Handling (All Roles)
  // ---------------------------------------------------------------------------
  console.log('\n[Suite 2] User Login & Token Handling (Student, Teacher, Admin)...');

  await test('Student login succeeds with 200 OK and returns JWT without leaking password_hash', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send(STUDENT_ALICE);

    assert.strictEqual(res.status, HTTP_STATUS.OK);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.user.role, 'STUDENT');
    assert.strictEqual(res.body.data.user.email, STUDENT_ALICE.email);
    assert.strictEqual(res.body.data.user.password_hash, undefined);
    assert.ok(typeof res.body.data.token === 'string');
    studentAliceToken = res.body.data.token;
  });

  await test('Teacher login succeeds with 200 OK and returns JWT with role TEACHER', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send(TEACHER_MILLER);

    assert.strictEqual(res.status, HTTP_STATUS.OK);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.user.role, 'TEACHER');
    assert.ok(typeof res.body.data.token === 'string');
    teacherMillerToken = res.body.data.token;
  });

  await test('Second teacher login succeeds to establish multi-user boundary tests', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send(TEACHER_JENKINS);

    assert.strictEqual(res.status, HTTP_STATUS.OK);
    assert.strictEqual(res.body.data.user.role, 'TEACHER');
    teacherJenkinsToken = res.body.data.token;
  });

  await test('Second student login succeeds to establish privacy tests', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send(STUDENT_DAVID);

    assert.strictEqual(res.status, HTTP_STATUS.OK);
    studentDavidToken = res.body.data.token;
  });

  await test('Admin login succeeds with 200 OK and returns JWT with role ADMIN', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send(ADMIN_CREDENTIALS);

    assert.strictEqual(res.status, HTTP_STATUS.OK);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.user.role, 'ADMIN');
    adminToken = res.body.data.token;
  });

  // ---------------------------------------------------------------------------
  // Suite 3: Authentication Failures & Account Status Controls
  // ---------------------------------------------------------------------------
  console.log('\n[Suite 3] Authentication Failures & Account Status Restrictions...');

  await test('Rejects incorrect password with standard 401 Unauthorized', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: STUDENT_ALICE.email, password: 'WrongPassword999!' });

    assert.strictEqual(res.status, HTTP_STATUS.UNAUTHORIZED);
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(res.body.error.code, 'INVALID_CREDENTIALS');
  });

  await test('Rejects non-existent email with uniform 401 (preventing user enumeration)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'ghost.user.nobody@university.edu', password: 'Password123!' });

    assert.strictEqual(res.status, HTTP_STATUS.UNAUTHORIZED);
    assert.strictEqual(res.body.error.code, 'INVALID_CREDENTIALS');
    assert.strictEqual(res.body.error.message, 'Invalid email or password.');
  });

  await test('Rejects malformed login requests with 400 Bad Request', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'not-an-email' }); // missing password and bad email

    assert.strictEqual(res.status, HTTP_STATUS.BAD_REQUEST);
    assert.strictEqual(res.body.error.code, 'VALIDATION_ERROR');
  });

  await test('Blocks unapproved teacher with 403 Forbidden (ACCOUNT_PENDING_APPROVAL)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send(PENDING_TEACHER);

    assert.strictEqual(res.status, HTTP_STATUS.FORBIDDEN);
    assert.strictEqual(res.body.error.code, 'ACCOUNT_PENDING_APPROVAL');
  });

  await test('Blocks suspended user accounts with 403 Forbidden (ACCOUNT_SUSPENDED)', async () => {
    // Temporarily mark user 7 as suspended for testing
    await db.execute("UPDATE users SET status = 'SUSPENDED' WHERE id = 7;");
    try {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send(STUDENT_DAVID);

      assert.strictEqual(res.status, HTTP_STATUS.FORBIDDEN);
      assert.strictEqual(res.body.error.code, 'ACCOUNT_SUSPENDED');
    } finally {
      // Guaranteed restoration of ACTIVE status even if assertion fails
      await db.execute("UPDATE users SET status = 'ACTIVE' WHERE id = 7;");
    }
  });

  // ---------------------------------------------------------------------------
  // Suite 4: Identity Verification on Protected API Requests
  // ---------------------------------------------------------------------------
  console.log('\n[Suite 4] Identity Verification & Token Inspection (/auth/me, /auth/verify)...');

  await test('Protected endpoint rejects unauthenticated request missing Authorization header', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    assert.strictEqual(res.status, HTTP_STATUS.UNAUTHORIZED);
    assert.strictEqual(res.body.error.code, 'AUTHENTICATION_REQUIRED');
  });

  await test('Protected endpoint rejects malformed Authorization header scheme', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Token ${studentAliceToken}`);

    assert.strictEqual(res.status, HTTP_STATUS.UNAUTHORIZED);
    assert.strictEqual(res.body.error.code, 'INVALID_TOKEN_FORMAT');
  });

  await test('Valid token returns authenticated identity profile on /auth/me', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${studentAliceToken}`);

    assert.strictEqual(res.status, HTTP_STATUS.OK);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.email, STUDENT_ALICE.email);
    assert.strictEqual(res.body.data.role, 'STUDENT');
    assert.ok(res.body.data.profile);
    assert.strictEqual(res.body.data.profile.student_id_number, 'STU-2026-001');
  });

  await test('Token verification endpoint /auth/verify returns valid: true', async () => {
    const res = await request(app)
      .get('/api/v1/auth/verify')
      .set('Authorization', `Bearer ${adminToken}`);

    assert.strictEqual(res.status, HTTP_STATUS.OK);
    assert.strictEqual(res.body.data.valid, true);
    assert.strictEqual(res.body.data.user.role, 'ADMIN');
  });

  // ---------------------------------------------------------------------------
  // Suite 5: Token Expiration, Tampering & Revocation (Logout)
  // ---------------------------------------------------------------------------
  console.log('\n[Suite 5] Token Expiration, Tampering & Logout Revocation...');

  await test('Rejects cryptographically tampered or forged JWT tokens with 401 INVALID_TOKEN', async () => {
    const forgedToken = jwt.sign(
      { sub: 1, role: 'ADMIN', email: 'admin@university.edu' },
      'completely_wrong_secret_attacker_key'
    );

    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${forgedToken}`);

    assert.strictEqual(res.status, HTTP_STATUS.UNAUTHORIZED);
    assert.strictEqual(res.body.error.code, 'INVALID_TOKEN');
  });

  await test('Rejects expired JWT tokens with 401 TOKEN_EXPIRED', async () => {
    // Generate token that expired 10 seconds ago
    const expiredToken = jwt.sign(
      { sub: 6, role: 'STUDENT', email: STUDENT_ALICE.email, jti: 'test-expired-jti' },
      env.jwt.secret,
      { expiresIn: '-10s' }
    );

    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${expiredToken}`);

    assert.strictEqual(res.status, HTTP_STATUS.UNAUTHORIZED);
    assert.strictEqual(res.body.error.code, 'TOKEN_EXPIRED');
  });

  await test('Logout revokes the token and records jti in revoked_tokens table', async () => {
    // 1. Log in a temporary user session
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send(STUDENT_ALICE);
    const tempToken = loginRes.body.data.token;

    // 2. Confirm token works
    const meBefore = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${tempToken}`);
    assert.strictEqual(meBefore.status, HTTP_STATUS.OK);

    // 3. Perform logout
    const logoutRes = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${tempToken}`);
    assert.strictEqual(logoutRes.status, HTTP_STATUS.OK);
    assert.strictEqual(logoutRes.body.success, true);

    // 4. Verify token is now blocked as revoked
    const meAfter = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${tempToken}`);
    assert.strictEqual(meAfter.status, HTTP_STATUS.UNAUTHORIZED);
    assert.strictEqual(meAfter.body.error.code, 'TOKEN_REVOKED');

    // 5. Verify database revoked_tokens ledger record exists
    const decoded = jwt.decode(tempToken);
    const record = await db.queryOne('SELECT * FROM revoked_tokens WHERE token_id = ?;', [decoded.jti]);
    assert.ok(record);
    assert.strictEqual(record.user_id, 6);
  });

  // ---------------------------------------------------------------------------
  // Suite 6: Brute-Force Rate Limiting Protections
  // ---------------------------------------------------------------------------
  console.log('\n[Suite 6] Brute-Force Rate Limiting & Lockout...');

  await test('Repeated failed logins trigger 429 TOO_MANY_REQUESTS lockout', async () => {
    const attackEmail = 'brute.target@university.edu';
    loginRateLimiter.reset();

    // Trigger 5 consecutive failed attempts
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/api/v1/auth/login')
        .send({ email: attackEmail, password: 'BadPasswordAttempt' });
    }

    // 6th attempt should be blocked with 429
    const blockedRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: attackEmail, password: 'BadPasswordAttempt' });

    assert.strictEqual(blockedRes.status, HTTP_STATUS.TOO_MANY_REQUESTS);
    assert.strictEqual(blockedRes.body.error.code, 'TOO_MANY_REQUESTS');
    assert.ok(blockedRes.headers['retry-after']);

    loginRateLimiter.reset();
  });

  // ---------------------------------------------------------------------------
  // Suite 7: Authorization Rule 1: Students Must NOT Access Admin Functions
  // ---------------------------------------------------------------------------
  console.log('\n[Suite 7] Rule: Students Must NOT Access Administrative Functions...');

  await test('Student attempting to access admin user list receives 403 FORBIDDEN', async () => {
    const res = await request(app)
      .get('/api/v1/admin/users')
      .set('Authorization', `Bearer ${studentAliceToken}`);

    assert.strictEqual(res.status, HTTP_STATUS.FORBIDDEN);
    assert.strictEqual(res.body.error.code, 'FORBIDDEN');
    assert.ok(res.body.error.message.includes('not authorized'));
  });

  await test('Student attempting to update user status receives 403 FORBIDDEN', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/users/7/status')
      .set('Authorization', `Bearer ${studentAliceToken}`)
      .send({ status: 'SUSPENDED' });

    assert.strictEqual(res.status, HTTP_STATUS.FORBIDDEN);
    assert.strictEqual(res.body.error.code, 'FORBIDDEN');
  });

  await test('Teacher attempting to access admin audit logs receives 403 FORBIDDEN', async () => {
    const res = await request(app)
      .get('/api/v1/admin/audit-logs')
      .set('Authorization', `Bearer ${teacherMillerToken}`);

    assert.strictEqual(res.status, HTTP_STATUS.FORBIDDEN);
    assert.strictEqual(res.body.error.code, 'FORBIDDEN');
  });

  await test('Admin successfully accesses administrative functions with 200 OK', async () => {
    const res = await request(app)
      .get('/api/v1/admin/users')
      .set('Authorization', `Bearer ${adminToken}`);

    assert.strictEqual(res.status, HTTP_STATUS.OK);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.data.users.length >= 7);
  });

  // ---------------------------------------------------------------------------
  // Suite 8: Authorization Rule 2: Teachers Must NOT Manage Other Teachers
  // ---------------------------------------------------------------------------
  console.log('\n[Suite 8] Rule: Teachers Must NOT Manage Other Teachers...');

  await test('Teacher Robert Miller (ID 1) attempting to modify Teacher Sarah Jenkins (ID 2) receives 403 FORBIDDEN', async () => {
    const res = await request(app)
      .patch('/api/v1/teachers/2') // Target: Sarah Jenkins
      .set('Authorization', `Bearer ${teacherMillerToken}`)
      .send({ officeRoom: 'Unauthorized Room Change 999' });

    assert.strictEqual(res.status, HTTP_STATUS.FORBIDDEN);
    assert.strictEqual(res.body.error.code, 'FORBIDDEN');
    assert.strictEqual(res.body.error.message, 'Access denied: Teachers cannot manage or modify other teachers.');
  });

  await test('Student attempting to modify a teacher receives 403 FORBIDDEN', async () => {
    const res = await request(app)
      .patch('/api/v1/teachers/1')
      .set('Authorization', `Bearer ${studentAliceToken}`)
      .send({ designation: 'Student Demoted You' });

    assert.strictEqual(res.status, HTTP_STATUS.FORBIDDEN);
    assert.strictEqual(res.body.error.code, 'FORBIDDEN');
  });

  await test('Teacher Robert Miller can modify their own profile with 200 OK', async () => {
    const res = await request(app)
      .patch('/api/v1/teachers/1') // Target: Self
      .set('Authorization', `Bearer ${teacherMillerToken}`)
      .send({ officeRoom: 'Room 402, Engineering Bldg (Updated)' });

    assert.strictEqual(res.status, HTTP_STATUS.OK);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.officeRoom, 'Room 402, Engineering Bldg (Updated)');
  });

  await test('Administrator can manage any teacher profile with 200 OK', async () => {
    const res = await request(app)
      .patch('/api/v1/teachers/2') // Admin modifying Sarah Jenkins
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ bio: 'Administrative override bio update.' });

    assert.strictEqual(res.status, HTTP_STATUS.OK);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.bio, 'Administrative override bio update.');
  });

  // ---------------------------------------------------------------------------
  // Suite 9: Authorization Rule 3: Private Record Privacy & Ownership
  // ---------------------------------------------------------------------------
  console.log('\n[Suite 9] Rule: Users Must NOT Access Other Users Private Records...');

  await test('Student Alice (User 6) accessing Student David (User 7) private record receives 403 FORBIDDEN', async () => {
    const res = await request(app)
      .get('/api/v1/users/7')
      .set('Authorization', `Bearer ${studentAliceToken}`);

    assert.strictEqual(res.status, HTTP_STATUS.FORBIDDEN);
    assert.strictEqual(res.body.error.code, 'FORBIDDEN');
    assert.strictEqual(res.body.error.message, "Access denied: you cannot access another user's private records without permission.");
  });

  await test('Teacher Robert (User 2) accessing Student David (User 7) private profile receives 403 FORBIDDEN', async () => {
    const res = await request(app)
      .get('/api/v1/users/7')
      .set('Authorization', `Bearer ${teacherMillerToken}`);

    assert.strictEqual(res.status, HTTP_STATUS.FORBIDDEN);
    assert.strictEqual(res.body.error.code, 'FORBIDDEN');
  });

  await test('Student David accessing their own private profile receives 200 OK', async () => {
    const res = await request(app)
      .get('/api/v1/users/7')
      .set('Authorization', `Bearer ${studentDavidToken}`);

    assert.strictEqual(res.status, HTTP_STATUS.OK);
    assert.strictEqual(res.body.data.id, 7);
    assert.strictEqual(res.body.data.email, STUDENT_DAVID.email);
  });

  await test('Administrator accessing David private record receives 200 OK', async () => {
    const res = await request(app)
      .get('/api/v1/users/7')
      .set('Authorization', `Bearer ${adminToken}`);

    assert.strictEqual(res.status, HTTP_STATUS.OK);
    assert.strictEqual(res.body.data.id, 7);
  });

  // ---------------------------------------------------------------------------
  // Suite 10: Environment Configuration & Secret Hygiene
  // ---------------------------------------------------------------------------
  console.log('\n[Suite 10] Environment Configuration & Secret Handling...');

  await test('Environment prevents booting in production with default or insecure JWT_SECRET', () => {
    assert.throws(() => {
      env.validateSecurityConfig({
        isProduction: true,
        secret: 'dev_jwt_secret_change_me_in_production_e9c3b8a1'
      });
    }, /Default development secret detected/);

    assert.throws(() => {
      env.validateSecurityConfig({
        isProduction: true,
        secret: 'short'
      });
    }, /must be at least 32 characters long/);
  });

  console.log('\n-----------------------------------------------------------------');
  console.log(`Authentication & RBAC Test Summary: ${passed} passed, ${failed} failed.`);
  console.log('=================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runAuthTests();
}

module.exports = { runAuthTests };
