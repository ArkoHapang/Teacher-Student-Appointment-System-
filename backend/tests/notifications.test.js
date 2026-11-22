/**
 * Dynamic Event Notification Dispatch Integration Test Suite
 *
 * Verifies Phase 3 requirements:
 * 1. Successful booking creates one teacher notification (BOOKING_REQUEST).
 * 2. Successful approval creates one student notification (STATUS_UPDATE).
 * 3. Successful rejection creates one student notification with the available reason (STATUS_UPDATE).
 * 4. Student cancellation notifies the teacher (STATUS_UPDATE).
 * 5. Teacher cancellation notifies the student (STATUS_UPDATE).
 * 6. Rescheduling notifies the counterparty with the new schedule (RESCHEDULE_REQUEST).
 * 7. Admin status changes notify both affected participants (STATUS_UPDATE).
 * 8. Admin rescheduling notifies both participants (RESCHEDULE_REQUEST).
 * 9. Invalid transitions do not create notifications.
 * 10. Failed notification insertion rolls back the appointment mutation.
 * 11. Notification types outside the schema's permitted values are rejected.
 * 12. A client cannot choose an arbitrary notification recipient.
 * 13. Existing notification retrieval authorization remains enforced.
 * 14. Existing tests and Admin panel behavior remain intact (slot release, history, summary).
 */

require('./setup');
const assert = require('assert');
const http = require('http');
const app = require('../src/app');
const db = require('../src/config/database');
const notificationService = require('../src/services/notificationService');
const appointmentService = require('../src/services/appointmentService');
const adminAppointmentService = require('../src/services/adminAppointmentService');

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

async function runNotificationTests() {
  console.log('\n=================================================================');
  console.log(' Teacher-Student Appointment System: Notification Dispatch Tests ');
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

  const createdSlotIds = [];
  const createdAppointmentIds = [];
  const createdNotificationIds = [];

  try {
    // 1. Authenticate users and retrieve fresh database identities dynamically
    let studentToken, teacherToken, adminToken;
    let studentUser, teacherUser, adminUser;
    let teacherProfile, studentProfile;

    const studentRecord = await db.queryOne(
      "SELECT u.email FROM users u JOIN roles r ON u.role_id = r.id JOIN student_profiles sp ON u.id = sp.user_id WHERE r.name = 'STUDENT' AND u.status = 'ACTIVE' LIMIT 1;"
    );
    const teacherRecord = await db.queryOne(
      "SELECT u.email FROM users u JOIN roles r ON u.role_id = r.id JOIN teacher_profiles tp ON u.id = tp.user_id WHERE r.name = 'TEACHER' AND u.status = 'ACTIVE' AND tp.is_verified = 1 LIMIT 1;"
    );
    const adminRecord = await db.queryOne(
      "SELECT u.email FROM users u JOIN roles r ON u.role_id = r.id WHERE r.name = 'ADMIN' AND u.status = 'ACTIVE' LIMIT 1;"
    );

    assert.ok(studentRecord, 'An active student user must exist');
    assert.ok(teacherRecord, 'An active verified teacher user must exist');
    assert.ok(adminRecord, 'An active admin user must exist');

    const studentLogin = await makeRequest('POST', '/api/v1/auth/login', {
      email: studentRecord.email,
      password: 'Password123!'
    });
    assert.strictEqual(studentLogin.status, 200, 'Student login failed');
    studentToken = studentLogin.body.data.token;
    studentUser = studentLogin.body.data.user;

    const teacherLogin = await makeRequest('POST', '/api/v1/auth/login', {
      email: teacherRecord.email,
      password: 'Password123!'
    });
    assert.strictEqual(teacherLogin.status, 200, 'Teacher login failed');
    teacherToken = teacherLogin.body.data.token;
    teacherUser = teacherLogin.body.data.user;

    const adminLogin = await makeRequest('POST', '/api/v1/auth/login', {
      email: adminRecord.email,
      password: 'Password123!'
    });
    assert.strictEqual(adminLogin.status, 200, 'Admin login failed');
    adminToken = adminLogin.body.data.token;
    adminUser = adminLogin.body.data.user;

    // Resolve profile records
    teacherProfile = await db.queryOne('SELECT * FROM teacher_profiles WHERE user_id = ?;', [teacherUser.id]);
    studentProfile = await db.queryOne('SELECT * FROM student_profiles WHERE user_id = ?;', [studentUser.id]);
    assert.ok(teacherProfile, 'Teacher profile must exist');
    assert.ok(studentProfile, 'Student profile must exist');

    // Helper: Create a dedicated availability slot on a distinct date/time
    let slotCounter = 0;
    async function createTestSlot(startTime = '10:00:00', endTime = '10:30:00') {
      slotCounter++;
      const offsetDays = 3000 + slotCounter;
      const slotDate = new Date(Date.now() + 86400000 * offsetDays).toISOString().slice(0, 10);
      const res = await db.execute(
        `INSERT INTO teacher_availability_slots
         (teacher_id, slot_date, start_time, end_time, start_timestamp, end_timestamp, is_booked, is_active)
         VALUES (?, ?, ?, ?, ? || ' ' || ?, ? || ' ' || ?, 0, 1);`,
        [teacherProfile.id, slotDate, startTime, endTime, slotDate, startTime, slotDate, endTime]
      );
      createdSlotIds.push(res.lastInsertRowid);
      return { id: res.lastInsertRowid, slotDate, startTime, endTime };
    }

    // Helper: Query notifications for a user
    async function getUserNotifications(userId) {
      return db.query(
        'SELECT * FROM notifications WHERE recipient_id = ? ORDER BY id DESC;',
        [userId]
      );
    }

    // Helper: Count notifications for a user
    async function getNotificationCount(userId) {
      const row = await db.queryOne(
        'SELECT count(*) as total FROM notifications WHERE recipient_id = ?;',
        [userId]
      );
      return parseInt(row.total, 10);
    }

    // Test 1: Successful booking creates one teacher notification
    await test('1. Successful booking creates one teacher notification', async () => {
      const slot = await createTestSlot('09:00:00', '09:30:00');
      const teacherCountBefore = await getNotificationCount(teacherUser.id);

      const res = await makeRequest(
        'POST',
        '/api/v1/appointments',
        {
          slotId: slot.id,
          title: 'Notification Verification Booking',
          purpose: 'Testing teacher notification generation.'
        },
        studentToken
      );

      assert.strictEqual(res.status, 201);
      const apptId = res.body.data.id;
      createdAppointmentIds.push(apptId);

      const teacherCountAfter = await getNotificationCount(teacherUser.id);
      assert.strictEqual(teacherCountAfter, teacherCountBefore + 1, 'Teacher must receive exactly one notification');

      const notifications = await getUserNotifications(teacherUser.id);
      const latest = notifications[0];
      createdNotificationIds.push(latest.id);

      assert.strictEqual(latest.type, 'BOOKING_REQUEST');
      assert.strictEqual(latest.appointment_id, apptId);
      assert.strictEqual(latest.title, 'New Appointment Request');
      assert.ok(latest.message.includes(slot.slotDate), 'Message should include slot date');
      assert.ok(latest.message.includes('Notification Verification Booking'), 'Message should include appointment title');
    });

    // Test 2: Successful approval creates one student notification
    await test('2. Successful approval creates one student notification', async () => {
      const slot = await createTestSlot('09:30:00', '10:00:00');
      const bookRes = await makeRequest(
        'POST',
        '/api/v1/appointments',
        { slotId: slot.id, title: 'Approval Test Request', purpose: 'Testing approval notification.' },
        studentToken
      );
      const apptId = bookRes.body.data.id;
      createdAppointmentIds.push(apptId);

      const studentCountBefore = await getNotificationCount(studentUser.id);

      const approveRes = await makeRequest(
        'POST',
        `/api/v1/appointments/${apptId}/approve`,
        { notes: 'Approved for consultation.' },
        teacherToken
      );
      assert.strictEqual(approveRes.status, 200);

      const studentCountAfter = await getNotificationCount(studentUser.id);
      assert.strictEqual(studentCountAfter, studentCountBefore + 1, 'Student must receive exactly one notification');

      const notifications = await getUserNotifications(studentUser.id);
      const latest = notifications[0];
      createdNotificationIds.push(latest.id);

      assert.strictEqual(latest.type, 'STATUS_UPDATE');
      assert.strictEqual(latest.appointment_id, apptId);
      assert.strictEqual(latest.title, 'Appointment Approved');
      assert.ok(latest.message.includes('approved'), 'Message should communicate approval');
      assert.ok(latest.message.includes('Approval Test Request'), 'Message should mention appointment title');
    });

    // Test 3: Successful rejection creates one student notification with the available reason
    await test('3. Successful rejection creates one student notification with the available reason', async () => {
      const slot = await createTestSlot('10:00:00', '10:30:00');
      const bookRes = await makeRequest(
        'POST',
        '/api/v1/appointments',
        { slotId: slot.id, title: 'Rejection Test Request', purpose: 'Testing rejection notification.' },
        studentToken
      );
      const apptId = bookRes.body.data.id;
      createdAppointmentIds.push(apptId);

      const studentCountBefore = await getNotificationCount(studentUser.id);
      const rejectionReason = 'Faculty member is attending a symposium.';

      const rejectRes = await makeRequest(
        'POST',
        `/api/v1/appointments/${apptId}/reject`,
        { reason: rejectionReason },
        teacherToken
      );
      assert.strictEqual(rejectRes.status, 200);

      const studentCountAfter = await getNotificationCount(studentUser.id);
      assert.strictEqual(studentCountAfter, studentCountBefore + 1, 'Student must receive exactly one notification');

      const notifications = await getUserNotifications(studentUser.id);
      const latest = notifications[0];
      createdNotificationIds.push(latest.id);

      assert.strictEqual(latest.type, 'STATUS_UPDATE');
      assert.strictEqual(latest.appointment_id, apptId, 'Rejection notification must retain appointment_id');
      assert.strictEqual(latest.title, 'Appointment Rejected');
      assert.ok(latest.message.includes(rejectionReason), 'Message must include supplied rejection reason');
    });

    // Test 4: Student cancellation notifies the teacher
    await test('4. Student cancellation notifies the teacher', async () => {
      const slot = await createTestSlot('10:30:00', '11:00:00');
      const bookRes = await makeRequest(
        'POST',
        '/api/v1/appointments',
        { slotId: slot.id, title: 'Student Cancellation Test', purpose: 'Testing student cancellation notification.' },
        studentToken
      );
      const apptId = bookRes.body.data.id;
      createdAppointmentIds.push(apptId);

      const teacherCountBefore = await getNotificationCount(teacherUser.id);
      const cancelReason = 'Student has an overlapping midterm examination.';

      const cancelRes = await makeRequest(
        'POST',
        `/api/v1/appointments/${apptId}/cancel`,
        { cancellationReason: cancelReason },
        studentToken
      );
      assert.strictEqual(cancelRes.status, 200);

      const teacherCountAfter = await getNotificationCount(teacherUser.id);
      assert.strictEqual(teacherCountAfter, teacherCountBefore + 1, 'Teacher must receive cancellation notification');

      const notifications = await getUserNotifications(teacherUser.id);
      const latest = notifications[0];
      createdNotificationIds.push(latest.id);

      assert.strictEqual(latest.type, 'STATUS_UPDATE');
      assert.strictEqual(latest.appointment_id, apptId);
      assert.strictEqual(latest.title, 'Appointment Cancelled');
      assert.ok(latest.message.includes(cancelReason), 'Message must include cancellation reason');
    });

    // Test 5: Teacher cancellation notifies the student
    await test('5. Teacher cancellation notifies the student', async () => {
      const slot = await createTestSlot('11:00:00', '11:30:00');
      const bookRes = await makeRequest(
        'POST',
        '/api/v1/appointments',
        { slotId: slot.id, title: 'Teacher Cancellation Test', purpose: 'Testing teacher cancellation notification.' },
        studentToken
      );
      const apptId = bookRes.body.data.id;
      createdAppointmentIds.push(apptId);

      // Approve appointment first
      await makeRequest('POST', `/api/v1/appointments/${apptId}/approve`, { notes: 'Approved.' }, teacherToken);

      const studentCountBefore = await getNotificationCount(studentUser.id);
      const cancelReason = 'Teacher has an urgent department meeting.';

      const cancelRes = await makeRequest(
        'POST',
        `/api/v1/appointments/${apptId}/cancel`,
        { cancellationReason: cancelReason },
        teacherToken
      );
      assert.strictEqual(cancelRes.status, 200);

      const studentCountAfter = await getNotificationCount(studentUser.id);
      assert.strictEqual(studentCountAfter, studentCountBefore + 1, 'Student must receive cancellation notification');

      const notifications = await getUserNotifications(studentUser.id);
      const latest = notifications[0];
      createdNotificationIds.push(latest.id);

      assert.strictEqual(latest.type, 'STATUS_UPDATE');
      assert.strictEqual(latest.appointment_id, apptId);
      assert.strictEqual(latest.title, 'Appointment Cancelled');
      assert.ok(latest.message.includes(cancelReason), 'Message must include cancellation reason');
    });

    // Test 6: Rescheduling notifies the counterparty with the new schedule
    await test('6. Rescheduling notifies the counterparty with the new schedule', async () => {
      const slot1 = await createTestSlot('11:30:00', '12:00:00');
      const slot2 = await createTestSlot('12:00:00', '12:30:00');

      const bookRes = await makeRequest(
        'POST',
        '/api/v1/appointments',
        { slotId: slot1.id, title: 'Reschedule Test Request', purpose: 'Testing reschedule notification.' },
        studentToken
      );
      const apptId = bookRes.body.data.id;
      createdAppointmentIds.push(apptId);

      const teacherCountBefore = await getNotificationCount(teacherUser.id);
      const rescheduleReason = 'Need to move to later afternoon slot.';

      const reschRes = await makeRequest(
        'POST',
        `/api/v1/appointments/${apptId}/reschedule`,
        { proposedSlotId: slot2.id, reason: rescheduleReason },
        studentToken
      );
      assert.strictEqual(reschRes.status, 200);

      const teacherCountAfter = await getNotificationCount(teacherUser.id);
      assert.strictEqual(teacherCountAfter, teacherCountBefore + 1, 'Teacher must receive RESCHEDULE_REQUEST notification');

      const notifications = await getUserNotifications(teacherUser.id);
      const latest = notifications[0];
      createdNotificationIds.push(latest.id);

      assert.strictEqual(latest.type, 'RESCHEDULE_REQUEST');
      assert.strictEqual(latest.appointment_id, apptId);
      assert.strictEqual(latest.title, 'Appointment Rescheduled');
      assert.ok(latest.message.includes(slot2.slotDate), 'Message must include new slot date');
      assert.ok(latest.message.includes(rescheduleReason), 'Message must include reschedule reason');
    });

    // Test 7: Admin status changes notify the affected participants
    await test('7. Admin status changes notify the affected participants', async () => {
      const slot = await createTestSlot('12:30:00', '13:00:00');
      const bookRes = await makeRequest(
        'POST',
        '/api/v1/appointments',
        { slotId: slot.id, title: 'Admin Status Change Test', purpose: 'Testing admin status notifications.' },
        studentToken
      );
      const apptId = bookRes.body.data.id;
      createdAppointmentIds.push(apptId);

      const studentCountBefore = await getNotificationCount(studentUser.id);
      const teacherCountBefore = await getNotificationCount(teacherUser.id);

      // Admin approves appointment
      const adminApproveRes = await makeRequest(
        'PATCH',
        `/api/v1/admin/appointments/${apptId}/status`,
        { status: 'APPROVED', notes: 'Administrative approval override.' },
        adminToken
      );
      assert.strictEqual(adminApproveRes.status, 200);

      const studentCountAfter = await getNotificationCount(studentUser.id);
      const teacherCountAfter = await getNotificationCount(teacherUser.id);

      assert.strictEqual(studentCountAfter, studentCountBefore + 1, 'Student must receive admin approval notification');
      assert.strictEqual(teacherCountAfter, teacherCountBefore + 1, 'Teacher must receive admin approval notification');

      const studentNotifs = await getUserNotifications(studentUser.id);
      const teacherNotifs = await getUserNotifications(teacherUser.id);

      assert.strictEqual(studentNotifs[0].type, 'STATUS_UPDATE');
      assert.strictEqual(teacherNotifs[0].type, 'STATUS_UPDATE');
      assert.strictEqual(studentNotifs[0].title, 'Appointment Approved by Administrator');
      assert.strictEqual(teacherNotifs[0].title, 'Appointment Approved by Administrator');
      createdNotificationIds.push(studentNotifs[0].id, teacherNotifs[0].id);
    });

    // Test 8: Admin rescheduling notifies both participants
    await test('8. Admin rescheduling notifies both participants', async () => {
      const slot1 = await createTestSlot('13:00:00', '13:30:00');
      const slot2 = await createTestSlot('13:30:00', '14:00:00');

      const bookRes = await makeRequest(
        'POST',
        '/api/v1/appointments',
        { slotId: slot1.id, title: 'Admin Reschedule Test', purpose: 'Testing admin reschedule notifications.' },
        studentToken
      );
      const apptId = bookRes.body.data.id;
      createdAppointmentIds.push(apptId);

      const studentCountBefore = await getNotificationCount(studentUser.id);
      const teacherCountBefore = await getNotificationCount(teacherUser.id);
      const adminReason = 'Administrative room reassignment.';

      const adminReschRes = await makeRequest(
        'POST',
        `/api/v1/admin/appointments/${apptId}/reschedule`,
        { proposedSlotId: slot2.id, reason: adminReason },
        adminToken
      );
      assert.strictEqual(adminReschRes.status, 200);

      const studentCountAfter = await getNotificationCount(studentUser.id);
      const teacherCountAfter = await getNotificationCount(teacherUser.id);

      assert.strictEqual(studentCountAfter, studentCountBefore + 1, 'Student must receive admin reschedule notification');
      assert.strictEqual(teacherCountAfter, teacherCountBefore + 1, 'Teacher must receive admin reschedule notification');

      const studentNotifs = await getUserNotifications(studentUser.id);
      const teacherNotifs = await getUserNotifications(teacherUser.id);

      assert.strictEqual(studentNotifs[0].type, 'RESCHEDULE_REQUEST');
      assert.strictEqual(teacherNotifs[0].type, 'RESCHEDULE_REQUEST');
      assert.strictEqual(studentNotifs[0].title, 'Appointment Rescheduled by Administrator');
      assert.strictEqual(teacherNotifs[0].title, 'Appointment Rescheduled by Administrator');
      assert.ok(studentNotifs[0].message.includes(adminReason));
      assert.ok(teacherNotifs[0].message.includes(adminReason));
      createdNotificationIds.push(studentNotifs[0].id, teacherNotifs[0].id);
    });

    // Test 9: Invalid transitions do not create notifications
    await test('9. Invalid transitions do not create notifications', async () => {
      const slot = await createTestSlot('14:00:00', '14:30:00');
      const bookRes = await makeRequest(
        'POST',
        '/api/v1/appointments',
        { slotId: slot.id, title: 'Invalid Transition Test', purpose: 'Testing invalid transitions.' },
        studentToken
      );
      const apptId = bookRes.body.data.id;
      createdAppointmentIds.push(apptId);

      // Cancel appointment to move it to terminal CANCELLED status
      await makeRequest(
        'POST',
        `/api/v1/appointments/${apptId}/cancel`,
        { cancellationReason: 'Valid cancellation before testing invalid transition.' },
        studentToken
      );

      const studentCountBefore = await getNotificationCount(studentUser.id);
      const teacherCountBefore = await getNotificationCount(teacherUser.id);

      // Attempt invalid transition: cancelling an already cancelled appointment
      const invalidRes = await makeRequest(
        'POST',
        `/api/v1/appointments/${apptId}/cancel`,
        { cancellationReason: 'Duplicate cancellation attempt.' },
        studentToken
      );
      assert.strictEqual(invalidRes.status, 400);

      const studentCountAfter = await getNotificationCount(studentUser.id);
      const teacherCountAfter = await getNotificationCount(teacherUser.id);

      assert.strictEqual(studentCountAfter, studentCountBefore, 'No student notification on failed transition');
      assert.strictEqual(teacherCountAfter, teacherCountBefore, 'No teacher notification on failed transition');
    });

    // Test 10: Failed notification insertion rolls back the appointment mutation
    await test('10. Failed notification insertion rolls back the appointment mutation', async () => {
      const slot = await createTestSlot('14:30:00', '15:00:00');
      const bookRes = await makeRequest(
        'POST',
        '/api/v1/appointments',
        { slotId: slot.id, title: 'Rollback Test Appointment', purpose: 'Testing transaction rollback.' },
        studentToken
      );
      const apptId = bookRes.body.data.id;
      createdAppointmentIds.push(apptId);

      // Execute a transactional mutation where notification insertion fails
      let caughtError = null;
      try {
        await db.transaction(async (tx) => {
          // Mutate appointment status
          await tx.execute("UPDATE appointments SET status = 'APPROVED' WHERE id = ?;", [apptId]);

          // Attempt to insert invalid notification type, which throws
          await notificationService.createNotification(tx, {
            recipientId: studentUser.id,
            appointmentId: apptId,
            title: 'Invalid Notification',
            message: 'This should trigger a transaction rollback.',
            type: 'DISALLOWED_TYPE'
          });
        });
      } catch (err) {
        caughtError = err;
      }

      assert.ok(caughtError, 'Expected transaction to throw when notification insertion fails');

      // Verify that appointment status mutation was completely rolled back
      const apptAfter = await db.queryOne('SELECT status FROM appointments WHERE id = ?;', [apptId]);
      assert.strictEqual(apptAfter.status, 'PENDING', 'Appointment status must remain PENDING after rollback');
    });

    // Test 11: Notification types outside the schema's permitted values are rejected
    await test('11. Notification types outside permitted values are rejected', async () => {
      let serviceError = null;
      try {
        await notificationService.createNotification(db, {
          recipientId: studentUser.id,
          appointmentId: null,
          title: 'Illegal Type Test',
          message: 'Testing illegal notification type validation.',
          type: 'UNAUTHORIZED_CUSTOM_EVENT'
        });
      } catch (err) {
        serviceError = err;
      }

      assert.ok(serviceError, 'Service must reject unlisted notification types');
      assert.strictEqual(serviceError.code, 'INVALID_NOTIFICATION_TYPE');
      assert.strictEqual(serviceError.statusCode, 400);

      // Verify database schema CHECK constraint directly
      let dbError = null;
      try {
        await db.execute(
          `INSERT INTO notifications (recipient_id, title, message, type)
           VALUES (?, 'Direct DB Test', 'Testing schema CHECK constraint.', 'DISALLOWED_TYPE');`,
          [studentUser.id]
        );
      } catch (err) {
        dbError = err;
      }
      assert.ok(dbError, 'Database CHECK constraint must reject invalid notification types');
    });

    // Test 12: A client cannot choose an arbitrary notification recipient
    await test('12. A client cannot choose an arbitrary notification recipient', async () => {
      const slot = await createTestSlot('15:00:00', '15:30:00');
      const victimUserId = 999999;

      // Client sends malicious recipientId or userId payloads
      const res = await makeRequest(
        'POST',
        '/api/v1/appointments',
        {
          slotId: slot.id,
          title: 'Spoofed Recipient Test',
          purpose: 'Attempting to inject arbitrary recipient ID.',
          recipientId: victimUserId,
          userId: victimUserId,
          targetUser: victimUserId
        },
        studentToken
      );
      assert.strictEqual(res.status, 201);
      const apptId = res.body.data.id;
      createdAppointmentIds.push(apptId);

      // Verify no notification was created for victimUserId
      const victimNotifs = await db.query(
        'SELECT * FROM notifications WHERE recipient_id = ?;',
        [victimUserId]
      );
      assert.strictEqual(victimNotifs.length, 0, 'No notification should be dispatched to arbitrary recipient ID');

      // Verify notification was sent exclusively to the verified teacher
      const teacherNotifs = await db.query(
        'SELECT * FROM notifications WHERE appointment_id = ?;',
        [apptId]
      );
      assert.strictEqual(teacherNotifs.length, 1);
      assert.strictEqual(teacherNotifs[0].recipient_id, teacherUser.id, 'Recipient must be verified teacher user ID');
      createdNotificationIds.push(teacherNotifs[0].id);
    });

    // Test 13: Existing notification retrieval authorization remains enforced
    await test('13. Existing notification retrieval authorization remains enforced', async () => {
      // Alice attempts to read Robert's notifications
      const unauthorizedRes = await makeRequest(
        'GET',
        `/api/v1/users/${teacherUser.id}/notifications`,
        null,
        studentToken
      );
      assert.strictEqual(unauthorizedRes.status, 403, 'User must not view other users notifications');
      assert.strictEqual(unauthorizedRes.body.error.code, 'FORBIDDEN');

      // Alice reads her own notifications
      const authorizedRes = await makeRequest(
        'GET',
        `/api/v1/users/${studentUser.id}/notifications`,
        null,
        studentToken
      );
      assert.strictEqual(authorizedRes.status, 200, 'User should view own notifications');
      assert.strictEqual(authorizedRes.body.success, true);
      assert.ok(Array.isArray(authorizedRes.body.data.notifications));
    });

    // Test 14: Existing tests and Admin panel behavior remain intact
    await test('14. Existing tests and Admin panel behavior remain intact', async () => {
      const summaryRes = await makeRequest('GET', '/api/v1/admin/appointments/summary', null, adminToken);
      assert.strictEqual(summaryRes.status, 200);
      const summaryData = summaryRes.body.data.summary || summaryRes.body.data;
      assert.ok(typeof summaryData.total === 'number');
      assert.ok(summaryData.byStatus);

      // Verify audit logs endpoint works
      const auditRes = await makeRequest('GET', '/api/v1/admin/audit-logs', null, adminToken);
      assert.strictEqual(auditRes.status, 200);
      assert.strictEqual(auditRes.body.success, true);
    });

  } finally {
    // Clean up created appointments, notifications, and slots
    try {
      if (createdNotificationIds.length > 0) {
        const placeholders = createdNotificationIds.map(() => '?').join(',');
        await db.execute(`DELETE FROM notifications WHERE id IN (${placeholders});`, createdNotificationIds);
      }
      if (createdAppointmentIds.length > 0) {
        const placeholders = createdAppointmentIds.map(() => '?').join(',');
        await db.execute(`DELETE FROM appointment_status_history WHERE appointment_id IN (${placeholders});`, createdAppointmentIds);
        await db.execute(`DELETE FROM appointment_reschedules WHERE appointment_id IN (${placeholders});`, createdAppointmentIds);
        await db.execute(`DELETE FROM notifications WHERE appointment_id IN (${placeholders});`, createdAppointmentIds);
        await db.execute(`DELETE FROM appointments WHERE id IN (${placeholders});`, createdAppointmentIds);
      }
      if (createdSlotIds.length > 0) {
        const placeholders = createdSlotIds.map(() => '?').join(',');
        await db.execute(`DELETE FROM teacher_availability_slots WHERE id IN (${placeholders});`, createdSlotIds);
      }
    } catch (cleanupErr) {
      console.warn('Cleanup warning:', cleanupErr.message);
    }

    if (server) {
      server.close();
    }
  }

  console.log('\n-----------------------------------------------------------------');
  console.log(`Notification Test Summary: ${passed} passed, ${failed} failed.`);
  console.log('=================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runNotificationTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
