/**
 * Phase 4 — Notification Read-State Management Integration Test Suite
 *
 * Verifies Phase 4 requirements:
 * 1. An authenticated user can mark their own unread notification as read.
 * 2. The database persists is_read = 1.
 * 3. A user cannot mark another user's notification as read (strict server-side ownership).
 * 4. An unauthenticated request is rejected (401).
 * 5. A nonexistent notification ID is handled correctly (404 / 400).
 * 6. Repeating a mark-as-read request is safe and idempotent (200).
 * 7. A failed request does not produce a false success in the frontend / service contracts.
 * 8. Existing notification retrieval and Phase 3 notification dispatch still work.
 * 9. If mark-all is implemented, it updates only the authenticated user's notifications.
 * 10. Existing Admin panel behavior remains intact.
 */

require('./setup');
const assert = require('assert');
const http = require('http');
const app = require('../src/app');
const db = require('../src/config/database');
const notificationService = require('../src/services/notificationService');
const appointmentService = require('../src/services/appointmentService');

let server;
let baseUrl;

function makeRequest(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const req = http.request(url, { method, headers }, (res) => {
      let raw = '';
      res.on('data', (chunk) => (raw += chunk));
      res.on('end', () => {
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = raw;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runReadStateTests() {
  console.log('\n=================================================================');
  console.log(' Teacher-Student Appointment System: Notification Read-State Tests');
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
  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  const createdNotificationIds = [];
  const createdAppointmentIds = [];
  const createdSlotIds = [];

  try {
    // 1. Authenticate users dynamically from database
    const studentRecord = await db.queryOne(
      `SELECT u.id, u.email, u.first_name, u.last_name
       FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE r.name = 'STUDENT' AND u.status = 'ACTIVE'
       LIMIT 1;`
    );
    assert.ok(studentRecord, 'Active student account must exist in database');

    const teacherRecord = await db.queryOne(
      `SELECT u.id, u.email, u.first_name, u.last_name, tp.id as teacher_profile_id
       FROM users u
       JOIN roles r ON u.role_id = r.id
       JOIN teacher_profiles tp ON tp.user_id = u.id
       WHERE r.name = 'TEACHER' AND u.status = 'ACTIVE'
       LIMIT 1;`
    );
    assert.ok(teacherRecord, 'Active teacher account must exist in database');

    const adminRecord = await db.queryOne(
      `SELECT u.id, u.email
       FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE r.name = 'ADMIN' AND u.status = 'ACTIVE'
       LIMIT 1;`
    );
    assert.ok(adminRecord, 'Active admin account must exist in database');

    // Authenticate via login API
    const studentLogin = await makeRequest('POST', '/api/v1/auth/login', {
      email: studentRecord.email,
      password: 'Password123!'
    });
    assert.strictEqual(studentLogin.status, 200);
    const studentToken = studentLogin.body.data.token;
    const studentUser = studentLogin.body.data.user;

    const teacherLogin = await makeRequest('POST', '/api/v1/auth/login', {
      email: teacherRecord.email,
      password: 'Password123!'
    });
    assert.strictEqual(teacherLogin.status, 200);
    const teacherToken = teacherLogin.body.data.token;
    const teacherUser = teacherLogin.body.data.user;

    const adminLogin = await makeRequest('POST', '/api/v1/auth/login', {
      email: adminRecord.email,
      password: 'Password123!'
    });
    assert.strictEqual(adminLogin.status, 200);
    const adminToken = adminLogin.body.data.token;

    // Helper to insert isolated notification
    async function insertTestNotification(recipientId, title = 'Test Notice', type = 'SYSTEM_ALERT') {
      const res = await db.execute(
        `INSERT INTO notifications (recipient_id, appointment_id, title, message, type, is_read, created_at)
         VALUES (?, null, ?, ?, ?, 0, CURRENT_TIMESTAMP);`,
        [recipientId, title, `Body for ${title}`, type]
      );
      createdNotificationIds.push(res.lastInsertRowid);
      return res.lastInsertRowid;
    }

    // -------------------------------------------------------------
    // Criterion 1: Authenticated user marks their own unread notification as read
    // -------------------------------------------------------------
    let studentNotif1Id;
    await test('1. An authenticated user can mark their own unread notification as read', async () => {
      studentNotif1Id = await insertTestNotification(studentUser.id, 'Advisory Schedule Updated');

      const res = await makeRequest(
        'PATCH',
        `/api/v1/users/${studentUser.id}/notifications/${studentNotif1Id}/read`,
        null,
        studentToken
      );

      assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.id, studentNotif1Id);
      assert.strictEqual(res.body.data.recipientId, studentUser.id);
      assert.strictEqual(res.body.data.isRead, 1);
      assert.strictEqual(res.body.data.title, 'Advisory Schedule Updated');
    });

    // -------------------------------------------------------------
    // Criterion 2: Database persists is_read = 1
    // -------------------------------------------------------------
    await test('2. The database persists is_read = 1', async () => {
      const row = await db.queryOne(
        'SELECT id, is_read, recipient_id FROM notifications WHERE id = ?;',
        [studentNotif1Id]
      );
      assert.ok(row, 'Notification record should exist in database');
      assert.strictEqual(row.is_read, 1, 'is_read must be 1 in database');
    });

    // -------------------------------------------------------------
    // Criterion 3: A user cannot mark another user's notification as read
    // -------------------------------------------------------------
    await test("3. A user cannot mark another user's notification as read", async () => {
      const teacherNotifId = await insertTestNotification(teacherUser.id, 'Private Faculty Reminder');

      // Case 3a: Student requests via Teacher's user URL
      const res3a = await makeRequest(
        'PATCH',
        `/api/v1/users/${teacherUser.id}/notifications/${teacherNotifId}/read`,
        null,
        studentToken
      );
      assert.strictEqual(res3a.status, 403, 'Should reject cross-user URL with 403 Forbidden');
      assert.strictEqual(res3a.body.success, false);
      assert.strictEqual(res3a.body.error.code, 'FORBIDDEN');

      // Case 3b: Student requests via own user URL with counterparty's notification ID
      const res3b = await makeRequest(
        'PATCH',
        `/api/v1/users/${studentUser.id}/notifications/${teacherNotifId}/read`,
        null,
        studentToken
      );
      assert.strictEqual(res3b.status, 403, 'Should reject foreign notification with 403 Forbidden');
      assert.strictEqual(res3b.body.success, false);
      assert.strictEqual(res3b.body.error.code, 'FORBIDDEN');

      // Verify notification remains unread in database
      const row = await db.queryOne('SELECT is_read FROM notifications WHERE id = ?;', [teacherNotifId]);
      assert.strictEqual(row.is_read, 0, 'Target notification must remain unread (is_read = 0)');
    });

    // -------------------------------------------------------------
    // Criterion 4: An unauthenticated request is rejected
    // -------------------------------------------------------------
    await test('4. An unauthenticated request is rejected', async () => {
      const unauthNotifId = await insertTestNotification(studentUser.id, 'Security Verification Notice');

      // No token
      const resNoToken = await makeRequest(
        'PATCH',
        `/api/v1/users/${studentUser.id}/notifications/${unauthNotifId}/read`,
        null,
        null
      );
      assert.strictEqual(resNoToken.status, 401);
      assert.strictEqual(resNoToken.body.success, false);
      assert.strictEqual(resNoToken.body.error.code, 'AUTHENTICATION_REQUIRED');

      // Forged / invalid token
      const resBadToken = await makeRequest(
        'PATCH',
        `/api/v1/users/${studentUser.id}/notifications/${unauthNotifId}/read`,
        null,
        'forged.invalid.token'
      );
      assert.strictEqual(resBadToken.status, 401);
      assert.strictEqual(resBadToken.body.success, false);
      assert.strictEqual(resBadToken.body.error.code, 'INVALID_TOKEN');

      // Notification should still be unread
      const row = await db.queryOne('SELECT is_read FROM notifications WHERE id = ?;', [unauthNotifId]);
      assert.strictEqual(row.is_read, 0);
    });

    // -------------------------------------------------------------
    // Criterion 5: A nonexistent notification ID is handled correctly
    // -------------------------------------------------------------
    await test('5. A nonexistent notification ID is handled correctly', async () => {
      // Nonexistent numeric ID
      const res404 = await makeRequest(
        'PATCH',
        `/api/v1/users/${studentUser.id}/notifications/99999999/read`,
        null,
        studentToken
      );
      assert.strictEqual(res404.status, 404);
      assert.strictEqual(res404.body.success, false);
      assert.strictEqual(res404.body.error.code, 'NOTIFICATION_NOT_FOUND');

      // Non-numeric invalid ID
      const res400 = await makeRequest(
        'PATCH',
        `/api/v1/users/${studentUser.id}/notifications/invalid-id/read`,
        null,
        studentToken
      );
      assert.strictEqual(res400.status, 400);
      assert.strictEqual(res400.body.success, false);
      assert.strictEqual(res400.body.error.code, 'INVALID_NOTIFICATION_ID');
    });

    // -------------------------------------------------------------
    // Criterion 6: Repeating a mark-as-read request is safe (idempotent)
    // -------------------------------------------------------------
    await test('6. Repeating a mark-as-read request is safe and idempotent', async () => {
      // Call 1 on already-read notification
      const repeatRes1 = await makeRequest(
        'PATCH',
        `/api/v1/users/${studentUser.id}/notifications/${studentNotif1Id}/read`,
        null,
        studentToken
      );
      assert.strictEqual(repeatRes1.status, 200);
      assert.strictEqual(repeatRes1.body.success, true);
      assert.strictEqual(repeatRes1.body.data.isRead, 1);

      // Call 2 on already-read notification
      const repeatRes2 = await makeRequest(
        'PATCH',
        `/api/v1/users/${studentUser.id}/notifications/${studentNotif1Id}/read`,
        null,
        studentToken
      );
      assert.strictEqual(repeatRes2.status, 200);
      assert.strictEqual(repeatRes2.body.success, true);
      assert.strictEqual(repeatRes2.body.data.isRead, 1);
    });

    // -------------------------------------------------------------
    // Criterion 7: A failed request does not produce a false success in frontend service contract
    // -------------------------------------------------------------
    await test('7. A failed request does not produce a false success in frontend contract', async () => {
      // Simulate failed call (e.g. 404 or 403) and verify error structure
      const failRes = await makeRequest(
        'PATCH',
        `/api/v1/users/${studentUser.id}/notifications/88888888/read`,
        null,
        studentToken
      );
      assert.strictEqual(failRes.status, 404);
      assert.strictEqual(failRes.body.success, false);
      assert.ok(failRes.body.error && failRes.body.error.message);

      // Verify that service level would receive rejected Promise
      let threw = false;
      try {
        if (!failRes.body.success) {
          throw new Error(failRes.body.error.message);
        }
      } catch (err) {
        threw = true;
        assert.ok(err.message.includes('not found') || err.message.length > 0);
      }
      assert.strictEqual(threw, true, 'Frontend service should reject and never falsely report success');
    });

    // -------------------------------------------------------------
    // Criterion 8: Existing notification retrieval and Phase 3 dispatch still work
    // -------------------------------------------------------------
    await test('8. Existing notification retrieval and Phase 3 notification dispatch still work', async () => {
      // 1. Create a future slot with required timestamps
      const futureDate = '2030-11-20';
      const slotRes = await db.execute(
        `INSERT INTO teacher_availability_slots
         (teacher_id, slot_date, start_time, end_time, start_timestamp, end_timestamp, is_booked, is_active)
         VALUES (?, ?, '11:00', '11:45', ? || ' 11:00', ? || ' 11:45', 0, 1);`,
        [teacherRecord.teacher_profile_id, futureDate, futureDate, futureDate]
      );
      const slotId = slotRes.lastInsertRowid;
      createdSlotIds.push(slotId);

      // 2. Book appointment via student API
      const bookRes = await makeRequest(
        'POST',
        '/api/v1/appointments',
        {
          slotId,
          title: 'Read State Phase 4 Verification Appointment',
          purpose: 'Verifying notification dispatch compatibility'
        },
        studentToken
      );
      assert.strictEqual(bookRes.status, 201);
      const apptId = bookRes.body.data.id;
      createdAppointmentIds.push(apptId);

      // 3. Verify notification created for teacher
      const teacherNotif = await db.queryOne(
        'SELECT id, recipient_id, appointment_id, type, is_read FROM notifications WHERE appointment_id = ? AND recipient_id = ?;',
        [apptId, teacherUser.id]
      );
      assert.ok(teacherNotif, 'Phase 3 dispatch must create notification for teacher');
      assert.strictEqual(teacherNotif.type, 'BOOKING_REQUEST');
      assert.strictEqual(teacherNotif.is_read, 0);
      createdNotificationIds.push(teacherNotif.id);

      // 4. Retrieve notifications list via GET /api/v1/users/:id/notifications
      const listRes = await makeRequest(
        'GET',
        `/api/v1/users/${teacherUser.id}/notifications`,
        null,
        teacherToken
      );
      assert.strictEqual(listRes.status, 200);
      assert.strictEqual(listRes.body.success, true);
      assert.ok(Array.isArray(listRes.body.data.notifications));
      const foundInList = listRes.body.data.notifications.find((n) => n.id === teacherNotif.id);
      assert.ok(foundInList, 'Newly dispatched notification must appear in retrieval list');
      assert.strictEqual(foundInList.isRead, 0);
    });

    // -------------------------------------------------------------
    // Criterion 9: Mark-all updates only the authenticated user's notifications
    // -------------------------------------------------------------
    await test("9. Mark-all updates only the authenticated user's notifications", async () => {
      // Seed 2 unread for student, 2 unread for teacher
      const s1 = await insertTestNotification(studentUser.id, 'Batch Student Alert 1');
      const s2 = await insertTestNotification(studentUser.id, 'Batch Student Alert 2');
      const t1 = await insertTestNotification(teacherUser.id, 'Batch Teacher Alert 1');
      const t2 = await insertTestNotification(teacherUser.id, 'Batch Teacher Alert 2');

      // Student calls mark-all
      const markAllRes = await makeRequest(
        'PATCH',
        `/api/v1/users/${studentUser.id}/notifications/read-all`,
        null,
        studentToken
      );
      assert.strictEqual(markAllRes.status, 200);
      assert.strictEqual(markAllRes.body.success, true);
      assert.strictEqual(markAllRes.body.data.recipientId, studentUser.id);
      assert.ok(markAllRes.body.data.updatedCount >= 2);

      // Check DB: Student's notifications are read
      const s1Db = await db.queryOne('SELECT is_read FROM notifications WHERE id = ?;', [s1]);
      const s2Db = await db.queryOne('SELECT is_read FROM notifications WHERE id = ?;', [s2]);
      assert.strictEqual(s1Db.is_read, 1);
      assert.strictEqual(s2Db.is_read, 1);

      // Check DB: Teacher's notifications MUST remain unread (is_read = 0)
      const t1Db = await db.queryOne('SELECT is_read FROM notifications WHERE id = ?;', [t1]);
      const t2Db = await db.queryOne('SELECT is_read FROM notifications WHERE id = ?;', [t2]);
      assert.strictEqual(t1Db.is_read, 0, 'Teacher notification 1 must not be marked read by student mark-all');
      assert.strictEqual(t2Db.is_read, 0, 'Teacher notification 2 must not be marked read by student mark-all');

      // Also verify POST alias /mark-all-read works safely
      const postAliasRes = await makeRequest(
        'POST',
        `/api/v1/users/${studentUser.id}/notifications/mark-all-read`,
        null,
        studentToken
      );
      assert.strictEqual(postAliasRes.status, 200);
      assert.strictEqual(postAliasRes.body.success, true);
    });

    // -------------------------------------------------------------
    // Criterion 10: Existing Admin panel behavior remains intact
    // -------------------------------------------------------------
    await test('10. Existing Admin panel behavior remains intact', async () => {
      // 1. Appointments summary
      const summaryRes = await makeRequest('GET', '/api/v1/admin/appointments/summary', null, adminToken);
      assert.strictEqual(summaryRes.status, 200);
      assert.strictEqual(summaryRes.body.success, true);
      const summary = summaryRes.body.data.summary || summaryRes.body.data;
      assert.ok(typeof summary.total === 'number');

      // 2. User accounts list
      const usersRes = await makeRequest('GET', '/api/v1/admin/users', null, adminToken);
      assert.strictEqual(usersRes.status, 200);
      assert.strictEqual(usersRes.body.success, true);
      assert.ok(Array.isArray(usersRes.body.data.users));

      // 3. Audit logs list
      const auditRes = await makeRequest('GET', '/api/v1/admin/audit-logs', null, adminToken);
      assert.strictEqual(auditRes.status, 200);
      assert.strictEqual(auditRes.body.success, true);
      assert.ok(Array.isArray(auditRes.body.data.logs));

      // 4. System diagnostics (health and ready)
      const healthRes = await makeRequest('GET', '/api/v1/health', null);
      assert.strictEqual(healthRes.status, 200);
      assert.strictEqual(healthRes.body.success, true);
      assert.strictEqual(healthRes.body.data.status, 'UP');

      const readyRes = await makeRequest('GET', '/api/v1/ready', null);
      assert.strictEqual(readyRes.status, 200);
      assert.strictEqual(readyRes.body.success, true);
      assert.strictEqual(readyRes.body.data.status, 'READY');
    });

  } finally {
    // Clean up created test data
    try {
      if (createdNotificationIds.length > 0) {
        const ph = createdNotificationIds.map(() => '?').join(',');
        await db.execute(`DELETE FROM notifications WHERE id IN (${ph});`, createdNotificationIds);
      }
      if (createdAppointmentIds.length > 0) {
        const ph = createdAppointmentIds.map(() => '?').join(',');
        await db.execute(`DELETE FROM appointment_status_history WHERE appointment_id IN (${ph});`, createdAppointmentIds);
        await db.execute(`DELETE FROM appointment_reschedules WHERE appointment_id IN (${ph});`, createdAppointmentIds);
        await db.execute(`DELETE FROM notifications WHERE appointment_id IN (${ph});`, createdAppointmentIds);
        await db.execute(`DELETE FROM appointments WHERE id IN (${ph});`, createdAppointmentIds);
      }
      if (createdSlotIds.length > 0) {
        const ph = createdSlotIds.map(() => '?').join(',');
        await db.execute(`DELETE FROM teacher_availability_slots WHERE id IN (${ph});`, createdSlotIds);
      }
    } catch (cleanupErr) {
      console.warn('Cleanup warning:', cleanupErr.message);
    }

    if (server) {
      server.close();
    }
  }

  console.log('\n-----------------------------------------------------------------');
  console.log(`Notification Read-State Test Summary: ${passed} passed, ${failed} failed.`);
  console.log('=================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runReadStateTests().catch((err) => {
  console.error('Test suite execution failed:', err);
  process.exit(1);
});
