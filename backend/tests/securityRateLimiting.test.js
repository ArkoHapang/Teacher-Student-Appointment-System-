/**
 * Comprehensive Rate Limiting & Client IP Security Test Suite
 *
 * Verifies:
 * 1. Client IP Resolver:
 *    - Valid IPv4 Fly-Client-IP header
 *    - Valid IPv6 Fly-Client-IP header
 *    - Missing Fly-Client-IP falls back to socket address
 *    - Empty Fly-Client-IP falls back to socket address
 *    - Malformed IP strings fail closed to socket address
 *    - Oversized IP strings (> 45 chars) fail closed to socket address
 *    - Spoofed X-Forwarded-For headers are strictly ignored
 *    - Multiple forwarded IP addresses in X-Forwarded-For are ignored
 *    - IPv6-mapped IPv4 addresses (::ffff:x.x.x.x) normalized to IPv4
 *    - IPv6 loopback (::1) normalized to 127.0.0.1
 *    - Local development fallback to socket remoteAddress
 * 2. Login Rate Limiting:
 *    - Repeated failed logins against single account trigger account lockout (5 attempts)
 *    - 6th failed attempt rejected with 429 and Retry-After header
 *    - Unknown account failed attempts tracked identically (enumeration resistance)
 *    - Successful login resets account failed counter
 *    - Password spraying simulation: 30 failed attempts from same IP across different accounts trigger IP spray block
 *    - 31st attempt from same IP rejected with 429 network spray message
 *    - Legitimate users on shared campus IP with occasional typos unaffected by spray threshold
 *    - In-memory storage isolation and reset behavior
 *    - Bounded memory hygiene and expired key pruning
 * 3. Registration Rate Limiting:
 *    - Five different users sharing one campus IP can register successfully (SB25-13)
 *    - Repeated registration attempts against single email address blocked after threshold
 *    - High-volume automated registration attempts from single IP limited
 *    - Malformed and missing client-IP headers fall back safely
 *    - Duplicate email conflict handling remains intact (409 Conflict)
 * 4. Regression & Authentication Invariants:
 *    - Legitimate student registration succeeds
 *    - Legitimate student and teacher authentication succeeds
 *    - Token revocation on logout succeeds
 */

require('./setup');
const path = require('path');
const assert = require('assert');
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/database');
const env = require('../src/config/env');
const HTTP_STATUS = require('../src/constants/httpStatusCodes');
const {
  resolveClientIp,
  isValidIp,
  normalizeIp,
  isFlyProxyTrusted
} = require('../src/utils/clientIpResolver');
const {
  BaseRateLimiter,
  LoginRateLimiter,
  RegistrationRateLimiter,
  loginRateLimiter,
  registrationRateLimiter
} = require('../src/middlewares/rateLimiter');

// Safety assertion: test must never run against production/development database
const devDbPath = path.normalize(path.resolve(process.cwd(), 'database/appointment_system.db'));
const currentDbPath = path.normalize(db.getPath());
if (process.env.NODE_ENV !== 'test') {
  throw new Error(`[CRITICAL TEST ERROR] NODE_ENV must be 'test'. Found: ${process.env.NODE_ENV}`);
}
if (currentDbPath.toLowerCase() === devDbPath.toLowerCase()) {
  throw new Error(`[CRITICAL TEST ERROR] Refusing execution against development database: ${currentDbPath}`);
}

async function runSecurityRateLimitingTests() {
  console.log('\n=================================================================');
  console.log(' Teacher-Student Appointment System: Security Rate Limiting Suite ');
  console.log(` Target Test Database: ${currentDbPath}`);
  console.log('=================================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  [FAIL] ${name}`);
      console.error(`         ${err.message}`);
      if (err.stack) {
        console.error(`         ${err.stack.split('\n').slice(1, 4).join('\n        ')}`);
      }
      failed++;
    }
  }

  try {
    // =========================================================================
    // SECTION 1: Client IP Resolver Unit & Edge-Case Verifications
    // =========================================================================
    console.log('[Section 1] Centralized Client IP Resolver Security Verifications...');

    await test('1.1: Resolves valid IPv4 address from Fly-Client-IP header', async () => {
      const mockReq = {
        headers: { 'fly-client-ip': '203.0.113.195' },
        socket: { remoteAddress: '127.0.0.1' }
      };
      const ip = resolveClientIp(mockReq);
      assert.strictEqual(ip, '203.0.113.195');
    });

    await test('1.2: Resolves valid IPv6 address from Fly-Client-IP header', async () => {
      const mockReq = {
        headers: { 'fly-client-ip': '2001:db8:85a3::8a2e:370:7334' },
        socket: { remoteAddress: '::1' }
      };
      const ip = resolveClientIp(mockReq);
      assert.strictEqual(ip, '2001:db8:85a3::8a2e:370:7334');
    });

    await test('1.3: Normalizes IPv6-mapped IPv4 address to standard IPv4', async () => {
      const mockReq = {
        headers: { 'fly-client-ip': '::ffff:198.51.100.42' },
        socket: { remoteAddress: '127.0.0.1' }
      };
      const ip = resolveClientIp(mockReq);
      assert.strictEqual(ip, '198.51.100.42');
    });

    await test('1.4: Normalizes IPv6 loopback (::1) to 127.0.0.1', async () => {
      const mockReq = {
        headers: { 'fly-client-ip': '::1' },
        socket: { remoteAddress: '::1' }
      };
      const ip = resolveClientIp(mockReq);
      assert.strictEqual(ip, '127.0.0.1');
    });

    await test('1.5: Missing Fly-Client-IP falls back safely to socket remoteAddress', async () => {
      const mockReq = {
        headers: {},
        socket: { remoteAddress: '192.168.1.50' }
      };
      const ip = resolveClientIp(mockReq);
      assert.strictEqual(ip, '192.168.1.50');
    });

    await test('1.6: Empty or whitespace-only Fly-Client-IP falls back to socket address', async () => {
      const mockReq = {
        headers: { 'fly-client-ip': '   ' },
        socket: { remoteAddress: '10.0.0.1' }
      };
      const ip = resolveClientIp(mockReq);
      assert.strictEqual(ip, '10.0.0.1');
    });

    await test('1.7: Malformed IP in Fly-Client-IP fails closed to socket address', async () => {
      const malformedCandidates = [
        '999.999.999.999',
        'invalid_ip_address',
        '127.0.0.1; DROP TABLE users;',
        '<script>alert(1)</script>',
        '192.168.1.1.1'
      ];
      for (const badIp of malformedCandidates) {
        const mockReq = {
          headers: { 'fly-client-ip': badIp },
          socket: { remoteAddress: '172.16.0.5' }
        };
        const resolved = resolveClientIp(mockReq);
        assert.strictEqual(resolved, '172.16.0.5', `Expected fallback for malformed: ${badIp}`);
      }
    });

    await test('1.8: Oversized candidate string (> 45 chars) fails closed to socket address', async () => {
      const oversized = '2001:0db8:85a3:0000:0000:8a2e:0370:7334:extra_garbage_overflow';
      const mockReq = {
        headers: { 'fly-client-ip': oversized },
        socket: { remoteAddress: '10.20.30.40' }
      };
      const ip = resolveClientIp(mockReq);
      assert.strictEqual(ip, '10.20.30.40');
    });

    await test('1.9: Spoofed X-Forwarded-For header is strictly ignored', async () => {
      const mockReq = {
        headers: {
          'x-forwarded-for': '8.8.8.8, 1.1.1.1',
          'fly-client-ip': '203.0.113.5'
        },
        socket: { remoteAddress: '127.0.0.1' }
      };
      const ip = resolveClientIp(mockReq);
      assert.strictEqual(ip, '203.0.113.5');
      // When fly-client-ip is absent, x-forwarded-for must NOT be used
      const mockReqNoFly = {
        headers: { 'x-forwarded-for': '8.8.8.8' },
        socket: { remoteAddress: '10.0.0.99' }
      };
      assert.strictEqual(resolveClientIp(mockReqNoFly), '10.0.0.99');
    });

    await test('1.10: Null, undefined, or missing request object returns 127.0.0.1 safely', async () => {
      assert.strictEqual(resolveClientIp(null), '127.0.0.1');
      assert.strictEqual(resolveClientIp({}), '127.0.0.1');
      assert.strictEqual(resolveClientIp({ headers: null, socket: null }), '127.0.0.1');
    });

    await test('1.11: Fly-Client-IP header rejected in production unless on Fly platform or explicitly trusted (BLK-03A)', async () => {
      const origEnv = process.env.NODE_ENV;
      const origTrust = process.env.TRUST_FLY_PROXY;
      const origApp = process.env.FLY_APP_NAME;
      const origRegion = process.env.FLY_REGION;
      const origMachine = process.env.FLY_MACHINE_ID;

      try {
        delete process.env.FLY_APP_NAME;
        delete process.env.FLY_REGION;
        delete process.env.FLY_MACHINE_ID;
        delete process.env.TRUST_FLY_PROXY;
        process.env.NODE_ENV = 'production';

        assert.strictEqual(isFlyProxyTrusted(), false, 'Non-Fly production must not trust Fly-Client-IP by default');

        const mockReq = {
          headers: { 'fly-client-ip': '203.0.113.99' },
          socket: { remoteAddress: '10.0.0.1' }
        };
        // Without platform env or trust flag, spoofed Fly-Client-IP is ignored
        const resolved = resolveClientIp(mockReq);
        assert.strictEqual(resolved, '10.0.0.1', 'Must fall back to socket address');

        // When TRUST_FLY_PROXY === 'true' is explicitly set, it is trusted
        process.env.TRUST_FLY_PROXY = 'true';
        assert.strictEqual(isFlyProxyTrusted(), true);
        assert.strictEqual(resolveClientIp(mockReq), '203.0.113.99');

        // When FLY_APP_NAME is set (running in Fly.io container), it is trusted
        delete process.env.TRUST_FLY_PROXY;
        process.env.FLY_APP_NAME = 'ts-appointment-system';
        assert.strictEqual(isFlyProxyTrusted(), true);
        assert.strictEqual(resolveClientIp(mockReq), '203.0.113.99');

        // When TRUST_FLY_PROXY === 'false' is set, it overrides platform env
        process.env.TRUST_FLY_PROXY = 'false';
        assert.strictEqual(isFlyProxyTrusted(), false);
        assert.strictEqual(resolveClientIp(mockReq), '10.0.0.1');
      } finally {
        process.env.NODE_ENV = origEnv;
        if (origTrust !== undefined) process.env.TRUST_FLY_PROXY = origTrust; else delete process.env.TRUST_FLY_PROXY;
        if (origApp !== undefined) process.env.FLY_APP_NAME = origApp; else delete process.env.FLY_APP_NAME;
        if (origRegion !== undefined) process.env.FLY_REGION = origRegion; else delete process.env.FLY_REGION;
        if (origMachine !== undefined) process.env.FLY_MACHINE_ID = origMachine; else delete process.env.FLY_MACHINE_ID;
      }
    });

    // =========================================================================
    // SECTION 2: Login Rate Limiting (Per-Account & IP Password Spraying)
    // =========================================================================
    console.log('\n[Section 2] Login Rate Limiting & Password Spraying Defenses...');

    await test('2.1: Five consecutive failed logins for target account trigger lockout', async () => {
      loginRateLimiter.reset();
      const victimEmail = 'brute.force.victim@university.edu';
      const testIp = '198.51.100.10';

      // Submit 5 failed attempts
      for (let i = 1; i <= 5; i++) {
        const res = await request(app)
          .post('/api/v1/auth/login')
          .set('Fly-Client-IP', testIp)
          .send({ email: victimEmail, password: 'WrongPassword123!' });
        assert.strictEqual(res.status, HTTP_STATUS.UNAUTHORIZED);
        assert.strictEqual(res.body.error.code, 'INVALID_CREDENTIALS');
      }

      // 6th attempt must be blocked by rate limiter with 429
      const lockedRes = await request(app)
        .post('/api/v1/auth/login')
        .set('Fly-Client-IP', testIp)
        .send({ email: victimEmail, password: 'AnyPassword123!' });

      assert.strictEqual(lockedRes.status, HTTP_STATUS.TOO_MANY_REQUESTS);
      assert.strictEqual(lockedRes.body.success, false);
      assert.strictEqual(lockedRes.body.error.code, 'TOO_MANY_REQUESTS');
      assert.ok(lockedRes.headers['retry-after'], 'Must contain Retry-After header');
      assert.ok(lockedRes.body.error.message.includes('this account'));
    });

    await test('2.2: Legitimate user with correct password succeeds even after attacker on another IP is blocked (BLK-03B DoS Elimination)', async () => {
      loginRateLimiter.reset();
      const victimEmail = 'robert.miller@university.edu';
      const attackerIp = '198.51.100.99';
      const legitimateIp = '203.0.113.55';

      // Attacker on attackerIp sends 5 failed attempts targeting victim account
      for (let i = 1; i <= 5; i++) {
        const res = await request(app)
          .post('/api/v1/auth/login')
          .set('Fly-Client-IP', attackerIp)
          .send({ email: victimEmail, password: 'AttackerWrongPassword!' });
        assert.strictEqual(res.status, HTTP_STATUS.UNAUTHORIZED);
        assert.strictEqual(res.body.error.code, 'INVALID_CREDENTIALS');
      }

      // Attacker's 6th attempt on victimEmail from attackerIp is rejected with 429
      const attackerBlockedRes = await request(app)
        .post('/api/v1/auth/login')
        .set('Fly-Client-IP', attackerIp)
        .send({ email: victimEmail, password: 'AnyPassword123!' });

      assert.strictEqual(attackerBlockedRes.status, HTTP_STATUS.TOO_MANY_REQUESTS);
      assert.strictEqual(attackerBlockedRes.body.error.code, 'TOO_MANY_REQUESTS');
      assert.ok(attackerBlockedRes.headers['retry-after']);
      assert.ok(attackerBlockedRes.body.error.message.includes('this account'));

      // Legitimate user on legitimateIp attempts login with correct password
      // MUST NOT be blocked by attacker's failed attempts (DoS elimination)
      const legitRes = await request(app)
        .post('/api/v1/auth/login')
        .set('Fly-Client-IP', legitimateIp)
        .send({ email: victimEmail, password: 'Password123!' });

      assert.strictEqual(legitRes.status, HTTP_STATUS.OK);
      assert.strictEqual(legitRes.body.success, true);
      assert.strictEqual(legitRes.body.data.user.email, victimEmail);
    });

    await test('2.3: Non-existent account failed attempts tracked identically (enumeration resistance)', async () => {
      loginRateLimiter.reset();
      const nonexistentEmail = 'ghost.user.doesnotexist@university.edu';
      const testIp = '198.51.100.20';

      for (let i = 1; i <= 5; i++) {
        const res = await request(app)
          .post('/api/v1/auth/login')
          .set('Fly-Client-IP', testIp)
          .send({ email: nonexistentEmail, password: 'WrongPassword123!' });
        assert.strictEqual(res.status, HTTP_STATUS.UNAUTHORIZED);
        assert.strictEqual(res.body.error.code, 'INVALID_CREDENTIALS');
      }

      // 6th attempt on nonexistent email also returns 429
      const lockedRes = await request(app)
        .post('/api/v1/auth/login')
        .set('Fly-Client-IP', testIp)
        .send({ email: nonexistentEmail, password: 'WrongPassword123!' });

      assert.strictEqual(lockedRes.status, HTTP_STATUS.TOO_MANY_REQUESTS);
      assert.strictEqual(lockedRes.body.error.code, 'TOO_MANY_REQUESTS');
    });

    await test('2.4: Successful login clears the account lockout counter', async () => {
      loginRateLimiter.reset();
      const adminEmail = 'admin@university.edu';
      const adminPass = 'Password123!';
      const testIp = '198.51.100.30';

      // 3 failed attempts
      for (let i = 0; i < 3; i++) {
        await request(app)
          .post('/api/v1/auth/login')
          .set('Fly-Client-IP', testIp)
          .send({ email: adminEmail, password: 'BadPassword!' });
      }

      // 4th attempt is successful
      const successRes = await request(app)
        .post('/api/v1/auth/login')
        .set('Fly-Client-IP', testIp)
        .send({ email: adminEmail, password: adminPass });
      assert.strictEqual(successRes.status, HTTP_STATUS.OK);

      // Verify that counter was cleared: account should now tolerate 4 more failed attempts without 429
      for (let i = 0; i < 4; i++) {
        const res = await request(app)
          .post('/api/v1/auth/login')
          .set('Fly-Client-IP', testIp)
          .send({ email: adminEmail, password: 'BadPassword!' });
        assert.strictEqual(res.status, HTTP_STATUS.UNAUTHORIZED);
      }
    });

    await test('2.5: Horizontal password spraying from single IP is intercepted by IP-level limit', async () => {
      loginRateLimiter.reset();
      const sprayAttackerIp = '198.51.100.77';

      // Attacker attempts 1 failed login against 30 different accounts from same IP
      for (let i = 1; i <= 30; i++) {
        const email = `spray.target.${i}@university.edu`;
        const res = await request(app)
          .post('/api/v1/auth/login')
          .set('Fly-Client-IP', sprayAttackerIp)
          .send({ email, password: 'Spring2026Password!' });
        assert.strictEqual(res.status, HTTP_STATUS.UNAUTHORIZED);
      }

      // 31st attempt from this IP (even against a completely new account) must be blocked by IP spray limiter
      const sprayBlocked = await request(app)
        .post('/api/v1/auth/login')
        .set('Fly-Client-IP', sprayAttackerIp)
        .send({ email: 'new.victim@university.edu', password: 'Spring2026Password!' });

      assert.strictEqual(sprayBlocked.status, HTTP_STATUS.TOO_MANY_REQUESTS);
      assert.strictEqual(sprayBlocked.body.success, false);
      assert.strictEqual(sprayBlocked.body.error.code, 'TOO_MANY_REQUESTS');
      assert.ok(sprayBlocked.body.error.message.includes('this network'));
      assert.ok(sprayBlocked.headers['retry-after']);
    });

    await test('2.6: Legitimate users on shared campus IP with occasional typos are not locked out', async () => {
      loginRateLimiter.reset();
      const campusNatIp = '198.51.100.50';

      // 10 different students on campus Wi-Fi make 1 password typo each
      for (let i = 1; i <= 10; i++) {
        const res = await request(app)
          .post('/api/v1/auth/login')
          .set('Fly-Client-IP', campusNatIp)
          .send({ email: `student.${i}@university.edu`, password: 'TypoPassword!' });
        assert.strictEqual(res.status, HTTP_STATUS.UNAUTHORIZED);
      }

      // Student 11 logs in with correct password from the same campus Wi-Fi -> succeeds!
      const validStudent = await request(app)
        .post('/api/v1/auth/login')
        .set('Fly-Client-IP', campusNatIp)
        .send({ email: 'admin@university.edu', password: 'Password123!' });

      assert.strictEqual(validStudent.status, HTTP_STATUS.OK);
    });

    await test('2.7: Limiter storage bound, memory hygiene & eviction immunity for active blocks (BLK-03C)', async () => {
      const customLimiter = new LoginRateLimiter({
        windowMs: 60000, // 1 minute window
        maxEntries: 10,
        maxAccountAttempts: 2
      });

      // 1. Create an active block on victim account from attacker IP
      const blockedVictim = 'targeted.victim@university.edu';
      const attackerIp = '198.51.100.44';
      customLimiter.recordFailure(blockedVictim, attackerIp);
      customLimiter.recordFailure(blockedVictim, attackerIp); // 2 failures -> active block!

      assert.strictEqual(
        customLimiter.isPairBlocked(attackerIp, blockedVictim),
        true,
        'Key must be actively blocked'
      );

      // 2. Flood the limiter with 25 unblocked unique keys to exceed maxEntries
      for (let i = 1; i <= 25; i++) {
        customLimiter.recordKeyFailure(`flood_unblocked_key_${i}`, 100);
      }

      // 3. Trigger cleanup / capacity shedding
      customLimiter.cleanup();

      // 4. Actively blocked entry MUST be strictly immune to eviction
      assert.strictEqual(
        customLimiter.isPairBlocked(attackerIp, blockedVictim),
        true,
        'Actively blocked key must NOT be evicted during capacity shedding (BLK-03C)'
      );

      // 5. Test expired unblocked record pruning
      const fastLimiter = new LoginRateLimiter({
        windowMs: 50, // 50ms window
        maxEntries: 10
      });
      for (let i = 1; i <= 15; i++) {
        fastLimiter.recordFailure(`expired${i}@test.com`, `10.0.0.${i}`);
      }
      fastLimiter.cleanup();
      assert.ok(fastLimiter.hits.size <= 10, `Expected <= 10 entries, found: ${fastLimiter.hits.size}`);

      customLimiter.stopCleanupTimer();
      fastLimiter.stopCleanupTimer();
    });

    // =========================================================================
    // SECTION 3: Registration Rate Limiting & Shared Campus IP Protection
    // =========================================================================
    console.log('\n[Section 3] Registration Rate Limiting & Shared Campus IP Defenses...');

    await test('3.1: Five different users behind same campus IP register successfully (SB25-13)', async () => {
      registrationRateLimiter.reset();
      const campusIp = '198.51.100.88';

      // Discover valid department ID
      const deptRes = await request(app).get('/api/v1/departments').expect(HTTP_STATUS.OK);
      const departmentId = deptRes.body.data.departments[0].id;

      // Register 5 distinct students from the exact same campus IP
      for (let i = 1; i <= 5; i++) {
        const timestamp = Date.now() + i;
        const res = await request(app)
          .post('/api/v1/auth/register')
          .set('Fly-Client-IP', campusIp)
          .send({
            email: `campus.student.${timestamp}@student.university.edu`,
            password: 'SecurePassword123!',
            firstName: `CampusStudent${i}`,
            lastName: 'Verification',
            studentIdNumber: `STU-CAMPUS-${timestamp}`,
            departmentId: departmentId,
            batch: '2026'
          });

        assert.strictEqual(
          res.status,
          HTTP_STATUS.CREATED,
          `Student ${i} failed registration: ${JSON.stringify(res.body)}`
        );
        assert.strictEqual(res.body.success, true);
      }
    });

    await test('3.2: Repeated registration attempts against single email address are throttled', async () => {
      registrationRateLimiter.reset();
      const targetEmail = 'spam.target@student.university.edu';

      // 5 registration attempts for same email from different IPs
      for (let i = 1; i <= 5; i++) {
        await request(app)
          .post('/api/v1/auth/register')
          .set('Fly-Client-IP', `10.100.0.${i}`)
          .send({ email: targetEmail });
      }

      // 6th attempt on same email is blocked with 429
      const blockedRes = await request(app)
        .post('/api/v1/auth/register')
        .set('Fly-Client-IP', '10.100.0.99')
        .send({ email: targetEmail });

      assert.strictEqual(blockedRes.status, HTTP_STATUS.TOO_MANY_REQUESTS);
      assert.strictEqual(blockedRes.body.error.code, 'RATE_LIMIT_EXCEEDED');
      assert.ok(blockedRes.body.error.message.includes('this email address'));
    });

    await test('3.3: High-volume registration flood from single IP is throttled', async () => {
      // Use dedicated RegistrationRateLimiter instance with maxIpAttempts = 5
      const floodLimiter = new RegistrationRateLimiter({
        maxIpAttempts: 5,
        maxEmailAttempts: 10
      });

      const floodIp = '198.51.100.123';

      // 5 attempts from flood IP
      for (let i = 1; i <= 5; i++) {
        floodLimiter.recordAttempt(`unique.${i}@test.com`, floodIp);
      }

      assert.strictEqual(floodLimiter.isIpBlocked(floodIp), true);
      assert.ok(floodLimiter.getRemainingBlockSeconds(floodLimiter.getIpKey(floodIp)) > 0);
      floodLimiter.stopCleanupTimer();
    });

    await test('3.4: Duplicate email validation returns 409 Conflict without rate limit confusion', async () => {
      registrationRateLimiter.reset();
      const deptRes = await request(app).get('/api/v1/departments').expect(HTTP_STATUS.OK);
      const departmentId = deptRes.body.data.departments[0].id;
      const existingEmail = `existing.conflict.${Date.now()}@student.university.edu`;

      // Initial registration
      await request(app)
        .post('/api/v1/auth/register')
        .set('Fly-Client-IP', '198.51.100.90')
        .send({
          email: existingEmail,
          password: 'Password123!',
          firstName: 'Existing',
          lastName: 'Student',
          studentIdNumber: `STU-DUP-${Date.now()}`,
          departmentId,
          batch: '2026'
        })
        .expect(HTTP_STATUS.CREATED);

      // Attempt duplicate registration
      const dupRes = await request(app)
        .post('/api/v1/auth/register')
        .set('Fly-Client-IP', '198.51.100.90')
        .send({
          email: existingEmail,
          password: 'Password123!',
          firstName: 'Another',
          lastName: 'Student',
          studentIdNumber: `STU-DUP-NEW-${Date.now()}`,
          departmentId,
          batch: '2026'
        });

      assert.strictEqual(dupRes.status, HTTP_STATUS.CONFLICT);
      assert.strictEqual(dupRes.body.error.code, 'DUPLICATE_EMAIL');
    });

    await test('3.5: Production RegistrationRateLimiter defaults to 50 IP attempts (BLK-03E)', async () => {
      const origEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';
        const prodLimiter = new RegistrationRateLimiter();
        assert.strictEqual(prodLimiter.maxIpAttempts, 50, 'Production IP registration limit must be 50');
        prodLimiter.stopCleanupTimer();
      } finally {
        process.env.NODE_ENV = origEnv;
      }
    });

    // =========================================================================
    // SECTION 4: Regression & Core Security Invariants
    // =========================================================================
    console.log('\n[Section 4] Regression & Authentication Hygiene Verifications...');

    await test('4.1: Legitimate teacher authentication remains fully functional', async () => {
      loginRateLimiter.reset();
      const res = await request(app)
        .post('/api/v1/auth/login')
        .set('Fly-Client-IP', '192.0.2.100')
        .send({ email: 'robert.miller@university.edu', password: 'Password123!' });

      assert.strictEqual(res.status, HTTP_STATUS.OK);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.user.role, 'TEACHER');
    });

    await test('4.2: Protected endpoint identity verification via GET /api/v1/auth/me', async () => {
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'robert.miller@university.edu', password: 'Password123!' });

      const token = loginRes.body.data.token;
      const meRes = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(HTTP_STATUS.OK);

      assert.strictEqual(meRes.body.success, true);
      assert.strictEqual(meRes.body.data.email, 'robert.miller@university.edu');
    });

    await test('4.3: Logout successfully revokes token and clears auth cookies', async () => {
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'robert.miller@university.edu', password: 'Password123!' });

      const token = loginRes.body.data.token;
      const logoutRes = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${token}`)
        .expect(HTTP_STATUS.OK);

      assert.strictEqual(logoutRes.body.success, true);
      assert.strictEqual(logoutRes.body.data.loggedOut, true);

      // Verify token is now revoked
      await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(HTTP_STATUS.UNAUTHORIZED);
    });

    await test('4.4: Defensive security response headers are verified present on API responses', async () => {
      const res = await request(app).get('/api/v1/health');
      assert.strictEqual(res.headers['x-content-type-options'], 'nosniff');
      assert.strictEqual(res.headers['x-frame-options'], 'DENY');
      assert.strictEqual(res.headers['referrer-policy'], 'strict-origin-when-cross-origin');
      assert.strictEqual(res.headers['x-xss-protection'], '0');
    });

    // =========================================================================
    // SECTION 5: Step 5B.2.11 Partitioned Storage & Bounded Capacity Verifications
    // =========================================================================
    console.log('\n[Section 5] Partitioned Storage & Strict Memory Bounds Verifications (Step 5B.2.11)...');

    await test('5.1: Test 1 — Original all-blocked overflow prevention and strict memory bound', async () => {
      const limiter = new BaseRateLimiter({ name: 'Test1AllBlocked', maxEntries: 5, windowMs: 60000 });
      // Fill to exactly capacity (5) with actively blocked entries
      for (let i = 1; i <= 5; i++) {
        limiter.recordKeyFailure(`blocked_${i}`, 1);
      }
      assert.strictEqual(limiter.hits.size, 5, 'Map must start at capacity 5');
      for (let i = 1; i <= 5; i++) {
        assert.strictEqual(limiter.isKeyBlocked(`blocked_${i}`), true, `blocked_${i} must be actively blocked`);
      }

      // Attempt to insert 6th unique key
      const res6 = limiter.recordKeyFailure('new_key_6', 10);
      assert.strictEqual(res6.success, false, 'Insertion must be rejected');
      assert.strictEqual(res6.capacityExhausted, true, 'Capacity exhaustion must be flagged');
      assert.strictEqual(res6.record, null);
      assert.strictEqual(limiter.hits.size, 5, 'Map size must NEVER exceed maxEntries (5)');

      // Confirm all 5 original active blocks remain intact
      for (let i = 1; i <= 5; i++) {
        assert.strictEqual(limiter.isKeyBlocked(`blocked_${i}`), true, `Original blocked_${i} must remain intact`);
      }

      // Attempt 20 more insertions when all are blocked
      for (let i = 7; i <= 26; i++) {
        const res = limiter.recordKeyFailure(`new_key_${i}`, 10);
        assert.strictEqual(res.capacityExhausted, true);
      }
      assert.strictEqual(limiter.hits.size, 5, 'Map size must remain strictly 5 after 20 rejected insertions');
      limiter.stopCleanupTimer();
    });

    await test('5.2: Test 2 — Horizontal password spraying across 300 accounts strictly blocks IP without counter reset', async () => {
      const sprayLimiter = new LoginRateLimiter({
        maxPairEntries: 10,
        maxIpEntries: 50,
        maxPairAttempts: 5,
        maxIpAttempts: 30,
        windowMs: 60000
      });

      const attackerIp = '198.51.100.222';

      // Attacker tests 300 distinct victim accounts from attackerIp
      for (let i = 1; i <= 300; i++) {
        sprayLimiter.recordFailure(`spray_victim_${i}@university.edu`, attackerIp);
      }

      // Verify aggregate IP partition behavior
      assert.strictEqual(sprayLimiter.isIpBlocked(attackerIp), true, 'Attacker IP must be blocked');
      const ipRecord = sprayLimiter.ipHits.hits.get(`ip:${attackerIp}`);
      assert.ok(ipRecord, 'IP record must exist in ipHits partition');
      assert.ok(ipRecord.count >= 30, 'IP counter must not be reset by pair key creations');
      assert.ok(ipRecord.blockedUntil > Date.now(), 'IP must be actively blocked');

      // Verify pairHits remained bounded
      assert.ok(sprayLimiter.pairHits.hits.size <= 10, `pairHits size must be <= 10, got: ${sprayLimiter.pairHits.hits.size}`);
      // Verify ipHits has exactly 1 entry for this attacker
      assert.strictEqual(sprayLimiter.ipHits.hits.size, 1);

      // Verify middleware rejects requests from this blocked IP with 429
      const mw = sprayLimiter.middleware();
      let status = null;
      let body = null;
      let retryAfter = null;
      const mockReq = { clientIp: attackerIp, body: { email: 'brand_new_target@university.edu' } };
      const mockRes = {
        setHeader: (k, v) => { if (k === 'Retry-After') retryAfter = v; },
        status: (code) => {
          status = code;
          return { json: (data) => { body = data; } };
        }
      };
      mw(mockReq, mockRes, () => {});

      assert.strictEqual(status, HTTP_STATUS.TOO_MANY_REQUESTS);
      assert.strictEqual(body.error.code, 'TOO_MANY_REQUESTS');
      assert.ok(body.error.message.includes('this network'));
      assert.ok(Number(retryAfter) > 0);

      sprayLimiter.stopCleanupTimer();
    });

    await test('5.3: Test 3 — Aggregate IP partition capacity exhaustion fails safe without evicting active blocks', async () => {
      const ipLimiter = new LoginRateLimiter({
        maxIpEntries: 5,
        maxPairEntries: 10,
        maxIpAttempts: 1,
        windowMs: 60000
      });

      // Fill ipHits to capacity (5) with active IP blocks
      for (let i = 1; i <= 5; i++) {
        ipLimiter.recordKeyFailure(`ip:10.0.0.${i}`, 1);
      }
      assert.strictEqual(ipLimiter.ipHits.hits.size, 5);
      assert.strictEqual(ipLimiter.ipHits.isCapacityExhausted(), true);

      // Attempt to register a failure from a brand new IP (10.0.0.99)
      const resNew = ipLimiter.recordFailure('anyone@uni.edu', '10.0.0.99');
      assert.strictEqual(resNew.ip.capacityExhausted, true);
      assert.strictEqual(ipLimiter.ipHits.hits.size, 5, 'ipHits must never exceed 5');

      // Verify all 5 original IP blocks remain intact
      for (let i = 1; i <= 5; i++) {
        assert.strictEqual(ipLimiter.isIpBlocked(`10.0.0.${i}`), true);
      }

      // Verify middleware handles capacity exhaustion safely (HTTP 429 throttle, no fail-open)
      const mw = ipLimiter.middleware();
      let status = null;
      let body = null;
      const mockReq = { clientIp: '10.0.0.99', body: { email: 'user@uni.edu' } };
      const mockRes = {
        setHeader: () => {},
        status: (code) => {
          status = code;
          return { json: (data) => { body = data; } };
        }
      };
      mw(mockReq, mockRes, () => {});

      assert.strictEqual(status, HTTP_STATUS.TOO_MANY_REQUESTS);
      assert.strictEqual(body.error.code, 'TOO_MANY_REQUESTS');

      ipLimiter.stopCleanupTimer();
    });

    await test('5.4: Test 4 — Pair partition capacity exhaustion preserves bounds and throttles safely', async () => {
      const pairLimiter = new LoginRateLimiter({
        maxPairEntries: 5,
        maxIpEntries: 50,
        maxPairAttempts: 1,
        windowMs: 60000
      });

      // Fill pairHits to capacity (5) with active pair blocks
      for (let i = 1; i <= 5; i++) {
        pairLimiter.pairHits.recordKeyFailure(`pair:198.51.100.1:victim_${i}@uni.edu`, 1);
      }
      assert.strictEqual(pairLimiter.pairHits.hits.size, 5);
      assert.strictEqual(pairLimiter.pairHits.isCapacityExhausted(), true);

      // New pair insertion must be rejected and size strictly bounded
      const res = pairLimiter.pairHits.recordKeyFailure('pair:198.51.100.1:victim_6@uni.edu', 1);
      assert.strictEqual(res.capacityExhausted, true);
      assert.strictEqual(pairLimiter.pairHits.hits.size, 5);

      // Middleware throttles untracked new pair conservatively
      const mw = pairLimiter.middleware();
      let status = null;
      const mockReq = { clientIp: '198.51.100.1', body: { email: 'victim_6@uni.edu' } };
      const mockRes = {
        setHeader: () => {},
        status: (code) => {
          status = code;
          return { json: () => {} };
        }
      };
      mw(mockReq, mockRes, () => {});
      assert.strictEqual(status, HTTP_STATUS.TOO_MANY_REQUESTS);

      pairLimiter.stopCleanupTimer();
    });

    await test('5.5: Test 5 — Mixed map contents: unblocked entries evicted while active blocks survive', async () => {
      const mixedLimiter = new BaseRateLimiter({ maxEntries: 10, windowMs: 60000 });
      // 5 blocked entries
      for (let i = 1; i <= 5; i++) {
        mixedLimiter.recordKeyFailure(`blocked_${i}`, 1);
      }
      // 5 unblocked entries
      for (let i = 1; i <= 5; i++) {
        mixedLimiter.recordKeyFailure(`unblocked_${i}`, 100);
      }
      assert.strictEqual(mixedLimiter.hits.size, 10);

      // Insert 5 more unblocked keys
      for (let i = 6; i <= 10; i++) {
        mixedLimiter.recordKeyFailure(`unblocked_${i}`, 100);
      }

      assert.strictEqual(mixedLimiter.hits.size, 10, 'Map size must stay bounded at 10');
      // All 5 blocked entries must be intact
      for (let i = 1; i <= 5; i++) {
        assert.strictEqual(mixedLimiter.isKeyBlocked(`blocked_${i}`), true);
      }
      // Old unblocked entries 1-5 must have been evicted
      for (let i = 1; i <= 5; i++) {
        assert.strictEqual(mixedLimiter.hits.has(`unblocked_${i}`), false);
      }
      mixedLimiter.stopCleanupTimer();
    });

    await test('5.6: Test 6 — Expiry and recovery allows safe memory reclamation and new records', async () => {
      const expLimiter = new BaseRateLimiter({ maxEntries: 5, windowMs: 100 });
      for (let i = 1; i <= 5; i++) {
        expLimiter.recordKeyFailure(`exp_key_${i}`, 1);
      }
      assert.strictEqual(expLimiter.hits.size, 5);

      // Artificially age the records past windowMs
      const past = Date.now() - 200;
      for (let i = 1; i <= 5; i++) {
        const rec = expLimiter.hits.get(`exp_key_${i}`);
        rec.firstAttempt = past;
        rec.blockedUntil = past + 10;
      }

      // Verify entries are now reported as unblocked
      for (let i = 1; i <= 5; i++) {
        assert.strictEqual(expLimiter.isKeyBlocked(`exp_key_${i}`), false);
      }

      // Cleanup prunes all expired records
      expLimiter.cleanup();
      assert.strictEqual(expLimiter.hits.size, 0, 'Expired records must be cleanly pruned');

      // Now new records can be inserted cleanly
      const res = expLimiter.recordKeyFailure('new_fresh_key', 5);
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.record.count, 1);
      assert.strictEqual(expLimiter.hits.size, 1);

      expLimiter.stopCleanupTimer();
    });

    await test('5.7: Test 7 — Cross-IP legitimate login is unaffected by attacker failures on another IP', async () => {
      loginRateLimiter.reset();
      const targetUser = 'cross.ip.target@university.edu';
      const attackerIp = '198.51.100.199';
      const legitimateIp = '203.0.113.199';

      // Attacker exhausts 5 failed attempts against targetUser from attackerIp
      for (let i = 1; i <= 5; i++) {
        loginRateLimiter.recordFailure(targetUser, attackerIp);
      }

      // Verify pair is blocked for attacker
      assert.strictEqual(loginRateLimiter.isPairBlocked(attackerIp, targetUser), true);

      // Verify legitimate user on legitimateIp is NOT blocked
      assert.strictEqual(loginRateLimiter.isPairBlocked(legitimateIp, targetUser), false);
      assert.strictEqual(loginRateLimiter.isIpBlocked(legitimateIp), false);

      // In middleware, legitimate user request passes through to next()
      const mw = loginRateLimiter.middleware();
      let nextCalled = false;
      const mockReq = { clientIp: legitimateIp, body: { email: targetUser } };
      const mockRes = { setHeader: () => {}, status: () => ({ json: () => {} }) };
      mw(mockReq, mockRes, () => { nextCalled = true; });
      assert.strictEqual(nextCalled, true, 'Legitimate user request must proceed to authentication');
    });

    await test('5.8: Test 8 — Comprehensive authentication behavior & error response verification', async () => {
      loginRateLimiter.reset();
      const testIp = '198.51.100.108';

      // 8a. Invalid input (missing email/password) -> 400 Bad Request
      const badInputRes = await request(app)
        .post('/api/v1/auth/login')
        .set('Fly-Client-IP', testIp)
        .send({ email: 'notanemail' });
      assert.strictEqual(badInputRes.status, HTTP_STATUS.BAD_REQUEST);

      // 8b. Incorrect password -> 401 INVALID_CREDENTIALS
      const wrongPassRes = await request(app)
        .post('/api/v1/auth/login')
        .set('Fly-Client-IP', testIp)
        .send({ email: 'admin@university.edu', password: 'WrongPassword999!' });
      assert.strictEqual(wrongPassRes.status, HTTP_STATUS.UNAUTHORIZED);
      assert.strictEqual(wrongPassRes.body.error.code, 'INVALID_CREDENTIALS');

      // 8c. Non-existent account -> 401 INVALID_CREDENTIALS (anti-enumeration)
      const unknownRes = await request(app)
        .post('/api/v1/auth/login')
        .set('Fly-Client-IP', testIp)
        .send({ email: 'nonexistent.user.999@university.edu', password: 'AnyPassword!' });
      assert.strictEqual(unknownRes.status, HTTP_STATUS.UNAUTHORIZED);
      assert.strictEqual(unknownRes.body.error.code, 'INVALID_CREDENTIALS');

      // 8d. Correct password -> 200 OK
      const successRes = await request(app)
        .post('/api/v1/auth/login')
        .set('Fly-Client-IP', testIp)
        .send({ email: 'admin@university.edu', password: 'Password123!' });
      assert.strictEqual(successRes.status, HTTP_STATUS.OK);
      assert.strictEqual(successRes.body.success, true);
    });

    await test('5.9: Test 9 — Registration limiter email and IP independent threshold verification', async () => {
      registrationRateLimiter.reset();
      const regIp = '198.51.100.109';
      const spamEmail = 'spam.check@student.university.edu';

      // Record 5 attempts for spamEmail
      for (let i = 1; i <= 5; i++) {
        registrationRateLimiter.recordAttempt(spamEmail, regIp);
      }

      // Verify email is blocked
      assert.strictEqual(registrationRateLimiter.isEmailBlocked(spamEmail), true);
      // Verify another email from same IP is NOT blocked by email limit
      assert.strictEqual(registrationRateLimiter.isEmailBlocked('other.student@student.university.edu'), false);
    });

    await test('5.10: Test 10 — Client-IP integration: normalized Fly-Client-IP utilized in rate limiting', async () => {
      loginRateLimiter.reset();
      const rawHeaderIp = '::ffff:198.51.100.210';
      const expectedNormalized = '198.51.100.210';

      const mockReq = {
        headers: { 'fly-client-ip': rawHeaderIp },
        socket: { remoteAddress: '127.0.0.1' },
        body: { email: 'check.client.ip@uni.edu' }
      };

      const resolved = resolveClientIp(mockReq);
      assert.strictEqual(resolved, expectedNormalized, 'Resolver must normalize IPv6-mapped IPv4');

      // Middleware must use resolved client IP for limiter accounting
      const mw = loginRateLimiter.middleware();
      let nextRan = false;
      mw(mockReq, {}, () => { nextRan = true; });
      assert.strictEqual(nextRan, true);
    });

  } finally {
    loginRateLimiter.reset();
    registrationRateLimiter.reset();
  }

  console.log('\n=================================================================');
  console.log(` Security Rate Limiting Test Summary: ${passed} passed, ${failed} failed out of ${passed + failed} tests.`);
  console.log('=================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runSecurityRateLimitingTests().catch((err) => {
  console.error('[FATAL SECURITY RUNNER EXCEPTION]', err);
  process.exit(1);
});
