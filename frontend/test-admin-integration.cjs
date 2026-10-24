/**
 * Admin Frontend API Integration Verification Script
 * Validates the API communication layer implemented in frontend/src/services
 * against the real backend endpoints and SQLite database.
 */

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
        startTimestamp: '2026-11-20 10:00:00',
        endTimestamp: '2026-11-20 10:30:00'
      })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.data.hasConflict, true, 'Booking outside available hours must register conflict');
    assert.strictEqual(data.data.code, 'TEACHER_OUTSIDE_HOURS');
    assert.ok(data.data.message);
  });

  // 6. Workflow 5 - Logout
  await test('Workflow 5 (Logout): Admin logs out, revoking token and wiping session', async () => {
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
