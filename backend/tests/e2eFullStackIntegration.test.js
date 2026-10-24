/**
 * End-to-End Full-Stack Integration Verification Suite
 * Verifies all 10 end-to-end workflows across Frontend API Contract, Backend,
 * Authentication, Database, and Conflict Prevention:
 * 
 * 1. Admin login, creates/manages teacher, views teacher in database-backed list.
 * 2. Admin monitors appointments using filters and pagination.
 * 3. Authorized user views appointment details and permitted history.
 * 4. Student logs in, views teacher availability, and requests an appointment.
 * 5. Assigned Teacher sees request and approves or rejects it according to business rules.
 * 6. Student and Teacher see correct appointment status afterward.
 * 7. Two overlapping appointment requests cannot both reserve the same teacher's time.
 * 8. Rescheduling into an occupied slot produces expected conflict response (409 Conflict).
 * 9. Users cannot access another role's protected endpoints without permission (403 Forbidden).
 * 10. Logout invalidates applicable authentication state and protected access is denied afterward (401 Unauthorized).
 */

const assert = require('assert');
const http = require('http');
const app = require('../src/app');
const db = require('../src/config/database');
const env = require('../src/config/env');

let server;
let baseUrl;

function makeRequest(method, path, body = null, token = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const reqHeaders = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...headers
    };
    if (token) reqHeaders['Authorization'] = `Bearer ${token}`;

    const req = http.request(
      url,
      { method, headers: reqHeaders },
      res => {
        let raw = '';
        res.on('data', chunk => (raw += chunk));
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw;
          }
          resolve({ status: res.statusCode, headers: res.headers, body: parsed });
        });
      }
    );

    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runE2EIntegrationTests() {
  console.log('\n=================================================================');
  console.log(' Full-Stack End-to-End Integration Verification Suite');
  console.log(' Testing Workflows 1 through 10 with Real DB & APIs');
  console.log('=================================================================\n');

  let passed = 0;
  let failed = 0;
  const testResults = [];

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  [PASS] ${name}`);
      passed++;
      testResults.push({ name, status: 'PASS' });
    } catch (err) {
      console.error(`  [FAIL] ${name}`);
      console.error(`         ${err.message}`);
      failed++;
      testResults.push({ name, status: 'FAIL', error: err.message });
    }
  }

  // 1. Verify Database Health & Connectivity
  await test('Infrastructure: Database connectivity & ping verification', async () => {
    const ping = await db.ping();
    assert.strictEqual(ping.connected, true, 'Database must be responsive');
    const tableCheck = await db.queryOne("SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='users'");
    assert.strictEqual(tableCheck.count, 1, 'Users table must exist');
  });

  // 2. Start HTTP Test Server
  await new Promise(resolve => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  try {
    let adminToken;
    let teacherToken;
    let studentAliceToken;
    let studentDavidToken;

    let createdTeacherId;
    let createdTeacherProfileId;
    let createdTeacherEmail;

    let slotForDavid1;
    let slotForDavid2;
    let slotForOverlap1;
    let slotForOverlap2;
    let slotOccupiedForReschedule;

    let apptToApproveId;
    let apptToRejectId;

    // Login authentications
    await test('Authentication: Admin logs in successfully', async () => {
      const res = await makeRequest('POST', '/api/v1/auth/login', {
        email: 'admin@university.edu',
        password: 'Password123!'
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.user.role, 'ADMIN');
      adminToken = res.body.data.token;
    });

    await test('Authentication: Teacher Robert Miller logs in successfully', async () => {
      const res = await makeRequest('POST', '/api/v1/auth/login', {
        email: 'robert.miller@university.edu',
        password: 'Password123!'
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.user.role, 'TEACHER');
      teacherToken = res.body.data.token;
    });

    await test('Authentication: Student Alice Carter logs in successfully', async () => {
      const res = await makeRequest('POST', '/api/v1/auth/login', {
        email: 'alice.carter@student.university.edu',
        password: 'Password123!'
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.user.role, 'STUDENT');
      studentAliceToken = res.body.data.token;
    });

    await test('Authentication: Student David Kim logs in successfully', async () => {
      const res = await makeRequest('POST', '/api/v1/auth/login', {
        email: 'david.kim@student.university.edu',
        password: 'Password123!'
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.user.role, 'STUDENT');
      studentDavidToken = res.body.data.token;
    });

    // -------------------------------------------------------------------------
    // WORKFLOW 1: Admin creates or manages teacher & views in database-backed list
    // -------------------------------------------------------------------------
    const uniqueNum = Math.floor(Math.random() * 90000) + 10000;
    createdTeacherEmail = `faculty.test.${uniqueNum}@university.edu`;

    await test('Workflow 1: Admin creates a new faculty member with permitted fields', async () => {
      const res = await makeRequest(
        'POST',
        '/api/v1/admin/teachers',
        {
          firstName: 'Clara',
          lastName: `Oswald-${uniqueNum}`,
          email: createdTeacherEmail,
          password: 'Password123!',
          departmentId: 1, // CSE
          designation: 'Assistant Professor',
          officeRoom: `Eng Hall ${uniqueNum}`
        },
        adminToken
      );

      assert.strictEqual(res.status, 201, `Expected 201 Created, got ${res.status}: ${JSON.stringify(res.body)}`);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data.teacher.id);
      createdTeacherId = res.body.data.teacher.id;
      createdTeacherProfileId = res.body.data.teacher.profileId || res.body.data.teacher.id;
    });

    await test('Workflow 1: Admin views the created teacher in the actual database-backed list', async () => {
      const res = await makeRequest(
        'GET',
        `/api/v1/admin/teachers?search=Oswald-${uniqueNum}`,
        null,
        adminToken
      );

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data.total >= 1);
      const found = res.body.data.teachers.find(t => t.email === createdTeacherEmail);
      assert.ok(found, 'Created teacher must exist in database query results');
      assert.strictEqual(found.department.code, 'CSE');
    });

    await test('Workflow 1: Admin manages teacher status and active availability', async () => {
      const res = await makeRequest(
        'PATCH',
        `/api/v1/admin/teachers/${createdTeacherProfileId}/status`,
        { status: 'SUSPENDED' },
        adminToken
      );
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.status, 'SUSPENDED');

      // Reactivate
      const resRestore = await makeRequest(
        'PATCH',
        `/api/v1/admin/teachers/${createdTeacherProfileId}/status`,
        { status: 'ACTIVE' },
        adminToken
      );
      assert.strictEqual(resRestore.status, 200);
      assert.strictEqual(resRestore.body.data.status, 'ACTIVE');
    });

    // -------------------------------------------------------------------------
    // WORKFLOW 2: Admin monitors appointments using filters and pagination
    // -------------------------------------------------------------------------
    await test('Workflow 2: Admin monitors appointments with pagination and status filters', async () => {
      // 1. Paginated list
      const listRes = await makeRequest('GET', '/api/v1/admin/appointments?page=1&limit=2', null, adminToken);
      assert.strictEqual(listRes.status, 200);
      assert.strictEqual(listRes.body.success, true);
      assert.strictEqual(listRes.body.data.page, 1);
      assert.strictEqual(listRes.body.data.limit, 2);
      assert.ok(Array.isArray(listRes.body.data.appointments));

      // 2. Status filter
      const filterRes = await makeRequest('GET', '/api/v1/admin/appointments?status=APPROVED', null, adminToken);
      assert.strictEqual(filterRes.status, 200);
      for (const appt of filterRes.body.data.appointments) {
        assert.strictEqual(appt.status, 'APPROVED');
      }

      // 3. Database derived summary metrics
      const summaryRes = await makeRequest('GET', '/api/v1/admin/appointments/summary', null, adminToken);
      assert.strictEqual(summaryRes.status, 200);
      assert.ok(typeof summaryRes.body.data.summary.total === 'number');
      assert.ok(summaryRes.body.data.summary.byStatus);
    });

    // -------------------------------------------------------------------------
    // WORKFLOW 3: Authorized user views appointment details and permitted history
    // -------------------------------------------------------------------------
    await test('Workflow 3: Authorized student views appointment details and audit trail', async () => {
      // Student Alice views Appointment #1 (her consultation with Dr. Miller)
      const res = await makeRequest('GET', '/api/v1/appointments/1', null, studentAliceToken);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      const apptData = res.body.data.appointment || res.body.data;
      assert.strictEqual(apptData.id, 1);

      // Audit history
      const histRes = await makeRequest('GET', '/api/v1/appointments/1/history', null, studentAliceToken);
      assert.strictEqual(histRes.status, 200);
      assert.ok(Array.isArray(histRes.body.data.history));
      assert.ok(histRes.body.data.history.length >= 1);
    });

    await test('Workflow 3: Unauthorized student David cannot access Alice appointment history', async () => {
      const res = await makeRequest('GET', '/api/v1/appointments/1/history', null, studentDavidToken);
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'FORBIDDEN');
    });

    // -------------------------------------------------------------------------
    // WORKFLOW 4: Student views teacher availability and requests appointment
    // -------------------------------------------------------------------------
    const randomDays = Math.floor(Math.random() * 8000) + 400;
    const futureDate1 = new Date(Date.now() + 86400000 * randomDays).toISOString().slice(0, 10);
    const futureDate2 = new Date(Date.now() + 86400000 * (randomDays + 1)).toISOString().slice(0, 10);

    // Setup 2 availability slots for Dr. Miller (Teacher 1)
    await test('Setup: Faculty creates availability slots for booking tests', async () => {
      const s1 = await makeRequest(
        'POST',
        '/api/v1/teachers/1/slots',
        { slotDate: futureDate1, startTime: '14:00', endTime: '14:30' },
        teacherToken
      );
      assert.strictEqual(s1.status, 201);
      slotForDavid1 = s1.body.data.id;

      const s2 = await makeRequest(
        'POST',
        '/api/v1/teachers/1/slots',
        { slotDate: futureDate2, startTime: '15:00', endTime: '15:45' },
        teacherToken
      );
      assert.strictEqual(s2.status, 201);
      slotForDavid2 = s2.body.data.id;
    });

    await test('Workflow 4: Student David views teacher availability slots', async () => {
      const res = await makeRequest('GET', '/api/v1/teachers/1/slots', null, studentDavidToken);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data.slots.some(s => s.id === slotForDavid1));
      assert.ok(res.body.data.slots.some(s => s.id === slotForDavid2));
    });

    await test('Workflow 4: Student David submits appointment requests', async () => {
      // Request 1: will be approved
      const res1 = await makeRequest(
        'POST',
        '/api/v1/appointments',
        {
          slotId: slotForDavid1,
          title: 'Algorithms Midterm Guidance',
          purpose: 'Clarifying dynamic programming recurrence relations'
        },
        studentDavidToken
      );
      assert.strictEqual(res1.status, 201);
      assert.strictEqual(res1.body.data.status, 'PENDING');
      apptToApproveId = res1.body.data.id;

      // Request 2: will be rejected
      const res2 = await makeRequest(
        'POST',
        '/api/v1/appointments',
        {
          slotId: slotForDavid2,
          title: 'Graph Search Questions',
          purpose: 'Understanding shortest path bounds'
        },
        studentDavidToken
      );
      assert.strictEqual(res2.status, 201);
      assert.strictEqual(res2.body.data.status, 'PENDING');
      apptToRejectId = res2.body.data.id;
    });

    // -------------------------------------------------------------------------
    // WORKFLOW 5: Assigned Teacher sees request and approves or rejects it
    // -------------------------------------------------------------------------
    await test('Workflow 5: Faculty retrieves assigned requests and approves one with notes', async () => {
      const list = await makeRequest('GET', '/api/v1/appointments?status=PENDING', null, teacherToken);
      assert.strictEqual(list.status, 200);
      assert.ok(list.body.data.appointments.some(a => a.id === apptToApproveId));

      // Approve with guidance notes
      const approveRes = await makeRequest(
        'POST',
        `/api/v1/appointments/${apptToApproveId}/approve`,
        { notes: 'Please bring your memoization table drafts.' },
        teacherToken
      );
      assert.strictEqual(approveRes.status, 200);
      assert.strictEqual(approveRes.body.success, true);
      assert.strictEqual(approveRes.body.data.status, 'APPROVED');
    });

    await test('Workflow 5: Faculty rejects second request with mandatory reason', async () => {
      const rejectRes = await makeRequest(
        'POST',
        `/api/v1/appointments/${apptToRejectId}/reject`,
        { reason: 'Department committee meeting conflict during this time slot.' },
        teacherToken
      );
      assert.strictEqual(rejectRes.status, 200);
      assert.strictEqual(rejectRes.body.success, true);
      assert.strictEqual(rejectRes.body.data.status, 'REJECTED');
    });

    // -------------------------------------------------------------------------
    // WORKFLOW 6: Student and Teacher see correct appointment status afterward
    // -------------------------------------------------------------------------
    await test('Workflow 6: Student verifies updated APPROVED and REJECTED statuses', async () => {
      const appt1Res = await makeRequest('GET', `/api/v1/appointments/${apptToApproveId}`, null, studentDavidToken);
      assert.strictEqual(appt1Res.status, 200);
      const appt1 = appt1Res.body.data.appointment || appt1Res.body.data;
      assert.strictEqual(appt1.status, 'APPROVED');

      const appt2Res = await makeRequest('GET', `/api/v1/appointments/${apptToRejectId}`, null, studentDavidToken);
      assert.strictEqual(appt2Res.status, 200);
      const appt2 = appt2Res.body.data.appointment || appt2Res.body.data;
      assert.strictEqual(appt2.status, 'REJECTED');
      const reason = appt2.cancellationReason || appt2.cancellation_reason || '';
      assert.ok(reason.includes('Department committee meeting'));
    });

    await test('Workflow 6: Teacher verifies updated APPROVED and REJECTED statuses', async () => {
      const appt1Res = await makeRequest('GET', `/api/v1/appointments/${apptToApproveId}`, null, teacherToken);
      assert.strictEqual(appt1Res.status, 200);
      const appt1 = appt1Res.body.data.appointment || appt1Res.body.data;
      assert.strictEqual(appt1.status, 'APPROVED');

      const appt2Res = await makeRequest('GET', `/api/v1/appointments/${apptToRejectId}`, null, teacherToken);
      assert.strictEqual(appt2Res.status, 200);
      const appt2 = appt2Res.body.data.appointment || appt2Res.body.data;
      assert.strictEqual(appt2.status, 'REJECTED');
    });

    // -------------------------------------------------------------------------
    // WORKFLOW 7: Two overlapping appointment requests cannot both reserve teacher
    // -------------------------------------------------------------------------
    const overlapDate = new Date(Date.now() + 86400000 * (randomDays + 2)).toISOString().slice(0, 10);

    await test('Workflow 7: Prevention of overlapping bookings for same teacher', async () => {
      // 1. Create base slot: 10:00 - 11:00
      const baseSlotRes = await makeRequest(
        'POST',
        '/api/v1/teachers/1/slots',
        { slotDate: overlapDate, startTime: '10:00', endTime: '11:00' },
        teacherToken
      );
      assert.strictEqual(baseSlotRes.status, 201);
      slotForOverlap1 = baseSlotRes.body.data.id;

      // 2. Student Alice books base slot
      const book1 = await makeRequest(
        'POST',
        '/api/v1/appointments',
        {
          slotId: slotForOverlap1,
          title: 'Senior Project Evaluation',
          purpose: 'First review'
        },
        studentAliceToken
      );
      assert.strictEqual(book1.status, 201);

      // 3. Attempt to book same slot by Student David -> rejected with 409
      const bookDuplicate = await makeRequest(
        'POST',
        '/api/v1/appointments',
        {
          slotId: slotForOverlap1,
          title: 'Concurrent Collision Attempt',
          purpose: 'Should be rejected'
        },
        studentDavidToken
      );
      assert.strictEqual(bookDuplicate.status, 409, 'Double booking must return 409 Conflict');
      assert.strictEqual(bookDuplicate.body.success, false);
      assert.ok(['SLOT_UNAVAILABLE', 'APPOINTMENT_CONFLICT'].includes(bookDuplicate.body.error.code));
    });

    // -------------------------------------------------------------------------
    // WORKFLOW 8: Rescheduling into occupied slot produces expected conflict (409)
    // -------------------------------------------------------------------------
    await test('Workflow 8: Rescheduling into occupied slot triggers 409 Conflict', async () => {
      // Attempt to reschedule David's approved appointment into Alice's booked slotForOverlap1
      const reschRes = await makeRequest(
        'POST',
        `/api/v1/appointments/${apptToApproveId}/reschedule`,
        {
          proposedSlotId: slotForOverlap1,
          reason: 'Schedule adjustment needed due to lecture overlap.'
        },
        studentDavidToken
      );

      assert.strictEqual(reschRes.status, 409, `Rescheduling into occupied slot failed with status ${reschRes.status}: ${JSON.stringify(reschRes.body)}`);
      assert.strictEqual(reschRes.body.success, false);
      assert.ok(['SLOT_UNAVAILABLE', 'APPOINTMENT_CONFLICT'].includes(reschRes.body.error.code));
    });

    // -------------------------------------------------------------------------
    // WORKFLOW 9: Users cannot access another role's protected endpoints (403)
    // -------------------------------------------------------------------------
    await test('Workflow 9: Role-based access control restrictions strictly enforced (403)', async () => {
      // 1. Student accessing Admin Users
      const stuAdminUsers = await makeRequest('GET', '/api/v1/admin/users', null, studentAliceToken);
      assert.strictEqual(stuAdminUsers.status, 403);
      assert.strictEqual(stuAdminUsers.body.error.code, 'FORBIDDEN');

      // 2. Student accessing Admin Appointments
      const stuAdminAppts = await makeRequest('GET', '/api/v1/admin/appointments', null, studentAliceToken);
      assert.strictEqual(stuAdminAppts.status, 403);
      assert.strictEqual(stuAdminAppts.body.error.code, 'FORBIDDEN');

      // 3. Teacher accessing Admin Audit Logs
      const teachAdminAudit = await makeRequest('GET', '/api/v1/admin/audit-logs', null, teacherToken);
      assert.strictEqual(teachAdminAudit.status, 403);
      assert.strictEqual(teachAdminAudit.body.error.code, 'FORBIDDEN');

      // 4. Teacher attempting to manage another teacher profile
      const teachOtherTeach = await makeRequest(
        'PATCH',
        '/api/v1/teachers/2',
        { designation: 'Hacked Title' },
        teacherToken
      );
      assert.strictEqual(teachOtherTeach.status, 403);
      assert.strictEqual(teachOtherTeach.body.error.code, 'FORBIDDEN');
    });

    // -------------------------------------------------------------------------
    // WORKFLOW 10: Logout invalidates auth state and protected access is denied (401)
    // -------------------------------------------------------------------------
    await test('Workflow 10: Logout revokes token and denies subsequent protected requests', async () => {
      // 1. Verify token works currently
      const meBefore = await makeRequest('GET', '/api/v1/auth/me', null, studentAliceToken);
      assert.strictEqual(meBefore.status, 200);

      // 2. Perform logout
      const logoutRes = await makeRequest('POST', '/api/v1/auth/logout', null, studentAliceToken);
      assert.strictEqual(logoutRes.status, 200);
      assert.strictEqual(logoutRes.body.success, true);

      // 3. Subsequent request with revoked token must be rejected with 401
      const meAfter = await makeRequest('GET', '/api/v1/auth/me', null, studentAliceToken);
      assert.strictEqual(meAfter.status, 401, 'Revoked token must be rejected with 401 Unauthorized');
      assert.strictEqual(meAfter.body.success, false);
      assert.ok(['TOKEN_REVOKED', 'UNAUTHORIZED'].includes(meAfter.body.error.code));
    });

  } finally {
    try {
      if (apptToApproveId) await db.execute('DELETE FROM appointments WHERE id IN (?, ?)', [apptToApproveId, apptToRejectId || 0]);
      if (slotForDavid1) await db.execute('DELETE FROM teacher_availability_slots WHERE id IN (?, ?, ?)', [slotForDavid1, slotForDavid2 || 0, slotForOverlap1 || 0]);
      if (createdTeacherId) {
        await db.execute('DELETE FROM teacher_profiles WHERE id = ?', [createdTeacherProfileId]);
        await db.execute('DELETE FROM users WHERE id = ?', [createdTeacherId]);
      }
    } catch {
      // cleanup best effort
    }
    // Teardown: Stop server
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  }

  console.log('\n-----------------------------------------------------------------');
  console.log(`End-to-End Verification Summary: ${passed} passed, ${failed} failed.`);
  console.log('=================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

// Execute suite
runE2EIntegrationTests().catch(err => {
  console.error('Fatal test suite failure:', err);
  process.exit(1);
});
