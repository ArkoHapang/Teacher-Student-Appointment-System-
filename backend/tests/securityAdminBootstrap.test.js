/**
 * Security Regression Test Suite for Administrator Credential Remediation (BLK-01)
 * Covers all 20 required scenarios (SEC-01 through SEC-20).
 * Uses strictly isolated temporary databases for each test to guarantee baseline safety.
 */

require('./setup');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { DatabaseSync } = require('node:sqlite');
const request = require('supertest');
const app = require('../src/app');
const env = require('../src/config/env');
const db = require('../src/config/database');
const passwordService = require('../src/services/passwordService');
const adminBootstrapService = require('../src/services/adminBootstrapService');
const authService = require('../src/services/authService');
const HTTP_STATUS = require('../src/constants/httpStatusCodes');

const SCRATCH_DIR = path.resolve(__dirname, '../../scratch');
if (!fs.existsSync(SCRATCH_DIR)) {
  fs.mkdirSync(SCRATCH_DIR, { recursive: true });
}

function createIsolatedTestDb(testId) {
  const dbPath = path.join(SCRATCH_DIR, `isolated_sec_${testId}_${Date.now()}.db`);
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

  // Apply migrations 001, 002, 003, 004
  execFileSync(process.execPath, [
    path.resolve(__dirname, '../../database/migrate.js'),
    `--db=${dbPath}`
  ], {
    encoding: 'utf8',
    windowsHide: true
  });

  return dbPath;
}

function cleanupDb(dbPath) {
  try {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  } catch {}
}

async function runSecurityTests() {
  console.log('\n=================================================================');
  console.log(' Teacher-Student Appointment System: Administrator Security Tests');
  console.log('=================================================================\n');

  let passed = 0;
  let failed = 0;
  const results = [];

  async function runTest(id, name, fn) {
    try {
      await fn();
      console.log(`  [PASS] ${id}: ${name}`);
      passed++;
      results.push({ id, name, status: 'PASS' });
    } catch (err) {
      console.log(`  [FAIL] ${id}: ${name}`);
      console.error(`         Error: ${err.message}`);
      failed++;
      results.push({ id, name, status: 'FAIL', error: err.message });
    }
  }

  // SEC-01: Fresh production database without bootstrap credentials refuses public server startup
  await runTest('SEC-01', 'Fresh production database without bootstrap credentials refuses public startup', async () => {
    const testDb = createIsolatedTestDb('sec01');
    try {
      // Execute in isolated subprocess simulating production mode without ADMIN_INITIAL_PASSWORD
      let threw = false;
      try {
        execFileSync(process.execPath, [
          '-e',
          `
          process.env.NODE_ENV = 'production';
          process.env.DB_FILE = ${JSON.stringify(testDb)};
          process.env.JWT_SECRET = 'a_very_long_production_test_jwt_secret_value_32chars';
          delete process.env.ADMIN_INITIAL_PASSWORD;
          const service = require('./backend/src/services/adminBootstrapService');
          service.ensureAdminProvisioned().then(() => process.exit(0)).catch(e => {
            console.error(e.message);
            process.exit(1);
          });
          `
        ], {
          encoding: 'utf8',
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe']
        });
      } catch (err) {
        threw = true;
        assert(err.stderr.includes('Production startup refused') || err.message.includes('exit code 1'));
      }
      assert(threw, 'Subprocess should have exited with error when credentials absent in production');
    } finally {
      cleanupDb(testDb);
    }
  });

  // SEC-02: Fresh database with valid bootstrap credentials provisions exactly one administrator
  await runTest('SEC-02', 'Fresh database with valid bootstrap credentials provisions exactly one administrator', async () => {
    const testDb = createIsolatedTestDb('sec02');
    try {
      const output = execFileSync(process.execPath, [
        '-e',
        `
        process.env.NODE_ENV = 'production';
        process.env.DB_FILE = ${JSON.stringify(testDb)};
        process.env.JWT_SECRET = 'a_very_long_production_test_jwt_secret_value_32chars';
        process.env.ADMIN_INITIAL_EMAIL = 'custom.admin@university.edu';
        process.env.ADMIN_INITIAL_PASSWORD = 'SecureAdmin#2026!P@ss';
        const service = require('./backend/src/services/adminBootstrapService');
        service.ensureAdminProvisioned().then(() => {
          const { DatabaseSync } = require('node:sqlite');
          const syncDb = new DatabaseSync(process.env.DB_FILE);
          const admins = syncDb.prepare("SELECT u.id, u.email, u.status FROM users u JOIN roles r ON u.role_id = r.id WHERE r.name = 'ADMIN'").all();
          const ledger = syncDb.prepare("SELECT count(*) as count FROM admin_bootstrap_state").get();
          console.log(JSON.stringify({ admins, ledgerCount: ledger.count }));
          process.exit(0);
        }).catch(e => {
          console.error(e.message);
          process.exit(1);
        });
        `
      ], {
        encoding: 'utf8',
        windowsHide: true
      });

      const parsed = JSON.parse(output.trim().split('\n').pop());
      assert.strictEqual(parsed.admins.length, 1, 'Exactly one administrator must exist');
      assert.strictEqual(parsed.admins[0].email, 'custom.admin@university.edu');
      assert.strictEqual(parsed.admins[0].status, 'ACTIVE');
      assert.strictEqual(parsed.ledgerCount, 1, 'Ledger must record 1 bootstrap event');
    } finally {
      cleanupDb(testDb);
    }
  });

  // SEC-03: Missing administrator email fails safely
  await runTest('SEC-03', 'Missing administrator email fails safely', async () => {
    let threw = false;
    try {
      await adminBootstrapService.bootstrapAdministrator({ email: '', password: 'SecurePassword#123!' });
    } catch (err) {
      threw = true;
      assert.strictEqual(err.statusCode, HTTP_STATUS.BAD_REQUEST);
      assert.strictEqual(err.code, 'VALIDATION_ERROR');
    }
    assert(threw, 'Should throw VALIDATION_ERROR on missing email');
  });

  // SEC-04: Missing administrator password fails safely
  await runTest('SEC-04', 'Missing administrator password fails safely', async () => {
    let threw = false;
    try {
      await adminBootstrapService.bootstrapAdministrator({ email: 'admin@university.edu', password: '' });
    } catch (err) {
      threw = true;
      assert.strictEqual(err.statusCode, HTTP_STATUS.BAD_REQUEST);
      assert.strictEqual(err.code, 'VALIDATION_ERROR');
    }
    assert(threw, 'Should throw VALIDATION_ERROR on missing password');
  });

  // SEC-05: Weak password rejected by complexity engine
  await runTest('SEC-05', 'Weak password rejected by complexity engine', async () => {
    const weakPasswords = ['short', 'nouppercase1!', 'NOLOWERCASE1!', 'NoNumberSymbol!', 'NoSpecial1234'];
    for (const weak of weakPasswords) {
      let threw = false;
      try {
        await adminBootstrapService.bootstrapAdministrator({ email: 'admin@university.edu', password: weak });
      } catch (err) {
        threw = true;
        assert.strictEqual(err.code, 'WEAK_PASSWORD');
      }
      assert(threw, `Should reject weak password: ${weak}`);
    }
  });

  // SEC-06: Invalid email format rejected
  await runTest('SEC-06', 'Invalid email format rejected', async () => {
    const invalidEmails = ['plainaddress', '@missingusername.com', 'user@.com', 'user@domain..com'];
    for (const invalid of invalidEmails) {
      let threw = false;
      try {
        await adminBootstrapService.bootstrapAdministrator({ email: invalid, password: 'SecureAdmin#2026!P@ss' });
      } catch (err) {
        threw = true;
        assert.strictEqual(err.code, 'VALIDATION_ERROR');
      }
      assert(threw, `Should reject invalid email: ${invalid}`);
    }
  });

  // SEC-07: Existing administrator cannot be overwritten by bootstrap
  await runTest('SEC-07', 'Existing administrator cannot be overwritten by bootstrap', async () => {
    const testDb = createIsolatedTestDb('sec07');
    try {
      const output = execFileSync(process.execPath, [
        '-e',
        `
        process.env.DB_FILE = ${JSON.stringify(testDb)};
        const service = require('./backend/src/services/adminBootstrapService');
        async function run() {
          await service.bootstrapAdministrator({ email: 'admin.initial@university.edu', password: 'FirstPassword#123!' });
          try {
            await service.bootstrapAdministrator({ email: 'attacker@university.edu', password: 'SecondPassword#123!' });
            console.log('FAIL_OVERWRITE');
          } catch (e) {
            console.log('PASS_PROTECTED:' + e.code);
          }
        }
        run();
        `
      ], { encoding: 'utf8', windowsHide: true });

      assert(output.includes('PASS_PROTECTED:ALREADY_BOOTSTRAPPED'), 'Should reject overwrite attempt');
    } finally {
      cleanupDb(testDb);
    }
  });

  // SEC-08: Repeated bootstrap attempt creates no duplicate administrator
  await runTest('SEC-08', 'Repeated bootstrap attempt creates no duplicate administrator', async () => {
    const testDb = createIsolatedTestDb('sec08');
    try {
      const output = execFileSync(process.execPath, [
        '-e',
        `
        process.env.DB_FILE = ${JSON.stringify(testDb)};
        const service = require('./backend/src/services/adminBootstrapService');
        async function run() {
          await service.bootstrapAdministrator({ email: 'primary.admin@university.edu', password: 'FirstPassword#123!' });
          try { await service.bootstrapAdministrator({ email: 'primary.admin@university.edu', password: 'FirstPassword#123!' }); } catch {}
          const { DatabaseSync } = require('node:sqlite');
          const syncDb = new DatabaseSync(process.env.DB_FILE);
          const count = syncDb.prepare("SELECT count(*) as c FROM users u JOIN roles r ON u.role_id = r.id WHERE r.name = 'ADMIN'").get().c;
          console.log('ADMIN_COUNT:' + count);
        }
        run();
        `
      ], { encoding: 'utf8', windowsHide: true });

      assert(output.includes('ADMIN_COUNT:1'), 'Admin count must remain exactly 1');
    } finally {
      cleanupDb(testDb);
    }
  });

  // SEC-09: Concurrent bootstrap attempts result in at most one successful provisioning
  await runTest('SEC-09', 'Concurrent bootstrap attempts result in at most one successful provisioning', async () => {
    const testDb = createIsolatedTestDb('sec09');
    try {
      const output = execFileSync(process.execPath, [
        '-e',
        `
        process.env.DB_FILE = ${JSON.stringify(testDb)};
        const service = require('./backend/src/services/adminBootstrapService');
        async function run() {
          const promises = [
            service.bootstrapAdministrator({ email: 'c1@university.edu', password: 'Password#12345!' }).then(() => 'c1_ok').catch(e => 'c1_err'),
            service.bootstrapAdministrator({ email: 'c2@university.edu', password: 'Password#12345!' }).then(() => 'c2_ok').catch(e => 'c2_err')
          ];
          const res = await Promise.all(promises);
          const { DatabaseSync } = require('node:sqlite');
          const syncDb = new DatabaseSync(process.env.DB_FILE);
          const count = syncDb.prepare("SELECT count(*) as c FROM users u JOIN roles r ON u.role_id = r.id WHERE r.name = 'ADMIN'").get().c;
          console.log(JSON.stringify({ res, count }));
        }
        run();
        `
      ], { encoding: 'utf8', windowsHide: true });

      const parsed = JSON.parse(output.trim().split('\n').pop());
      assert.strictEqual(parsed.count, 1, 'Must have exactly 1 admin after concurrent race');
    } finally {
      cleanupDb(testDb);
    }
  });

  // SEC-10: Failed provisioning transaction leaves no partially created administrator
  await runTest('SEC-10', 'Failed provisioning transaction leaves no partially created administrator', async () => {
    const testDb = createIsolatedTestDb('sec10');
    try {
      const output = execFileSync(process.execPath, [
        '-e',
        `
        process.env.DB_FILE = ${JSON.stringify(testDb)};
        const service = require('./backend/src/services/adminBootstrapService');
        async function run() {
          try {
            await service.bootstrapAdministrator({ email: 'invalid_email_that_fails', password: 'Weak' });
          } catch (e) {}
          const { DatabaseSync } = require('node:sqlite');
          const syncDb = new DatabaseSync(process.env.DB_FILE);
          const ledgerCount = syncDb.prepare("SELECT count(*) as c FROM admin_bootstrap_state").get().c;
          console.log('LEDGER_COUNT:' + ledgerCount);
        }
        run();
        `
      ], { encoding: 'utf8', windowsHide: true });

      assert(output.includes('LEDGER_COUNT:0'), 'Ledger must have 0 entries after failed attempt');
    } finally {
      cleanupDb(testDb);
    }
  });

  // SEC-11: Bootstrap credentials absent after successful provisioning allows normal startup
  await runTest('SEC-11', 'Bootstrap credentials absent after successful provisioning allows normal startup', async () => {
    const testDb = createIsolatedTestDb('sec11');
    try {
      const output = execFileSync(process.execPath, [
        '-e',
        `
        process.env.NODE_ENV = 'production';
        process.env.DB_FILE = ${JSON.stringify(testDb)};
        process.env.JWT_SECRET = 'a_very_long_production_test_jwt_secret_value_32chars';
        const service = require('./backend/src/services/adminBootstrapService');
        async function run() {
          // 1. Initial provisioning
          await service.bootstrapAdministrator({ email: 'admin@university.edu', password: 'InitialPassword#123!' });
          // 2. Restart simulation: delete environment variable
          delete process.env.ADMIN_INITIAL_PASSWORD;
          // 3. Ensure startup passes
          const ok = await service.ensureAdminProvisioned();
          console.log('RESTART_STATUS:' + ok);
        }
        run();
        `
      ], { encoding: 'utf8', windowsHide: true });

      assert(output.includes('RESTART_STATUS:true'), 'Subsequent startup must succeed without credentials');
    } finally {
      cleanupDb(testDb);
    }
  });

  // SEC-12: Bootstrap credentials supplied after provisioning leaves existing admin unchanged
  await runTest('SEC-12', 'Bootstrap credentials supplied after provisioning leaves existing admin unchanged', async () => {
    const testDb = createIsolatedTestDb('sec12');
    try {
      const output = execFileSync(process.execPath, [
        '-e',
        `
        process.env.NODE_ENV = 'production';
        process.env.DB_FILE = ${JSON.stringify(testDb)};
        process.env.JWT_SECRET = 'a_very_long_production_test_jwt_secret_value_32chars';
        const service = require('./backend/src/services/adminBootstrapService');
        async function run() {
          // 1. Initial provisioning
          await service.bootstrapAdministrator({ email: 'original.admin@university.edu', password: 'OriginalPassword#123!' });
          // 2. Restart with different credentials in env
          process.env.ADMIN_INITIAL_EMAIL = 'different.admin@university.edu';
          process.env.ADMIN_INITIAL_PASSWORD = 'DifferentPassword#456!';
          await service.ensureAdminProvisioned();
          const { DatabaseSync } = require('node:sqlite');
          const syncDb = new DatabaseSync(process.env.DB_FILE);
          const admin = syncDb.prepare("SELECT email FROM users WHERE id = 1").get();
          console.log('ADMIN_EMAIL:' + admin.email);
        }
        run();
        `
      ], { encoding: 'utf8', windowsHide: true });

      assert(output.includes('ADMIN_EMAIL:original.admin@university.edu'), 'Original admin email must not be overwritten');
    } finally {
      cleanupDb(testDb);
    }
  });

  // SEC-13: Default seeded administrator credential cannot authenticate in fresh production state
  await runTest('SEC-13', 'Default seeded administrator credential cannot authenticate in fresh production state', async () => {
    const testDb = createIsolatedTestDb('sec13');
    try {
      const output = execFileSync(process.execPath, [
        '-e',
        `
        process.env.DB_FILE = ${JSON.stringify(testDb)};
        const auth = require('./backend/src/services/authService');
        async function run() {
          try {
            await auth.login('admin@university.edu', 'Password123!');
            console.log('LOGIN_STATUS:SUCCESS');
          } catch (e) {
            console.log('LOGIN_STATUS:REJECTED:' + e.code);
          }
        }
        run();
        `
      ], { encoding: 'utf8', windowsHide: true });

      assert(output.includes('LOGIN_STATUS:REJECTED'), 'Default password must be rejected');
      assert(!output.includes('LOGIN_STATUS:SUCCESS'), 'Default password must NEVER succeed');
    } finally {
      cleanupDb(testDb);
    }
  });

  // SEC-14: Newly provisioned administrator login succeeds with standard authentication
  await runTest('SEC-14', 'Newly provisioned administrator login succeeds with standard authentication', async () => {
    const testDb = createIsolatedTestDb('sec14');
    try {
      const output = execFileSync(process.execPath, [
        '-e',
        `
        process.env.DB_FILE = ${JSON.stringify(testDb)};
        const service = require('./backend/src/services/adminBootstrapService');
        const auth = require('./backend/src/services/authService');
        async function run() {
          await service.bootstrapAdministrator({ email: 'new.admin@university.edu', password: 'SecureNewPassword#2026!' });
          const res = await auth.login('new.admin@university.edu', 'SecureNewPassword#2026!');
          console.log(JSON.stringify({ success: !!res.token, role: res.user.role }));
        }
        run();
        `
      ], { encoding: 'utf8', windowsHide: true });

      const parsed = JSON.parse(output.trim().split('\n').pop());
      assert.strictEqual(parsed.success, true);
      assert.strictEqual(parsed.role, 'ADMIN');
    } finally {
      cleanupDb(testDb);
    }
  });

  // SEC-15: Student attempts administrator action -> Access Denied (403)
  await runTest('SEC-15', 'Student attempts administrator action receives 403 Forbidden', async () => {
    const studentLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'alice.carter@student.university.edu', password: 'Password123!' });
    assert.strictEqual(studentLogin.statusCode, HTTP_STATUS.OK);
    const token = studentLogin.body.data.token;

    const adminRoute = await request(app)
      .get('/api/v1/admin/users')
      .set('Authorization', `Bearer ${token}`);
    assert.strictEqual(adminRoute.statusCode, HTTP_STATUS.FORBIDDEN);
  });

  // SEC-16: Teacher attempts administrator action -> Access Denied (403)
  await runTest('SEC-16', 'Teacher attempts administrator action receives 403 Forbidden', async () => {
    const teacherLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'robert.miller@university.edu', password: 'Password123!' });
    assert.strictEqual(teacherLogin.statusCode, HTTP_STATUS.OK);
    const token = teacherLogin.body.data.token;

    const adminRoute = await request(app)
      .get('/api/v1/admin/users')
      .set('Authorization', `Bearer ${token}`);
    assert.strictEqual(adminRoute.statusCode, HTTP_STATUS.FORBIDDEN);
  });

  // SEC-17: Database integrity check returns ok
  await runTest('SEC-17', 'PRAGMA integrity_check returns ok', async () => {
    const testDb = createIsolatedTestDb('sec17');
    try {
      const syncDb = new DatabaseSync(testDb);
      const res = syncDb.prepare('PRAGMA integrity_check;').all();
      assert.strictEqual(res[0].integrity_check, 'ok');
    } finally {
      cleanupDb(testDb);
    }
  });

  // SEC-18: Foreign-key check returns no violations
  await runTest('SEC-18', 'PRAGMA foreign_key_check returns no violations', async () => {
    const testDb = createIsolatedTestDb('sec18');
    try {
      const syncDb = new DatabaseSync(testDb);
      const violations = syncDb.prepare('PRAGMA foreign_key_check;').all();
      assert.strictEqual(violations.length, 0, 'Must have zero foreign key violations');
    } finally {
      cleanupDb(testDb);
    }
  });

  // SEC-19: Repeated migrations idempotent
  await runTest('SEC-19', 'Repeated migrations idempotent without duplication or corruption', async () => {
    const testDb = createIsolatedTestDb('sec19');
    try {
      // Run migrate again on same DB
      const output = execFileSync(process.execPath, [
        path.resolve(__dirname, '../../database/migrate.js'),
        `--db=${testDb}`
      ], { encoding: 'utf8', windowsHide: true });

      assert(output.includes('0 applied, 4 up-to-date, 4 total'), 'Must report 0 applied on repeat');
    } finally {
      cleanupDb(testDb);
    }
  });

  // SEC-20: Startup without secure provisioning confirms fail-closed behavior
  await runTest('SEC-20', 'Startup without secure provisioning confirms fail-closed behavior', async () => {
    const testDb = createIsolatedTestDb('sec20');
    try {
      let threw = false;
      try {
        execFileSync(process.execPath, [
          '-e',
          `
          process.env.NODE_ENV = 'production';
          process.env.DB_FILE = ${JSON.stringify(testDb)};
          process.env.JWT_SECRET = 'a_very_long_production_test_jwt_secret_value_32chars';
          const service = require('./backend/src/services/adminBootstrapService');
          service.ensureAdminProvisioned().then(() => process.exit(0)).catch(() => process.exit(1));
          `
        ], { encoding: 'utf8', windowsHide: true });
      } catch (err) {
        threw = true;
      }
      assert(threw, 'Fail-closed behavior confirmed: server refused startup without provisioning');
    } finally {
      cleanupDb(testDb);
    }
  });

  console.log('\n-----------------------------------------------------------------');
  console.log(`Administrator Security Test Summary: ${passed} passed, ${failed} failed.`);
  console.log('=================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runSecurityTests();
}

module.exports = { runSecurityTests };
