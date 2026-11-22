/**
 * Cookie Authentication & CSRF Trusted-Origin Hardening Test Suite
 *
 * Verifies:
 * 1. Configured trusted origin is accepted on cookie mutation.
 * 2. Untrusted origin is rejected with 403 CSRF_REJECTED.
 * 3. Host-header manipulation (Host: evil.example) cannot add an origin to trusted allowlist.
 * 4. X-Forwarded-Host: evil.example manipulation cannot add a trusted origin.
 * 5. X-Forwarded-Proto manipulation cannot add a trusted origin.
 * 6. Origin: http://evil.example with Host: evil.example rejected with 403 CSRF_REJECTED.
 * 7. Missing Origin on browser-indicated cookie mutation rejected with 403 CSRF_REJECTED.
 * 8. Sec-Fetch-Site: cross-site rejected with 403 CSRF_REJECTED.
 * 9. Missing or incorrect X-Requested-With rejected with 403 CSRF_REJECTED.
 * 10. Valid same-origin cookie mutation (valid Origin + X-Requested-With + same-origin) accepted.
 * 11. Valid bearer-authenticated mutation remains compatible without cookie CSRF headers.
 * 12. Malformed Authorization headers fail closed (401 INVALID_TOKEN_FORMAT).
 * 13. Safe GET requests remain unaffected by CSRF checks.
 * 14. OPTIONS preflight remains unaffected.
 * 15. Wildcard (*) and malformed trusted-origin configuration cannot authorize an origin.
 * 16. Production mode without explicitly configured trusted origin fails closed for cookie mutations.
 * 17. Cookie-only session negotiation (X-Session-Mode: cookie-only) on login omits JWT in body.
 * 18. Cookie-only session negotiation (X-Session-Mode: cookie-only) on register omits JWT in body.
 * 19. Session restoration via GET /api/v1/auth/me with cookie and anti-caching headers.
 * 20. Revocation enforcement: revoked cookie token rejected with 401 TOKEN_REVOKED.
 * 21. Role-based access control with cookie authentication.
 */

require('./setup');
const path = require('path');
const assert = require('assert');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const db = require('../src/config/database');
const env = require('../src/config/env');
const HTTP_STATUS = require('../src/constants/httpStatusCodes');
const { loginRateLimiter, registrationRateLimiter } = require('../src/middlewares/rateLimiter');
const { getTrustedOrigins } = require('../src/middlewares/authMiddleware');

// Pre-Execution Isolation Verification
const devDbPath = path.normalize(path.resolve(process.cwd(), 'database/appointment_system.db'));
const currentDbPath = path.normalize(db.getPath());

if (process.env.NODE_ENV !== 'test') {
  throw new Error(`[CRITICAL TEST ERROR] NODE_ENV must be 'test'. Found: ${process.env.NODE_ENV}`);
}
if (!currentDbPath.toLowerCase().includes('test')) {
  throw new Error(`[CRITICAL TEST ERROR] Database filename must contain 'test'. Found: ${currentDbPath}`);
}
if (currentDbPath.toLowerCase() === devDbPath.toLowerCase()) {
  throw new Error(`[CRITICAL SAFETY VIOLATION] Test runner target resolved to development database: ${currentDbPath}`);
}

async function runCookieAuthTests() {
  console.log('\n=================================================================');
  console.log(' Cookie Authentication & CSRF Trusted-Origin Hardening Tests     ');
  console.log(' Isolated Test DB: ' + currentDbPath);
  console.log('=================================================================\n');

  let passed = 0;
  let failed = 0;
  const testResults = [];

  async function test(name, fn) {
    try {
      loginRateLimiter.reset();
      registrationRateLimiter.reset();
      await fn();
      console.log(`  [PASS] ${name}`);
      passed++;
      testResults.push({ name, status: 'PASS' });
    } catch (err) {
      console.error(`  [FAIL] ${name}`);
      console.error(`         ${err.message}`);
      if (err.stack && process.env.DEBUG) console.error(err.stack);
      failed++;
      testResults.push({ name, status: 'FAIL', error: err.message });
    }
  }

  const createdUserIds = [];

  const cleanup = async () => {
    if (createdUserIds.length > 0) {
      const placeholders = createdUserIds.map(() => '?').join(', ');
      await db.execute(`DELETE FROM audit_logs WHERE actor_id IN (${placeholders});`, createdUserIds);
      await db.execute(`DELETE FROM student_profiles WHERE user_id IN (${placeholders});`, createdUserIds);
      await db.execute(`DELETE FROM revoked_tokens WHERE user_id IN (${placeholders});`, createdUserIds);
      await db.execute(`DELETE FROM users WHERE id IN (${placeholders});`, createdUserIds);
      createdUserIds.length = 0;
    }
  };

  const getFreshSession = async (email = 'alice.carter@student.university.edu', password = 'Password123!') => {
    loginRateLimiter.reset();
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(HTTP_STATUS.OK);

    assert.ok(res.headers['set-cookie'], 'Login must emit Set-Cookie');
    const cookies = res.headers['set-cookie'];
    const cookieHeader = Array.isArray(cookies) ? cookies.join('; ') : cookies;
    return {
      user: res.body.data.user,
      token: res.body.data.token,
      cookie: cookieHeader
    };
  };

  try {
    // -------------------------------------------------------------
    // Scenario 1: Configured trusted origin is accepted on cookie mutation
    // -------------------------------------------------------------
    await test('Scenario 1: Configured trusted origin is accepted on cookie mutation', async () => {
      const session = await getFreshSession();
      const res = await request(app)
        .post('/api/v1/auth/logout')
        .set('Cookie', session.cookie)
        .set('Origin', 'http://localhost:3000')
        .set('X-Requested-With', 'XMLHttpRequest')
        .set('Sec-Fetch-Site', 'same-origin')
        .expect(HTTP_STATUS.OK);

      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.loggedOut, true);
    });

    // -------------------------------------------------------------
    // Scenario 2: Untrusted origin is rejected with 403 CSRF_REJECTED
    // -------------------------------------------------------------
    await test('Scenario 2: Untrusted origin is rejected with 403 CSRF_REJECTED', async () => {
      const session = await getFreshSession();
      const res = await request(app)
        .post('/api/v1/auth/logout')
        .set('Cookie', session.cookie)
        .set('Origin', 'http://evil.attacker.com')
        .set('X-Requested-With', 'XMLHttpRequest')
        .set('Sec-Fetch-Site', 'same-site')
        .expect(HTTP_STATUS.FORBIDDEN);

      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'CSRF_REJECTED');
    });

    // -------------------------------------------------------------
    // Scenario 3: Host-header manipulation cannot add an origin to trusted allowlist
    // -------------------------------------------------------------
    await test('Scenario 3: Host-header manipulation (Host: evil.example) cannot add an origin to trusted allowlist', async () => {
      const session = await getFreshSession();
      const res = await request(app)
        .post('/api/v1/auth/logout')
        .set('Cookie', session.cookie)
        .set('Host', 'evil.example')
        .set('Origin', 'http://evil.example')
        .set('X-Requested-With', 'XMLHttpRequest')
        .expect(HTTP_STATUS.FORBIDDEN);

      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'CSRF_REJECTED');
    });

    // -------------------------------------------------------------
    // Scenario 4: X-Forwarded-Host manipulation cannot add a trusted origin
    // -------------------------------------------------------------
    await test('Scenario 4: X-Forwarded-Host: evil.example manipulation cannot add a trusted origin', async () => {
      const session = await getFreshSession();
      const res = await request(app)
        .post('/api/v1/auth/logout')
        .set('Cookie', session.cookie)
        .set('X-Forwarded-Host', 'evil.example')
        .set('Origin', 'http://evil.example')
        .set('X-Requested-With', 'XMLHttpRequest')
        .expect(HTTP_STATUS.FORBIDDEN);

      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'CSRF_REJECTED');
    });

    // -------------------------------------------------------------
    // Scenario 5: X-Forwarded-Proto manipulation cannot add a trusted origin
    // -------------------------------------------------------------
    await test('Scenario 5: X-Forwarded-Proto manipulation cannot add a trusted origin', async () => {
      const session = await getFreshSession();
      const res = await request(app)
        .post('/api/v1/auth/logout')
        .set('Cookie', session.cookie)
        .set('X-Forwarded-Proto', 'https')
        .set('Host', 'evil.example')
        .set('Origin', 'https://evil.example')
        .set('X-Requested-With', 'XMLHttpRequest')
        .expect(HTTP_STATUS.FORBIDDEN);

      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'CSRF_REJECTED');
    });

    // -------------------------------------------------------------
    // Scenario 6: Origin and Host matching evil.example rejected with 403 CSRF_REJECTED
    // -------------------------------------------------------------
    await test('Scenario 6: Origin http://evil.example with Host evil.example is rejected with 403 CSRF_REJECTED', async () => {
      const session = await getFreshSession();
      const res = await request(app)
        .post('/api/v1/auth/logout')
        .set('Cookie', session.cookie)
        .set('Host', 'evil.example')
        .set('Origin', 'http://evil.example')
        .set('X-Requested-With', 'XMLHttpRequest')
        .expect(HTTP_STATUS.FORBIDDEN);

      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'CSRF_REJECTED');
    });

    // -------------------------------------------------------------
    // Scenario 7: Missing Origin on browser-indicated cookie mutation rejected with 403 CSRF_REJECTED
    // -------------------------------------------------------------
    await test('Scenario 7: Missing Origin on a browser-indicated cookie mutation is rejected with 403 CSRF_REJECTED', async () => {
      const session = await getFreshSession();
      const res = await request(app)
        .post('/api/v1/auth/logout')
        .set('Cookie', session.cookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .set('Sec-Fetch-Mode', 'cors')
        .expect(HTTP_STATUS.FORBIDDEN);

      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'CSRF_REJECTED');
    });

    // -------------------------------------------------------------
    // Scenario 8: Sec-Fetch-Site: cross-site is rejected with 403 CSRF_REJECTED
    // -------------------------------------------------------------
    await test('Scenario 8: Sec-Fetch-Site: cross-site is rejected with 403 CSRF_REJECTED', async () => {
      const session = await getFreshSession();
      const res = await request(app)
        .post('/api/v1/auth/logout')
        .set('Cookie', session.cookie)
        .set('Origin', 'http://localhost:3000')
        .set('Sec-Fetch-Site', 'cross-site')
        .set('X-Requested-With', 'XMLHttpRequest')
        .expect(HTTP_STATUS.FORBIDDEN);

      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'CSRF_REJECTED');
    });

    // -------------------------------------------------------------
    // Scenario 9: Missing or incorrect X-Requested-With header on browser cookie mutation rejected
    // -------------------------------------------------------------
    await test('Scenario 9: Missing or incorrect X-Requested-With header on browser cookie mutation is rejected with 403 CSRF_REJECTED', async () => {
      const session = await getFreshSession();
      // A. Missing X-Requested-With
      const res1 = await request(app)
        .post('/api/v1/auth/logout')
        .set('Cookie', session.cookie)
        .set('Origin', 'http://localhost:3000')
        .set('Sec-Fetch-Site', 'same-origin')
        .expect(HTTP_STATUS.FORBIDDEN);

      assert.strictEqual(res1.body.success, false);
      assert.strictEqual(res1.body.error.code, 'CSRF_REJECTED');

      // B. Incorrect X-Requested-With value
      const res2 = await request(app)
        .post('/api/v1/auth/logout')
        .set('Cookie', session.cookie)
        .set('Origin', 'http://localhost:3000')
        .set('X-Requested-With', 'FetchAPI')
        .set('Sec-Fetch-Site', 'same-origin')
        .expect(HTTP_STATUS.FORBIDDEN);

      assert.strictEqual(res2.body.success, false);
      assert.strictEqual(res2.body.error.code, 'CSRF_REJECTED');
    });

    // -------------------------------------------------------------
    // Scenario 10: Valid same-origin cookie mutation accepted
    // -------------------------------------------------------------
    await test('Scenario 10: Valid same-origin cookie mutation (valid Origin + X-Requested-With: XMLHttpRequest + Sec-Fetch-Site: same-origin) is accepted', async () => {
      const session = await getFreshSession();
      const res = await request(app)
        .post('/api/v1/auth/logout')
        .set('Cookie', session.cookie)
        .set('Origin', 'http://localhost:3000')
        .set('X-Requested-With', 'XMLHttpRequest')
        .set('Sec-Fetch-Site', 'same-origin')
        .expect(HTTP_STATUS.OK);

      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.loggedOut, true);
    });

    // -------------------------------------------------------------
    // Scenario 11: Valid bearer-authenticated mutation remains compatible without cookie CSRF headers
    // -------------------------------------------------------------
    await test('Scenario 11: Valid bearer-authenticated mutation remains compatible without cookie CSRF headers', async () => {
      const session = await getFreshSession();
      const res = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${session.token}`)
        .expect(HTTP_STATUS.OK);

      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.loggedOut, true);
    });

    // -------------------------------------------------------------
    // Scenario 12: Malformed Authorization headers fail closed (401 INVALID_TOKEN_FORMAT)
    // -------------------------------------------------------------
    await test('Scenario 12: Malformed Authorization headers fail closed (401 INVALID_TOKEN_FORMAT)', async () => {
      // Missing token part
      const res1 = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer')
        .expect(HTTP_STATUS.UNAUTHORIZED);

      assert.strictEqual(res1.body.success, false);
      assert.strictEqual(res1.body.error.code, 'INVALID_TOKEN_FORMAT');

      // Wrong scheme
      const res2 = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', 'Basic dXNlcjpwYXNz')
        .expect(HTTP_STATUS.UNAUTHORIZED);

      assert.strictEqual(res2.body.success, false);
      assert.strictEqual(res2.body.error.code, 'INVALID_TOKEN_FORMAT');

      // Excess parts
      const res3 = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer token part3')
        .expect(HTTP_STATUS.UNAUTHORIZED);

      assert.strictEqual(res3.body.success, false);
      assert.strictEqual(res3.body.error.code, 'INVALID_TOKEN_FORMAT');
    });

    // -------------------------------------------------------------
    // Scenario 13: Safe GET requests remain unaffected by CSRF checks
    // -------------------------------------------------------------
    await test('Scenario 13: Safe GET requests remain unaffected by CSRF checks', async () => {
      const session = await getFreshSession();
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Cookie', session.cookie)
        .set('Origin', 'http://evil.example')
        .expect(HTTP_STATUS.OK);

      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.email, 'alice.carter@student.university.edu');
    });

    // -------------------------------------------------------------
    // Scenario 14: OPTIONS preflight remains unaffected
    // -------------------------------------------------------------
    await test('Scenario 14: OPTIONS preflight remains unaffected', async () => {
      const res = await request(app)
        .options('/api/v1/auth/logout')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'POST');

      assert.ok(
        res.status === HTTP_STATUS.OK || res.status === 204,
        `OPTIONS status should be 200 or 204, got ${res.status}`
      );
    });

    // -------------------------------------------------------------
    // Scenario 15: Wildcard (*) and malformed trusted-origin configuration cannot authorize an origin
    // -------------------------------------------------------------
    await test('Scenario 15: Wildcard (*) and malformed trusted-origin configuration cannot authorize an origin', async () => {
      // 1. Direct trusted origins helper test
      const spoofedReq = {
        headers: {
          host: 'attacker-injected.example',
          'x-forwarded-host': 'spoofed.example',
          'x-forwarded-proto': 'https'
        }
      };
      const trusted = getTrustedOrigins(spoofedReq);
      assert.strictEqual(trusted.has('*'), false, 'Wildcard must never be trusted');
      assert.strictEqual(trusted.has('http://attacker-injected.example'), false);
      assert.strictEqual(trusted.has('https://attacker-injected.example'), false);
      assert.strictEqual(trusted.has('http://spoofed.example'), false);

      // 2. Supertest with malformed Origin header
      const session = await getFreshSession();
      const res = await request(app)
        .post('/api/v1/auth/logout')
        .set('Cookie', session.cookie)
        .set('Origin', 'http://localhost:3000/malformed/path')
        .set('X-Requested-With', 'XMLHttpRequest')
        .expect(HTTP_STATUS.FORBIDDEN);

      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'CSRF_REJECTED');
    });

    // -------------------------------------------------------------
    // Scenario 16: Production mode without explicitly configured trusted origin fails closed
    // -------------------------------------------------------------
    await test('Scenario 16: Production mode without explicitly configured trusted origin fails closed for cookie mutations', async () => {
      const prevEnv = process.env.NODE_ENV;
      const prevCors = process.env.CORS_ORIGIN;
      try {
        process.env.NODE_ENV = 'production';
        delete process.env.CORS_ORIGIN;

        const prodTrusted = getTrustedOrigins();
        assert.strictEqual(prodTrusted.size, 0, 'Production trusted origins must be empty when CORS_ORIGIN is unconfigured');

        const session = await getFreshSession();
        const res = await request(app)
          .post('/api/v1/auth/logout')
          .set('Cookie', session.cookie)
          .set('Origin', 'http://localhost:3000')
          .set('X-Requested-With', 'XMLHttpRequest')
          .set('Sec-Fetch-Site', 'same-origin')
          .expect(HTTP_STATUS.FORBIDDEN);

        assert.strictEqual(res.body.success, false);
        assert.strictEqual(res.body.error.code, 'CSRF_REJECTED');
      } finally {
        process.env.NODE_ENV = prevEnv;
        if (prevCors !== undefined) {
          process.env.CORS_ORIGIN = prevCors;
        } else {
          delete process.env.CORS_ORIGIN;
        }
      }
    });

    // -------------------------------------------------------------
    // Scenario 17: Cookie-only session negotiation on login omits JWT in body
    // -------------------------------------------------------------
    await test('Scenario 17: Cookie-only session negotiation (X-Session-Mode: cookie-only) on login omits JWT in body', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .set('X-Session-Mode', 'cookie-only')
        .send({
          email: 'alice.carter@student.university.edu',
          password: 'Password123!'
        })
        .expect(HTTP_STATUS.OK);

      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.user.email, 'alice.carter@student.university.edu');
      assert.strictEqual(res.body.data.token, undefined, 'JWT token must NOT be exposed in response body when cookie-only negotiated');
      assert.ok(res.headers['set-cookie'], 'Set-Cookie header must be emitted');

      const cookieStr = Array.isArray(res.headers['set-cookie']) ? res.headers['set-cookie'].join('; ') : res.headers['set-cookie'];
      assert.ok(cookieStr.includes('token='), 'Cookie token must be set');
      assert.ok(cookieStr.toLowerCase().includes('httponly'), 'Cookie must be HttpOnly');
      assert.ok(cookieStr.toLowerCase().includes('samesite=strict'), 'Cookie must have SameSite=Strict');
    });

    // -------------------------------------------------------------
    // Scenario 18: Cookie-only session negotiation on registration omits JWT in body
    // -------------------------------------------------------------
    await test('Scenario 18: Cookie-only session negotiation (X-Session-Mode: cookie-only) on register omits JWT in body', async () => {
      const timestamp = Date.now();
      const testEmail = `cookie.student.${timestamp}@student.university.edu`;
      const testStudentId = `STU-CK-${String(timestamp).slice(-6)}`;

      const res = await request(app)
        .post('/api/v1/auth/register')
        .set('X-Session-Mode', 'cookie-only')
        .send({
          email: testEmail,
          password: 'Password123!',
          firstName: 'Cookie',
          lastName: 'Tester',
          studentIdNumber: testStudentId,
          departmentId: 1
        })
        .expect(HTTP_STATUS.CREATED);

      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.user.email, testEmail);
      assert.strictEqual(res.body.data.token, undefined, 'JWT token must NOT be exposed in response body when cookie-only negotiated');
      assert.ok(res.headers['set-cookie'], 'Set-Cookie header must be emitted');
      createdUserIds.push(res.body.data.user.id);
    });

    // -------------------------------------------------------------
    // Scenario 19: Session restoration via GET /api/v1/auth/me with cookie and anti-caching headers
    // -------------------------------------------------------------
    await test('Scenario 19: Session restoration via GET /api/v1/auth/me with cookie and anti-caching headers', async () => {
      const session = await getFreshSession();
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Cookie', session.cookie)
        .expect(HTTP_STATUS.OK);

      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.email, 'alice.carter@student.university.edu');
      assert.strictEqual(res.body.data.role, 'STUDENT');

      // Verify anti-caching headers
      assert.ok(res.headers['cache-control'].includes('no-store'), 'Cache-Control must contain no-store');
      assert.ok(res.headers['cache-control'].includes('no-cache'), 'Cache-Control must contain no-cache');
      assert.strictEqual(res.headers['pragma'], 'no-cache');
      assert.strictEqual(res.headers['expires'], '0');
    });

    // -------------------------------------------------------------
    // Scenario 20: Revocation enforcement: revoked cookie token rejected with 401 TOKEN_REVOKED
    // -------------------------------------------------------------
    await test('Scenario 20: Revocation enforcement: revoked cookie token rejected with 401 TOKEN_REVOKED', async () => {
      const session = await getFreshSession();

      // Logout to revoke the session
      await request(app)
        .post('/api/v1/auth/logout')
        .set('Cookie', session.cookie)
        .set('Origin', 'http://localhost:3000')
        .set('X-Requested-With', 'XMLHttpRequest')
        .set('Sec-Fetch-Site', 'same-origin')
        .expect(HTTP_STATUS.OK);

      // Attempt to reuse revoked cookie
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Cookie', session.cookie)
        .expect(HTTP_STATUS.UNAUTHORIZED);

      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'TOKEN_REVOKED');
    });

    // -------------------------------------------------------------
    // Scenario 21: Role-based access control with cookie authentication
    // -------------------------------------------------------------
    await test('Scenario 21: Role-based access control with cookie authentication', async () => {
      // A. Student access to admin endpoint is denied
      const studentSession = await getFreshSession('alice.carter@student.university.edu', 'Password123!');
      const studentDenial = await request(app)
        .get('/api/v1/admin/users')
        .set('Cookie', studentSession.cookie)
        .expect(HTTP_STATUS.FORBIDDEN);

      assert.strictEqual(studentDenial.body.success, false);

      // B. Admin access to admin endpoint is permitted
      const adminSession = await getFreshSession('admin@university.edu', 'Password123!');
      const adminAccess = await request(app)
        .get('/api/v1/admin/users')
        .set('Cookie', adminSession.cookie)
        .expect(HTTP_STATUS.OK);

      assert.strictEqual(adminAccess.body.success, true);
      assert.ok(Array.isArray(adminAccess.body.data.users));
    });

  } finally {
    await cleanup();
  }

  console.log('\n=================================================================');
  console.log(` Summary: ${passed} passed, ${failed} failed out of ${passed + failed} cookie auth scenarios`);
  console.log('=================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runCookieAuthTests().catch((err) => {
  console.error('[FATAL RUNNER EXCEPTION]', err);
  process.exit(1);
});
