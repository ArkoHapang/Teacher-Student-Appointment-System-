/**
 * Admin System Views Integration Test Suite
 * Validates backend endpoints corresponding to the Admin panel's:
 * - User Accounts (GET /api/v1/admin/users, PATCH /api/v1/admin/users/:id/status)
 * - Audit Logs (GET /api/v1/admin/audit-logs)
 * - System Status (GET /api/v1/health, GET /api/v1/ready)
 * - Strict RBAC verification across roles (ADMIN vs TEACHER vs STUDENT)
 */

require('./setup');
const assert = require('assert');
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/database');
const HTTP_STATUS = require('../src/constants/httpStatusCodes');
const { USER_STATUS } = require('../src/constants/roles');

async function runAdminSystemViewTests() {
  console.log('\n=================================================================');
  console.log(' Teacher-Student Appointment System: Admin System Views Tests    ');
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

  // Auth helper
  const login = async (email, password = 'Password123!') => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password });
    if (res.status !== HTTP_STATUS.OK) {
      throw new Error(`Failed to login as ${email}: ${JSON.stringify(res.body)}`);
    }
    return res.body.data.token;
  };

  const adminToken = await login('admin@university.edu');
  const teacherToken = await login('robert.miller@university.edu');
  const studentToken = await login('alice.carter@student.university.edu');

  // Suite 1: User Accounts Endpoint Tests
  console.log('\n[Suite 1] User Accounts (/api/v1/admin/users)...');

  await test('RBAC: Student cannot list user accounts (403 Forbidden)', async () => {
    const res = await request(app)
      .get('/api/v1/admin/users')
      .set('Authorization', `Bearer ${studentToken}`);

    assert.strictEqual(res.status, HTTP_STATUS.FORBIDDEN);
    assert.strictEqual(res.body.error.code, 'FORBIDDEN');
  });

  await test('RBAC: Teacher cannot list user accounts (403 Forbidden)', async () => {
    const res = await request(app)
      .get('/api/v1/admin/users')
      .set('Authorization', `Bearer ${teacherToken}`);

    assert.strictEqual(res.status, HTTP_STATUS.FORBIDDEN);
    assert.strictEqual(res.body.error.code, 'FORBIDDEN');
  });

  await test('Admin successfully retrieves all user accounts (200 OK)', async () => {
    const res = await request(app)
      .get('/api/v1/admin/users')
      .set('Authorization', `Bearer ${adminToken}`);

    assert.strictEqual(res.status, HTTP_STATUS.OK);
    assert.strictEqual(res.body.success, true);
    assert.ok(typeof res.body.data.total === 'number');
    assert.ok(Array.isArray(res.body.data.users));
    assert.ok(res.body.data.users.length >= 7);

    const sample = res.body.data.users[0];
    assert.ok(sample.id);
    assert.ok(sample.email);
    assert.ok(sample.first_name);
    assert.ok(sample.last_name);
    assert.ok(sample.status);
    assert.ok(sample.role_name);
    assert.ok(sample.created_at);
  });

  // Suite 2: User Status Modification Tests
  console.log('\n[Suite 2] User Status Management (/api/v1/admin/users/:id/status)...');

  await test('RBAC: Student cannot modify user status (403 Forbidden)', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/users/6/status')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ status: USER_STATUS.SUSPENDED });

    assert.strictEqual(res.status, HTTP_STATUS.FORBIDDEN);
  });

  await test('Validation: Invalid user status is rejected (400 Bad Request)', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/users/6/status')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'NON_EXISTENT_STATUS' });

    assert.strictEqual(res.status, HTTP_STATUS.BAD_REQUEST);
    assert.strictEqual(res.body.error.code, 'INVALID_STATUS');
  });

  await test('Admin successfully modifies and restores user status (200 OK)', async () => {
    const userToTest = await db.queryOne("SELECT id, status FROM users WHERE email = 'alice.carter@student.university.edu';");
    assert.ok(userToTest, 'Target test user must exist');

    const originalStatus = userToTest.status;
    const tempStatus = originalStatus === USER_STATUS.ACTIVE ? USER_STATUS.SUSPENDED : USER_STATUS.ACTIVE;

    // Apply temp status
    const updateRes = await request(app)
      .patch(`/api/v1/admin/users/${userToTest.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: tempStatus });

    assert.strictEqual(updateRes.status, HTTP_STATUS.OK);
    assert.strictEqual(updateRes.body.success, true);
    assert.strictEqual(updateRes.body.data.status, tempStatus);

    // Verify DB reflects update
    const dbCheck = await db.queryOne('SELECT status FROM users WHERE id = ?;', [userToTest.id]);
    assert.strictEqual(dbCheck.status, tempStatus);

    // Revert status
    const revertRes = await request(app)
      .patch(`/api/v1/admin/users/${userToTest.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: originalStatus });

    assert.strictEqual(revertRes.status, HTTP_STATUS.OK);
    assert.strictEqual(revertRes.body.data.status, originalStatus);
  });

  // Suite 3: Audit Logs Tests
  console.log('\n[Suite 3] Audit Logs (/api/v1/admin/audit-logs)...');

  await test('RBAC: Student cannot access audit logs (403 Forbidden)', async () => {
    const res = await request(app)
      .get('/api/v1/admin/audit-logs')
      .set('Authorization', `Bearer ${studentToken}`);

    assert.strictEqual(res.status, HTTP_STATUS.FORBIDDEN);
  });

  await test('RBAC: Teacher cannot access audit logs (403 Forbidden)', async () => {
    const res = await request(app)
      .get('/api/v1/admin/audit-logs')
      .set('Authorization', `Bearer ${teacherToken}`);

    assert.strictEqual(res.status, HTTP_STATUS.FORBIDDEN);
  });

  await test('Admin successfully retrieves audit logs with actor details (200 OK)', async () => {
    const res = await request(app)
      .get('/api/v1/admin/audit-logs')
      .set('Authorization', `Bearer ${adminToken}`);

    assert.strictEqual(res.status, HTTP_STATUS.OK);
    assert.strictEqual(res.body.success, true);
    assert.ok(Array.isArray(res.body.data.logs));
    assert.ok(res.body.data.logs.length > 0);

    const log = res.body.data.logs[0];
    assert.ok(log.id);
    assert.ok(log.actor_id);
    assert.ok(log.action);
    assert.ok(log.entity_type);
    assert.ok(log.entity_id);
    assert.ok(log.actor_email);
    assert.ok(log.first_name);
    assert.ok(log.last_name);
    assert.ok(log.created_at);
  });

  // Suite 4: System Status Diagnostics (Health & Readiness)
  console.log('\n[Suite 4] System Diagnostics (/api/v1/health & /api/v1/ready)...');

  await test('Liveness probe (/api/v1/health) reports UP with memory usage', async () => {
    const res = await request(app).get('/api/v1/health');

    assert.strictEqual(res.status, HTTP_STATUS.OK);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.status, 'UP');
    assert.ok(typeof res.body.data.uptimeSeconds === 'number');
    assert.ok(res.body.data.service);
    assert.ok(res.body.data.memoryUsage);
    assert.ok(typeof res.body.data.memoryUsage.rssMb === 'number');
    assert.ok(typeof res.body.data.memoryUsage.heapUsedMb === 'number');
  });

  await test('Readiness probe (/api/v1/ready) reports READY with database and applied migrations', async () => {
    const res = await request(app).get('/api/v1/ready');

    assert.strictEqual(res.status, HTTP_STATUS.OK);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.status, 'READY');
    assert.strictEqual(res.body.data.checks.database.connected, true);
    assert.ok(typeof res.body.data.checks.database.latencyMs === 'number');
    assert.strictEqual(res.body.data.checks.migrations.isUpToDate, true);
    assert.ok(res.body.data.checks.migrations.appliedCount >= 3);
    assert.strictEqual(res.body.data.checks.migrations.appliedCount, res.body.data.checks.migrations.totalAvailable);
    assert.strictEqual(res.body.data.checks.migrations.pendingCount, 0);
  });

  console.log('\n=================================================================');
  console.log(` Summary: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  console.log('=================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runAdminSystemViewTests().catch(err => {
    console.error('Fatal error in admin system view tests:', err);
    process.exit(1);
  });
}

module.exports = runAdminSystemViewTests;
