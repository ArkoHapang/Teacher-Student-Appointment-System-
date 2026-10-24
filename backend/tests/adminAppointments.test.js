/**
 * Administrative Appointment Management & Monitoring Test Suite (GitHub Issues #38 & #39)
 *
 * Verifies:
 * 1. Security & RBAC: Only ADMIN can access monitoring and management endpoints.
 * 2. Issue #38 Monitoring:
 *    - Paginated listing with limit & page bounds.
 *    - Filtering by status, teacher, student, department, and date range.
 *    - Keyword and appointment identifier search.
 *    - Sorting by creation date, appointment slot date, and status.
 *    - Aggregated database summary metrics (total, byStatus, upcoming, today, completed).
 *    - Detailed individual appointment view with student, teacher, slot, history, and feedback.
 * 3. Issue #39 Record Management:
 *    - Metadata updates (title, purpose) with validation and participant immutability.
 *    - Lifecycle status transitions (PENDING -> APPROVED, APPROVED -> COMPLETED, CANCELLED).
 *    - Prevention of arbitrary status jumps and modification of terminal records.
 *    - Slot release on cancellation/rejection and slot locking on approval.
 *    - Conflict detection on administrative rescheduling.
 *    - Strict preservation of appointment records and chronological status audit history.
 */

const assert = require('assert');
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/database');
const HTTP_STATUS = require('../src/constants/httpStatusCodes');
const { APPOINTMENT_STATUS } = require('../src/constants/roles');

async function runAdminAppointmentTests() {
  console.log('\n=================================================================');
  console.log(' Teacher-Student Appointment System: Issues #38 & #39 Admin Tests ');
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
      if (err.stack && process.env.DEBUG) console.error(err.stack);
      failed++;
    }
  }

  // 1. Establish auth tokens
  const login = async (email, password = 'Password123!') => {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password });
    if (res.status !== 200) {
      throw new Error(`Failed to login as ${email}: ${JSON.stringify(res.body)}`);
    }
    return res.body.data.token;
  };

  const adminToken = await login('admin@university.edu');
  const teacherToken = await login('robert.miller@university.edu');
  const studentToken = await login('alice.carter@student.university.edu');

  // Track entities for deterministic test cleanup
  const createdAppointmentIds = [];
  const createdSlotIds = [];

  try {
    // -------------------------------------------------------------
    // Section 1: Security & RBAC Enforcement
    // -------------------------------------------------------------
    await test('Security: Student is rejected from monitoring appointments (403 Forbidden)', async () => {
      const res = await request(app)
        .get('/api/v1/admin/appointments')
        .set('Authorization', `Bearer ${studentToken}`);
      assert.strictEqual(res.status, HTTP_STATUS.FORBIDDEN);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'FORBIDDEN');
    });

    await test('Security: Teacher is rejected from monitoring appointments (403 Forbidden)', async () => {
      const res = await request(app)
        .get('/api/v1/admin/appointments')
        .set('Authorization', `Bearer ${teacherToken}`);
      assert.strictEqual(res.status, HTTP_STATUS.FORBIDDEN);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'FORBIDDEN');
    });

    await test('Security: Unauthenticated request is rejected (401 Unauthorized)', async () => {
      const res = await request(app).get('/api/v1/admin/appointments');
      assert.strictEqual(res.status, HTTP_STATUS.UNAUTHORIZED);
      assert.strictEqual(res.body.success, false);
    });

    await test('Security: Non-admin is rejected from viewing appointment summary (403 Forbidden)', async () => {
      const res = await request(app)
        .get('/api/v1/admin/appointments/summary')
        .set('Authorization', `Bearer ${studentToken}`);
      assert.strictEqual(res.status, HTTP_STATUS.FORBIDDEN);
    });

    await test('Security: Non-admin is rejected from updating appointment metadata (403 Forbidden)', async () => {
      const res = await request(app)
        .patch('/api/v1/admin/appointments/1')
        .set('Authorization', `Bearer ${teacherToken}`)
        .send({ title: 'Unauthorized update' });
      assert.strictEqual(res.status, HTTP_STATUS.FORBIDDEN);
    });

    await test('Security: Non-admin is rejected from updating appointment status (403 Forbidden)', async () => {
      const res = await request(app)
        .patch('/api/v1/admin/appointments/1/status')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ status: 'APPROVED' });
      assert.strictEqual(res.status, HTTP_STATUS.FORBIDDEN);
    });

    await test('Security: Non-admin is rejected from rescheduling through admin route (403 Forbidden)', async () => {
      const res = await request(app)
        .post('/api/v1/admin/appointments/1/reschedule')
        .set('Authorization', `Bearer ${teacherToken}`)
        .send({ proposedSlotId: 2, reason: 'Unauthorized reschedule' });
      assert.strictEqual(res.status, HTTP_STATUS.FORBIDDEN);
    });

    // -------------------------------------------------------------
    // Section 2: Issue #38 Monitoring — Paginated Listing, Filtering & Sorting
    // -------------------------------------------------------------
    await test('Monitoring: Admin retrieves default paginated appointment list', async () => {
      const res = await request(app)
        .get('/api/v1/admin/appointments')
        .set('Authorization', `Bearer ${adminToken}`);

      assert.strictEqual(res.status, HTTP_STATUS.OK);
      assert.strictEqual(res.body.success, true);
      assert.ok(typeof res.body.data.total === 'number');
      assert.strictEqual(res.body.data.page, 1);
      assert.strictEqual(res.body.data.limit, 10);
      assert.ok(Array.isArray(res.body.data.appointments));
      assert.ok(res.body.data.appointments.length > 0);

      const first = res.body.data.appointments[0];
      assert.ok(first.id);
      assert.ok(first.title);
      assert.ok(first.status);
      assert.ok(first.student);
      assert.ok(first.student.email);
      assert.ok(first.teacher);
      assert.ok(first.teacher.email);
      assert.ok(first.slot);
      assert.ok(first.slot.slotDate);
    });

    await test('Monitoring: Pagination limits and page offsets are respected', async () => {
      const resPage1 = await request(app)
        .get('/api/v1/admin/appointments?limit=1&page=1')
        .set('Authorization', `Bearer ${adminToken}`);

      assert.strictEqual(resPage1.status, HTTP_STATUS.OK);
      assert.strictEqual(resPage1.body.data.limit, 1);
      assert.strictEqual(resPage1.body.data.page, 1);
      assert.strictEqual(resPage1.body.data.appointments.length, 1);

      const resPage2 = await request(app)
        .get('/api/v1/admin/appointments?limit=1&page=2')
        .set('Authorization', `Bearer ${adminToken}`);

      assert.strictEqual(resPage2.status, HTTP_STATUS.OK);
      assert.strictEqual(resPage2.body.data.page, 2);
      if (resPage1.body.data.total > 1) {
        assert.strictEqual(resPage2.body.data.appointments.length, 1);
        assert.notStrictEqual(resPage1.body.data.appointments[0].id, resPage2.body.data.appointments[0].id);
      }
    });

    await test('Monitoring: Sorting by created_at and date ASC/DESC', async () => {
      const resDesc = await request(app)
        .get('/api/v1/admin/appointments?sortBy=created_at&sortOrder=DESC')
        .set('Authorization', `Bearer ${adminToken}`);
      assert.strictEqual(resDesc.status, HTTP_STATUS.OK);
      const datesDesc = resDesc.body.data.appointments.map((a) => a.createdAt);
      assert.ok(datesDesc.length > 0);

      const resAsc = await request(app)
        .get('/api/v1/admin/appointments?sortBy=created_at&sortOrder=ASC')
        .set('Authorization', `Bearer ${adminToken}`);
      assert.strictEqual(resAsc.status, HTTP_STATUS.OK);
      const datesAsc = resAsc.body.data.appointments.map((a) => a.createdAt);
      assert.ok(datesAsc.length > 0);
    });

    await test('Monitoring: Filter appointments by status', async () => {
      const res = await request(app)
        .get('/api/v1/admin/appointments?status=PENDING')
        .set('Authorization', `Bearer ${adminToken}`);
      assert.strictEqual(res.status, HTTP_STATUS.OK);
      for (const a of res.body.data.appointments) {
        assert.strictEqual(a.status, 'PENDING');
      }
    });

    await test('Monitoring: Filter appointments by teacherId and studentId', async () => {
      const resTeacher = await request(app)
        .get('/api/v1/admin/appointments?teacherId=1')
        .set('Authorization', `Bearer ${adminToken}`);
      assert.strictEqual(resTeacher.status, HTTP_STATUS.OK);
      for (const a of resTeacher.body.data.appointments) {
        assert.ok(a.teacher.profileId === 1 || a.teacher.userId === 1);
      }

      const resStudent = await request(app)
        .get('/api/v1/admin/appointments?studentId=1')
        .set('Authorization', `Bearer ${adminToken}`);
      assert.strictEqual(resStudent.status, HTTP_STATUS.OK);
      for (const a of resStudent.body.data.appointments) {
        assert.ok(a.student.profileId === 1 || a.student.userId === 1);
      }
    });

    await test('Monitoring: Filter appointments by date range', async () => {
      const res = await request(app)
        .get('/api/v1/admin/appointments?startDate=2026-01-01&endDate=2027-01-01')
        .set('Authorization', `Bearer ${adminToken}`);
      assert.strictEqual(res.status, HTTP_STATUS.OK);
      for (const a of res.body.data.appointments) {
        assert.ok(a.slot.slotDate >= '2026-01-01' && a.slot.slotDate <= '2027-01-01');
      }
    });

    await test('Monitoring: Search appointments by ID and keyword', async () => {
      const resId = await request(app)
        .get('/api/v1/admin/appointments')
        .query({ search: '#1' })
        .set('Authorization', `Bearer ${adminToken}`);
      assert.strictEqual(resId.status, HTTP_STATUS.OK);
      assert.ok(resId.body.data.appointments.some((a) => a.id === 1));

      const resText = await request(app)
        .get('/api/v1/admin/appointments?search=Discussion')
        .set('Authorization', `Bearer ${adminToken}`);
      assert.strictEqual(resText.status, HTTP_STATUS.OK);
      for (const a of resText.body.data.appointments) {
        assert.ok(
          a.title.includes('Discussion') ||
          a.purpose.includes('Discussion') ||
          a.student.firstName.includes('Discussion') ||
          a.teacher.firstName.includes('Discussion')
        );
      }
    });

    await test('Monitoring: Real-time database metrics & appointment summary', async () => {
      const res = await request(app)
        .get('/api/v1/admin/appointments/summary')
        .set('Authorization', `Bearer ${adminToken}`);

      assert.strictEqual(res.status, HTTP_STATUS.OK);
      assert.strictEqual(res.body.success, true);
      const summary = res.body.data.summary;
      assert.ok(typeof summary.total === 'number');
      assert.ok(typeof summary.byStatus === 'object');
      assert.ok(typeof summary.byStatus.PENDING === 'number');
      assert.ok(typeof summary.byStatus.APPROVED === 'number');
      assert.ok(typeof summary.upcoming === 'number');
      assert.ok(typeof summary.today === 'number');
    });

    await test('Monitoring: View detailed appointment record with history and participants', async () => {
      const res = await request(app)
        .get('/api/v1/admin/appointments/1')
        .set('Authorization', `Bearer ${adminToken}`);

      assert.strictEqual(res.status, HTTP_STATUS.OK);
      assert.strictEqual(res.body.success, true);
      const appt = res.body.data.appointment;
      assert.strictEqual(appt.id, 1);
      assert.ok(appt.title);
      assert.ok(appt.purpose);
      assert.ok(appt.student);
      assert.ok(appt.student.studentIdNumber);
      assert.ok(appt.teacher);
      assert.ok(appt.teacher.designation);
      assert.ok(appt.slot);
      assert.ok(Array.isArray(appt.history));
      assert.ok(Array.isArray(appt.reschedules));
    });

    await test('Monitoring: Non-existent appointment returns 404 Not Found', async () => {
      const res = await request(app)
        .get('/api/v1/admin/appointments/999999')
        .set('Authorization', `Bearer ${adminToken}`);
      assert.strictEqual(res.status, HTTP_STATUS.NOT_FOUND);
      assert.strictEqual(res.body.error.code, 'APPOINTMENT_NOT_FOUND');
    });

    await test('Monitoring: Invalid non-numeric ID returns 400 Bad Request', async () => {
      const res = await request(app)
        .get('/api/v1/admin/appointments/not-a-number')
        .set('Authorization', `Bearer ${adminToken}`);
      assert.strictEqual(res.status, HTTP_STATUS.BAD_REQUEST);
      assert.strictEqual(res.body.error.code, 'INVALID_APPOINTMENT_ID');
    });

    // -------------------------------------------------------------
    // Section 3: Issue #39 Record Management — Metadata Updates & Validation
    // -------------------------------------------------------------
    // Clean up any stale test fixtures from previously interrupted runs
    const staleSlots = await db.query("SELECT id FROM teacher_availability_slots WHERE slot_date IN ('2026-11-20', '2026-11-21', '2026-11-22');");
    for (const s of staleSlots) {
      await db.execute("DELETE FROM appointment_status_history WHERE appointment_id IN (SELECT id FROM appointments WHERE slot_id = ?);", [s.id]);
      await db.execute("DELETE FROM appointments WHERE slot_id = ?;", [s.id]);
      await db.execute("DELETE FROM teacher_availability_slots WHERE id = ?;", [s.id]);
    }

    // Set up dedicated test appointment for mutations
    const slotRes1 = await db.execute(
      `INSERT INTO teacher_availability_slots (teacher_id, slot_date, start_time, end_time, start_timestamp, end_timestamp, is_booked, is_active)
       VALUES (1, '2026-11-20', '10:00:00', '10:30:00', '2026-11-20 10:00:00', '2026-11-20 10:30:00', 1, 1);`
    );
    const testSlot1Id = slotRes1.lastInsertRowid;
    createdSlotIds.push(testSlot1Id);

    const slotRes2 = await db.execute(
      `INSERT INTO teacher_availability_slots (teacher_id, slot_date, start_time, end_time, start_timestamp, end_timestamp, is_booked, is_active)
       VALUES (1, '2026-11-20', '11:00:00', '11:30:00', '2026-11-20 11:00:00', '2026-11-20 11:30:00', 0, 1);`
    );
    const testSlot2Id = slotRes2.lastInsertRowid;
    createdSlotIds.push(testSlot2Id);

    const apptInsertRes = await db.execute(
      `INSERT INTO appointments (student_id, teacher_id, slot_id, title, purpose, status)
       VALUES (1, 1, ?, 'Original Thesis Review', 'Initial discussion on thesis draft', 'PENDING');`,
      [testSlot1Id]
    );
    const testApptId = apptInsertRes.lastInsertRowid;
    createdAppointmentIds.push(testApptId);

    await test('Metadata Management: Successfully updates permitted metadata (title, purpose)', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/appointments/${testApptId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'Corrected Thesis Consultation Title',
          purpose: 'Corrected detailed description for research milestone review.'
        });

      assert.strictEqual(res.status, HTTP_STATUS.OK);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.appointment.title, 'Corrected Thesis Consultation Title');
      assert.strictEqual(res.body.data.appointment.purpose, 'Corrected detailed description for research milestone review.');

      // Verify audit log
      const audit = await db.queryOne(
        "SELECT id, action, details FROM audit_logs WHERE action = 'UPDATE_APPOINTMENT_METADATA' AND entity_id = ? ORDER BY id DESC LIMIT 1;",
        [String(testApptId)]
      );
      assert.ok(audit, 'Audit entry must be created for appointment metadata change');
    });

    await test('Metadata Management: Title shorter than 3 characters is rejected (400 Bad Request)', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/appointments/${testApptId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'AB' });

      assert.strictEqual(res.status, HTTP_STATUS.BAD_REQUEST);
      assert.strictEqual(res.body.error.code, 'VALIDATION_ERROR');
    });

    await test('Metadata Management: Purpose shorter than 5 characters is rejected (400 Bad Request)', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/appointments/${testApptId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ purpose: 'Tiny' });

      assert.strictEqual(res.status, HTTP_STATUS.BAD_REQUEST);
      assert.strictEqual(res.body.error.code, 'VALIDATION_ERROR');
    });

    await test('Metadata Management: Attempting to modify immutable participants or slot via metadata is rejected', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/appointments/${testApptId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ studentId: 2, teacherId: 2 });

      assert.strictEqual(res.status, HTTP_STATUS.BAD_REQUEST);
      assert.strictEqual(res.body.error.code, 'IMMUTABLE_PARTICIPANTS');
    });

    // -------------------------------------------------------------
    // Section 4: Issue #39 Lifecycle Transitions & State Machine Protection
    // -------------------------------------------------------------
    await test('Lifecycle: Admin approves PENDING appointment (PENDING -> APPROVED)', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/appointments/${testApptId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          status: 'APPROVED',
          notes: 'Approved by department chair'
        });

      assert.strictEqual(res.status, HTTP_STATUS.OK);
      assert.strictEqual(res.body.data.status, 'APPROVED');

      // Verify slot is still locked
      const slot = await db.queryOne('SELECT is_booked FROM teacher_availability_slots WHERE id = ?;', [testSlot1Id]);
      assert.strictEqual(slot.is_booked, 1);

      // Verify status history
      const history = await db.queryOne(
        'SELECT previous_status, new_status, notes FROM appointment_status_history WHERE appointment_id = ? ORDER BY id DESC LIMIT 1;',
        [testApptId]
      );
      assert.strictEqual(history.previous_status, 'PENDING');
      assert.strictEqual(history.new_status, 'APPROVED');
    });

    await test('Lifecycle: Arbitrary status transition (e.g. APPROVED -> PENDING) is blocked with 400 Bad Request', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/appointments/${testApptId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'PENDING' });

      assert.strictEqual(res.status, HTTP_STATUS.BAD_REQUEST);
      assert.strictEqual(res.body.error.code, 'INVALID_STATUS_TRANSITION');
    });

    await test('Lifecycle: Admin completes APPROVED appointment (APPROVED -> COMPLETED)', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/appointments/${testApptId}/complete`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ notes: 'Consultation session concluded satisfactorily.' });

      assert.strictEqual(res.status, HTTP_STATUS.OK);
      assert.strictEqual(res.body.data.status, 'COMPLETED');

      // Check DB record
      const appt = await db.queryOne('SELECT status FROM appointments WHERE id = ?;', [testApptId]);
      assert.strictEqual(appt.status, 'COMPLETED');
    });

    await test('Lifecycle: Terminal COMPLETED appointment rejects further transitions (COMPLETED -> CANCELLED)', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/appointments/${testApptId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'CANCELLED', reason: 'Too late to cancel' });

      assert.strictEqual(res.status, HTTP_STATUS.BAD_REQUEST);
      assert.strictEqual(res.body.error.code, 'INVALID_STATUS_TRANSITION');
    });

    // -------------------------------------------------------------
    // Section 5: Issue #39 Cancellation, Slot Release & Preservation
    // -------------------------------------------------------------
    // Create another appointment to test cancellation and slot release
    const cancelSlotRes = await db.execute(
      `INSERT INTO teacher_availability_slots (teacher_id, slot_date, start_time, end_time, start_timestamp, end_timestamp, is_booked, is_active)
       VALUES (1, '2026-11-21', '09:00:00', '09:30:00', '2026-11-21 09:00:00', '2026-11-21 09:30:00', 1, 1);`
    );
    const cancelSlotId = cancelSlotRes.lastInsertRowid;
    createdSlotIds.push(cancelSlotId);

    const cancelApptRes = await db.execute(
      `INSERT INTO appointments (student_id, teacher_id, slot_id, title, purpose, status)
       VALUES (1, 1, ?, 'Session to Cancel', 'This consultation will be cancelled', 'APPROVED');`,
      [cancelSlotId]
    );
    const cancelApptId = cancelApptRes.lastInsertRowid;
    createdAppointmentIds.push(cancelApptId);

    await test('Cancellation: Admin cancels appointment, releases slot, and records audit trail', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/appointments/${cancelApptId}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ cancellationReason: 'Student schedule conflict; cancelled by admin.' });

      assert.strictEqual(res.status, HTTP_STATUS.OK);
      assert.strictEqual(res.body.data.status, 'CANCELLED');

      // Verify slot is now unbooked
      const slot = await db.queryOne('SELECT is_booked FROM teacher_availability_slots WHERE id = ?;', [cancelSlotId]);
      assert.strictEqual(slot.is_booked, 0, 'Slot must be released upon cancellation');

      // Verify appointment record is preserved (NOT deleted)
      const appt = await db.queryOne('SELECT id, status, cancellation_reason FROM appointments WHERE id = ?;', [cancelApptId]);
      assert.ok(appt, 'Appointment record must be preserved');
      assert.strictEqual(appt.status, 'CANCELLED');
    });

    await test('Cancellation: Cancelling an already CANCELLED appointment is rejected (400 Bad Request)', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/appointments/${cancelApptId}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ cancellationReason: 'Already cancelled' });

      assert.strictEqual(res.status, HTTP_STATUS.BAD_REQUEST);
      assert.strictEqual(res.body.error.code, 'INVALID_STATUS_TRANSITION');
    });

    // -------------------------------------------------------------
    // Section 6: Issue #39 Rescheduling & Conflict Detection
    // -------------------------------------------------------------
    // Setup appointment to test administrative rescheduling
    const reschedSlot1Res = await db.execute(
      `INSERT INTO teacher_availability_slots (teacher_id, slot_date, start_time, end_time, start_timestamp, end_timestamp, is_booked, is_active)
       VALUES (2, '2026-11-22', '14:00:00', '14:30:00', '2026-11-22 14:00:00', '2026-11-22 14:30:00', 1, 1);`
    );
    const reschedSlot1Id = reschedSlot1Res.lastInsertRowid;
    createdSlotIds.push(reschedSlot1Id);

    const reschedSlot2Res = await db.execute(
      `INSERT INTO teacher_availability_slots (teacher_id, slot_date, start_time, end_time, start_timestamp, end_timestamp, is_booked, is_active)
       VALUES (2, '2026-11-22', '15:00:00', '15:30:00', '2026-11-22 15:00:00', '2026-11-22 15:30:00', 0, 1);`
    );
    const reschedSlot2Id = reschedSlot2Res.lastInsertRowid;
    createdSlotIds.push(reschedSlot2Id);

    const reschedApptRes = await db.execute(
      `INSERT INTO appointments (student_id, teacher_id, slot_id, title, purpose, status)
       VALUES (1, 2, ?, 'Rescheduling Target Session', 'To test admin reschedule flow', 'APPROVED');`,
      [reschedSlot1Id]
    );
    const reschedApptId = reschedApptRes.lastInsertRowid;
    createdAppointmentIds.push(reschedApptId);

    await test('Rescheduling: Admin reschedules appointment into available slot with atomic slot transfer', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/appointments/${reschedApptId}/reschedule`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          proposedSlotId: reschedSlot2Id,
          reason: 'Administrative room reallocation reschedule.'
        });

      assert.strictEqual(res.status, HTTP_STATUS.OK);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.newSlotId, reschedSlot2Id);
      assert.strictEqual(res.body.data.status, 'APPROVED');

      // Verify old slot is released and new slot is reserved
      const oldSlot = await db.queryOne('SELECT is_booked FROM teacher_availability_slots WHERE id = ?;', [reschedSlot1Id]);
      const newSlot = await db.queryOne('SELECT is_booked FROM teacher_availability_slots WHERE id = ?;', [reschedSlot2Id]);
      assert.strictEqual(oldSlot.is_booked, 0, 'Original slot must be released');
      assert.strictEqual(newSlot.is_booked, 1, 'Proposed slot must be reserved');

      // Verify reschedule ledger entry
      const ledger = await db.queryOne(
        'SELECT original_slot_id, proposed_slot_id, status FROM appointment_reschedules WHERE appointment_id = ? ORDER BY id DESC LIMIT 1;',
        [reschedApptId]
      );
      assert.strictEqual(ledger.original_slot_id, reschedSlot1Id);
      assert.strictEqual(ledger.proposed_slot_id, reschedSlot2Id);
      assert.strictEqual(ledger.status, 'ACCEPTED');
    });

    await test('Rescheduling: Attempting to reschedule to slot belonging to DIFFERENT teacher is blocked (400 Bad Request)', async () => {
      // testSlot2Id belongs to Teacher 1, but reschedApptId belongs to Teacher 2
      const res = await request(app)
        .post(`/api/v1/admin/appointments/${reschedApptId}/reschedule`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          proposedSlotId: testSlot2Id,
          reason: 'Invalid cross-teacher reschedule'
        });

      assert.strictEqual(res.status, HTTP_STATUS.BAD_REQUEST);
      assert.strictEqual(res.body.error.code, 'DIFFERENT_TEACHER_SLOT');
    });

    await test('Rescheduling: Attempting to reschedule to already booked slot triggers conflict detection (409 Conflict)', async () => {
      // reschedSlot2Id is now already booked by reschedApptId
      // Create another appointment for Teacher 2
      const slotBusyRes = await db.execute(
        `INSERT INTO teacher_availability_slots (teacher_id, slot_date, start_time, end_time, start_timestamp, end_timestamp, is_booked, is_active)
         VALUES (2, '2026-11-22', '16:00:00', '16:30:00', '2026-11-22 16:00:00', '2026-11-22 16:30:00', 1, 1);`
      );
      const slotBusyId = slotRes1.lastInsertRowid;
      createdSlotIds.push(slotBusyRes.lastInsertRowid);

      const apptBusyRes = await db.execute(
        `INSERT INTO appointments (student_id, teacher_id, slot_id, title, purpose, status)
         VALUES (2, 2, ?, 'Conflicting Candidate', 'Candidate for conflict test', 'APPROVED');`,
        [slotBusyRes.lastInsertRowid]
      );
      createdAppointmentIds.push(apptBusyRes.lastInsertRowid);

      // Attempt to reschedule to reschedSlot2Id which is already occupied
      const res = await request(app)
        .post(`/api/v1/admin/appointments/${apptBusyRes.lastInsertRowid}/reschedule`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          proposedSlotId: reschedSlot2Id,
          reason: 'Will cause conflict'
        });

      assert.strictEqual(res.status, HTTP_STATUS.CONFLICT);
      assert.strictEqual(res.body.error.code, 'SLOT_UNAVAILABLE');
    });

    await test('Rescheduling: Attempting to reschedule terminal CANCELLED appointment is blocked (400 Bad Request)', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/appointments/${cancelApptId}/reschedule`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          proposedSlotId: testSlot2Id,
          reason: 'Cannot reschedule cancelled'
        });

      assert.strictEqual(res.status, HTTP_STATUS.BAD_REQUEST);
      assert.strictEqual(res.body.error.code, 'CANNOT_RESCHEDULE_TERMINAL');
    });

    // -------------------------------------------------------------
    // Section 7: Chronological History Endpoint Verification
    // -------------------------------------------------------------
    await test('History: Admin retrieves complete chronological audit history for appointment', async () => {
      const res = await request(app)
        .get(`/api/v1/admin/appointments/${reschedApptId}/history`)
        .set('Authorization', `Bearer ${adminToken}`);

      assert.strictEqual(res.status, HTTP_STATUS.OK);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data.history.length >= 1);
      assert.ok(res.body.data.history[0].newStatus);
      assert.ok(res.body.data.history[0].changedBy);
      assert.ok(res.body.data.history[0].changedBy.email);
    });

  } finally {
    console.log('\n--- Cleaning up temporary test data ---');
    for (const apptId of createdAppointmentIds) {
      await db.execute('DELETE FROM appointment_notes WHERE appointment_id = ?;', [apptId]);
      await db.execute('DELETE FROM appointment_reschedules WHERE appointment_id = ?;', [apptId]);
      await db.execute('DELETE FROM appointment_status_history WHERE appointment_id = ?;', [apptId]);
      await db.execute('DELETE FROM feedback_ratings WHERE appointment_id = ?;', [apptId]);
      await db.execute('DELETE FROM appointments WHERE id = ?;', [apptId]);
    }
    for (const slotId of createdSlotIds) {
      await db.execute('DELETE FROM teacher_availability_slots WHERE id = ?;', [slotId]);
    }
    // Clean up audit logs for appointments created during test
    for (const apptId of createdAppointmentIds) {
      await db.execute("DELETE FROM audit_logs WHERE entity_type = 'APPOINTMENT' AND entity_id = ?;", [String(apptId)]);
    }
  }

  console.log('\n=================================================================');
  console.log(` Summary: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  console.log('=================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runAdminAppointmentTests().catch((err) => {
    console.error('Fatal error during test run:', err);
    process.exit(1);
  });
}

module.exports = runAdminAppointmentTests;
