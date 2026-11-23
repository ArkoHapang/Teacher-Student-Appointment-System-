/**
 * Final Integrated Acceptance Test Suite (End-to-End Scenarios A-E)
 * Phase 6 Final Release Readiness Verification
 *
 * Covers:
 * Scenario A: Complete Student Lifecycle
 * Scenario B: Complete Teacher Lifecycle
 * Scenario C: Complete Appointment Lifecycle & Feedback
 * Scenario D: Notifications, Read Persistence & Session Invalidation
 * Scenario E: Administrator Management, Audit Logs & RBAC Security
 */

require('./setup');
const assert = require('assert');
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/database');
const emailService = require('../src/services/emailService');
const authTokenService = require('../src/services/authTokenService');
const tokenService = require('../src/services/tokenService');
const HTTP_STATUS = require('../src/constants/httpStatusCodes');
const { registrationRateLimiter, loginRateLimiter } = require('../src/middlewares/rateLimiter');

async function runIntegratedAcceptanceTests() {
  console.log('\n=================================================================');
  console.log(' Final Integrated Acceptance Testing: E2E Scenarios A through E   ');
  console.log(' Environment: Local Isolated Test DB (appointment_system_test.db) ');
  console.log('=================================================================\n');

  let passed = 0;
  let failed = 0;
  const testResults = [];

  async function step(scenario, description, fn) {
    try {
      registrationRateLimiter.reset();
      loginRateLimiter.reset();
      await fn();
      console.log(`  [PASS] [${scenario}] ${description}`);
      passed++;
      testResults.push({ scenario, description, status: 'PASS' });
    } catch (err) {
      console.log(`  [FAIL] [${scenario}] ${description}`);
      console.error(`         ${err.message}`);
      if (err.stack && process.env.DEBUG) console.error(err.stack);
      failed++;
      testResults.push({ scenario, description, status: 'FAIL', error: err.message });
    }
  }

  // Cleanup tracking
  const cleanupUserIds = [];
  const cleanupSlotIds = [];
  const cleanupAppointmentIds = [];

  const cleanup = async () => {
    try {
      if (cleanupAppointmentIds.length > 0) {
        const ph = cleanupAppointmentIds.map(() => '?').join(',');
        await db.execute(`DELETE FROM feedback_ratings WHERE appointment_id IN (${ph});`, cleanupAppointmentIds);
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
      // Clean up test emails
      const testEmails = [
        'e2e.student@university.edu',
        'e2e.student2@university.edu',
        'e2e.teacher@university.edu'
      ];
      const phEmails = testEmails.map(() => '?').join(',');
      const lingeringUsers = await db.query(`SELECT id FROM users WHERE email IN (${phEmails});`, testEmails);
      if (lingeringUsers.length > 0) {
        const ids = lingeringUsers.map(u => u.id);
        const phIds = ids.map(() => '?').join(',');
        await db.execute(`DELETE FROM notifications WHERE recipient_id IN (${phIds});`, ids);
        await db.execute(`DELETE FROM auth_tokens WHERE user_id IN (${phIds});`, ids);
        await db.execute(`DELETE FROM student_profiles WHERE user_id IN (${phIds});`, ids);
        await db.execute(`DELETE FROM teacher_profiles WHERE user_id IN (${phIds});`, ids);
        await db.execute(`DELETE FROM users WHERE id IN (${phIds});`, ids);
      }
    } catch (e) {
      // safe fallback
    }
  };

  try {
    await cleanup();

    // Baseline Seed Tokens
    const adminLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@university.edu', password: 'Password123!' });
    const adminToken = adminLogin.body?.data?.token;
    assert.ok(adminToken, 'Admin authentication token acquired');

    // =========================================================================
    // SCENARIO A: Student Lifecycle
    // =========================================================================
    console.log('\n--- SCENARIO A: Student Lifecycle ---');
    let studentUser = null;
    let studentToken = null;
    let verificationToken = null;

    await step('Scenario A.1', 'Student registration validation (required fields and duplicate ID checks)', async () => {
      // 1. Missing required fields
      const badRes = await request(app)
        .post('/api/v1/auth/register')
        .send({ email: 'incomplete@university.edu' });
      assert.strictEqual(badRes.status, HTTP_STATUS.BAD_REQUEST);

      // 2. Weak password rejection
      const weakRes = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: 'weakpass@university.edu',
          password: 'simple',
          firstName: 'Weak',
          lastName: 'Pass',
          studentIdNumber: 'STU-FAIL-01',
          departmentId: 1
        });
      assert.strictEqual(weakRes.status, HTTP_STATUS.BAD_REQUEST);

      // 3. Duplicate student ID rejection against existing seed user (Alice = STU-2026-001)
      const dupIdRes = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: 'unique.email@university.edu',
          password: 'ValidPassword123!',
          firstName: 'Duplicate',
          lastName: 'ID',
          studentIdNumber: 'STU-2026-001',
          departmentId: 1
        });
      assert.strictEqual(dupIdRes.status, HTTP_STATUS.CONFLICT);
      assert.strictEqual(dupIdRes.body.error.code, 'DUPLICATE_STUDENT_ID');
    });

    await step('Scenario A.2', 'Successful student registration with student ID format verification', async () => {
      emailService.clearOutbox();
      const payload = {
        email: 'e2e.student@university.edu',
        password: 'StudentSecurePass123!',
        firstName: 'Elena',
        lastName: 'Rostova',
        studentIdNumber: 'STU-2026-901',
        departmentId: 1,
        batch: '2026',
        phoneNumber: '+1-555-0199'
      };

      const res = await request(app)
        .post('/api/v1/auth/register')
        .send(payload);

      assert.strictEqual(res.status, HTTP_STATUS.CREATED);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.user.email, payload.email);
      assert.strictEqual(res.body.data.profile.studentIdNumber, payload.studentIdNumber);
      assert.strictEqual(res.body.data.profile.batch, '2026');

      studentUser = res.body.data.user;
      studentToken = res.body.data.token;
      cleanupUserIds.push(studentUser.id);
    });

    await step('Scenario A.3', 'Email verification token creation, single-use, and resend workflow', async () => {
      verificationToken = emailService.getLatestToken('e2e.student@university.edu', 'STUDENT_VERIFICATION');
      assert.ok(verificationToken, 'Verification token generated and queued in email outbox');

      // 1. Consume token successfully
      const verifyRes = await request(app)
        .post('/api/v1/auth/verify-email')
        .send({ token: verificationToken });
      assert.strictEqual(verifyRes.status, HTTP_STATUS.OK);
      assert.strictEqual(verifyRes.body.success, true);

      // 2. Single-use enforcement: re-using the same token must fail with 400
      const reuseRes = await request(app)
        .post('/api/v1/auth/verify-email')
        .send({ token: verificationToken });
      assert.strictEqual(reuseRes.status, HTTP_STATUS.BAD_REQUEST);

      // 3. Resend verification flow
      emailService.clearOutbox();
      const resendRes = await request(app)
        .post('/api/v1/auth/resend-verification')
        .send({ email: 'e2e.student@university.edu' });
      assert.strictEqual(resendRes.status, HTTP_STATUS.OK);
      const newToken = emailService.getLatestToken('e2e.student@university.edu', 'STUDENT_VERIFICATION');
      assert.ok(newToken, 'New verification token issued upon resend request');
    });

    await step('Scenario A.4', 'Sign in, session restoration via /api/v1/auth/me, and profile update persistence', async () => {
      // 1. Authenticate with newly registered student credentials
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'e2e.student@university.edu', password: 'StudentSecurePass123!' });
      assert.strictEqual(loginRes.status, HTTP_STATUS.OK);
      const activeToken = loginRes.body.data.token;

      // 2. Restore session via /api/v1/auth/me (simulating page refresh with Bearer / Cookie)
      const meRes = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${activeToken}`);
      assert.strictEqual(meRes.status, HTTP_STATUS.OK);
      assert.strictEqual(meRes.body.data.email, 'e2e.student@university.edu');
      assert.strictEqual(meRes.body.data.profile.studentIdNumber, 'STU-2026-901');

      // 3. Update permitted profile fields
      const updateRes = await request(app)
        .patch(`/api/v1/users/${studentUser.id}`)
        .set('Authorization', `Bearer ${activeToken}`)
        .send({ firstName: 'Elena-Updated', lastName: 'Rostova-Updated' });
      assert.strictEqual(updateRes.status, HTTP_STATUS.OK);

      // 4. Logout (revokes token)
      const logoutRes = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${activeToken}`);
      assert.strictEqual(logoutRes.status, HTTP_STATUS.OK);

      // 5. Re-login and confirm profile update persisted in database
      const reLoginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'e2e.student@university.edu', password: 'StudentSecurePass123!' });
      assert.strictEqual(reLoginRes.status, HTTP_STATUS.OK);
      assert.strictEqual(reLoginRes.body.data.user.firstName, 'Elena-Updated');
      studentToken = reLoginRes.body.data.token;
    });

    // =========================================================================
    // SCENARIO B: Teacher Lifecycle
    // =========================================================================
    console.log('\n--- SCENARIO B: Teacher Lifecycle ---');
    let teacherProfileId = null;
    let teacherUserId = null;
    let teacherToken = null;
    let teacherSlotId = null;

    await step('Scenario B.1', 'Administrator creates teacher invitation; pending teacher hidden from public directory', async () => {
      emailService.clearOutbox();
      const createRes = await request(app)
        .post('/api/v1/admin/teachers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: 'e2e.teacher@university.edu',
          firstName: 'Prof. Jonathan',
          lastName: 'Hayes',
          departmentId: 1,
          designation: 'Associate Professor',
          officeRoom: 'Tech Building 402',
          bio: 'Distributed Systems & Cloud Architecture',
          sendInvitation: true
        });

      assert.strictEqual(createRes.status, HTTP_STATUS.CREATED);
      const teacherData = createRes.body.data.teacher || createRes.body.data;
      assert.strictEqual(teacherData.isVerified, 0);
      assert.strictEqual(teacherData.status, 'PENDING_APPROVAL');

      teacherProfileId = teacherData.id;
      teacherUserId = teacherData.userId;
      cleanupUserIds.push(teacherUserId);

      // Verify unverified teacher is NOT present in public directory
      const publicList = await request(app).get('/api/v1/teachers');
      assert.strictEqual(publicList.status, HTTP_STATUS.OK);
      const isVisible = publicList.body.data.teachers.some(t => t.email === 'e2e.teacher@university.edu');
      assert.strictEqual(isVisible, false, 'Unverified teacher must not be publicly visible');
    });

    await step('Scenario B.2', 'Complete teacher onboarding, set password, and verify public directory listing', async () => {
      const inviteToken = emailService.getLatestToken('e2e.teacher@university.edu', 'TEACHER_INVITATION');
      assert.ok(inviteToken, 'Teacher invitation token found in email outbox');

      // Complete onboarding
      const onboardRes = await request(app)
        .post('/api/v1/auth/onboard-teacher')
        .send({ token: inviteToken, password: 'ProfHayesPassword2026!' });
      assert.strictEqual(onboardRes.status, HTTP_STATUS.OK);

      // Confirm sign in
      const teacherLogin = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'e2e.teacher@university.edu', password: 'ProfHayesPassword2026!' });
      assert.strictEqual(teacherLogin.status, HTTP_STATUS.OK);
      assert.strictEqual(teacherLogin.body.data.user.role, 'TEACHER');
      teacherToken = teacherLogin.body.data.token;

      // Confirm publicly visible now
      const publicList = await request(app).get('/api/v1/teachers');
      assert.strictEqual(publicList.status, HTTP_STATUS.OK);
      const isVisible = publicList.body.data.teachers.some(t => t.email === 'e2e.teacher@university.edu');
      assert.strictEqual(isVisible, true, 'Onboarded teacher must now appear in public directory');
    });

    await step('Scenario B.3', 'Create availability slots with rejection of invalid, past, and overlapping slots', async () => {
      // 1. Reject past slot
      const pastSlotRes = await request(app)
        .post(`/api/v1/teachers/${teacherProfileId}/slots`)
        .set('Authorization', `Bearer ${teacherToken}`)
        .send({ slotDate: '2024-01-01', startTime: '10:00', endTime: '10:30' });
      assert.strictEqual(pastSlotRes.status, HTTP_STATUS.BAD_REQUEST);

      // 2. Reject invalid duration (< 10 minutes)
      const shortSlotRes = await request(app)
        .post(`/api/v1/teachers/${teacherProfileId}/slots`)
        .set('Authorization', `Bearer ${teacherToken}`)
        .send({ slotDate: '2026-12-10', startTime: '10:00', endTime: '10:05' });
      assert.strictEqual(shortSlotRes.status, HTTP_STATUS.BAD_REQUEST);

      // 3. Create valid future slot A (10:00 - 10:30)
      const slotARes = await request(app)
        .post(`/api/v1/teachers/${teacherProfileId}/slots`)
        .set('Authorization', `Bearer ${teacherToken}`)
        .send({ slotDate: '2026-12-10', startTime: '10:00', endTime: '10:30' });
      assert.strictEqual(slotARes.status, HTTP_STATUS.CREATED);
      teacherSlotId = slotARes.body.data.id;
      cleanupSlotIds.push(teacherSlotId);

      // 4. Reject overlapping slot (10:15 - 10:45)
      const overlapRes = await request(app)
        .post(`/api/v1/teachers/${teacherProfileId}/slots`)
        .set('Authorization', `Bearer ${teacherToken}`)
        .send({ slotDate: '2026-12-10', startTime: '10:15', endTime: '10:45' });
      assert.strictEqual(overlapRes.status, HTTP_STATUS.CONFLICT);

      // 5. Create valid non-overlapping slot B for rescheduling (11:00 - 11:30)
      const slotBRes = await request(app)
        .post(`/api/v1/teachers/${teacherProfileId}/slots`)
        .set('Authorization', `Bearer ${teacherToken}`)
        .send({ slotDate: '2026-12-10', startTime: '11:00', endTime: '11:30' });
      assert.strictEqual(slotBRes.status, HTTP_STATUS.CREATED);
      cleanupSlotIds.push(slotBRes.body.data.id);

      // 6. Confirm future availability appears in student booking discovery
      const studentSlotsRes = await request(app)
        .get(`/api/v1/teachers/${teacherProfileId}/slots`)
        .set('Authorization', `Bearer ${studentToken}`);
      assert.strictEqual(studentSlotsRes.status, HTTP_STATUS.OK);
      assert.strictEqual(studentSlotsRes.body.data.slots.length, 2);
    });

    // =========================================================================
    // SCENARIO C: Appointment Lifecycle
    // =========================================================================
    console.log('\n--- SCENARIO C: Appointment Lifecycle ---');
    let appointmentId = null;

    // Second student for double-booking check
    let student2Token = null;
    await step('Scenario C.1', 'Book appointment as student and verify double-booking prevention', async () => {
      // Register second student
      const s2Reg = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: 'e2e.student2@university.edu',
          password: 'Student2Password123!',
          firstName: 'Marcus',
          lastName: 'Brody',
          studentIdNumber: 'STU-2026-902',
          departmentId: 1
        });
      assert.strictEqual(s2Reg.status, HTTP_STATUS.CREATED);
      student2Token = s2Reg.body.data.token;
      cleanupUserIds.push(s2Reg.body.data.user.id);

      // Student 1 books slot A
      const bookRes = await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({
          slotId: teacherSlotId,
          title: 'Distributed Consensus Guidance',
          purpose: 'Discuss Raft consensus implementation in course project.'
        });
      assert.strictEqual(bookRes.status, HTTP_STATUS.CREATED);
      assert.strictEqual(bookRes.body.data.status, 'PENDING');
      assert.strictEqual(bookRes.body.data.slotId, teacherSlotId);
      appointmentId = bookRes.body.data.id;
      cleanupAppointmentIds.push(appointmentId);

      // Student 2 attempts to double-book the exact same slot -> MUST FAIL 409
      const doubleBookRes = await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${student2Token}`)
        .send({
          slotId: teacherSlotId,
          title: 'Concurrent Attempt',
          purpose: 'Should be rejected by atomic slot lock.'
        });
      assert.strictEqual(doubleBookRes.status, HTTP_STATUS.CONFLICT);
    });

    await step('Scenario C.2', 'Teacher approval, status history timestamps, and notifications', async () => {
      // Teacher approves appointment
      const approveRes = await request(app)
        .post(`/api/v1/appointments/${appointmentId}/approve`)
        .set('Authorization', `Bearer ${teacherToken}`)
        .send({ notes: 'Please bring your architecture diagram.' });
      assert.strictEqual(approveRes.status, HTTP_STATUS.OK);
      assert.strictEqual(approveRes.body.data.status, 'APPROVED');

      // Verify status transition history includes timestamps
      const histRes = await request(app)
        .get(`/api/v1/appointments/${appointmentId}/history`)
        .set('Authorization', `Bearer ${studentToken}`);
      assert.strictEqual(histRes.status, HTTP_STATUS.OK);
      assert.ok(histRes.body.data.history.length >= 2);
      const latestTransition = histRes.body.data.history[0];
      assert.ok(latestTransition.created_at || latestTransition.changed_at, 'Status transition must contain timestamp');
    });

    await step('Scenario C.3', 'Rescheduling, conflict detection, and past cancellation rules', async () => {
      // Find teacher slot B (11:00 - 11:30)
      const slots = await db.query(
        'SELECT id FROM teacher_availability_slots WHERE teacher_id = ? AND id != ? ORDER BY id ASC;',
        [teacherProfileId, teacherSlotId]
      );
      assert.ok(slots.length > 0, 'Alternative slot exists');
      const alternateSlotId = slots[0].id;

      // Reschedule appointment to slot B
      const reschedRes = await request(app)
        .post(`/api/v1/appointments/${appointmentId}/reschedule`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ proposedSlotId: alternateSlotId, reason: 'Conflict with laboratory class schedule' });
      assert.strictEqual(reschedRes.status, HTTP_STATUS.OK);

      // Slot A should now be released back to unbooked
      const slotARow = await db.queryOne('SELECT is_booked FROM teacher_availability_slots WHERE id = ?;', [teacherSlotId]);
      assert.strictEqual(slotARow.is_booked, 0, 'Original slot must be released upon reschedule');

      // Create a past appointment to test past cancellation guard
      const pastSlotRes = await db.execute(
        `INSERT INTO teacher_availability_slots (teacher_id, slot_date, start_time, end_time, start_timestamp, end_timestamp, is_booked, is_active)
         VALUES (?, '2020-01-01', '10:00:00', '10:30:00', '2020-01-01 10:00:00', '2020-01-01 10:30:00', 1, 1);`,
        [teacherProfileId]
      );
      const pastSlotId = pastSlotRes.lastInsertRowid;
      cleanupSlotIds.push(pastSlotId);

      const pastApptRes = await db.execute(
        `INSERT INTO appointments (student_id, teacher_id, slot_id, title, purpose, status)
         VALUES (?, ?, ?, 'Past Session', 'Historical meeting', 'APPROVED');`,
        [(await db.queryOne('SELECT id FROM student_profiles WHERE user_id = ?;', [studentUser.id])).id, teacherProfileId, pastSlotId]
      );
      const pastApptId = pastApptRes.lastInsertRowid;
      cleanupAppointmentIds.push(pastApptId);

      // Attempt to cancel past appointment -> MUST BE REJECTED 400
      const cancelPastRes = await request(app)
        .post(`/api/v1/appointments/${pastApptId}/cancel`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ cancellationReason: 'Trying to cancel an old consultation' });
      assert.strictEqual(cancelPastRes.status, HTTP_STATUS.BAD_REQUEST);
      assert.strictEqual(cancelPastRes.body.error.code, 'CANNOT_CANCEL_PAST_APPOINTMENT');
    });

    await step('Scenario C.4', 'Complete appointment and submit feedback rating', async () => {
      // Teacher completes appointment
      const completeRes = await request(app)
        .post(`/api/v1/appointments/${appointmentId}/complete`)
        .set('Authorization', `Bearer ${teacherToken}`);
      assert.strictEqual(completeRes.status, HTTP_STATUS.OK);
      assert.strictEqual(completeRes.body.data.status, 'COMPLETED');

      // Student submits 5-star feedback
      const feedbackRes = await request(app)
        .post(`/api/v1/appointments/${appointmentId}/feedback`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ rating: 5, comments: 'Exceptional guidance on distributed system consensus.' });
      assert.strictEqual(feedbackRes.status, HTTP_STATUS.CREATED);
      assert.strictEqual(feedbackRes.body.data.rating, 5);

      // Duplicate feedback must be rejected (UNIQUE constraint)
      const dupFeedbackRes = await request(app)
        .post(`/api/v1/appointments/${appointmentId}/feedback`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ rating: 4, comments: 'Second feedback attempt' });
      assert.strictEqual(dupFeedbackRes.status, HTTP_STATUS.CONFLICT);
    });

    // =========================================================================
    // SCENARIO D: Notifications and Sessions
    // =========================================================================
    console.log('\n--- SCENARIO D: Notifications and Sessions ---');

    await step('Scenario D.1', 'Real workflow notifications generated and read status persisted', async () => {
      // Retrieve student notifications (created from approval/rescheduling/completion)
      const notifsRes = await request(app)
        .get(`/api/v1/users/${studentUser.id}/notifications`)
        .set('Authorization', `Bearer ${studentToken}`);
      assert.strictEqual(notifsRes.status, HTTP_STATUS.OK);
      assert.ok(notifsRes.body.data.notifications.length > 0, 'Student should have received notifications');

      const unreadNotif = notifsRes.body.data.notifications.find(n => !n.isRead || n.isRead === 0 || n.is_read === 0);
      assert.ok(unreadNotif, 'Should have at least one unread notification');

      // Mark notification as read
      const markRes = await request(app)
        .patch(`/api/v1/users/${studentUser.id}/notifications/${unreadNotif.id}/read`)
        .set('Authorization', `Bearer ${studentToken}`);
      assert.strictEqual(markRes.status, HTTP_STATUS.OK);

      // Verify persistence directly in database
      const dbNotif = await db.queryOne('SELECT is_read FROM notifications WHERE id = ?;', [unreadNotif.id]);
      assert.strictEqual(dbNotif.is_read, 1);
    });

    await step('Scenario D.2', 'Session invalidation on logout and protected route enforcement', async () => {
      // Logout student
      const logoutRes = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${studentToken}`);
      assert.strictEqual(logoutRes.status, HTTP_STATUS.OK);

      // Attempting to access protected endpoint with revoked token must fail with 401
      const failRes = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${studentToken}`);
      assert.strictEqual(failRes.status, HTTP_STATUS.UNAUTHORIZED);
    });

    // =========================================================================
    // SCENARIO E: Administrator Workflows & Security
    // =========================================================================
    console.log('\n--- SCENARIO E: Administrator Workflows & Security ---');

    await step('Scenario E.1', 'Administrator management views, audit logs with nullable actors, and credential redaction', async () => {
      // 1. Inspect user list
      const usersRes = await request(app)
        .get('/api/v1/admin/users')
        .set('Authorization', `Bearer ${adminToken}`);
      assert.strictEqual(usersRes.status, HTTP_STATUS.OK);
      assert.ok(usersRes.body.data.users.length >= 3);

      // 2. Insert system-level audit record with actor_id = NULL (testing Migration 006)
      await db.execute(`
        INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details, ip_address)
        VALUES (NULL, 'SYSTEM_ACCEPTANCE_TEST', 'SYSTEM', '0', '{"token":"acceptance-secret-token","password":"acceptancePassword123!","metric":"100%"}', '127.0.0.1');
      `);

      // 3. Inspect audit logs
      const auditRes = await request(app)
        .get('/api/v1/admin/audit-logs')
        .set('Authorization', `Bearer ${adminToken}`);
      assert.strictEqual(auditRes.status, HTTP_STATUS.OK);

      const sysLog = auditRes.body.data.logs.find(l => l.action === 'SYSTEM_ACCEPTANCE_TEST');
      assert.ok(sysLog, 'Audit log with actor_id NULL returned via LEFT JOIN');
      assert.strictEqual(sysLog.actor_id, null);

      // 4. Verify sensitive credential redaction
      assert.ok(!sysLog.details.includes('acceptance-secret-token'), 'Sensitive token must be redacted');
      assert.ok(!sysLog.details.includes('acceptancePassword123!'), 'Sensitive password must be redacted');
      assert.ok(sysLog.details.includes('[REDACTED]'), 'Must include [REDACTED] placeholder');

      await db.execute("DELETE FROM audit_logs WHERE action = 'SYSTEM_ACCEPTANCE_TEST';");
    });

    await step('Scenario E.2', 'RBAC Security: Unauthorized users blocked from administrative endpoints', async () => {
      // Teacher Hayes cannot view administrative audit logs
      const teacherAuditRes = await request(app)
        .get('/api/v1/admin/audit-logs')
        .set('Authorization', `Bearer ${teacherToken}`);
      assert.strictEqual(teacherAuditRes.status, HTTP_STATUS.FORBIDDEN);

      // Teacher cannot access admin user catalog
      const teacherUsersRes = await request(app)
        .get('/api/v1/admin/users')
        .set('Authorization', `Bearer ${teacherToken}`);
      assert.strictEqual(teacherUsersRes.status, HTTP_STATUS.FORBIDDEN);
    });

  } finally {
    await cleanup();
  }

  console.log('\n-----------------------------------------------------------------');
  console.log(`Integrated Acceptance Suite Summary: ${passed} passed, ${failed} failed out of ${passed + failed} steps.`);
  console.log('=================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runIntegratedAcceptanceTests();
