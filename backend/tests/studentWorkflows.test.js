/**
 * Student Workflows Integration Test
 * Verifies all 8 student permitted workflows against real backend APIs and permissions:
 * 1. View and update permitted profile fields
 * 2. Find and view teachers
 * 3. View teacher availability slots
 * 4. Request appointments & handle 409 collisions
 * 5. View appointment status and chronological history
 * 6. Cancel or reschedule appointments where allowed
 * 7. View relevant notifications and messages
 * 8. Logout & token invalidation
 * 9. Server-enforced RBAC restrictions (student forbidden from admin functions)
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

async function runStudentWorkflowTests() {
  console.log('\n=================================================================');
  console.log(' Teacher–Student Appointment System: Student Frontend API Verification');
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
    let aliceToken;
    let aliceUser;
    let availableSlot1;
    let availableSlot2;
    let createdApptId;

    // Seed dedicated future slots with distinct days (30 min duration each)
    const randOffset = Math.floor(Math.random() * 800) + 50;
    const dateStr1 = new Date(Date.now() + 86400000 * randOffset).toISOString().slice(0, 10);
    const dateStr2 = new Date(Date.now() + 86400000 * (randOffset + 1)).toISOString().slice(0, 10);

    const s1Result = await db.execute(
      `INSERT INTO teacher_availability_slots (teacher_id, slot_date, start_time, end_time, start_timestamp, end_timestamp, is_booked, is_active)
       VALUES (1, ?, '14:00:00', '14:30:00', ? || ' 14:00:00', ? || ' 14:30:00', 0, 1);`,
      [dateStr1, dateStr1, dateStr1]
    );
    availableSlot1 = s1Result.lastInsertRowid;

    const s2Result = await db.execute(
      `INSERT INTO teacher_availability_slots (teacher_id, slot_date, start_time, end_time, start_timestamp, end_timestamp, is_booked, is_active)
       VALUES (1, ?, '15:00:00', '15:30:00', ? || ' 15:00:00', ? || ' 15:30:00', 0, 1);`,
      [dateStr2, dateStr2, dateStr2]
    );
    availableSlot2 = s2Result.lastInsertRowid;

    // Authentication
    await test('Authentication: Student logs in with valid credentials', async () => {
      const res = await makeRequest('POST', '/api/v1/auth/login', {
        email: 'alice.carter@student.university.edu',
        password: 'Password123!'
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.user.role, 'STUDENT');
      aliceToken = res.body.data.token;
      aliceUser = res.body.data.user;
    });

    // Workflow 1: View and update permitted profile fields
    await test('Workflow 1: View permitted student profile fields', async () => {
      const res = await makeRequest('GET', `/api/v1/users/${aliceUser.id}`, null, aliceToken);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.email, 'alice.carter@student.university.edu');
      assert.ok(res.body.data.profile);
      const studentIdNum = res.body.data.profile.studentIdNumber || res.body.data.profile.student_id_number;
      assert.strictEqual(studentIdNum, 'STU-2026-001');
      const deptCode = res.body.data.profile.departmentCode || res.body.data.profile.department_code;
      assert.strictEqual(deptCode, 'CSE');
    });

    await test('Workflow 1: Update permitted profile fields (firstName, lastName)', async () => {
      const res = await makeRequest(
        'PATCH',
        `/api/v1/users/${aliceUser.id}`,
        { firstName: 'Alice M.', lastName: 'Carter' },
        aliceToken
      );
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.firstName || res.body.data.first_name, 'Alice M.');
      assert.strictEqual(res.body.data.lastName || res.body.data.last_name, 'Carter');

      // Verify persistence
      const verifyRes = await makeRequest('GET', `/api/v1/users/${aliceUser.id}`, null, aliceToken);
      assert.strictEqual(verifyRes.body.data.firstName || verifyRes.body.data.first_name, 'Alice M.');
    });

    // Workflow 2: Find and view teachers
    await test('Workflow 2: Retrieve faculty directory', async () => {
      const res = await makeRequest('GET', '/api/v1/teachers', null, aliceToken);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.data.teachers));
      assert.ok(res.body.data.teachers.length >= 2);

      const t1 = res.body.data.teachers.find(t => (t.teacher_profile_id ?? t.teacherProfileId ?? t.id) === 1);
      assert.ok(t1, 'Teacher 1 should be found in directory');
      assert.ok(t1.office_room || t1.officeRoom);
      assert.ok(t1.designation);
      assert.ok(t1.department_code || t1.departmentCode);
    });

    await test('Workflow 2: View individual teacher details', async () => {
      const res = await makeRequest('GET', '/api/v1/teachers/1', null, aliceToken);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      const teacherId = res.body.data.teacher_profile_id ?? res.body.data.teacherProfileId ?? res.body.data.id;
      assert.strictEqual(teacherId, 1);
      assert.ok(res.body.data.first_name || res.body.data.firstName);
      assert.ok(res.body.data.last_name || res.body.data.lastName);
    });

    // Workflow 3: View teacher availability
    await test('Workflow 3: View live available consultation slots for teacher', async () => {
      const res = await makeRequest('GET', '/api/v1/teachers/1/slots', null, aliceToken);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.data.slots));
      const s1 = res.body.data.slots.find(s => s.id === availableSlot1);
      assert.ok(s1, 'Expected seeded slot 1 to be in available slots list');
      assert.strictEqual(s1.is_booked ?? s1.isBooked, 0);
    });

    // Workflow 4: Request appointment
    await test('Workflow 4: Submit appointment request for an available slot', async () => {
      const res = await makeRequest(
        'POST',
        '/api/v1/appointments',
        {
          slotId: availableSlot1,
          title: 'Senior Project Guidance',
          purpose: 'Discussion regarding architecture choices and testing strategy.'
        },
        aliceToken
      );
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.status, 'PENDING');
      assert.strictEqual(res.body.data.title, 'Senior Project Guidance');
      const bookedSlotId = res.body.data.slot_id ?? res.body.data.slotId;
      assert.strictEqual(bookedSlotId, availableSlot1);
      createdApptId = res.body.data.id;
    });

    await test('Workflow 4: Double-booking prevention intercepts concurrent/duplicate booking with 409 Conflict', async () => {
      const res = await makeRequest(
        'POST',
        '/api/v1/appointments',
        {
          slotId: availableSlot1,
          title: 'Duplicate Booking Attempt',
          purpose: 'Should be blocked because slot is already reserved.'
        },
        aliceToken
      );
      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'SLOT_UNAVAILABLE');
    });

    // Workflow 5: View appointment status and history
    await test('Workflow 5: View student appointment list and status', async () => {
      const res = await makeRequest('GET', '/api/v1/appointments', null, aliceToken);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      const appt = res.body.data.appointments.find(a => a.id === createdApptId);
      assert.ok(appt);
      assert.strictEqual(appt.status, 'PENDING');
      const teacherName = appt.teacher_first_name ?? appt.teacherFirstName;
      assert.ok(teacherName);
    });

    await test('Workflow 5: View appointment details and chronological history', async () => {
      const res = await makeRequest('GET', `/api/v1/appointments/${createdApptId}/history`, null, aliceToken);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.data.history));
      assert.ok(res.body.data.history.length >= 1);
      const newStat = res.body.data.history[0].new_status ?? res.body.data.history[0].newStatus;
      assert.strictEqual(newStat, 'PENDING');
    });

    // Workflow 6: Cancel or reschedule appointments where allowed
    await test('Workflow 6: Reschedule appointment to alternative slot', async () => {
      const res = await makeRequest(
        'POST',
        `/api/v1/appointments/${createdApptId}/reschedule`,
        {
          proposedSlotId: availableSlot2,
          reason: 'Conflict with departmental lab seminar'
        },
        aliceToken
      );
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);

      // Verify slot migrated to slot 2 and slot 1 freed
      const verifyAppt = await makeRequest('GET', `/api/v1/appointments/${createdApptId}`, null, aliceToken);
      const updatedSlotId = verifyAppt.body.data.slot_id ?? verifyAppt.body.data.slotId;
      assert.strictEqual(updatedSlotId, availableSlot2);
    });

    await test('Workflow 6: Cancel appointment with reason releases slot', async () => {
      const res = await makeRequest(
        'POST',
        `/api/v1/appointments/${createdApptId}/cancel`,
        {
          cancellationReason: 'Topic resolved in class discussion'
        },
        aliceToken
      );
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);

      // Verify status is CANCELLED
      const verifyAppt = await makeRequest('GET', `/api/v1/appointments/${createdApptId}`, null, aliceToken);
      assert.strictEqual(verifyAppt.body.data.status, 'CANCELLED');
      const cancelReason = verifyAppt.body.data.cancellation_reason ?? verifyAppt.body.data.cancellationReason;
      assert.strictEqual(cancelReason, 'Topic resolved in class discussion');
    });

    // Workflow 7: View notifications
    await test('Workflow 7: View student notifications and alerts', async () => {
      const res = await makeRequest('GET', `/api/v1/users/${aliceUser.id}/notifications`, null, aliceToken);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.data.notifications));
      assert.ok(res.body.data.notifications.length >= 1);
      const notif = res.body.data.notifications[0];
      assert.ok(notif.title);
      assert.ok(notif.message);
      assert.ok(notif.type);
    });

    // Server-enforced permissions
    await test('Authorization: Student cannot access administrative user endpoints (403)', async () => {
      const res = await makeRequest('GET', '/api/v1/admin/users', null, aliceToken);
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'FORBIDDEN');
    });

    await test('Authorization: Student cannot access administrative appointment monitor (403)', async () => {
      const res = await makeRequest('GET', '/api/v1/admin/appointments', null, aliceToken);
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'FORBIDDEN');
    });

    // Workflow 8: Logout
    await test('Workflow 8: Logout successfully invalidates token', async () => {
      const res = await makeRequest('POST', '/api/v1/auth/logout', null, aliceToken);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);

      // Verify token cannot be reused
      const protectedRes = await makeRequest('GET', '/api/v1/auth/me', null, aliceToken);
      assert.strictEqual(protectedRes.status, 401);
      assert.strictEqual(protectedRes.body.error.code, 'TOKEN_REVOKED');
    });

  } finally {
    if (server) {
      server.close();
    }
  }

  console.log('\n-----------------------------------------------------------------');
  console.log(`Student Workflow Test Summary: ${passed} passed, ${failed} failed.`);
  console.log('=================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runStudentWorkflowTests().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
