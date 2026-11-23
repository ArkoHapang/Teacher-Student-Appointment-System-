/**
 * Student Self-Registration End-to-End Integration Verification Suite
 * (Hardened for Cookie-Only Authentication with CSRF Alignment)
 *
 * Verifies the complete student self-registration workflow end-to-end:
 * 1. Public Department Discovery (GET /api/v1/departments)
 * 2. Atomic Student Registration with Cookie-Only Negotiation (POST /api/v1/auth/register)
 * 3. Session & HttpOnly Cookie Behavior (SameSite, Path, Secure, HttpOnly, Anti-Caching)
 * 4. Authentication with Newly Registered Credentials (POST /api/v1/auth/login with X-Session-Mode: cookie-only)
 * 5. Logout & Cookie Revocation Invalidation (POST /api/v1/auth/logout with CSRF headers)
 * 6. Duplicate Conflict Defense (DUPLICATE_EMAIL & DUPLICATE_STUDENT_ID)
 * 7. Administrative Visibility (GET /api/v1/admin/users via Cookie Session)
 * 8. Frontend Service Communication Contract & Storage Hygiene (No JWT in localStorage)
 */

// 1. Mandatory Test Isolation Setup
require('../backend/tests/setup');
const path = require('path');
const assert = require('assert');
const request = require('supertest');
const app = require('../backend/src/app');
const db = require('../backend/src/config/database');
const env = require('../backend/src/config/env');
const HTTP_STATUS = require('../backend/src/constants/httpStatusCodes');
const { registrationRateLimiter, loginRateLimiter } = require('../backend/src/middlewares/rateLimiter');

// 2. Pre-Execution Isolation Verification
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

async function runStudentIntegrationTests() {
  console.log('\n=================================================================');
  console.log(' Student Self-Registration E2E Integration Suite (Cookie-Only)   ');
  console.log(' Isolated Test DB: ' + currentDbPath);
  console.log('=================================================================\n');

  let passed = 0;
  let failed = 0;
  const testResults = [];

  async function test(name, fn) {
    try {
      registrationRateLimiter.reset();
      loginRateLimiter.reset();
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

  // Track entities created specifically by this test run for targeted cleanup
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

  try {
    // Generate unique, collision-proof credentials for this execution
    const timestamp = Date.now();
    const testEmail = `e2e.student.${timestamp}@student.university.edu`;
    const testPassword = 'SecureStudent2026!';
    const testStudentId = `STU-E2E-${String(timestamp).slice(-6)}`;
    const testFirstName = 'Marcus';
    const testLastName = 'Vance';
    let targetDeptId = 1;

    let registeredUser = null;
    let registeredProfile = null;
    let registeredCookies = null;

    // -------------------------------------------------------------
    // Scenario 1: Public Department Discovery
    // -------------------------------------------------------------
    await test('Scenario 1: Public department discovery (GET /api/v1/departments)', async () => {
      const res = await request(app)
        .get('/api/v1/departments')
        .expect(HTTP_STATUS.OK);

      assert.strictEqual(res.body.success, true, 'Response success must be true');
      assert.ok(res.body.data, 'Response data envelope must be present');
      assert.ok(typeof res.body.data.total === 'number', 'Total count must be a number');
      assert.ok(Array.isArray(res.body.data.departments), 'Departments must be an array');
      assert.ok(res.body.data.departments.length > 0, 'Departments array must be non-empty');

      const firstDept = res.body.data.departments[0];
      assert.ok(typeof firstDept.id === 'number', 'Department ID must be a number');
      assert.ok(typeof firstDept.code === 'string' && firstDept.code.length > 0, 'Department code must be valid');
      assert.ok(typeof firstDept.name === 'string' && firstDept.name.length > 0, 'Department name must be valid');
      targetDeptId = firstDept.id;

      // Ensure data is real database records, not static mocks
      const dbCheck = await db.queryOne('SELECT id, code, name FROM departments WHERE id = ?;', [targetDeptId]);
      assert.ok(dbCheck, 'Department must exist in the real SQLite database');
      assert.strictEqual(dbCheck.code, firstDept.code);
    });

    // -------------------------------------------------------------
    // Scenario 2: Successful Student Registration with Cookie-Only Mode
    // -------------------------------------------------------------
    await test('Scenario 2: Atomic student registration with cookie-only negotiation (POST /api/v1/auth/register)', async () => {
      const payload = {
        email: testEmail,
        password: testPassword,
        firstName: testFirstName,
        lastName: testLastName,
        studentIdNumber: testStudentId,
        departmentId: targetDeptId,
        batch: 'Batch 2026-E2E',
        phoneNumber: '+1-555-0188',
        role: 'ADMIN', // Attempt privilege escalation (must be ignored)
        status: 'SUSPENDED' // Attempt status override (must be ignored)
      };

      const res = await request(app)
        .post('/api/v1/auth/register')
        .set('X-Session-Mode', 'cookie-only')
        .send(payload)
        .expect(HTTP_STATUS.CREATED);

      assert.strictEqual(res.body.success, true, 'Registration must report success');
      assert.ok(res.body.data, 'Registration data must be present');
      assert.ok(res.body.data.user, 'User object must be returned');
      assert.ok(res.body.data.profile, 'Student profile object must be returned');
      assert.strictEqual(res.body.data.token, undefined, 'Cookie-only registration must omit JWT token in response body');

      registeredUser = res.body.data.user;
      registeredProfile = res.body.data.profile;
      registeredCookies = res.headers['set-cookie'];
      createdUserIds.push(registeredUser.id);

      // Verify returned user state
      assert.strictEqual(registeredUser.email, testEmail);
      assert.strictEqual(registeredUser.firstName, testFirstName);
      assert.strictEqual(registeredUser.lastName, testLastName);
      assert.strictEqual(registeredUser.role, 'STUDENT', 'Role must strictly default to STUDENT');
      assert.strictEqual(registeredUser.status, 'ACTIVE', 'Status must strictly default to ACTIVE');

      // Verify returned profile
      assert.strictEqual(registeredProfile.userId, registeredUser.id);
      assert.strictEqual(registeredProfile.studentIdNumber, testStudentId);
      assert.strictEqual(registeredProfile.departmentId, targetDeptId);

      // Verify database persistence: password is never plaintext
      const dbUser = await db.queryOne('SELECT id, password_hash, role_id, status FROM users WHERE id = ?;', [registeredUser.id]);
      assert.ok(dbUser, 'User record must exist in SQLite database');
      assert.notStrictEqual(dbUser.password_hash, testPassword, 'Stored password must not be plaintext');
      assert.ok(
        dbUser.password_hash.startsWith('$2b$10$') || dbUser.password_hash.startsWith('$2a$10$'),
        'Stored password must be a valid salted bcrypt hash'
      );

      // Verify student profile persistence
      const dbProfile = await db.queryOne('SELECT id, user_id, student_id_number, department_id FROM student_profiles WHERE user_id = ?;', [registeredUser.id]);
      assert.ok(dbProfile, 'Student profile record must exist in SQLite database');
      assert.strictEqual(dbProfile.student_id_number, testStudentId);
      assert.strictEqual(dbProfile.department_id, targetDeptId);

      // Verify audit logging
      const dbAudit = await db.queryOne(
        "SELECT id, action, entity_type, actor_id FROM audit_logs WHERE action = 'AUTH_REGISTER' AND actor_id = ?;",
        [registeredUser.id]
      );
      assert.ok(dbAudit, 'Registration audit event must be persisted');
      assert.strictEqual(dbAudit.entity_type, 'USER');
    });

    // -------------------------------------------------------------
    // Scenario 3: Cookie and Session Behavior
    // -------------------------------------------------------------
    await test('Scenario 3: Cookie and session header verification', async () => {
      assert.ok(registeredCookies, 'Set-Cookie header must be present in registration response');
      const cookieStr = Array.isArray(registeredCookies) ? registeredCookies.join('; ') : registeredCookies;

      // Verify cookie security attributes
      assert.ok(cookieStr.includes('token='), 'Cookie must set token name');
      assert.ok(cookieStr.toLowerCase().includes('httponly'), 'Cookie must specify HttpOnly');
      assert.ok(cookieStr.toLowerCase().includes('path=/'), 'Cookie must specify Path=/');
      assert.ok(cookieStr.toLowerCase().includes('samesite=strict'), 'Cookie must specify SameSite=Strict');

      if (env.isProduction) {
        assert.ok(cookieStr.toLowerCase().includes('secure'), 'Secure flag must be present in production');
      }

      // Verify cookie-based authentication against protected endpoint
      const cookieAuthRes = await request(app)
        .get('/api/v1/auth/me')
        .set('Cookie', registeredCookies)
        .expect(HTTP_STATUS.OK);

      assert.strictEqual(cookieAuthRes.body.success, true);
      assert.strictEqual(cookieAuthRes.body.data.email, testEmail);
      assert.strictEqual(cookieAuthRes.body.data.role, 'STUDENT');

      // Verify anti-caching headers on protected session endpoint
      assert.ok(cookieAuthRes.headers['cache-control'].includes('no-store'), 'Cache-Control must contain no-store');
      assert.ok(cookieAuthRes.headers['cache-control'].includes('no-cache'), 'Cache-Control must contain no-cache');
      assert.strictEqual(cookieAuthRes.headers['pragma'], 'no-cache');
      assert.strictEqual(cookieAuthRes.headers['expires'], '0');
    });

    // -------------------------------------------------------------
    // Scenario 4: Student Authentication
    // -------------------------------------------------------------
    await test('Scenario 4: Student login with newly registered credentials (POST /api/v1/auth/login)', async () => {
      // 1. Valid credentials with cookie-only mode
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .set('X-Session-Mode', 'cookie-only')
        .send({
          email: testEmail,
          password: testPassword
        })
        .expect(HTTP_STATUS.OK);

      assert.strictEqual(loginRes.body.success, true);
      assert.strictEqual(loginRes.body.data.token, undefined, 'Cookie-only login must omit JWT access token in body');
      assert.strictEqual(loginRes.body.data.user.email, testEmail);
      assert.strictEqual(loginRes.body.data.user.role, 'STUDENT');
      assert.strictEqual(loginRes.body.data.user.status, 'ACTIVE');

      // Verify login returns valid session cookie
      assert.ok(loginRes.headers['set-cookie'], 'Login must emit Set-Cookie');

      // 2. Reject incorrect credentials
      const invalidRes = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testEmail,
          password: 'IncorrectPassword123!'
        })
        .expect(HTTP_STATUS.UNAUTHORIZED);

      assert.strictEqual(invalidRes.body.success, false);
      assert.strictEqual(invalidRes.body.error.code, 'INVALID_CREDENTIALS');
    });

    // -------------------------------------------------------------
    // Scenario 5: Logout & Session Invalidation with CSRF Headers
    // -------------------------------------------------------------
    await test('Scenario 5: Logout, cookie clearing, and token revocation (POST /api/v1/auth/logout)', async () => {
      // 1. Fresh login to acquire an isolated active cookie
      const session = await request(app)
        .post('/api/v1/auth/login')
        .set('X-Session-Mode', 'cookie-only')
        .send({ email: testEmail, password: testPassword })
        .expect(HTTP_STATUS.OK);

      const activeCookie = session.headers['set-cookie'];
      assert.ok(activeCookie, 'Active session cookie must be present');

      // 2. Perform cookie-authenticated logout mutation with required CSRF headers
      const logoutRes = await request(app)
        .post('/api/v1/auth/logout')
        .set('Cookie', activeCookie)
        .set('Origin', 'http://localhost:3000')
        .set('X-Requested-With', 'XMLHttpRequest')
        .set('Sec-Fetch-Site', 'same-origin')
        .expect(HTTP_STATUS.OK);

      assert.strictEqual(logoutRes.body.success, true);
      assert.strictEqual(logoutRes.body.data.loggedOut, true);

      // Verify Set-Cookie clears tokens
      const clearCookieHeader = logoutRes.headers['set-cookie'];
      assert.ok(clearCookieHeader, 'Logout must provide clearing Set-Cookie headers');
      const clearCookieStr = Array.isArray(clearCookieHeader) ? clearCookieHeader.join('; ') : clearCookieHeader;
      assert.ok(
        clearCookieStr.includes('Expires=Thu, 01 Jan 1970') || clearCookieStr.includes('Max-Age=0'),
        'Cookie header must invalidate the cookie'
      );

      // 3. Subsequent access with revoked session cookie is denied
      const revokedAccessRes = await request(app)
        .get('/api/v1/auth/me')
        .set('Cookie', activeCookie)
        .expect(HTTP_STATUS.UNAUTHORIZED);

      assert.strictEqual(revokedAccessRes.body.success, false);
      assert.strictEqual(revokedAccessRes.body.error.code, 'TOKEN_REVOKED');
    });

    // -------------------------------------------------------------
    // Scenario 6: Duplicate Prevention
    // -------------------------------------------------------------
    await test('Scenario 6: Duplicate email and student ID conflict defense', async () => {
      // 1. Attempt registration with the same email
      const dupEmailRes = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: testEmail, // duplicate
          password: 'AnotherPassword123!',
          firstName: 'Another',
          lastName: 'Student',
          studentIdNumber: `STU-UNIQ-${String(Date.now()).slice(-6)}`,
          departmentId: targetDeptId
        })
        .expect(HTTP_STATUS.CONFLICT);

      assert.strictEqual(dupEmailRes.body.success, false);
      assert.strictEqual(dupEmailRes.body.error.code, 'DUPLICATE_EMAIL');

      // 2. Attempt registration with the same student ID (different email)
      const dupIdRes = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: `different.${Date.now()}@student.university.edu`,
          password: 'AnotherPassword123!',
          firstName: 'Another',
          lastName: 'Student',
          studentIdNumber: testStudentId, // duplicate
          departmentId: targetDeptId
        })
        .expect(HTTP_STATUS.CONFLICT);

      assert.strictEqual(dupIdRes.body.success, false);
      assert.strictEqual(dupIdRes.body.error.code, 'DUPLICATE_STUDENT_ID');
    });

    // -------------------------------------------------------------
    // Scenario 7: Admin User-Management Visibility via Cookie Session
    // -------------------------------------------------------------
    await test('Scenario 7: Admin visibility in user list (GET /api/v1/admin/users)', async () => {
      // 1. Authenticate with seeded Admin credentials in cookie mode
      const adminLoginRes = await request(app)
        .post('/api/v1/auth/login')
        .set('X-Session-Mode', 'cookie-only')
        .send({
          email: 'admin@university.edu',
          password: 'Password123!'
        })
        .expect(HTTP_STATUS.OK);

      const adminCookie = adminLoginRes.headers['set-cookie'];
      assert.ok(adminCookie, 'Admin session cookie acquired');

      // 2. Query administrative users list via Cookie session
      const usersRes = await request(app)
        .get('/api/v1/admin/users')
        .set('Cookie', adminCookie)
        .expect(HTTP_STATUS.OK);

      assert.strictEqual(usersRes.body.success, true);
      assert.ok(Array.isArray(usersRes.body.data.users));

      // Verify registered student is present in admin list
      const foundStudent = usersRes.body.data.users.find((u) => u.email === testEmail);
      assert.ok(foundStudent, 'Newly registered student must appear in administrative user list');
      assert.strictEqual(foundStudent.id, registeredUser.id);
      assert.strictEqual(foundStudent.first_name, testFirstName);
      assert.strictEqual(foundStudent.last_name, testLastName);
      assert.strictEqual(foundStudent.role_name, 'STUDENT', 'Admin list must confirm STUDENT role');
      assert.strictEqual(foundStudent.status, 'ACTIVE', 'Admin list must confirm ACTIVE status');
    });

    // -------------------------------------------------------------
    // Scenario 8: Frontend Service Communication Contract & Storage Hygiene
    // -------------------------------------------------------------
    await test('Scenario 8: Frontend service client contract and localStorage hygiene verification', async () => {
      // Mock browser localStorage
      const mockStorage = {};
      const mockLocalStorage = {
        getItem: (k) => mockStorage[k] || null,
        setItem: (k, v) => { mockStorage[k] = String(v); },
        removeItem: (k) => { delete mockStorage[k]; }
      };

      const USER_KEY = 'ts_auth_user';
      const TOKEN_KEY = 'ts_auth_token';

      // 1. Dynamic department discovery simulation
      const deptFetch = await request(app).get('/api/v1/departments').expect(HTTP_STATUS.OK);
      const extractedDepartments = deptFetch.body.data.departments;
      assert.ok(Array.isArray(extractedDepartments), 'Service contract: must extract departments array');

      // 2. Registration payload and response contract with cookie-only mode
      const uniqueClientEmail = `client.service.${Date.now()}@student.university.edu`;
      const uniqueClientStudentId = `STU-SVC-${String(Date.now()).slice(-6)}`;
      const clientPayload = {
        email: uniqueClientEmail,
        password: 'ClientPassword123!',
        firstName: 'Clara',
        lastName: 'Oswald',
        studentIdNumber: uniqueClientStudentId,
        departmentId: targetDeptId,
        batch: '2026-SVC'
      };

      const regRes = await request(app)
        .post('/api/v1/auth/register')
        .set('X-Session-Mode', 'cookie-only')
        .send(clientPayload)
        .expect(HTTP_STATUS.CREATED);

      createdUserIds.push(regRes.body.data.user.id);

      // Verify response body contract: user present, token STRICTLY undefined
      assert.ok(regRes.body.data.user);
      assert.strictEqual(regRes.body.data.token, undefined, 'Cookie-only registration must not return raw token');

      // Simulate refactored authService.registerStudent storage updates (stores ONLY user, NEVER token)
      mockLocalStorage.setItem(USER_KEY, JSON.stringify(regRes.body.data.user));

      // Assert storage hygiene: token key is strictly null in localStorage
      assert.strictEqual(mockLocalStorage.getItem(TOKEN_KEY), null, 'JWT token must NEVER be written to localStorage');

      const storedUser = JSON.parse(mockLocalStorage.getItem(USER_KEY));
      assert.strictEqual(storedUser.email, uniqueClientEmail);
      assert.strictEqual(storedUser.role, 'STUDENT');

      // 3. Simulate session restoration via /auth/me contract
      const meRes = await request(app)
        .get('/api/v1/auth/me')
        .set('Cookie', regRes.headers['set-cookie'])
        .expect(HTTP_STATUS.OK);

      // Contract check: res.body.data IS the user object directly
      assert.strictEqual(meRes.body.data.email, uniqueClientEmail);
      assert.strictEqual(meRes.body.data.role, 'STUDENT');

      // 4. Logout simulation
      mockLocalStorage.removeItem(USER_KEY);
      mockLocalStorage.removeItem(TOKEN_KEY);
      assert.strictEqual(mockLocalStorage.getItem(TOKEN_KEY), null);
      assert.strictEqual(mockLocalStorage.getItem(USER_KEY), null);
    });

    // =============================================================
    // Step 4D.2.4B — Dynamic Frontend Module Loader for Test Stubs
    // =============================================================
    const fs = require('fs');
    let ts;
    try {
      ts = require('typescript');
    } catch {
      ts = require('./node_modules/typescript');
    }

    function createMockStorage() {
      const store = {};
      return {
        getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
        clear: () => { for (const k in store) delete store[k]; },
        _getRawStore: () => store
      };
    }

    function loadFrontendModule(filePath, customEnv = {}) {
      const fullPath = path.resolve(__dirname, filePath);
      const tsSource = fs.readFileSync(fullPath, 'utf8');
      const jsSource = ts.transpileModule(tsSource, {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2020
        }
      }).outputText;

      const moduleObj = { exports: {} };
      const requireShim = (id) => {
        if (customEnv.modules && customEnv.modules[id]) {
          return customEnv.modules[id];
        }
        if (id === './apiClient') return loadFrontendModule('src/services/apiClient.ts', customEnv);
        if (id === './sessionSync') return loadFrontendModule('src/services/sessionSync.ts', customEnv);
        return {};
      };

      const scope = {
        module: moduleObj,
        exports: moduleObj.exports,
        require: requireShim,
        window: customEnv.window,
        localStorage: customEnv.localStorage,
        sessionStorage: customEnv.sessionStorage,
        BroadcastChannel: customEnv.BroadcastChannel,
        fetch: customEnv.fetch,
        crypto: customEnv.crypto || {
          randomUUID: () => `test_tab_${Math.random().toString(36).substring(2, 9)}`
        }
      };

      const fn = new Function(...Object.keys(scope), jsSource);
      fn(...Object.values(scope));
      return moduleObj.exports;
    }

    class BroadcastChannelBus {
      constructor() {
        this.channels = new Map();
      }

      createChannelClass() {
        const bus = this;
        return class MockBroadcastChannel {
          constructor(name) {
            this.name = name;
            this.onmessage = null;
            this.closed = false;
            if (!bus.channels.has(name)) {
              bus.channels.set(name, new Set());
            }
            bus.channels.get(name).add(this);
          }

          postMessage(data) {
            if (this.closed) throw new Error('BroadcastChannel is closed');
            const set = bus.channels.get(this.name) || new Set();
            for (const target of set) {
              if (target !== this && !target.closed && typeof target.onmessage === 'function') {
                target.onmessage({ data });
              }
            }
          }

          close() {
            this.closed = true;
            const set = bus.channels.get(this.name);
            if (set) {
              set.delete(this);
              if (set.size === 0) bus.channels.delete(this.name);
            }
          }
        };
      }
    }

    // -------------------------------------------------------------
    // Scenario 9: Cross-Tab Logout via BroadcastChannel (AC1, 4, 5, 6, 7, 8, 9, 10, 11)
    // -------------------------------------------------------------
    await test('Scenario 9: Cross-tab logout broadcast and reception via BroadcastChannel', async () => {
      const bus = new BroadcastChannelBus();
      const MockBC = bus.createChannelClass();

      // Tab 1 setup
      const tab1Storage = createMockStorage();
      const tab1Sync = loadFrontendModule('src/services/sessionSync.ts', {
        window: { BroadcastChannel: MockBC },
        BroadcastChannel: MockBC,
        localStorage: tab1Storage,
        crypto: { randomUUID: () => 'tab_alpha_1' }
      }).sessionSync;

      // Tab 2 setup
      const tab2Storage = createMockStorage();
      const tab2Sync = loadFrontendModule('src/services/sessionSync.ts', {
        window: { BroadcastChannel: MockBC },
        BroadcastChannel: MockBC,
        localStorage: tab2Storage,
        crypto: { randomUUID: () => 'tab_beta_2' }
      }).sessionSync;

      let tab2BackendLogoutCount = 0;
      const tab2Fetch = async (url) => {
        if (url.includes('/auth/logout')) {
          tab2BackendLogoutCount++;
          return { ok: true, status: 200, json: async () => ({ success: true }) };
        }
        return { ok: true, status: 200, json: async () => ({ success: true, data: {} }) };
      };

      const tab2ApiClient = loadFrontendModule('src/services/apiClient.ts', {
        fetch: tab2Fetch,
        localStorage: tab2Storage
      }).apiClient;

      const tab2Auth = loadFrontendModule('src/services/authService.ts', {
        localStorage: tab2Storage,
        modules: {
          './apiClient': { apiClient: tab2ApiClient },
          './sessionSync': { sessionSync: tab2Sync }
        }
      }).authService;

      // Seed Tab 2 as authenticated
      tab2Auth.setStoredUser({
        id: 99,
        email: 'student.tab2@university.edu',
        firstName: 'Tab2',
        lastName: 'Student',
        role: 'STUDENT',
        status: 'ACTIVE'
      });
      assert.ok(tab2Auth.getStoredUser(), 'Tab 2 must begin with cached user');

      // Capture broadcasted payload from Tab 1
      let capturedPayload = null;
      const origPostMessage = MockBC.prototype.postMessage;
      MockBC.prototype.postMessage = function (data) {
        capturedPayload = data;
        origPostMessage.call(this, data);
      };

      // Subscribe Tab 2 to remote logout
      let tab2ReceivedEvent = false;
      let tab2RebroadcastCount = 0;
      const origTab2Broadcast = tab2Sync.broadcastLogout;
      tab2Sync.broadcastLogout = () => {
        tab2RebroadcastCount++;
        origTab2Broadcast.call(tab2Sync);
      };

      tab2Sync.onRemoteLogout(() => {
        tab2ReceivedEvent = true;
        tab2Auth.handleRemoteLogout();
      });

      // Subscribe Tab 1 to remote logout (to verify self-message is ignored)
      let tab1SelfReflected = false;
      tab1Sync.onRemoteLogout(() => {
        tab1SelfReflected = true;
      });

      // Tab 1 initiates logout
      tab1Sync.broadcastLogout();

      // Assertions
      assert.ok(capturedPayload, 'Tab 1 must emit a logout payload');
      assert.strictEqual(capturedPayload.type, 'LOGOUT', 'Payload type must be LOGOUT');
      assert.strictEqual(typeof capturedPayload.timestamp, 'number', 'Payload timestamp must be a number');
      assert.strictEqual(capturedPayload.tabId, 'tab_alpha_1', 'Payload must identify sender tab');
      assert.deepStrictEqual(
        Object.keys(capturedPayload).sort(),
        ['tabId', 'timestamp', 'type'],
        'Payload must contain ONLY permitted metadata (zero tokens, passwords, cookies, or profile data)'
      );

      assert.strictEqual(tab2ReceivedEvent, true, 'Tab 2 must receive the remote logout event');
      assert.strictEqual(tab2Auth.getStoredUser(), null, 'Tab 2 must clear cached user metadata');
      assert.strictEqual(tab2BackendLogoutCount, 0, 'Receiving tab must NOT call backend logout endpoint');
      assert.strictEqual(tab2RebroadcastCount, 0, 'Receiving tab must NOT rebroadcast the logout event');
      assert.strictEqual(tab1SelfReflected, false, 'Originating tab must ignore its own event');

      // Teardown
      tab1Sync.cleanup();
      tab2Sync.cleanup();
    });

    // -------------------------------------------------------------
    // Scenario 10: Storage-Event Fallback Synchronization (AC2, 8, 9, 10, 11)
    // -------------------------------------------------------------
    await test('Scenario 10: Storage-event fallback when BroadcastChannel is unavailable and malformed payload defense', async () => {
      const sharedStorage = createMockStorage();
      const storageListeners = [];

      const mockWindowA = {
        addEventListener: (evt, h) => { if (evt === 'storage') storageListeners.push(h); },
        removeEventListener: (evt, h) => {
          const idx = storageListeners.indexOf(h);
          if (idx !== -1) storageListeners.splice(idx, 1);
        }
      };

      const mockWindowB = {
        addEventListener: (evt, h) => { if (evt === 'storage') storageListeners.push(h); },
        removeEventListener: (evt, h) => {
          const idx = storageListeners.indexOf(h);
          if (idx !== -1) storageListeners.splice(idx, 1);
        }
      };

      // Wrap sharedStorage to dispatch storage event on mutations
      const wrappedStorageA = {
        getItem: sharedStorage.getItem,
        setItem: (k, v) => {
          sharedStorage.setItem(k, v);
          for (const handler of storageListeners) {
            handler({ key: k, newValue: v });
          }
        },
        removeItem: (k) => {
          sharedStorage.removeItem(k);
          for (const handler of storageListeners) {
            handler({ key: k, newValue: null });
          }
        }
      };

      const wrappedStorageB = {
        getItem: sharedStorage.getItem,
        setItem: wrappedStorageA.setItem,
        removeItem: wrappedStorageA.removeItem
      };

      // Tab A (BroadcastChannel = undefined)
      const tabASync = loadFrontendModule('src/services/sessionSync.ts', {
        window: mockWindowA,
        localStorage: wrappedStorageA,
        BroadcastChannel: undefined,
        crypto: { randomUUID: () => 'tab_storage_a' }
      }).sessionSync;

      // Tab B (BroadcastChannel = undefined)
      const tabBSync = loadFrontendModule('src/services/sessionSync.ts', {
        window: mockWindowB,
        localStorage: wrappedStorageB,
        BroadcastChannel: undefined,
        crypto: { randomUUID: () => 'tab_storage_b' }
      }).sessionSync;

      assert.strictEqual(tabASync.isBroadcastChannelMode(), false, 'BroadcastChannel mode must be false');
      assert.strictEqual(tabBSync.isBroadcastChannelMode(), false, 'BroadcastChannel mode must be false');

      let tabBReceivedCount = 0;
      tabBSync.onRemoteLogout(() => {
        tabBReceivedCount++;
      });

      // Tab A broadcasts logout via storage fallback
      tabASync.broadcastLogout();

      assert.strictEqual(tabBReceivedCount, 1, 'Tab B must receive logout via storage-event fallback');
      assert.strictEqual(
        sharedStorage.getItem('ts_auth_sync_event'),
        null,
        'Temporary storage-event data must be removed immediately after publishing'
      );

      // Malformed / non-logout storage events must be safely ignored
      const dispatchRaw = (evt) => {
        for (const handler of storageListeners) handler(evt);
      };

      // 1. Unrelated key
      dispatchRaw({ key: 'unrelated_key', newValue: JSON.stringify({ type: 'LOGOUT', timestamp: Date.now(), tabId: 'other' }) });
      assert.strictEqual(tabBReceivedCount, 1, 'Unrelated storage keys must be ignored');

      // 2. Removal event (newValue is null)
      dispatchRaw({ key: 'ts_auth_sync_event', newValue: null });
      assert.strictEqual(tabBReceivedCount, 1, 'Removal events must be ignored');

      // 3. Invalid JSON string
      dispatchRaw({ key: 'ts_auth_sync_event', newValue: 'INVALID_NOT_JSON{' });
      assert.strictEqual(tabBReceivedCount, 1, 'Malformed JSON must not throw or trigger logout');

      // 4. Missing required fields
      dispatchRaw({ key: 'ts_auth_sync_event', newValue: JSON.stringify({ type: 'NOT_LOGOUT' }) });
      assert.strictEqual(tabBReceivedCount, 1, 'Invalid event types must be ignored');

      // 5. Originating tabId matches Tab B (self-reflection)
      dispatchRaw({ key: 'ts_auth_sync_event', newValue: JSON.stringify({ type: 'LOGOUT', timestamp: Date.now(), tabId: 'tab_storage_b' }) });
      assert.strictEqual(tabBReceivedCount, 1, 'Self-reflected storage events must be ignored');

      tabASync.cleanup();
      tabBSync.cleanup();
    });

    // -------------------------------------------------------------
    // Scenario 11: Headless Node.js Runtime Safety (AC3)
    // -------------------------------------------------------------
    await test('Scenario 11: Browser API guard and headless Node.js runtime safety', async () => {
      // In this environment, window, localStorage, and BroadcastChannel are completely undefined
      const headlessSync = loadFrontendModule('src/services/sessionSync.ts', {
        window: undefined,
        localStorage: undefined,
        BroadcastChannel: undefined,
        crypto: undefined
      }).sessionSync;

      assert.strictEqual(headlessSync.isSupported(), false, 'isSupported must return false without throwing');
      assert.strictEqual(headlessSync.isBroadcastChannelMode(), false, 'isBroadcastChannelMode must be false');
      assert.doesNotThrow(() => {
        headlessSync.broadcastLogout();
      }, 'broadcastLogout must execute without throwing in headless Node.js');

      let unsub;
      assert.doesNotThrow(() => {
        unsub = headlessSync.onRemoteLogout(() => {});
      }, 'onRemoteLogout must not throw in headless Node.js');

      assert.doesNotThrow(() => {
        if (typeof unsub === 'function') unsub();
        headlessSync.cleanup();
      }, 'cleanup must not throw in headless Node.js');

      // authService storage guard in headless Node.js
      const headlessAuth = loadFrontendModule('src/services/authService.ts', {
        localStorage: undefined
      }).authService;

      assert.strictEqual(headlessAuth.getStoredUser(), null, 'getStoredUser must return null safely');
      assert.doesNotThrow(() => {
        headlessAuth.setStoredUser(null);
      }, 'setStoredUser must not throw without localStorage');
    });

    // -------------------------------------------------------------
    // Scenario 12: Session Epoch & Race Protection (AC13, 14, 15, 16)
    // -------------------------------------------------------------
    await test('Scenario 12: Session epoch protection against stale /auth/me responses and race conditions', async () => {
      // Test 1: Delayed /auth/me cannot restore session after local logout
      {
        const storage = createMockStorage();
        let resolveDelayedMe;
        const delayedMePromise = new Promise((resolve) => {
          resolveDelayedMe = resolve;
        });

        const mockApiClient = {
          get: (url) => {
            if (url === '/api/v1/auth/me') return delayedMePromise;
            return Promise.resolve({ success: true, data: {} });
          },
          post: (url) => Promise.resolve({ success: true, data: { loggedOut: true } }),
          resetUnauthorizedGuard: () => {}
        };

        const auth = loadFrontendModule('src/services/authService.ts', {
          localStorage: storage,
          modules: {
            './apiClient': { apiClient: mockApiClient },
            './sessionSync': { sessionSync: { broadcastLogout: () => {} } }
          }
        }).authService;

        // User initially logged in
        auth.setStoredUser({ id: 1, email: 'initial@student.edu', role: 'STUDENT', status: 'ACTIVE' });
        assert.ok(auth.getStoredUser());

        // /auth/me starts (epoch 0)
        const meRequest = auth.getMe();

        // Local logout completes while /auth/me is in-flight (epoch becomes 1)
        await auth.logout();
        assert.strictEqual(auth.getStoredUser(), null, 'Stored user must be cleared on logout');

        // Delayed response arrives from server
        resolveDelayedMe({ success: true, data: { id: 1, email: 'initial@student.edu', role: 'STUDENT', status: 'ACTIVE' } });

        let threwStale = false;
        try {
          await meRequest;
        } catch (err) {
          threwStale = err.message === 'STALE_SESSION_RESPONSE' || err.isStale === true;
        }

        assert.strictEqual(threwStale, true, 'Stale /auth/me must reject with STALE_SESSION_RESPONSE');
        assert.strictEqual(auth.getStoredUser(), null, 'Delayed response must NOT restore the logged-out user');
      }

      // Test 2: Delayed /auth/me cannot restore session after remote logout
      {
        const storage = createMockStorage();
        let resolveDelayedMe;
        const delayedMePromise = new Promise((resolve) => {
          resolveDelayedMe = resolve;
        });

        const mockApiClient = {
          get: (url) => {
            if (url === '/api/v1/auth/me') return delayedMePromise;
            return Promise.resolve({ success: true, data: {} });
          },
          resetUnauthorizedGuard: () => {}
        };

        const auth = loadFrontendModule('src/services/authService.ts', {
          localStorage: storage,
          modules: {
            './apiClient': { apiClient: mockApiClient }
          }
        }).authService;

        auth.setStoredUser({ id: 2, email: 'user2@student.edu', role: 'STUDENT', status: 'ACTIVE' });

        const meRequest = auth.getMe();

        // Remote logout event arrives while /auth/me is in-flight
        auth.handleRemoteLogout();
        assert.strictEqual(auth.getStoredUser(), null);

        // Delayed response arrives
        resolveDelayedMe({ success: true, data: { id: 2, email: 'user2@student.edu', role: 'STUDENT', status: 'ACTIVE' } });

        let threwStale = false;
        try {
          await meRequest;
        } catch (err) {
          threwStale = err.message === 'STALE_SESSION_RESPONSE' || err.isStale === true;
        }

        assert.strictEqual(threwStale, true, 'Stale /auth/me must reject after remote logout');
        assert.strictEqual(auth.getStoredUser(), null, 'Remote logout state must not be overwritten by delayed response');
      }

      // Test 3: Older /auth/me response cannot overwrite newer login
      {
        const storage = createMockStorage();
        let resolveOldMe;
        const oldMePromise = new Promise((resolve) => {
          resolveOldMe = resolve;
        });

        const newUser = { id: 200, email: 'new.student@student.edu', role: 'STUDENT', status: 'ACTIVE' };

        const mockApiClient = {
          get: (url) => {
            if (url === '/api/v1/auth/me') return oldMePromise;
            return Promise.resolve({ success: true, data: {} });
          },
          post: (url) => Promise.resolve({ success: true, data: { user: newUser } }),
          resetUnauthorizedGuard: () => {}
        };

        const auth = loadFrontendModule('src/services/authService.ts', {
          localStorage: storage,
          modules: {
            './apiClient': { apiClient: mockApiClient }
          }
        }).authService;

        // Old /auth/me starts (epoch 0)
        const oldMeRequest = auth.getMe();

        // New login succeeds while old /auth/me is in-flight (epoch becomes 1)
        await auth.login('new.student@student.edu', 'ValidPassword123!');
        assert.strictEqual(auth.getStoredUser().email, 'new.student@student.edu');

        // Old response resolves with User 1 data
        const oldUser = { id: 100, email: 'old.student@student.edu', role: 'STUDENT', status: 'ACTIVE' };
        resolveOldMe({ success: true, data: oldUser });

        let threwStale = false;
        try {
          await oldMeRequest;
        } catch (err) {
          threwStale = err.message === 'STALE_SESSION_RESPONSE' || err.isStale === true;
        }

        assert.strictEqual(threwStale, true, 'Older /auth/me request must be rejected as stale');
        assert.strictEqual(
          auth.getStoredUser().email,
          'new.student@student.edu',
          'Newer logged-in session must NOT be overwritten by older response'
        );
      }
    });

    // -------------------------------------------------------------
    // Scenario 13: 401 Notification Deduplication & Per-Session Guard (AC17, 18)
    // -------------------------------------------------------------
    await test('Scenario 13: 401 unauthorized notification deduplication and per-session guard reset', async () => {
      const storage = createMockStorage();

      let fetchCount = 0;
      const mockFetch = async (url) => {
        fetchCount++;
        return {
          ok: false,
          status: 401,
          json: async () => ({
            success: false,
            error: { code: 'UNAUTHORIZED', message: 'Session token expired or missing' }
          })
        };
      };

      const client = loadFrontendModule('src/services/apiClient.ts', {
        fetch: mockFetch,
        localStorage: storage
      }).apiClient;

      let unauthorizedCallbackCount = 0;
      client.onUnauthorized(() => {
        unauthorizedCallbackCount++;
      });

      // Fire 5 simultaneous protected requests returning 401
      const parallelRequests = [
        client.request('/api/v1/protected/resource1'),
        client.request('/api/v1/protected/resource2'),
        client.request('/api/v1/protected/resource3'),
        client.request('/api/v1/protected/resource4'),
        client.request('/api/v1/protected/resource5')
      ];

      await Promise.allSettled(parallelRequests);

      assert.strictEqual(fetchCount, 5, 'All 5 requests must have been dispatched');
      assert.strictEqual(
        unauthorizedCallbackCount,
        1,
        'Multiple simultaneous 401s must produce exactly one unauthorized notification per active session'
      );

      // Verify guard reset on new session establishment
      client.resetUnauthorizedGuard();

      await Promise.allSettled([client.request('/api/v1/protected/after-reset')]);
      assert.strictEqual(
        unauthorizedCallbackCount,
        2,
        'Resetting the unauthorized guard must permit notification for subsequent sessions'
      );

      // Verify that expected 401 on login entrypoint does not trigger unauthorized notification
      client.resetUnauthorizedGuard();
      await Promise.allSettled([
        client.request('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ email: 'bad@bad.com', password: 'bad' }) })
      ]);

      assert.strictEqual(
        unauthorizedCallbackCount,
        2,
        'Expected 401 on /auth/login must NOT trigger session-expired notification'
      );
    });

    // -------------------------------------------------------------
    // Scenario 14: Strict Cookie-Only Architecture & Storage Hygiene (AC19, 20, 21, 22)
    // -------------------------------------------------------------
    await test('Scenario 14: Strict cookie-only authentication and browser storage hygiene', async () => {
      const capturedRequests = [];
      const mockFetch = async (url, options = {}) => {
        capturedRequests.push({ url, options });
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: { user: { id: 77, email: 'hygiene@univ.edu', role: 'STUDENT' } } })
        };
      };

      const storage = createMockStorage();
      const client = loadFrontendModule('src/services/apiClient.ts', {
        fetch: mockFetch,
        localStorage: storage
      }).apiClient;

      // 1. GET request
      await client.get('/api/v1/test');
      const getReq = capturedRequests[capturedRequests.length - 1];
      assert.strictEqual(getReq.options.credentials, 'include', 'Client must enforce credentials: include');
      assert.strictEqual(getReq.options.headers['Authorization'], undefined, 'No Authorization header injected');

      // 2. Mutation request
      await client.post('/api/v1/test', { data: 123 });
      const postReq = capturedRequests[capturedRequests.length - 1];
      assert.strictEqual(postReq.options.credentials, 'include');
      assert.strictEqual(
        postReq.options.headers['X-Requested-With'],
        'XMLHttpRequest',
        'State-changing requests must include X-Requested-With CSRF defense'
      );
      assert.strictEqual(postReq.options.headers['Authorization'], undefined, 'No Bearer token in headers');

      // 3. Login request
      await client.post('/api/v1/auth/login', { email: 'test@univ.edu', password: 'Pass' });
      const loginReq = capturedRequests[capturedRequests.length - 1];
      assert.strictEqual(loginReq.options.credentials, 'include');
      assert.strictEqual(
        loginReq.options.headers['X-Session-Mode'],
        'cookie-only',
        'Authentication requests must negotiate X-Session-Mode: cookie-only'
      );

      // 4. Verify backend Bearer compatibility remains intact for non-browser clients
      const adminLogin = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'admin@university.edu', password: 'Password123!' })
        .expect(HTTP_STATUS.OK);

      const bearerToken = adminLogin.body.data.token;
      assert.ok(bearerToken, 'Backend must continue to provide Bearer token when requested without cookie-only');

      const bearerRes = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${bearerToken}`)
        .expect(HTTP_STATUS.OK);

      assert.strictEqual(bearerRes.body.success, true);
      assert.strictEqual(bearerRes.body.data.email, 'admin@university.edu');
    });

  } finally {
    // Clean up only test records created by this suite
    await cleanup();
  }

  console.log('\n=================================================================');
  console.log(` Summary: ${passed} passed, ${failed} failed out of ${passed + failed} integration scenarios`);
  console.log('=================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runStudentIntegrationTests().catch((err) => {
  console.error('[FATAL RUNNER EXCEPTION]', err);
  process.exit(1);
});
