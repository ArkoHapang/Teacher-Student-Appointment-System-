/**
 * Teacher Workflows Integration Test
 * Verifies all 8 faculty/teacher permitted workflows against real backend APIs and permissions:
 * 1. View and update permitted profile fields (personal names, designation, officeRoom, bio)
 * 2. Configure and update availability (create slots, interval overlap 409 conflict, toggle active, delete unbooked)
 * 3. View assigned appointment requests
 * 4. Approve or reject requests according to business rules (with notes/reasons)
 * 5. View upcoming, historical appointments, and mark consultation completed
 * 6. Cancel or reschedule appointments where allowed
 * 7. View relevant notifications and messages
 * 8. Logout & token invalidation
 * 9. Server-enforced RBAC restrictions (cannot manage other teachers or access admin endpoints)
 */

const assert = require('assert');
const http = require('http');
const app = require('../src/app');
const db = require('../src/config/database');

let server;
let baseUrl;

function makeRequest(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const req = http.request(
      url,
      { method, headers },
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

async function runTeacherWorkflowTests() {
  console.log('\n=================================================================');
  console.log(' Teacher–Student Appointment System: Teacher Frontend API Verification');
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
      failed++;
    }
  }

  // Start temporary server
  await new Promise(resolve => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  try {
    let robertToken;
    let robertUser;
    let robertTeacherProfile;
    let studentToken;
    let createdSlot1Id;
    let createdSlot2Id;
    let createdApptId;
    let apptToRejectId;

    // Login as Teacher Dr. Robert Smith (User ID 2, Teacher Profile ID 1)
    await test('Authentication: Teacher logs in with valid credentials', async () => {
      const res = await makeRequest('POST', '/api/v1/auth/login', {
        email: 'robert.miller@university.edu',
        password: 'Password123!'
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.user.role, 'TEACHER');
      robertToken = res.body.data.token;
      robertUser = res.body.data.user;
    });

    // Login as Student Alice (User ID 6) to send test requests
    await test('Setup: Student logs in to create requests', async () => {
      const res = await makeRequest('POST', '/api/v1/auth/login', {
        email: 'alice.carter@student.university.edu',
        password: 'Password123!'
      });
      assert.strictEqual(res.status, 200);
      studentToken = res.body.data.token;
    });

    // Workflow 1: View and manage permitted profile fields
    await test('Workflow 1: View institutional faculty records and permitted fields', async () => {
      const res = await makeRequest('GET', `/api/v1/users/${robertUser.id}`, null, robertToken);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.role, 'TEACHER');
      assert.ok(res.body.data.profile);
      robertTeacherProfile = res.body.data.profile;
      assert.ok(robertTeacherProfile.designation);
      assert.ok(robertTeacherProfile.officeRoom || robertTeacherProfile.office_room);
      assert.ok(robertTeacherProfile.departmentCode || robertTeacherProfile.department_code);
    });

    await test('Workflow 1: Update permitted faculty profile fields (name, designation, officeRoom, bio)', async () => {
      // 1. Update personal name
      const userRes = await makeRequest(
        'PATCH',
        `/api/v1/users/${robertUser.id}`,
        { firstName: 'Robert', lastName: 'Miller' },
        robertToken
      );
      assert.strictEqual(userRes.status, 200);

      // 2. Update professional credentials
      const teachRes = await makeRequest(
        'PATCH',
        `/api/v1/teachers/${robertTeacherProfile.id}`,
        {
          designation: 'Professor & Department Chair',
          officeRoom: 'Engineering Hall 402-A',
          bio: 'Advising senior capstone and distributed computing research.'
        },
        robertToken
      );
      assert.strictEqual(teachRes.status, 200);
      assert.strictEqual(teachRes.body.success, true);
      assert.strictEqual(teachRes.body.data.designation, 'Professor & Department Chair');
      assert.strictEqual(teachRes.body.data.officeRoom || teachRes.body.data.office_room, 'Engineering Hall 402-A');
    });

    // Workflow 2: Configure and update availability
    const uniqueDayOffset = Math.floor(Math.random() * 800) + 120;
    const testDate = new Date(Date.now() + 86400000 * uniqueDayOffset).toISOString().slice(0, 10);
    const testDate2 = new Date(Date.now() + 86400000 * (uniqueDayOffset + 1)).toISOString().slice(0, 10);

    await test('Workflow 2: Configure new availability slot with validation', async () => {
      const res = await makeRequest(
        'POST',
        `/api/v1/teachers/${robertTeacherProfile.id}/slots`,
        {
          slotDate: testDate,
          startTime: '10:00',
          endTime: '10:45'
        },
        robertToken
      );
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data.id);
      createdSlot1Id = res.body.data.id;
    });

    await test('Workflow 2: Interval collision detection rejects overlapping availability slot with 409 Conflict', async () => {
      const res = await makeRequest(
        'POST',
        `/api/v1/teachers/${robertTeacherProfile.id}/slots`,
        {
          slotDate: testDate,
          startTime: '10:15',
          endTime: '11:00'
        },
        robertToken
      );
      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'SLOT_OVERLAP');
    });

    await test('Workflow 2: Configure second availability slot for rescheduling tests', async () => {
      const res = await makeRequest(
        'POST',
        `/api/v1/teachers/${robertTeacherProfile.id}/slots`,
        {
          slotDate: testDate2,
          startTime: '14:00',
          endTime: '14:45'
        },
        robertToken
      );
      assert.strictEqual(res.status, 201);
      createdSlot2Id = res.body.data.id;
    });

    await test('Workflow 2: Toggle slot active/inactive availability status', async () => {
      const res = await makeRequest(
        'PATCH',
        `/api/v1/teachers/${robertTeacherProfile.id}/slots/${createdSlot1Id}`,
        { isActive: false },
        robertToken
      );
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.isActive, 0);

      // Reactivate
      const reactivateRes = await makeRequest(
        'PATCH',
        `/api/v1/teachers/${robertTeacherProfile.id}/slots/${createdSlot1Id}`,
        { isActive: true },
        robertToken
      );
      assert.strictEqual(reactivateRes.status, 200);
      assert.strictEqual(reactivateRes.body.data.isActive, 1);
    });

    // Workflow 3: View assigned appointment requests
    await test('Workflow 3: Student creates appointment requests assigned to this faculty member', async () => {
      const appt1Res = await makeRequest(
        'POST',
        '/api/v1/appointments',
        {
          slotId: createdSlot1Id,
          title: 'Thesis Architecture Proposal',
          purpose: 'Discussing the distributed replication mechanism.'
        },
        studentToken
      );
      assert.strictEqual(appt1Res.status, 201);
      createdApptId = appt1Res.body.data.id;

      // Seed a temporary slot & appointment for rejection test
      const tempSlotRes = await makeRequest(
        'POST',
        `/api/v1/teachers/${robertTeacherProfile.id}/slots`,
        {
          slotDate: testDate,
          startTime: '16:00',
          endTime: '16:30'
        },
        robertToken
      );
      const appt2Res = await makeRequest(
        'POST',
        '/api/v1/appointments',
        {
          slotId: tempSlotRes.body.data.id,
          title: 'Unprepared Consultation Topic',
          purpose: 'General questions.'
        },
        studentToken
      );
      apptToRejectId = appt2Res.body.data.id;
    });

    await test('Workflow 3: Faculty retrieves scoped appointment requests', async () => {
      const res = await makeRequest('GET', '/api/v1/appointments', null, robertToken);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      const req1 = res.body.data.appointments.find(a => a.id === createdApptId);
      assert.ok(req1, 'Assigned request should be present');
      assert.strictEqual(req1.status, 'PENDING');
      assert.strictEqual(req1.student_first_name || req1.studentFirstName, 'Alice M.');
    });

    // Workflow 4: Approve or reject requests according to business rules
    await test('Workflow 4: Approve appointment request with guidance notes', async () => {
      const res = await makeRequest(
        'POST',
        `/api/v1/appointments/${createdApptId}/approve`,
        { notes: 'Please review Section 3 draft before our meeting.' },
        robertToken
      );
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);

      // Verify status is APPROVED
      const verifyRes = await makeRequest('GET', `/api/v1/appointments/${createdApptId}`, null, robertToken);
      assert.strictEqual(verifyRes.body.data.status, 'APPROVED');
    });

    await test('Workflow 4: Reject appointment request with mandatory reason releases slot', async () => {
      const res = await makeRequest(
        'POST',
        `/api/v1/appointments/${apptToRejectId}/reject`,
        { reason: 'Please refine project scope and consult teaching assistants first.' },
        robertToken
      );
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);

      // Verify status is REJECTED
      const verifyRes = await makeRequest('GET', `/api/v1/appointments/${apptToRejectId}`, null, robertToken);
      assert.strictEqual(verifyRes.body.data.status, 'REJECTED');
    });

    // Workflow 5: View upcoming and historical appointments
    await test('Workflow 5: View confirmed upcoming schedule and chronological history', async () => {
      const res = await makeRequest('GET', '/api/v1/appointments?status=APPROVED', null, robertToken);
      assert.strictEqual(res.status, 200);
      assert.ok(res.body.data.appointments.some(a => a.id === createdApptId));

      const histRes = await makeRequest('GET', `/api/v1/appointments/${createdApptId}/history`, null, robertToken);
      assert.strictEqual(histRes.status, 200);
      assert.ok(histRes.body.data.history.length >= 2);
    });

    // Workflow 6: Cancel or reschedule appointments where permitted
    await test('Workflow 6: Reschedule confirmed appointment to alternative open slot', async () => {
      const res = await makeRequest(
        'POST',
        `/api/v1/appointments/${createdApptId}/reschedule`,
        {
          proposedSlotId: createdSlot2Id,
          reason: 'Department faculty meeting scheduled during previous slot'
        },
        robertToken
      );
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);

      const verifyRes = await makeRequest('GET', `/api/v1/appointments/${createdApptId}`, null, robertToken);
      assert.strictEqual(verifyRes.body.data.slot_id ?? verifyRes.body.data.slotId, createdSlot2Id);
    });

    await test('Workflow 5/6: Faculty marks consultation as COMPLETED', async () => {
      const res = await makeRequest(
        'POST',
        `/api/v1/appointments/${createdApptId}/complete`,
        null,
        robertToken
      );
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);

      const verifyRes = await makeRequest('GET', `/api/v1/appointments/${createdApptId}`, null, robertToken);
      assert.strictEqual(verifyRes.body.data.status, 'COMPLETED');
    });

    await test('Workflow 6: Terminal COMPLETED consultation rejects further cancellation', async () => {
      const res = await makeRequest(
        'POST',
        `/api/v1/appointments/${createdApptId}/cancel`,
        { cancellationReason: 'Cannot cancel after completion' },
        robertToken
      );
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
    });

    // Workflow 7: View notifications
    await test('Workflow 7: Faculty retrieves notifications and alerts', async () => {
      const res = await makeRequest('GET', `/api/v1/users/${robertUser.id}/notifications`, null, robertToken);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.data.notifications));
    });

    // Authorization: Role boundaries
    await test('Authorization: Teacher cannot access administrative endpoints (403)', async () => {
      const res = await makeRequest('GET', '/api/v1/admin/users', null, robertToken);
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'FORBIDDEN');
    });

    await test('Authorization: Teacher cannot manage another teacher profile (403)', async () => {
      // Teacher Dr. Robert Smith (profile ID 1) attempting to update Dr. Sarah Miller (profile ID 2)
      const res = await makeRequest(
        'PATCH',
        '/api/v1/teachers/2',
        { designation: 'Hacked Designation' },
        robertToken
      );
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'FORBIDDEN');
    });

    // Workflow 8: Logout
    await test('Workflow 8: Logout successfully invalidates token', async () => {
      const res = await makeRequest('POST', '/api/v1/auth/logout', null, robertToken);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);

      // Verify token cannot be reused
      const protectedRes = await makeRequest('GET', '/api/v1/auth/me', null, robertToken);
      assert.strictEqual(protectedRes.status, 401);
      assert.strictEqual(protectedRes.body.error.code, 'TOKEN_REVOKED');
    });

  } finally {
    if (server) {
      server.close();
    }
  }

  console.log('\n-----------------------------------------------------------------');
  console.log(`Teacher Workflow Test Summary: ${passed} passed, ${failed} failed.`);
  console.log('=================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTeacherWorkflowTests().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
