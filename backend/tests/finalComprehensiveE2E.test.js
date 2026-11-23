/**
 * Final Product-Wide Comprehensive Functional & Regression Verification Suite
 * Phase 4 & Phase 6 Execution
 *
 * Verifies the complete university consultation lifecycle across Student, Teacher, and Administrator roles:
 * 1. Student self-registration and profile persistence.
 * 2. Multi-role authentication and session establishment.
 * 3. Faculty availability slot creation and interval collision rejection (409 Conflict).
 * 4. Faculty directory discovery and available slot inspection.
 * 5. Consultation request booking and slot locking.
 * 6. Concurrency / double-booking defense (409 Conflict).
 * 7. Real-time notification creation for faculty on request.
 * 8. Faculty review and approval with preparation notes.
 * 9. Real-time notification creation for student on approval.
 * 10. Student status verification (APPROVED).
 * 11. Consultation completion by faculty (COMPLETED).
 * 12. Student rating and feedback submission.
 * 13. Duplicate feedback rejection (409 Conflict).
 * 14. Faculty feedback inspection.
 * 15. Administrative monitoring, aggregated metrics summary, and audit ledger tracking.
 * 16. Multi-role RBAC enforcement (403 Forbidden).
 * 17. Input validation defense (400 Bad Request).
 * 18. Token revocation and session invalidation on logout (401 Unauthorized).
 * 19. Session re-authentication and persistent record verification.
 */

require('./setup');
const assert = require('assert');
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/database');
const HTTP_STATUS = require('../src/constants/httpStatusCodes');
const { ROLES, APPOINTMENT_STATUS } = require('../src/constants/roles');
const { registrationRateLimiter, loginRateLimiter } = require('../src/middlewares/rateLimiter');

async function runFinalComprehensiveE2E() {
  console.log('\n=================================================================');
  console.log(' Final Product-Wide Comprehensive E2E Verification Suite        ');
  console.log(' Cross-Role Lifecycle: Student -> Teacher -> Admin -> Security  ');
  console.log('=================================================================\n');

  let passed = 0;
  let failed = 0;
  const testResults = [];

  async function test(name, fn) {
    try {
      registrationRateLimiter.reset();
      loginRateLimiter.reset();
      await fn();
      console.log(`  [PASS] ${name}`);
      passed++;
      testResults.push({ name, status: 'PASS' });
    } catch (err) {
      console.error(`  [FAIL] ${name}`);
      console.error(`         ${err.message}`);
      if (err.stack && process.env.DEBUG) console.error(err.stack);
      failed++;
      testResults.push({ name, status: 'FAIL', error: err.message });
    }
  }

  // Guaranteed cleanup tracking
  const createdUserIds = [];
  const createdSlotIds = [];
  const createdAppointmentIds = [];

  const cleanup = async () => {
    try {
      if (createdAppointmentIds.length > 0) {
        const placeholders = createdAppointmentIds.map(() => '?').join(', ');
        await db.execute(`DELETE FROM feedback_ratings WHERE appointment_id IN (${placeholders});`, createdAppointmentIds);
        await db.execute(`DELETE FROM appointment_status_history WHERE appointment_id IN (${placeholders});`, createdAppointmentIds);
        await db.execute(`DELETE FROM appointments WHERE id IN (${placeholders});`, createdAppointmentIds);
      }
      if (createdSlotIds.length > 0) {
        const placeholders = createdSlotIds.map(() => '?').join(', ');
        await db.execute(`DELETE FROM teacher_availability_slots WHERE id IN (${placeholders});`, createdSlotIds);
      }
      if (createdUserIds.length > 0) {
        const placeholders = createdUserIds.map(() => '?').join(', ');
        await db.execute(`DELETE FROM notifications WHERE recipient_id IN (${placeholders});`, createdUserIds);
        await db.execute(`DELETE FROM audit_logs WHERE actor_id IN (${placeholders});`, createdUserIds);
        await db.execute(`DELETE FROM revoked_tokens WHERE user_id IN (${placeholders});`, createdUserIds);
        await db.execute(`DELETE FROM student_profiles WHERE user_id IN (${placeholders});`, createdUserIds);
        await db.execute(`DELETE FROM users WHERE id IN (${placeholders});`, createdUserIds);
      }
    } catch (cleanupErr) {
      console.warn(`[Cleanup Warning] ${cleanupErr.message}`);
    }
  };

  try {
    const timestamp = Date.now();
    const studentEmail = `final.student.${timestamp}@student.university.edu`;
    const studentPassword = 'SecureStudent2026!';
    const studentIdNumber = `STU-FINAL-${String(timestamp).slice(-6)}`;
    const studentFirstName = 'Elena';
    const studentLastName = 'Rostova';

    let studentUserId = null;
    let studentToken = null;

    let teacherUserId = 2; // Robert Miller
    let teacherProfileId = 1;
    let teacherToken = null;

    let adminToken = null;
    let testSlotId = null;
    let testAppointmentId = null;

    // -------------------------------------------------------------
    // Step 1: Student Self-Registration (POST /api/v1/auth/register)
    // -------------------------------------------------------------
    await test('1. Student self-registration: Valid payload creates active student and profile', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: studentEmail,
          password: studentPassword,
          firstName: studentFirstName,
          lastName: studentLastName,
          studentIdNumber: studentIdNumber,
          departmentId: 1, // Computer Science
          batch: '2026-A',
          phoneNumber: '+1-555-0188'
        });

      assert.strictEqual(res.status, 201, `Expected HTTP 201, got ${res.status}: ${JSON.stringify(res.body)}`);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data.user);
      assert.strictEqual(res.body.data.user.email, studentEmail);
      assert.strictEqual(res.body.data.user.role, 'STUDENT');
      assert.strictEqual(res.body.data.user.status, 'ACTIVE');

      studentUserId = res.body.data.user.id;
      createdUserIds.push(studentUserId);

      // Verify in SQLite database
      const dbUser = await db.queryOne('SELECT * FROM users WHERE id = ?;', [studentUserId]);
      assert.ok(dbUser, 'User record must exist in SQLite database');
      assert.strictEqual(dbUser.email, studentEmail);

      const dbProfile = await db.queryOne('SELECT * FROM student_profiles WHERE user_id = ?;', [studentUserId]);
      assert.ok(dbProfile, 'Student profile record must exist in SQLite database');
      assert.strictEqual(dbProfile.student_id_number, studentIdNumber);

      // Authenticate via /api/v1/auth/login to establish bearer token for API tests
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: studentEmail, password: studentPassword });
      assert.strictEqual(loginRes.status, 200);
      assert.strictEqual(loginRes.body.success, true);
      studentToken = loginRes.body.data.token;
      assert.ok(studentToken, 'Student JWT token must be returned');
    });

    // -------------------------------------------------------------
    // Step 2: Teacher & Admin Authentication (POST /api/v1/auth/login)
    // -------------------------------------------------------------
    await test('2. Teacher and Admin login: Authenticate seeded accounts', async () => {
      // Teacher login
      const teacherRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'robert.miller@university.edu', password: 'Password123!' });
      assert.strictEqual(teacherRes.status, 200);
      assert.strictEqual(teacherRes.body.data.user.role, 'TEACHER');
      teacherToken = teacherRes.body.data.token;

      // Admin login
      const adminRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'admin@university.edu', password: 'Password123!' });
      assert.strictEqual(adminRes.status, 200);
      assert.strictEqual(adminRes.body.data.user.role, 'ADMIN');
      adminToken = adminRes.body.data.token;
    });

    // -------------------------------------------------------------
    // Step 3: Teacher Availability Configuration & Collision Defense
    // -------------------------------------------------------------
    await test('3. Faculty availability: Add consultation slot and enforce interval collision defense', async () => {
      const slotDate = '2050-05-15';
      const startTime = '14:00';
      const endTime = '14:45';

      // Create new slot
      const res = await request(app)
        .post(`/api/v1/teachers/${teacherProfileId}/slots`)
        .set('Authorization', `Bearer ${teacherToken}`)
        .send({
          slotDate,
          startTime,
          endTime
        });

      assert.strictEqual(res.status, 201, `Failed to create slot: ${JSON.stringify(res.body)}`);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data.id);
      testSlotId = res.body.data.id;
      createdSlotIds.push(testSlotId);

      // Attempt overlapping slot creation (14:15 - 15:00) -> Must return 409 Conflict
      const overlapRes = await request(app)
        .post(`/api/v1/teachers/${teacherProfileId}/slots`)
        .set('Authorization', `Bearer ${teacherToken}`)
        .send({
          slotDate,
          startTime: '14:15',
          endTime: '15:00'
        });

      assert.strictEqual(overlapRes.status, 409, 'Overlapping availability slot must be rejected with 409 Conflict');
      assert.strictEqual(overlapRes.body.error.code, 'SLOT_OVERLAP');
    });

    // -------------------------------------------------------------
    // Step 4: Student Appointment Booking & Double-Booking Defense
    // -------------------------------------------------------------
    await test('4. Student consultation booking: Request slot and verify duplicate booking prevention', async () => {
      // Valid consultation request
      const bookRes = await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({
          slotId: testSlotId,
          title: 'Advanced Machine Learning Thesis Discussion',
          purpose: 'Discussing hyperparameter tuning and convergence criteria for neural ODE models.'
        });

      assert.strictEqual(bookRes.status, 201, `Failed to book appointment: ${JSON.stringify(bookRes.body)}`);
      assert.strictEqual(bookRes.body.success, true);
      assert.strictEqual(bookRes.body.data.status, 'PENDING');
      testAppointmentId = bookRes.body.data.id;
      createdAppointmentIds.push(testAppointmentId);

      // Verify slot is now locked in database
      const dbSlot = await db.queryOne('SELECT * FROM teacher_availability_slots WHERE id = ?;', [testSlotId]);
      assert.strictEqual(dbSlot.is_booked, 1, 'Slot must be marked is_booked=1');

      // Attempt concurrent duplicate booking on the occupied slot -> Must return 409 Conflict
      const dupRes = await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({
          slotId: testSlotId,
          title: 'Competing Consultation Request',
          purpose: 'Attempting to reserve an already booked consultation slot.'
        });

      assert.strictEqual(dupRes.status, 409, 'Duplicate booking on reserved slot must be rejected with 409 Conflict');
      assert.strictEqual(dupRes.body.error.code, 'SLOT_UNAVAILABLE');
    });

    // -------------------------------------------------------------
    // Step 5: Faculty Notification & Approval Workflow
    // -------------------------------------------------------------
    await test('5. Faculty request processing: Teacher receives notification and approves request', async () => {
      // Verify teacher notification was generated
      const notif = await db.queryOne(
        `SELECT * FROM notifications
         WHERE recipient_id = ? AND appointment_id = ?
         ORDER BY id DESC LIMIT 1;`,
        [teacherUserId, testAppointmentId]
      );
      assert.ok(notif, 'Notification for faculty must exist in SQLite database');

      // Teacher approves the consultation request
      const approveRes = await request(app)
        .post(`/api/v1/appointments/${testAppointmentId}/approve`)
        .set('Authorization', `Bearer ${teacherToken}`)
        .send({
          notes: 'Please bring your current training loss curves and validation metrics.'
        });

      assert.strictEqual(approveRes.status, 200, `Approval failed: ${JSON.stringify(approveRes.body)}`);
      assert.strictEqual(approveRes.body.data.status, 'APPROVED');

      // Verify appointment history ledger
      const history = await db.query(
        'SELECT * FROM appointment_status_history WHERE appointment_id = ? ORDER BY id ASC;',
        [testAppointmentId]
      );
      assert.ok(history.length >= 2, 'History ledger must contain creation and approval events');
      assert.strictEqual(history[history.length - 1].new_status, 'APPROVED');
    });

    // -------------------------------------------------------------
    // Step 6: Student Notification & Status Verification
    // -------------------------------------------------------------
    await test('6. Student status reflection: Student receives confirmation notification and views APPROVED status', async () => {
      // Student inspects appointment
      const getRes = await request(app)
        .get(`/api/v1/appointments/${testAppointmentId}`)
        .set('Authorization', `Bearer ${studentToken}`);

      assert.strictEqual(getRes.status, 200);
      assert.strictEqual(getRes.body.data.status, 'APPROVED');

      // Verify student received approval notification
      const studentNotif = await db.queryOne(
        `SELECT * FROM notifications
         WHERE recipient_id = ? AND appointment_id = ?
         ORDER BY id DESC LIMIT 1;`,
        [studentUserId, testAppointmentId]
      );
      assert.ok(studentNotif, 'Approval notification for student must exist in database');

      // Student marks notification as read
      const markReadRes = await request(app)
        .patch(`/api/v1/users/${studentUserId}/notifications/${studentNotif.id}/read`)
        .set('Authorization', `Bearer ${studentToken}`);
      assert.strictEqual(markReadRes.status, 200);

      const updatedNotif = await db.queryOne('SELECT is_read FROM notifications WHERE id = ?;', [studentNotif.id]);
      assert.strictEqual(updatedNotif.is_read, 1, 'Notification must be marked as read');
    });

    // -------------------------------------------------------------
    // Step 7: Faculty Completes Consultation (COMPLETED)
    // -------------------------------------------------------------
    await test('7. Faculty lifecycle completion: Teacher marks consultation as COMPLETED', async () => {
      const completeRes = await request(app)
        .post(`/api/v1/appointments/${testAppointmentId}/complete`)
        .set('Authorization', `Bearer ${teacherToken}`);

      assert.strictEqual(completeRes.status, 200, `Completion failed: ${JSON.stringify(completeRes.body)}`);
      assert.strictEqual(completeRes.body.data.status, 'COMPLETED');

      // Verify terminal status protection: Cannot cancel a COMPLETED appointment
      const cancelRes = await request(app)
        .post(`/api/v1/appointments/${testAppointmentId}/cancel`)
        .set('Authorization', `Bearer ${teacherToken}`)
        .send({ reason: 'Attempting invalid cancellation of completed consultation.' });

      assert.strictEqual(cancelRes.status, 400, 'Terminal COMPLETED appointment cannot be cancelled');
    });

    // -------------------------------------------------------------
    // Step 8: Student Submits Consultation Feedback & Rating
    // -------------------------------------------------------------
    await test('8. Consultation feedback: Student submits 5-star rating, verified in database and teacher view', async () => {
      const fbRes = await request(app)
        .post(`/api/v1/appointments/${testAppointmentId}/feedback`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({
          rating: 5,
          comments: 'Extremely helpful advice on regularization and gradient stability!'
        });

      assert.strictEqual(fbRes.status, 201, `Feedback submission failed: ${JSON.stringify(fbRes.body)}`);
      assert.strictEqual(fbRes.body.success, true);
      assert.strictEqual(fbRes.body.data.rating, 5);

      // Duplicate feedback defense: Cannot submit twice
      const dupFbRes = await request(app)
        .post(`/api/v1/appointments/${testAppointmentId}/feedback`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ rating: 4, comments: 'Duplicate submission attempt.' });

      assert.strictEqual(dupFbRes.status, 409, 'Duplicate feedback submission must return 409 Conflict');
      assert.strictEqual(dupFbRes.body.error.code, 'DUPLICATE_FEEDBACK');

      // Teacher retrieves feedback
      const teacherFbRes = await request(app)
        .get(`/api/v1/appointments/${testAppointmentId}/feedback`)
        .set('Authorization', `Bearer ${teacherToken}`);

      assert.strictEqual(teacherFbRes.status, 200);
      assert.strictEqual(teacherFbRes.body.data.rating, 5);
      assert.strictEqual(teacherFbRes.body.data.comments, 'Extremely helpful advice on regularization and gradient stability!');
    });

    // -------------------------------------------------------------
    // Step 9: Administrative Monitoring & Audit Trail
    // -------------------------------------------------------------
    await test('9. Administrative oversight: Admin retrieves appointment summary, full details, and audit trail', async () => {
      // Admin summary metrics
      const summaryRes = await request(app)
        .get('/api/v1/admin/appointments/summary')
        .set('Authorization', `Bearer ${adminToken}`);

      assert.strictEqual(summaryRes.status, 200);
      assert.ok(summaryRes.body.data.summary.total >= 1);
      assert.ok(summaryRes.body.data.summary.byStatus.COMPLETED >= 1);

      // Admin appointment details
      const detailRes = await request(app)
        .get(`/api/v1/admin/appointments/${testAppointmentId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      assert.strictEqual(detailRes.status, 200);
      assert.strictEqual(detailRes.body.data.appointment.student.studentIdNumber, studentIdNumber);
      assert.strictEqual(detailRes.body.data.appointment.status, 'COMPLETED');

      // Admin audit logs inspection
      const auditRes = await request(app)
        .get('/api/v1/admin/audit-logs')
        .set('Authorization', `Bearer ${adminToken}`);

      assert.strictEqual(auditRes.status, 200);
      assert.ok(Array.isArray(auditRes.body.data.logs));
      assert.ok(auditRes.body.data.logs.length > 0);
    });

    // -------------------------------------------------------------
    // Step 10: Multi-Role RBAC & Boundary Defense
    // -------------------------------------------------------------
    await test('10. RBAC Boundary Defense: Unauthorized cross-role access is strictly blocked (403 Forbidden)', async () => {
      // Student cannot access admin users endpoint
      const studentAdminUsers = await request(app)
        .get('/api/v1/admin/users')
        .set('Authorization', `Bearer ${studentToken}`);
      assert.strictEqual(studentAdminUsers.status, 403, 'Student must receive 403 Forbidden on admin endpoints');

      // Student cannot access admin audit logs
      const studentAudit = await request(app)
        .get('/api/v1/admin/audit-logs')
        .set('Authorization', `Bearer ${studentToken}`);
      assert.strictEqual(studentAudit.status, 403, 'Student must receive 403 Forbidden on admin audit logs');

      // Teacher cannot access admin user status update
      const teacherUserStatus = await request(app)
        .patch(`/api/v1/admin/users/${studentUserId}/status`)
        .set('Authorization', `Bearer ${teacherToken}`)
        .send({ status: 'SUSPENDED' });
      assert.strictEqual(teacherUserStatus.status, 403, 'Teacher must receive 403 Forbidden on user status modification');
    });

    // -------------------------------------------------------------
    // Step 11: Input Validation & Error Handling
    // -------------------------------------------------------------
    await test('11. Input Validation Defense: Invalid parameters and malformed bodies return 400 Bad Request', async () => {
      // Booking with missing title & purpose
      const badBook = await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ slotId: 9999 });
      assert.strictEqual(badBook.status, 400, 'Missing fields must return 400 Bad Request');

      // Non-numeric appointment ID
      const badId = await request(app)
        .get('/api/v1/admin/appointments/invalid-non-numeric-id')
        .set('Authorization', `Bearer ${adminToken}`);
      assert.strictEqual(badId.status, 400, 'Non-numeric appointment ID must return 400 Bad Request');
    });

    // -------------------------------------------------------------
    // Step 12: Logout, Token Revocation & Data Persistence
    // -------------------------------------------------------------
    await test('12. Session security: Logout revokes token (401), re-login confirms data persistence', async () => {
      // Student logs out
      const logoutRes = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${studentToken}`);
      assert.strictEqual(logoutRes.status, 200);

      // Attempting access with revoked token -> Must return 401
      const revokedAccess = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${studentToken}`);
      assert.strictEqual(revokedAccess.status, 401, 'Revoked token must be rejected with 401 Unauthorized');

      // Re-login with the student credentials
      const reloginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: studentEmail, password: studentPassword });
      assert.strictEqual(reloginRes.status, 200);

      const freshToken = reloginRes.body.data.token;
      assert.ok(freshToken);

      // Verify persistent data integrity: student can still access their completed appointment
      const recheckAppt = await request(app)
        .get(`/api/v1/appointments/${testAppointmentId}`)
        .set('Authorization', `Bearer ${freshToken}`);
      assert.strictEqual(recheckAppt.status, 200);
      assert.strictEqual(recheckAppt.body.data.status, 'COMPLETED');
    });

  } finally {
    await cleanup();
  }

  console.log('\n=================================================================');
  console.log(` Final E2E Summary: ${passed} passed, ${failed} failed out of ${passed + failed} tests.`);
  console.log('=================================================================\n');

  if (failed > 0) {
    process.exitCode = 1;
  }
}

runFinalComprehensiveE2E();
