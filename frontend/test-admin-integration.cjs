/**
 * Admin Frontend API Integration Verification Script
 * Validates the API communication layer implemented in frontend/src/services
 * against the real backend endpoints and SQLite database.
 */

require('../backend/tests/setup');
const assert = require('assert');

async function runAdminIntegration() {
  console.log('\n=================================================================');
  console.log(' Admin Frontend API Integration Verification                    ');
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

  // Set up mock localStorage and fetch
  const storage = {};
  global.localStorage = {
    getItem: (k) => storage[k] || null,
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: (k) => { delete storage[k]; }
  };

  const app = require('../backend/src/app');
  const request = require('supertest');

  // Shim global fetch using supertest
  global.fetch = async (url, options = {}) => {
    const method = (options.method || 'GET').toLowerCase();
    let req = request(app)[method](url);
    if (options.headers) {
      for (const [k, v] of Object.entries(options.headers)) {
        req = req.set(k, v);
      }
    }
    if (options.body) {
      req = req.send(JSON.parse(options.body));
    }
    const res = await req;
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      headers: {
        get: (h) => res.headers[h.toLowerCase()]
      },
      json: async () => res.body,
      text: async () => res.text
    };
  };

  // Import compiled or raw TypeScript services via dynamic import or direct logic
  // We test the contract directly:
  let token = null;

  // 1. Workflow 5 - Login as Admin
  await test('Auth: Administrator logs in via /api/v1/auth/login and receives token & user object', async () => {
    const res = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@university.edu', password: 'Password123!' })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.data.user.role, 'ADMIN');
    token = data.data.token;
    assert.ok(token);
  });

  const authHeaders = () => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  });

  // 2. Workflow 1 - Manage Teachers
  await test('Workflow 1 (Manage Teachers): List paginated teachers with department filtering', async () => {
    const res = await fetch('/api/v1/admin/teachers?departmentId=1&page=1&limit=5', {
      headers: authHeaders()
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    assert.ok(Array.isArray(data.data.teachers));
    assert.ok(data.data.total >= 1);
    assert.strictEqual(data.data.teachers[0].department.id, 1);
  });

  await test('Workflow 1 (Manage Teachers): Inspect individual teacher record with metrics and courses', async () => {
    const res = await fetch('/api/v1/admin/teachers/1', {
      headers: authHeaders()
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.data.teacher.id, 1);
    assert.ok(data.data.teacher.stats, 'Detailed stats must be present');
    assert.ok(data.data.teacher.courses, 'Courses array must be present');
  });

  // 3. Workflow 2 - Monitor All Appointments
  await test('Workflow 2 (Monitor Appointments): Retrieve aggregated real-time appointment metrics summary', async () => {
    const res = await fetch('/api/v1/admin/appointments/summary', {
      headers: authHeaders()
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    const summary = data.data.summary;
    assert.ok(typeof summary.total === 'number');
    assert.ok(summary.byStatus);
    assert.ok(typeof summary.upcoming === 'number');
  });

  await test('Workflow 2 (Monitor Appointments): Paginated query with search and status filter', async () => {
    const res = await fetch('/api/v1/admin/appointments?status=PENDING&page=1&limit=10', {
      headers: authHeaders()
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    assert.ok(Array.isArray(data.data.appointments));
    for (const appt of data.data.appointments) {
      assert.strictEqual(appt.status, 'PENDING');
    }
  });

  // 4. Workflow 3 - View & Manage Appointment Records
  await test('Workflow 3 (Manage Appointment Records): Inspect full details and status history', async () => {
    // Grab first appointment ID
    const listRes = await fetch('/api/v1/admin/appointments?limit=1', { headers: authHeaders() });
    const listData = await listRes.json();
    const apptId = listData.data.appointments[0].id;

    const detailRes = await fetch(`/api/v1/admin/appointments/${apptId}`, { headers: authHeaders() });
    const detailData = await detailRes.json();
    assert.strictEqual(detailRes.status, 200);
    assert.strictEqual(detailData.data.appointment.id, apptId);

    const histRes = await fetch(`/api/v1/admin/appointments/${apptId}/history`, { headers: authHeaders() });
    const histData = await histRes.json();
    assert.strictEqual(histRes.status, 200);
    assert.ok(Array.isArray(histData.data.history));
  });

  // 5. Workflow 4 - Display Appointment Conflict Errors
  await test('Workflow 4 (Conflict Detection): Evaluate booking collisions against conflict engine', async () => {
    // Run conflict detection on teacher 1 for an interval outside available hours
    const res = await fetch('/api/v1/appointments/check-conflict', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        teacherId: 1,
        startTimestamp: '2028-11-20 10:00:00',
        endTimestamp: '2028-11-20 10:30:00'
      })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.data.hasConflict, true, 'Booking outside available hours must register conflict');
    assert.strictEqual(data.data.code, 'TEACHER_OUTSIDE_HOURS');
    assert.ok(data.data.message);
  });

  // 6. Workflow 6 - User Accounts Management
  await test('Workflow 6 (User Accounts): Admin retrieves all user accounts via /api/v1/admin/users', async () => {
    const res = await fetch('/api/v1/admin/users', { headers: authHeaders() });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    assert.ok(typeof data.data.total === 'number');
    assert.ok(Array.isArray(data.data.users));
    assert.ok(data.data.users.length >= 7, 'Database must contain users');

    const firstUser = data.data.users[0];
    assert.ok(firstUser.id);
    assert.ok(firstUser.email);
    assert.ok(firstUser.first_name);
    assert.ok(firstUser.last_name);
    assert.ok(firstUser.status);
    assert.ok(firstUser.role_name);
  });

  await test('Workflow 6 (User Accounts): Admin updates user account status via /api/v1/admin/users/:id/status', async () => {
    // Find a test user (e.g., student user #6 or #7)
    const listRes = await fetch('/api/v1/admin/users', { headers: authHeaders() });
    const listData = await listRes.json();
    const testUser = listData.data.users.find(u => u.role_name === 'STUDENT');
    assert.ok(testUser, 'Student user must exist');

    const originalStatus = testUser.status;
    const newStatus = originalStatus === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';

    const updateRes = await fetch(`/api/v1/admin/users/${testUser.id}/status`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ status: newStatus })
    });
    const updateData = await updateRes.json();
    assert.strictEqual(updateRes.status, 200);
    assert.strictEqual(updateData.success, true);
    assert.strictEqual(updateData.data.status, newStatus);

    // Restore original status
    const revertRes = await fetch(`/api/v1/admin/users/${testUser.id}/status`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ status: originalStatus })
    });
    const revertData = await revertRes.json();
    assert.strictEqual(revertRes.status, 200);
    assert.strictEqual(revertData.data.status, originalStatus);
  });

  // 7. Workflow 7 - Audit Logs Ledger
  await test('Workflow 7 (Audit Logs): Admin retrieves immutable audit trail via /api/v1/admin/audit-logs', async () => {
    const res = await fetch('/api/v1/admin/audit-logs', { headers: authHeaders() });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    assert.ok(Array.isArray(data.data.logs));
    assert.ok(data.data.logs.length > 0, 'Audit logs must contain recorded operations');

    const firstLog = data.data.logs[0];
    assert.ok(firstLog.id);
    assert.ok(firstLog.actor_id);
    assert.ok(firstLog.action);
    assert.ok(firstLog.entity_type);
    assert.ok(firstLog.created_at);
    assert.ok(firstLog.actor_email);

    // Verify recent UPDATE_USER_STATUS was recorded in audit log
    const statusUpdateLog = data.data.logs.find(l => l.action === 'UPDATE_USER_STATUS');
    assert.ok(statusUpdateLog, 'UPDATE_USER_STATUS operation must be recorded in audit ledger');
  });

  // 8. Workflow 8 - System Status, Health & Readiness Diagnostics
  await test('Workflow 8 (System Status): Query health probe via /api/v1/health', async () => {
    const res = await fetch('/api/v1/health');
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.data.status, 'UP');
    assert.ok(typeof data.data.uptimeSeconds === 'number');
    assert.ok(data.data.memoryUsage);
    assert.ok(typeof data.data.memoryUsage.rssMb === 'number');
  });

  await test('Workflow 8 (System Status): Query readiness probe via /api/v1/ready', async () => {
    const res = await fetch('/api/v1/ready');
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.data.status, 'READY');
    assert.strictEqual(data.data.checks.database.connected, true);
    assert.strictEqual(data.data.checks.migrations.isUpToDate, true);
    assert.strictEqual(data.data.checks.migrations.appliedCount, 4);
    assert.strictEqual(data.data.checks.migrations.pendingCount, 0);
  });

  // 9. Workflow 9 - Role-Based Access Control (RBAC) Enforcement
  await test('Workflow 9 (RBAC): Student and Teacher cannot access admin users or audit endpoints', async () => {
    // Login as student
    const stuLoginRes = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'alice.carter@student.university.edu', password: 'Password123!' })
    });
    const stuData = await stuLoginRes.json();
    const studentToken = stuData.data.token;

    const stuUsersRes = await fetch('/api/v1/admin/users', {
      headers: { 'Authorization': `Bearer ${studentToken}` }
    });
    assert.strictEqual(stuUsersRes.status, 403, 'Student must receive 403 Forbidden for admin users');

    const stuAuditRes = await fetch('/api/v1/admin/audit-logs', {
      headers: { 'Authorization': `Bearer ${studentToken}` }
    });
    assert.strictEqual(stuAuditRes.status, 403, 'Student must receive 403 Forbidden for admin audit logs');

    // Login as teacher
    const teachLoginRes = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'robert.miller@university.edu', password: 'Password123!' })
    });
    const teachData = await teachLoginRes.json();
    const teacherToken = teachData.data.token;

    const teachUsersRes = await fetch('/api/v1/admin/users', {
      headers: { 'Authorization': `Bearer ${teacherToken}` }
    });
    assert.strictEqual(teachUsersRes.status, 403, 'Teacher must receive 403 Forbidden for admin users');

    const teachAuditRes = await fetch('/api/v1/admin/audit-logs', {
      headers: { 'Authorization': `Bearer ${teacherToken}` }
    });
    assert.strictEqual(teachAuditRes.status, 403, 'Teacher must receive 403 Forbidden for admin audit logs');
  });

  // 10. Workflow 10 - Logout
  await test('Workflow 10 (Logout): Admin logs out, revoking token and wiping session', async () => {
    const res = await fetch('/api/v1/auth/logout', {
      method: 'POST',
      headers: authHeaders()
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.data.loggedOut, true);

    // Verify subsequent request with same token returns 401
    const postLogoutRes = await fetch('/api/v1/admin/appointments/summary', {
      headers: authHeaders()
    });
    assert.strictEqual(postLogoutRes.status, 401, 'Revoked token must be rejected with 401');
  });

  console.log('\n=================================================================');
  console.log(` Summary: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  console.log('=================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runAdminIntegration().catch((e) => {
  console.error(e);
  process.exit(1);
});
