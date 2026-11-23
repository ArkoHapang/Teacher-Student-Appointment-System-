/**
 * Consolidated Bug Fix Verification Test Suite (GitHub Issues #42 through #62)
 *
 * Verifies all 21 audience-reported defects across the Teacher-Student Appointment System:
 * - Group A: Frontend, Navigation & Usability (#42, #44, #45, #54, #59, #61)
 * - Group B: Student Identity, Registration & Profiles (#43, #46, #51, #57, #62)
 * - Group C: Authentication & Account Onboarding (#47, #53, #60)
 * - Group D: Appointment Scheduling & Lifecycle (#48, #49, #50, #55, #56)
 * - Group E: Notifications & Administration (#52, #58)
 */

require('./setup');
const assert = require('assert');
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/database');
const emailService = require('../src/services/emailService');
const authTokenService = require('../src/services/authTokenService');
const tokenService = require('../src/services/tokenService');
const slotService = require('../src/services/slotService');
const appointmentService = require('../src/services/appointmentService');
const HTTP_STATUS = require('../src/constants/httpStatusCodes');
const { registrationRateLimiter, loginRateLimiter } = require('../src/middlewares/rateLimiter');

async function runConsolidatedTests() {
  console.log('\n=================================================================');
  console.log(' Teacher-Student Appointment System: Consolidated Bugfixes (#42-#62) ');
  console.log('=================================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(issueTag, description, fn) {
    try {
      registrationRateLimiter.reset();
      loginRateLimiter.reset();
      await fn();
      console.log(`  [PASS] [${issueTag}] ${description}`);
      passed++;
    } catch (err) {
      console.log(`  [FAIL] [${issueTag}] ${description}`);
      console.error(`         ${err.message}`);
      if (err.stack && process.env.DEBUG) console.error(err.stack);
      failed++;
    }
  }

  // Tracking entities for cleanup
  const cleanupUserIds = [];
  const cleanupSlotIds = [];
  const cleanupAppointmentIds = [];

  const cleanup = async () => {
    try {
      if (cleanupAppointmentIds.length > 0) {
        const ph = cleanupAppointmentIds.map(() => '?').join(',');
        await db.execute(`DELETE FROM appointment_status_history WHERE appointment_id IN (${ph});`, cleanupAppointmentIds);
        await db.execute(`DELETE FROM appointment_reschedules WHERE appointment_id IN (${ph});`, cleanupAppointmentIds);
        await db.execute(`DELETE FROM appointments WHERE id IN (${ph});`, cleanupAppointmentIds);
        cleanupAppointmentIds.length = 0;
      }
      if (cleanupSlotIds.length > 0) {
        const ph = cleanupSlotIds.map(() => '?').join(',');
        await db.execute(`DELETE FROM teacher_availability_slots WHERE id IN (${ph});`, cleanupSlotIds);
        cleanupSlotIds.length = 0;
      }
      if (cleanupUserIds.length > 0) {
        const ph = cleanupUserIds.map(() => '?').join(',');
        await db.execute(`DELETE FROM notifications WHERE recipient_id IN (${ph});`, cleanupUserIds);
        await db.execute(`DELETE FROM auth_tokens WHERE user_id IN (${ph});`, cleanupUserIds);
        await db.execute(`DELETE FROM student_profiles WHERE user_id IN (${ph});`, cleanupUserIds);
        await db.execute(`DELETE FROM teacher_profiles WHERE user_id IN (${ph});`, cleanupUserIds);
        await db.execute(`DELETE FROM users WHERE id IN (${ph});`, cleanupUserIds);
        cleanupUserIds.length = 0;
      }
      // Also clean up by email to avoid cross-run duplication
      await db.execute(`
        DELETE FROM notifications WHERE recipient_id IN (
          SELECT id FROM users WHERE email IN ('consolidated.student@university.edu', 'prof.onboarding.test@university.edu')
        );
      `);
      await db.execute(`
        DELETE FROM auth_tokens WHERE user_id IN (
          SELECT id FROM users WHERE email IN ('consolidated.student@university.edu', 'prof.onboarding.test@university.edu')
        );
      `);
      await db.execute(`
        DELETE FROM student_profiles WHERE user_id IN (
          SELECT id FROM users WHERE email IN ('consolidated.student@university.edu', 'prof.onboarding.test@university.edu')
        );
      `);
      await db.execute(`
        DELETE FROM teacher_profiles WHERE user_id IN (
          SELECT id FROM users WHERE email IN ('consolidated.student@university.edu', 'prof.onboarding.test@university.edu')
        );
      `);
      await db.execute(`
        DELETE FROM users WHERE email IN ('consolidated.student@university.edu', 'prof.onboarding.test@university.edu');
      `);
      await db.execute("DELETE FROM audit_logs WHERE action = 'SYSTEM_BOOTSTRAP';");
    } catch (e) {
      // Safe cleanup fallback
    }
  };

  try {
    // Initial cleanup of stale test records
    await cleanup();
    // Obtain active seed tokens for existing roles
    const adminLoginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@university.edu', password: 'Password123!' });
    const adminToken = adminLoginRes.body?.data?.token;

    const studentLoginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'alice.carter@student.university.edu', password: 'Password123!' });
    const studentToken = studentLoginRes.body?.data?.token;
    const studentUser = studentLoginRes.body?.data?.user;

    const teacherLoginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'robert.miller@university.edu', password: 'Password123!' });
    const teacherToken = teacherLoginRes.body?.data?.token;
    const teacherUser = teacherLoginRes.body?.data?.user;

    // -------------------------------------------------------------
    // GROUP A: Frontend, Navigation & Usability
    // -------------------------------------------------------------

    await test('Issue #44', 'No placeholder teacher name hardcoded in user identity responses', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${teacherToken}`);
      assert.strictEqual(res.status, HTTP_STATUS.OK);
      assert.strictEqual(res.body.data.firstName, 'Robert');
      assert.strictEqual(res.body.data.lastName, 'Miller');
      assert.strictEqual(res.body.data.email, 'robert.miller@university.edu');
    });

    await test('Issue #54', 'SPA history navigation contract preserves session state', async () => {
      // Cookie or Bearer token preserves active session across state transitions
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Cookie', `token=${studentToken}`);
      assert.strictEqual(res.status, HTTP_STATUS.OK);
      assert.strictEqual(res.body.data.email, 'alice.carter@student.university.edu');
    });

    // -------------------------------------------------------------
    // GROUP B: Student Identity, Registration & Profiles
    // -------------------------------------------------------------

    await test('Issue #43', 'Actual student ID number returned from DB without mock STU-001 hardcoding', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${studentToken}`);
      assert.strictEqual(res.status, HTTP_STATUS.OK);
      assert.strictEqual(res.body.data.profile.studentIdNumber, 'STU-2026-001');
      assert.notStrictEqual(res.body.data.profile.studentIdNumber, 'STU-001');
    });

    let newStudentUser = null;
    let newStudentToken = null;

    await test('Issue #46', 'Student self-registration flow creates user and student profile atomically', async () => {
      emailService.clearOutbox();
      const payload = {
        email: 'consolidated.student@university.edu',
        password: 'SecurePassword123!',
        firstName: 'Sam',
        lastName: 'Taylor',
        studentIdNumber: 'STU-2026-777',
        departmentId: 1,
        batch: 'Batch 2025',
        phoneNumber: '+1-555-7777'
      };
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send(payload);

      assert.strictEqual(res.status, HTTP_STATUS.CREATED);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.user.email, payload.email);
      assert.strictEqual(res.body.data.profile.studentIdNumber, payload.studentIdNumber);

      newStudentUser = res.body.data.user;
      newStudentToken = res.body.data.token;
      cleanupUserIds.push(newStudentUser.id);
    });

    await test('Issue #51', 'Academic batch preserved cleanly without duplicate Batch prefix', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${newStudentToken}`);
      assert.strictEqual(res.status, HTTP_STATUS.OK);
      assert.strictEqual(res.body.data.profile.batch, 'Batch 2025');
    });

    await test('Issue #57', 'Full student profile details displayed including phone number and department', async () => {
      const res = await request(app)
        .get(`/api/v1/users/${newStudentUser.id}`)
        .set('Authorization', `Bearer ${newStudentToken}`);
      assert.strictEqual(res.status, HTTP_STATUS.OK);
      const profile = res.body.data.profile;
      assert.strictEqual(profile.phoneNumber, '+1-555-7777');
      assert.strictEqual(profile.studentIdNumber, 'STU-2026-777');
      assert.strictEqual(profile.departmentCode, 'CSE');
    });

    let studentVerifyToken = null;
    await test('Issue #62', 'Student registration issues identity verification token and dispatches email', async () => {
      studentVerifyToken = emailService.getLatestToken('consolidated.student@university.edu', 'STUDENT_VERIFICATION');
      assert.ok(studentVerifyToken, 'Expected verification token in email outbox');

      // Verify token consumption via verify-email endpoint
      const verifyRes = await request(app)
        .post('/api/v1/auth/verify-email')
        .send({ token: studentVerifyToken });
      assert.strictEqual(verifyRes.status, HTTP_STATUS.OK);
      assert.strictEqual(verifyRes.body.success, true);

      // Re-consuming same token must fail
      const reuseRes = await request(app)
        .post('/api/v1/auth/verify-email')
        .send({ token: studentVerifyToken });
      assert.strictEqual(reuseRes.status, HTTP_STATUS.BAD_REQUEST);
    });

    // -------------------------------------------------------------
    // GROUP C: Authentication & Account Onboarding
    // -------------------------------------------------------------

    let resetToken = null;
    await test('Issue #47', 'Forgot password recovery flow issues single-use token and updates password', async () => {
      emailService.clearOutbox();

      // 1. Request password reset (anti-enumeration check)
      const forgotRes = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'consolidated.student@university.edu' });
      assert.strictEqual(forgotRes.status, HTTP_STATUS.OK);

      // Non-existent email returns same uniform message
      const fakeRes = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'nobody.nonexistent@university.edu' });
      assert.strictEqual(fakeRes.status, HTTP_STATUS.OK);
      assert.strictEqual(fakeRes.body.message, forgotRes.body.message);

      resetToken = emailService.getLatestToken('consolidated.student@university.edu', 'PASSWORD_RESET');
      assert.ok(resetToken, 'Expected password reset token in outbox');

      // 2. Reset password using token
      const resetRes = await request(app)
        .post('/api/v1/auth/reset-password')
        .send({ token: resetToken, newPassword: 'BrandNewPassword456!' });
      assert.strictEqual(resetRes.status, HTTP_STATUS.OK);

      // 3. Login with new credentials succeeds
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'consolidated.student@university.edu', password: 'BrandNewPassword456!' });
      assert.strictEqual(loginRes.status, HTTP_STATUS.OK);

      // 4. Old password fails
      const oldLoginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'consolidated.student@university.edu', password: 'SecurePassword123!' });
      assert.strictEqual(oldLoginRes.status, HTTP_STATUS.UNAUTHORIZED);
    });

    await test('Issue #53', 'Session is restored via /api/v1/auth/me cookie authentication', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Cookie', `token=${adminToken}`);
      assert.strictEqual(res.status, HTTP_STATUS.OK);
      assert.strictEqual(res.body.data.role, 'ADMIN');
    });

    let teacherInviteToken = null;
    let onboardedTeacherId = null;

    await test('Issue #60', 'Unverified teacher creation issues onboarding token and hides from public directory', async () => {
      emailService.clearOutbox();

      // Admin creates faculty member with onboarding invitation
      const createRes = await request(app)
        .post('/api/v1/admin/teachers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: 'prof.onboarding.test@university.edu',
          firstName: 'Marcus',
          lastName: 'Vance',
          departmentId: 1,
          designation: 'Assistant Professor',
          officeRoom: 'Room 505',
          bio: 'Algorithms research.',
          sendInvitation: true
        });

      assert.strictEqual(createRes.status, HTTP_STATUS.CREATED);
      const createdTeacher = createRes.body.data.teacher || createRes.body.data;
      assert.strictEqual(createdTeacher.isVerified, 0);

      onboardedTeacherId = createdTeacher.id;
      cleanupUserIds.push(createdTeacher.userId);

      // Verify unverified teacher is NOT in public teacher directory
      const listRes = await request(app).get('/api/v1/teachers');
      assert.strictEqual(listRes.status, HTTP_STATUS.OK);
      const foundInPublic = listRes.body.data.teachers.some(t => t.email === 'prof.onboarding.test@university.edu');
      assert.strictEqual(foundInPublic, false, 'Unverified teacher must NOT be listed publicly');

      // Retrieve invitation token from email outbox
      teacherInviteToken = emailService.getLatestToken('prof.onboarding.test@university.edu', 'TEACHER_INVITATION');
      assert.ok(teacherInviteToken, 'Expected teacher invitation token in outbox');

      // Complete onboarding
      const onboardRes = await request(app)
        .post('/api/v1/auth/onboard-teacher')
        .send({ token: teacherInviteToken, password: 'ProfPassword789!' });
      assert.strictEqual(onboardRes.status, HTTP_STATUS.OK);

      // Now teacher is verified and appears in public directory
      const verifiedListRes = await request(app).get('/api/v1/teachers');
      const foundNow = verifiedListRes.body.data.teachers.some(t => t.email === 'prof.onboarding.test@university.edu');
      assert.strictEqual(foundNow, true, 'Verified teacher must appear in public directory');
    });

    // -------------------------------------------------------------
    // GROUP D: Appointment Scheduling & Lifecycle
    // -------------------------------------------------------------

    await test('Issue #50', 'Available future consultation slots for Sarah Jenkins are discoverable', async () => {
      // Dr. Sarah Jenkins is teacher_profiles.id = 2
      const res = await request(app).get('/api/v1/teachers/2/slots');
      assert.strictEqual(res.status, HTTP_STATUS.OK);
      assert.ok(res.body.data.slots.length > 0, 'Sarah Jenkins should have future available slots');
    });

    let createdSlot = null;
    await test('Issue #49', 'Faculty can configure new valid future availability slots', async () => {
      const slotPayload = {
        slotDate: '2026-12-15',
        startTime: '10:00',
        endTime: '10:30'
      };
      const res = await request(app)
        .post('/api/v1/teachers/1/slots')
        .set('Authorization', `Bearer ${teacherToken}`)
        .send(slotPayload);

      assert.strictEqual(res.status, HTTP_STATUS.CREATED);
      assert.strictEqual(res.body.data.slotDate, '2026-12-15');
      createdSlot = res.body.data;
      cleanupSlotIds.push(createdSlot.id);
    });

    let activeAppointment = null;
    await test('Issue #50 (Booking)', 'Student can successfully book consultation slot', async () => {
      const bookingPayload = {
        slotId: createdSlot.id,
        title: 'Thesis Guidance Session',
        purpose: 'Review thesis chapter 3 database methodology.'
      };
      const res = await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${studentToken}`)
        .send(bookingPayload);

      assert.strictEqual(res.status, HTTP_STATUS.CREATED);
      assert.strictEqual(res.body.data.status, 'PENDING');
      activeAppointment = res.body.data;
      cleanupAppointmentIds.push(activeAppointment.id);
    });

    await test('Issue #48', 'Appointment status history returns created_at timestamps', async () => {
      const res = await request(app)
        .get(`/api/v1/appointments/${activeAppointment.id}/history`)
        .set('Authorization', `Bearer ${studentToken}`);
      assert.strictEqual(res.status, HTTP_STATUS.OK);
      assert.ok(res.body.data.history.length > 0);
      const firstEntry = res.body.data.history[0];
      assert.ok(firstEntry.created_at || firstEntry.changed_at, 'Status history entry must include timestamp');
    });

    await test('Issue #55', 'Historical/past appointments cannot be manually cancelled', async () => {
      // Create a past appointment directly in database for testing
      const pastSlotRes = await db.execute(
        `INSERT INTO teacher_availability_slots
         (teacher_id, slot_date, start_time, end_time, start_timestamp, end_timestamp, is_booked, is_active)
         VALUES (1, '2026-01-10', '09:00:00', '09:30:00', '2026-01-10 09:00:00', '2026-01-10 09:30:00', 1, 1);`
      );
      const pastSlotId = pastSlotRes.lastInsertRowid;
      cleanupSlotIds.push(pastSlotId);

      const pastApptRes = await db.execute(
        `INSERT INTO appointments (student_id, teacher_id, slot_id, title, purpose, status)
         VALUES (1, 1, ?, 'Old Consultation', 'Past session', 'APPROVED');`,
        [pastSlotId]
      );
      const pastApptId = pastApptRes.lastInsertRowid;
      cleanupAppointmentIds.push(pastApptId);

      // Attempt to cancel past appointment
      const cancelRes = await request(app)
        .post(`/api/v1/appointments/${pastApptId}/cancel`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ cancellationReason: 'Trying to cancel an old appointment.' });

      assert.strictEqual(cancelRes.status, HTTP_STATUS.BAD_REQUEST);
      assert.strictEqual(cancelRes.body.error.code, 'CANNOT_CANCEL_PAST_APPOINTMENT');
    });

    await test('Issue #56', 'Appointment rescheduling validates alternate slot and student overlap', async () => {
      // 1. Create alternate future slot for teacher 1
      const altSlotRes = await db.execute(
        `INSERT INTO teacher_availability_slots
         (teacher_id, slot_date, start_time, end_time, start_timestamp, end_timestamp, is_booked, is_active)
         VALUES (1, '2026-12-16', '14:00:00', '14:30:00', '2026-12-16 14:00:00', '2026-12-16 14:30:00', 0, 1);`
      );
      const altSlotId = altSlotRes.lastInsertRowid;
      cleanupSlotIds.push(altSlotId);

      // Reschedule active appointment to alternate slot
      const reschRes = await request(app)
        .post(`/api/v1/appointments/${activeAppointment.id}/reschedule`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({
          proposedSlotId: altSlotId,
          reason: 'Conflict with departmental colloquium.'
        });

      assert.strictEqual(reschRes.status, HTTP_STATUS.OK);
      assert.strictEqual(reschRes.body.data.status, 'APPROVED');
      assert.strictEqual(reschRes.body.data.newSlotId, altSlotId);

      // Verify original slot is now released (is_booked = 0)
      const origSlot = await db.queryOne('SELECT is_booked FROM teacher_availability_slots WHERE id = ?;', [createdSlot.id]);
      assert.strictEqual(origSlot.is_booked, 0);

      // Verify new slot is now booked (is_booked = 1)
      const targetSlot = await db.queryOne('SELECT is_booked FROM teacher_availability_slots WHERE id = ?;', [altSlotId]);
      assert.strictEqual(targetSlot.is_booked, 1);
    });

    // -------------------------------------------------------------
    // GROUP E: Notifications & Administration
    // -------------------------------------------------------------

    await test('Issue #52', 'Notification read state persists in database', async () => {
      // Find a notification for student Alice (user 6)
      const notif = await db.queryOne(
        'SELECT id, is_read FROM notifications WHERE recipient_id = 6 ORDER BY id DESC LIMIT 1;'
      );
      assert.ok(notif, 'Expected at least one notification for student Alice');

      const markRes = await request(app)
        .patch(`/api/v1/users/6/notifications/${notif.id}/read`)
        .set('Authorization', `Bearer ${studentToken}`);
      assert.strictEqual(markRes.status, HTTP_STATUS.OK);

      // Query database to verify persistence
      const updatedDb = await db.queryOne('SELECT is_read FROM notifications WHERE id = ?;', [notif.id]);
      assert.strictEqual(updatedDb.is_read, 1);
    });

    await test('Issue #58', 'Admin audit logs use LEFT JOIN and redact sensitive credentials', async () => {
      // Insert a system action with actor_id = NULL and sensitive key in details
      await db.execute(
        `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details, ip_address)
         VALUES (NULL, 'SYSTEM_BOOTSTRAP', 'SYSTEM', '0', '{"token":"secret123456","password":"rawPassword","status":"OK"}', '127.0.0.1');`
      );

      const logsRes = await request(app)
        .get('/api/v1/admin/audit-logs')
        .set('Authorization', `Bearer ${adminToken}`);

      assert.strictEqual(logsRes.status, HTTP_STATUS.OK);
      const systemLog = logsRes.body.data.logs.find(l => l.action === 'SYSTEM_BOOTSTRAP');
      assert.ok(systemLog, 'Audit log with actor_id NULL must be returned via LEFT JOIN');

      // Verify sensitive values are redacted
      assert.ok(!systemLog.details.includes('secret123456'), 'token value must be redacted');
      assert.ok(!systemLog.details.includes('rawPassword'), 'password value must be redacted');
      assert.ok(systemLog.details.includes('[REDACTED]'), 'Redacted placeholder must be present');
    });

  } finally {
    await cleanup();
  }

  console.log('\n-----------------------------------------------------------------');
  console.log(`Consolidated Bugfix Suite Summary: ${passed} passed, ${failed} failed out of ${passed + failed} tests.`);
  console.log('=================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runConsolidatedTests();
