/**
 * User Logout & Token Revocation Test Suite (GitHub Issue #41)
 *
 * Verifies:
 * 1. Server-side token invalidation via persistent database revocation ledger (`revoked_tokens`).
 * 2. Revoked access tokens are rejected with 401 Unauthorized (`TOKEN_REVOKED`) on subsequent requests.
 * 3. Clearing authentication state and credentials via Set-Cookie and Clear-Site-Data headers.
 * 4. Anti-caching headers (`Cache-Control: no-store`, `Pragma: no-cache`) to prevent back-navigation cache display.
 * 5. Redirection to `/login` for browser navigation logouts.
 * 6. Role coverage: Verifies logout and token invalidation for Student, Teacher, and Admin accounts.
 * 7. Cookie-based authentication and cookie revocation.
 * 8. Audit trail logging for all logout actions in `audit_logs`.
 */

const assert = require('assert');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const db = require('../src/config/database');
const env = require('../src/config/env');
const HTTP_STATUS = require('../src/constants/httpStatusCodes');

async function runLogoutTests() {
  console.log('\n=================================================================');
  console.log(' Teacher-Student Appointment System: Issue #41 Logout Tests      ');
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

  const loginUser = async (email, password = 'Password123!') => {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password });
    if (res.status !== 200) {
      throw new Error(`Failed to login as ${email}: ${JSON.stringify(res.body)}`);
    }
    return {
      user: res.body.data.user,
      token: res.body.data.token,
      cookie: res.headers['set-cookie']
    };
  };

  try {
    // -------------------------------------------------------------
    // Section 1: Server-Side Invalidation & Revocation Ledger
    // -------------------------------------------------------------
    await test('Stateless Token Revocation: Logout records token jti in revoked_tokens table', async () => {
      const { token, user } = await loginUser('alice.carter@student.university.edu');
      const decoded = jwt.decode(token);
      assert.ok(decoded.jti, 'Access token must contain a unique jti');

      const logoutRes = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${token}`);

      assert.strictEqual(logoutRes.status, HTTP_STATUS.OK);
      assert.strictEqual(logoutRes.body.success, true);
      assert.strictEqual(logoutRes.body.data.loggedOut, true);

      // Verify token jti exists in revoked_tokens database table
      const revokedRecord = await db.queryOne(
        'SELECT token_id, user_id FROM revoked_tokens WHERE token_id = ?;',
        [decoded.jti]
      );
      assert.ok(revokedRecord, 'Token jti must be stored in revoked_tokens table');
      assert.strictEqual(revokedRecord.user_id, user.id);
    });

    await test('Token Invalidation: Subsequent protected requests with revoked token return 401 TOKEN_REVOKED', async () => {
      const { token } = await loginUser('alice.carter@student.university.edu');

      // Verify valid before logout
      const beforeRes = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`);
      assert.strictEqual(beforeRes.status, HTTP_STATUS.OK);

      // Logout
      await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${token}`);

      // Attempt access to auth identity endpoint
      const afterRes = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`);
      assert.strictEqual(afterRes.status, HTTP_STATUS.UNAUTHORIZED);
      assert.strictEqual(afterRes.body.error.code, 'TOKEN_REVOKED');

      // Attempt access to appointment endpoint
      const apptRes = await request(app)
        .get('/api/v1/appointments')
        .set('Authorization', `Bearer ${token}`);
      assert.strictEqual(apptRes.status, HTTP_STATUS.UNAUTHORIZED);
      assert.strictEqual(apptRes.body.error.code, 'TOKEN_REVOKED');
    });

    // -------------------------------------------------------------
    // Section 2: Client Storage Clearing & Browser Header Protections
    // -------------------------------------------------------------
    await test('Storage Hygiene: Logout sets Clear-Site-Data header to wipe browser cache, cookies, and storage', async () => {
      const { token } = await loginUser('alice.carter@student.university.edu');

      const res = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${token}`);

      assert.strictEqual(res.status, HTTP_STATUS.OK);
      const clearSiteData = res.headers['clear-site-data'];
      assert.ok(clearSiteData, 'Clear-Site-Data header must be sent on logout');
      assert.ok(clearSiteData.includes('cache'));
      assert.ok(clearSiteData.includes('cookies'));
      assert.ok(clearSiteData.includes('storage'));
    });

    await test('Cookie Invalidation: Logout expires and clears auth cookies', async () => {
      const { token } = await loginUser('alice.carter@student.university.edu');

      const res = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${token}`);

      assert.strictEqual(res.status, HTTP_STATUS.OK);
      const setCookies = res.headers['set-cookie'];
      assert.ok(Array.isArray(setCookies) && setCookies.length > 0, 'Set-Cookie headers must be returned to clear cookies');

      // Verify cookies are expired (e.g. Expires in 1970 or Max-Age=0)
      const tokenCookieCleared = setCookies.some((c) => c.startsWith('token=;') || c.includes('Expires=Thu, 01 Jan 1970'));
      assert.ok(tokenCookieCleared, 'token cookie must be cleared upon logout');
    });

    await test('Anti-Caching Headers: Protected endpoints and logout set Cache-Control: no-store to prevent back-navigation display', async () => {
      const { token } = await loginUser('alice.carter@student.university.edu');

      // Check Cache-Control on authenticated endpoint
      const meRes = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`);
      assert.strictEqual(meRes.status, HTTP_STATUS.OK);
      assert.ok(meRes.headers['cache-control'].includes('no-store'), 'Protected endpoints must have Cache-Control: no-store');

      // Check Cache-Control on logout
      const logoutRes = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${token}`);
      assert.strictEqual(logoutRes.status, HTTP_STATUS.OK);
      assert.ok(logoutRes.headers['cache-control'].includes('no-store'), 'Logout response must have Cache-Control: no-store');
      assert.strictEqual(logoutRes.headers['pragma'], 'no-cache');
    });

    // -------------------------------------------------------------
    // Section 3: Redirection & Browser Navigation Handling
    // -------------------------------------------------------------
    await test('Redirection: API JSON logout returns redirectTo: /login in response body', async () => {
      const { token } = await loginUser('alice.carter@student.university.edu');

      const res = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${token}`);

      assert.strictEqual(res.status, HTTP_STATUS.OK);
      assert.strictEqual(res.body.data.redirectTo, '/login');
    });

    await test('Redirection: Browser navigation logout (GET with redirect=true) performs HTTP 302 Found redirect to /login', async () => {
      const { token } = await loginUser('alice.carter@student.university.edu');

      const res = await request(app)
        .get('/api/v1/auth/logout?redirect=true')
        .set('Authorization', `Bearer ${token}`);

      assert.strictEqual(res.status, 302);
      assert.strictEqual(res.headers.location, '/login');

      // Verify token was revoked during redirect
      const decoded = jwt.decode(token);
      const isRevoked = await db.queryOne('SELECT id FROM revoked_tokens WHERE token_id = ?;', [decoded.jti]);
      assert.ok(isRevoked, 'Token must be revoked even when using browser GET logout');
    });

    await test('Redirection: Browser HTML logout request (Accept: text/html) redirects to /login', async () => {
      const { token } = await loginUser('alice.carter@student.university.edu');

      const res = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${token}`)
        .set('Accept', 'text/html');

      assert.strictEqual(res.status, 302);
      assert.strictEqual(res.headers.location, '/login');
    });

    // -------------------------------------------------------------
    // Section 4: Role-Based Verification (Student, Teacher, Admin)
    // -------------------------------------------------------------
    await test('Role Verification: Student account logout invalidates token and records audit log', async () => {
      const { token, user } = await loginUser('alice.carter@student.university.edu');

      const res = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${token}`);
      assert.strictEqual(res.status, HTTP_STATUS.OK);

      // Verify token cannot be reused
      const meRes = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`);
      assert.strictEqual(meRes.status, HTTP_STATUS.UNAUTHORIZED);
      assert.strictEqual(meRes.body.error.code, 'TOKEN_REVOKED');

      // Verify audit log entry
      const audit = await db.queryOne(
        "SELECT id, action, actor_id FROM audit_logs WHERE action = 'AUTH_LOGOUT' AND actor_id = ? ORDER BY id DESC LIMIT 1;",
        [user.id]
      );
      assert.ok(audit, 'Audit log entry must be created for student logout');
    });

    await test('Role Verification: Teacher account logout invalidates token and blocks subsequent access', async () => {
      const { token, user } = await loginUser('robert.miller@university.edu');

      const res = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${token}`);
      assert.strictEqual(res.status, HTTP_STATUS.OK);

      // Verify teacher cannot access protected endpoint
      const meRes = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`);
      assert.strictEqual(meRes.status, HTTP_STATUS.UNAUTHORIZED);
      assert.strictEqual(meRes.body.error.code, 'TOKEN_REVOKED');

      // Verify audit log
      const audit = await db.queryOne(
        "SELECT id, action, actor_id FROM audit_logs WHERE action = 'AUTH_LOGOUT' AND actor_id = ? ORDER BY id DESC LIMIT 1;",
        [user.id]
      );
      assert.ok(audit, 'Audit log entry must be created for teacher logout');
    });

    await test('Role Verification: Admin account logout invalidates token and blocks admin access', async () => {
      const { token, user } = await loginUser('admin@university.edu');

      const res = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${token}`);
      assert.strictEqual(res.status, HTTP_STATUS.OK);

      // Verify admin cannot access admin endpoint
      const adminRes = await request(app)
        .get('/api/v1/admin/users')
        .set('Authorization', `Bearer ${token}`);
      assert.strictEqual(adminRes.status, HTTP_STATUS.UNAUTHORIZED);
      assert.strictEqual(adminRes.body.error.code, 'TOKEN_REVOKED');

      // Verify audit log
      const audit = await db.queryOne(
        "SELECT id, action, actor_id FROM audit_logs WHERE action = 'AUTH_LOGOUT' AND actor_id = ? ORDER BY id DESC LIMIT 1;",
        [user.id]
      );
      assert.ok(audit, 'Audit log entry must be created for admin logout');
    });

    // -------------------------------------------------------------
    // Section 5: Cookie-Based Authentication & Logout
    // -------------------------------------------------------------
    await test('Cookie Authentication: User can authenticate via cookie and cookie is invalidated on logout', async () => {
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'alice.carter@student.university.edu', password: 'Password123!' });

      const cookieHeader = loginRes.headers['set-cookie'];
      assert.ok(cookieHeader, 'Login must set auth cookie');

      // Access protected endpoint using cookie only (no Authorization header)
      const meRes = await request(app)
        .get('/api/v1/auth/me')
        .set('Cookie', cookieHeader);
      assert.strictEqual(meRes.status, HTTP_STATUS.OK);
      assert.strictEqual(meRes.body.data.email, 'alice.carter@student.university.edu');

      // Logout using cookie
      const logoutRes = await request(app)
        .post('/api/v1/auth/logout')
        .set('Cookie', cookieHeader);
      assert.strictEqual(logoutRes.status, HTTP_STATUS.OK);

      // Subsequent access with that cookie must now be rejected
      const meAfterRes = await request(app)
        .get('/api/v1/auth/me')
        .set('Cookie', cookieHeader);
      assert.strictEqual(meAfterRes.status, HTTP_STATUS.UNAUTHORIZED);
      assert.strictEqual(meAfterRes.body.error.code, 'TOKEN_REVOKED');
    });

  } finally {
    console.log('\n--- Test run completed ---');
  }

  console.log('\n=================================================================');
  console.log(` Summary: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  console.log('=================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runLogoutTests().catch((err) => {
    console.error('Fatal error during test run:', err);
    process.exit(1);
  });
}

module.exports = runLogoutTests;
