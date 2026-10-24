/**
 * Core Appointment Business Logic Test Suite
 * Validates:
 * 1. Creation of appointment requests with slot validation and duration enforcement
 * 2. Scoped appointment viewing by role and ownership (Student, Teacher, Admin)
 * 3. Teacher approval and rejection (with automatic slot release)
 * 4. Cancellation rules, mandatory reasons, and slot release
 * 5. Rescheduling validation (same teacher, future slot, concurrency safe)
 * 6. Deterministic lifecycle transitions and terminal state protection
 * 7. Chronological status history audit tracking
 * 8. Concurrency & Race Condition Defense: Simultaneous booking requests for the same slot
 */

const assert = require('assert');
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/database');
const slotService = require('../src/services/slotService');
const HTTP_STATUS = require('../src/constants/httpStatusCodes');
const { APPOINTMENT_STATUS } = require('../src/constants/roles');

async function runAppointmentTests() {
  console.log('\n=================================================================');
  console.log(' Teacher-Student Appointment System: Core Appointment Tests       ');
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

  // 1. Establish tokens for all required user roles
  const login = async (email, password = 'Password123!') => {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password });
    if (res.status !== 200) {
      throw new Error(`Failed to login as ${email}: ${JSON.stringify(res.body)}`);
    }
    return res.body.data.token;
  };

  const adminToken = await login('admin@university.edu');
  const teacherMillerToken = await login('robert.miller@university.edu'); // Teacher ID: 1
  const teacherJenkinsToken = await login('sarah.jenkins@university.edu'); // Teacher ID: 2
  const studentAliceToken = await login('alice.carter@student.university.edu'); // Student ID: 1
  const studentDavidToken = await login('david.kim@student.university.edu'); // Student ID: 2

  // Track created IDs for test cleanup
  const createdSlotIds = [];
  const createdAppointmentIds = [];

  const createTestSlot = async ({
    teacherId = 1,
    date = '2026-11-01',
    start = '10:00:00',
    end = '10:30:00',
    isActive = 1,
    isBooked = 0
  } = {}) => {
    const startTimestamp = `${date} ${start}`;
    const endTimestamp = `${date} ${end}`;

    // Proactively clean up any stale matching slots from aborted prior test runs
    const existing = await db.query('SELECT id FROM teacher_availability_slots WHERE teacher_id = ? AND start_timestamp = ?;', [teacherId, startTimestamp]);
    for (const row of existing) {
      if (row.id > 6) {
        await db.execute('DELETE FROM appointment_status_history WHERE appointment_id IN (SELECT id FROM appointments WHERE slot_id = ?);', [row.id]);
        await db.execute('DELETE FROM appointment_reschedules WHERE appointment_id IN (SELECT id FROM appointments WHERE slot_id = ?);', [row.id]);
        await db.execute('DELETE FROM appointments WHERE slot_id = ?;', [row.id]);
        await db.execute('DELETE FROM teacher_availability_slots WHERE id = ?;', [row.id]);
      }
    }

    const res = await db.execute(
      `INSERT INTO teacher_availability_slots
       (teacher_id, slot_date, start_time, end_time, start_timestamp, end_timestamp, is_booked, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
      [teacherId, date, start, end, startTimestamp, endTimestamp, isBooked, isActive]
    );
    createdSlotIds.push(res.lastInsertRowid);
    return res.lastInsertRowid;
  };

  try {
    // -------------------------------------------------------------------------
    // Suite 1: Appointment Request Creation & Slot Validation
    // -------------------------------------------------------------------------
    console.log('[Suite 1] Creation & Availability Validation...');

    let bookedAppointmentId = null;
    let testSlot1 = null;

    await test('Student successfully creates appointment request for an available slot', async () => {
      testSlot1 = await createTestSlot({ teacherId: 1, date: '2026-11-02', start: '09:00:00', end: '09:30:00' });

      const res = await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${studentAliceToken}`)
        .send({
          slotId: testSlot1,
          title: 'Thesis Supervision Discussion',
          purpose: 'Review literature survey and proposed experimental methodology.'
        });

      assert.strictEqual(res.status, HTTP_STATUS.CREATED);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.status, APPOINTMENT_STATUS.PENDING);
      assert.strictEqual(res.body.data.slotId, testSlot1);
      bookedAppointmentId = res.body.data.id;
      createdAppointmentIds.push(bookedAppointmentId);

      // Verify slot is now flagged as booked in DB
      const slotRow = await db.queryOne('SELECT is_booked FROM teacher_availability_slots WHERE id = ?;', [testSlot1]);
      assert.strictEqual(slotRow.is_booked, 1);
    });

    await test('Initial creation atomically generates PENDING entry in appointment_status_history', async () => {
      const history = await db.query(
        'SELECT * FROM appointment_status_history WHERE appointment_id = ? ORDER BY id ASC;',
        [bookedAppointmentId]
      );
      assert.ok(history.length >= 1);
      assert.strictEqual(history[0].new_status, APPOINTMENT_STATUS.PENDING);
      assert.strictEqual(history[0].previous_status, null);
    });

    await test('Rejects booking when slot is already reserved with 409 Conflict', async () => {
      const res = await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${studentDavidToken}`)
        .send({
          slotId: testSlot1,
          title: 'Concurrent Clash Attempt',
          purpose: 'Attempting to reserve an already booked slot.'
        });

      assert.strictEqual(res.status, HTTP_STATUS.CONFLICT);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'SLOT_UNAVAILABLE');
    });

    await test('Rejects booking non-existent slot with 404 NOT_FOUND', async () => {
      const res = await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${studentAliceToken}`)
        .send({
          slotId: 999999,
          title: 'Ghost Slot',
          purpose: 'Should return 404 not found.'
        });

      assert.strictEqual(res.status, HTTP_STATUS.NOT_FOUND);
      assert.strictEqual(res.body.error.code, 'SLOT_NOT_FOUND');
    });

    await test('Rejects booking a past availability slot with 400 Bad Request', async () => {
      const pastSlot = await createTestSlot({ teacherId: 1, date: '2026-01-01', start: '10:00:00', end: '10:30:00' });

      const res = await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${studentAliceToken}`)
        .send({
          slotId: pastSlot,
          title: 'Past Consultation',
          purpose: 'Cannot book in the past.'
        });

      assert.strictEqual(res.status, HTTP_STATUS.BAD_REQUEST);
      assert.strictEqual(res.body.error.code, 'SLOT_IN_PAST');
    });

    await test('Rejects booking a slot with invalid duration (< 10 minutes) with 400 Bad Request', async () => {
      const tooShortSlot = await createTestSlot({ teacherId: 1, date: '2026-11-03', start: '10:00:00', end: '10:05:00' });

      const res = await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${studentAliceToken}`)
        .send({
          slotId: tooShortSlot,
          title: 'Micro Consultation',
          purpose: 'Too short duration should be rejected.'
        });

      assert.strictEqual(res.status, HTTP_STATUS.BAD_REQUEST);
      assert.strictEqual(res.body.error.code, 'INVALID_SLOT_DURATION');
    });

    await test('Rejects appointment creation by a Teacher role (only students book appointments)', async () => {
      const slotForTeacher = await createTestSlot({ teacherId: 1, date: '2026-11-04', start: '14:00:00', end: '14:30:00' });

      const res = await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${teacherJenkinsToken}`)
        .send({
          slotId: slotForTeacher,
          title: 'Teacher Self Booking',
          purpose: 'Teachers cannot book consultations.'
        });

      assert.strictEqual(res.status, HTTP_STATUS.FORBIDDEN);
      assert.strictEqual(res.body.error.code, 'FORBIDDEN');
    });

    await test('Rejects malformed input missing title or purpose with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${studentAliceToken}`)
        .send({ slotId: 1 }); // Missing title & purpose

      assert.strictEqual(res.status, HTTP_STATUS.BAD_REQUEST);
      assert.strictEqual(res.body.error.code, 'VALIDATION_ERROR');
    });

    // -------------------------------------------------------------------------
    // Suite 2: Role-Based Scoping & Private Viewing
    // -------------------------------------------------------------------------
    console.log('\n[Suite 2] Role-Based Scoping & Private Viewing Permissions...');

    await test('Student Alice views appointments: scoped exclusively to Alice', async () => {
      const res = await request(app)
        .get('/api/v1/appointments')
        .set('Authorization', `Bearer ${studentAliceToken}`);

      assert.strictEqual(res.status, HTTP_STATUS.OK);
      assert.ok(res.body.data.total >= 1);
      // All returned records must belong to Alice
      res.body.data.appointments.forEach((appt) => {
        assert.strictEqual(appt.student_id, 1);
      });
    });

    await test('Teacher Dr. Miller views appointments: scoped exclusively to Dr. Miller', async () => {
      const res = await request(app)
        .get('/api/v1/appointments')
        .set('Authorization', `Bearer ${teacherMillerToken}`);

      assert.strictEqual(res.status, HTTP_STATUS.OK);
      assert.ok(res.body.data.total >= 1);
      res.body.data.appointments.forEach((appt) => {
        assert.strictEqual(appt.teacher_id, 1);
      });
    });

    await test('Admin views appointments: returns system-wide appointment catalog', async () => {
      const res = await request(app)
        .get('/api/v1/appointments')
        .set('Authorization', `Bearer ${adminToken}`);

      assert.strictEqual(res.status, HTTP_STATUS.OK);
      assert.ok(res.body.data.total >= 2);
    });

    await test('Student David attempting to GET Alice appointment receives 403 FORBIDDEN', async () => {
      const res = await request(app)
        .get(`/api/v1/appointments/${bookedAppointmentId}`)
        .set('Authorization', `Bearer ${studentDavidToken}`);

      assert.strictEqual(res.status, HTTP_STATUS.FORBIDDEN);
      assert.strictEqual(res.body.error.code, 'FORBIDDEN');
    });

    await test('Teacher Sarah Jenkins attempting to GET Dr. Miller appointment receives 403 FORBIDDEN', async () => {
      const res = await request(app)
        .get(`/api/v1/appointments/${bookedAppointmentId}`)
        .set('Authorization', `Bearer ${teacherJenkinsToken}`);

      assert.strictEqual(res.status, HTTP_STATUS.FORBIDDEN);
      assert.strictEqual(res.body.error.code, 'FORBIDDEN');
    });

    await test('Student Alice can view her own appointment details with 200 OK', async () => {
      const res = await request(app)
        .get(`/api/v1/appointments/${bookedAppointmentId}`)
        .set('Authorization', `Bearer ${studentAliceToken}`);

      assert.strictEqual(res.status, HTTP_STATUS.OK);
      assert.strictEqual(res.body.data.id, bookedAppointmentId);
    });

    // -------------------------------------------------------------------------
    // Suite 3: Teacher Approval & Rejection Lifecycle
    // -------------------------------------------------------------------------
    console.log('\n[Suite 3] Teacher Approval & Rejection Lifecycle Transitions...');

    await test('Unassigned teacher Dr. Jenkins attempting to approve receives 403 FORBIDDEN', async () => {
      const res = await request(app)
        .post(`/api/v1/appointments/${bookedAppointmentId}/approve`)
        .set('Authorization', `Bearer ${teacherJenkinsToken}`)
        .send({ notes: 'Unauthorized faculty approval' });

      assert.strictEqual(res.status, HTTP_STATUS.FORBIDDEN);
      assert.strictEqual(res.body.error.code, 'FORBIDDEN');
    });

    await test('Student Alice attempting to self-approve her appointment receives 403 FORBIDDEN', async () => {
      const res = await request(app)
        .post(`/api/v1/appointments/${bookedAppointmentId}/approve`)
        .set('Authorization', `Bearer ${studentAliceToken}`);

      assert.strictEqual(res.status, HTTP_STATUS.FORBIDDEN);
      assert.strictEqual(res.body.error.code, 'FORBIDDEN');
    });

    await test('Assigned teacher Dr. Miller approves appointment: status transitions to APPROVED', async () => {
      const res = await request(app)
        .post(`/api/v1/appointments/${bookedAppointmentId}/approve`)
        .set('Authorization', `Bearer ${teacherMillerToken}`)
        .send({ notes: 'Please bring drafted paper outline.' });

      assert.strictEqual(res.status, HTTP_STATUS.OK);
      assert.strictEqual(res.body.data.status, APPOINTMENT_STATUS.APPROVED);

      // Verify DB record
      const appt = await db.queryOne('SELECT status FROM appointments WHERE id = ?;', [bookedAppointmentId]);
      assert.strictEqual(appt.status, APPOINTMENT_STATUS.APPROVED);
    });

    await test('Attempting to re-approve an already APPROVED appointment is rejected with 400 Bad Request', async () => {
      const res = await request(app)
        .post(`/api/v1/appointments/${bookedAppointmentId}/approve`)
        .set('Authorization', `Bearer ${teacherMillerToken}`)
        .send({ notes: 'Duplicate approval should be rejected' });

      assert.strictEqual(res.status, HTTP_STATUS.BAD_REQUEST);
      assert.strictEqual(res.body.error.code, 'INVALID_STATUS_TRANSITION');
    });

    await test('Teacher rejection: rejects PENDING appointment and releases slot back to unbooked', async () => {
      // 1. Create a fresh PENDING appointment
      const rejSlot = await createTestSlot({ teacherId: 1, date: '2026-11-05', start: '11:00:00', end: '11:30:00' });
      const createRes = await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${studentDavidToken}`)
        .send({
          slotId: rejSlot,
          title: 'Algorithms Homework Help',
          purpose: 'Clarify dynamic programming state transitions.'
        });
      const rejApptId = createRes.body.data.id;
      createdAppointmentIds.push(rejApptId);

      // 2. Reject as assigned teacher
      const rejRes = await request(app)
        .post(`/api/v1/appointments/${rejApptId}/reject`)
        .set('Authorization', `Bearer ${teacherMillerToken}`)
        .send({ reason: 'Faculty on academic leave during this time slot.' });

      assert.strictEqual(rejRes.status, HTTP_STATUS.OK);
      assert.strictEqual(rejRes.body.data.status, APPOINTMENT_STATUS.REJECTED);

      // 3. Verify slot is released (is_booked = 0)
      const slotRow = await db.queryOne('SELECT is_booked FROM teacher_availability_slots WHERE id = ?;', [rejSlot]);
      assert.strictEqual(slotRow.is_booked, 0);

      // 4. Verify status history recorded REJECTED
      const history = await db.query('SELECT * FROM appointment_status_history WHERE appointment_id = ? ORDER BY id DESC LIMIT 1;', [rejApptId]);
      assert.strictEqual(history[0].new_status, APPOINTMENT_STATUS.REJECTED);
    });

    await test('Attempting to reject an already REJECTED appointment is blocked with 400 Bad Request', async () => {
      const rejAppt = await db.queryOne("SELECT id FROM appointments WHERE status = 'REJECTED' ORDER BY id DESC LIMIT 1;");
      const res = await request(app)
        .post(`/api/v1/appointments/${rejAppt.id}/reject`)
        .set('Authorization', `Bearer ${teacherMillerToken}`)
        .send({ reason: 'Repeated rejection should fail.' });

      assert.strictEqual(res.status, HTTP_STATUS.BAD_REQUEST);
      assert.strictEqual(res.body.error.code, 'INVALID_STATUS_TRANSITION');
    });

    await test('Attempting to complete a PENDING appointment directly without approval is blocked with 400 Bad Request', async () => {
      // Create fresh PENDING appointment
      const pendSlot = await createTestSlot({ teacherId: 1, date: '2026-11-12', start: '16:00:00', end: '16:30:00' });
      const createRes = await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${studentAliceToken}`)
        .send({
          slotId: pendSlot,
          title: 'Direct Complete Target',
          purpose: 'Testing direct completion block from PENDING.'
        });
      const pendApptId = createRes.body.data.id;
      createdAppointmentIds.push(pendApptId);

      const res = await request(app)
        .post(`/api/v1/appointments/${pendApptId}/complete`)
        .set('Authorization', `Bearer ${teacherMillerToken}`)
        .send({ notes: 'Trying to complete unapproved appointment' });

      assert.strictEqual(res.status, HTTP_STATUS.BAD_REQUEST);
      assert.strictEqual(res.body.error.code, 'INVALID_STATUS_TRANSITION');
    });

    // -------------------------------------------------------------------------
    // Suite 4: Appointment Cancellation Rules
    // -------------------------------------------------------------------------
    console.log('\n[Suite 4] Appointment Cancellation Rules & Slot Release...');

    await test('Cancellation requires a non-empty cancellation reason', async () => {
      const res = await request(app)
        .post(`/api/v1/appointments/${bookedAppointmentId}/cancel`)
        .set('Authorization', `Bearer ${studentAliceToken}`)
        .send({ cancellationReason: '' });

      assert.strictEqual(res.status, HTTP_STATUS.BAD_REQUEST);
    });

    await test('Third-party student David attempting to cancel Alice appointment receives 403 FORBIDDEN', async () => {
      const res = await request(app)
        .post(`/api/v1/appointments/${bookedAppointmentId}/cancel`)
        .set('Authorization', `Bearer ${studentDavidToken}`)
        .send({ cancellationReason: 'Malicious cancellation attempt.' });

      assert.strictEqual(res.status, HTTP_STATUS.FORBIDDEN);
    });

    await test('Student owner cancels appointment: transitions to CANCELLED and releases slot', async () => {
      // Create fresh appointment to cancel
      const cancelSlot = await createTestSlot({ teacherId: 1, date: '2026-11-06', start: '15:00:00', end: '15:30:00' });
      const createRes = await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${studentAliceToken}`)
        .send({
          slotId: cancelSlot,
          title: 'Cancel Target Appointment',
          purpose: 'Testing cancellation flow and slot release.'
        });
      const cancelApptId = createRes.body.data.id;
      createdAppointmentIds.push(cancelApptId);

      const cancelRes = await request(app)
        .post(`/api/v1/appointments/${cancelApptId}/cancel`)
        .set('Authorization', `Bearer ${studentAliceToken}`)
        .send({ cancellationReason: 'Schedule conflict with midterm exam.' });

      assert.strictEqual(cancelRes.status, HTTP_STATUS.OK);
      assert.strictEqual(cancelRes.body.data.status, APPOINTMENT_STATUS.CANCELLED);

      // Verify slot released
      const slotRow = await db.queryOne('SELECT is_booked FROM teacher_availability_slots WHERE id = ?;', [cancelSlot]);
      assert.strictEqual(slotRow.is_booked, 0);

      // Verify cancellation reason recorded
      const apptRow = await db.queryOne('SELECT cancellation_reason, cancelled_by FROM appointments WHERE id = ?;', [cancelApptId]);
      assert.strictEqual(apptRow.cancellation_reason, 'Schedule conflict with midterm exam.');
      assert.strictEqual(apptRow.cancelled_by, 6); // Alice's user_id
    });

    await test('Attempting to cancel an already CANCELLED appointment is blocked with 400 Bad Request', async () => {
      // Find a cancelled appointment
      const cancelledAppt = await db.queryOne("SELECT id FROM appointments WHERE status = 'CANCELLED' LIMIT 1;");
      const res = await request(app)
        .post(`/api/v1/appointments/${cancelledAppt.id}/cancel`)
        .set('Authorization', `Bearer ${studentAliceToken}`)
        .send({ cancellationReason: 'Repeated cancellation should fail.' });

      assert.strictEqual(res.status, HTTP_STATUS.BAD_REQUEST);
      assert.strictEqual(res.body.error.code, 'INVALID_STATUS_TRANSITION');
    });

    // -------------------------------------------------------------------------
    // Suite 5: Rescheduling with Atomic Validation
    // -------------------------------------------------------------------------
    console.log('\n[Suite 5] Rescheduling Validations & Slot Migration...');

    let reschedApptId = null;
    let originalSlot = null;
    let targetSlot = null;

    await test('Setup appointment for rescheduling tests', async () => {
      originalSlot = await createTestSlot({ teacherId: 1, date: '2026-11-07', start: '10:00:00', end: '10:30:00' });
      targetSlot = await createTestSlot({ teacherId: 1, date: '2026-11-07', start: '11:00:00', end: '11:30:00' });

      const createRes = await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${studentAliceToken}`)
        .send({
          slotId: originalSlot,
          title: 'Reschedule Subject',
          purpose: 'Will be rescheduled.'
        });
      reschedApptId = createRes.body.data.id;
      createdAppointmentIds.push(reschedApptId);

      // Teacher approves it first
      await request(app)
        .post(`/api/v1/appointments/${reschedApptId}/approve`)
        .set('Authorization', `Bearer ${teacherMillerToken}`);
    });

    await test('Rejects reschedule to a slot belonging to a DIFFERENT teacher with 400 Bad Request', async () => {
      // Slot belongs to Teacher 2 (Dr. Jenkins), but appointment is with Teacher 1
      const differentTeacherSlot = await createTestSlot({ teacherId: 2, date: '2026-11-08', start: '14:00:00', end: '14:30:00' });

      const res = await request(app)
        .post(`/api/v1/appointments/${reschedApptId}/reschedule`)
        .set('Authorization', `Bearer ${studentAliceToken}`)
        .send({
          proposedSlotId: differentTeacherSlot,
          reason: 'Switching faculty consultation slot.'
        });

      assert.strictEqual(res.status, HTTP_STATUS.BAD_REQUEST);
      assert.strictEqual(res.body.error.code, 'DIFFERENT_TEACHER_SLOT');
    });

    await test('Successfully reschedules appointment: frees original slot, reserves target slot, and updates appointment', async () => {
      const res = await request(app)
        .post(`/api/v1/appointments/${reschedApptId}/reschedule`)
        .set('Authorization', `Bearer ${studentAliceToken}`)
        .send({
          proposedSlotId: targetSlot,
          reason: 'Doctor appointment conflict in morning.'
        });

      assert.strictEqual(res.status, HTTP_STATUS.OK);
      assert.strictEqual(res.body.data.newSlotId, targetSlot);

      // 1. Original slot must be freed
      const oldSlotRow = await db.queryOne('SELECT is_booked FROM teacher_availability_slots WHERE id = ?;', [originalSlot]);
      assert.strictEqual(oldSlotRow.is_booked, 0);

      // 2. Target slot must be reserved
      const newSlotRow = await db.queryOne('SELECT is_booked FROM teacher_availability_slots WHERE id = ?;', [targetSlot]);
      assert.strictEqual(newSlotRow.is_booked, 1);

      // 3. Appointment slot_id must point to target slot
      const apptRow = await db.queryOne('SELECT slot_id, status FROM appointments WHERE id = ?;', [reschedApptId]);
      assert.strictEqual(apptRow.slot_id, targetSlot);
      assert.strictEqual(apptRow.status, APPOINTMENT_STATUS.APPROVED);

      // 4. appointment_reschedules audit ledger record created
      const reschedLog = await db.queryOne('SELECT * FROM appointment_reschedules WHERE appointment_id = ?;', [reschedApptId]);
      assert.ok(reschedLog);
      assert.strictEqual(reschedLog.original_slot_id, originalSlot);
      assert.strictEqual(reschedLog.proposed_slot_id, targetSlot);
    });

    // -------------------------------------------------------------------------
    // Suite 6: Completion & Status History Tracking
    // -------------------------------------------------------------------------
    console.log('\n[Suite 6] Completion & Chronological Status History Audit...');

    await test('Assigned faculty marks appointment as COMPLETED: terminal state reached', async () => {
      const res = await request(app)
        .post(`/api/v1/appointments/${reschedApptId}/complete`)
        .set('Authorization', `Bearer ${teacherMillerToken}`)
        .send({ notes: 'Student completed project milestone presentation.' });

      assert.strictEqual(res.status, HTTP_STATUS.OK);
      assert.strictEqual(res.body.data.status, APPOINTMENT_STATUS.COMPLETED);
    });

    await test('Student attempting to mark appointment completed receives 403 FORBIDDEN', async () => {
      const res = await request(app)
        .post(`/api/v1/appointments/${reschedApptId}/complete`)
        .set('Authorization', `Bearer ${studentAliceToken}`);

      assert.strictEqual(res.status, HTTP_STATUS.FORBIDDEN);
    });

    await test('Terminal COMPLETED appointment rejects further transitions with 400 Bad Request', async () => {
      const res = await request(app)
        .post(`/api/v1/appointments/${reschedApptId}/cancel`)
        .set('Authorization', `Bearer ${studentAliceToken}`)
        .send({ cancellationReason: 'Cannot cancel a completed consultation.' });

      assert.strictEqual(res.status, HTTP_STATUS.BAD_REQUEST);
      assert.strictEqual(res.body.error.code, 'INVALID_STATUS_TRANSITION');
    });

    await test('Chronological history endpoint returns complete audit trail of transitions', async () => {
      const res = await request(app)
        .get(`/api/v1/appointments/${reschedApptId}/history`)
        .set('Authorization', `Bearer ${studentAliceToken}`);

      assert.strictEqual(res.status, HTTP_STATUS.OK);
      assert.strictEqual(res.body.success, true);
      const { history } = res.body.data;
      assert.ok(history.length >= 3); // PENDING -> APPROVED -> Reschedule -> COMPLETED

      const statuses = history.map((h) => h.new_status);
      assert.ok(statuses.includes(APPOINTMENT_STATUS.PENDING));
      assert.ok(statuses.includes(APPOINTMENT_STATUS.APPROVED));
      assert.ok(statuses.includes(APPOINTMENT_STATUS.COMPLETED));

      // Each entry must record timestamps and actor identity
      history.forEach((entry) => {
        assert.ok(entry.changed_at);
        assert.ok(entry.changed_by);
        assert.ok(entry.changed_by_email);
      });
    });

    await test('Unauthorized student David attempting to view Alice appointment history receives 403 FORBIDDEN', async () => {
      const res = await request(app)
        .get(`/api/v1/appointments/${reschedApptId}/history`)
        .set('Authorization', `Bearer ${studentDavidToken}`);

      assert.strictEqual(res.status, HTTP_STATUS.FORBIDDEN);
      assert.strictEqual(res.body.error.code, 'FORBIDDEN');
    });

    await test('Administrator can view any appointment history with 200 OK', async () => {
      const res = await request(app)
        .get(`/api/v1/appointments/${reschedApptId}/history`)
        .set('Authorization', `Bearer ${adminToken}`);

      assert.strictEqual(res.status, HTTP_STATUS.OK);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data.history.length >= 3);
    });

    // -------------------------------------------------------------------------
    // Suite 7: Race Conditions & Simultaneous Booking Attempts
    // -------------------------------------------------------------------------
    console.log('\n[Suite 7] Concurrency & Race Condition Defense...');

    await test('Simultaneous concurrent booking requests for same slot: exactly ONE succeeds and one receives 409', async () => {
      // 1. Create a single clean test slot
      const raceSlot = await createTestSlot({
        teacherId: 1,
        date: '2026-11-10',
        start: '13:00:00',
        end: '13:30:00'
      });

      // 2. Dispatch two simultaneous requests in parallel
      const request1 = request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${studentAliceToken}`)
        .send({
          slotId: raceSlot,
          title: 'Student Alice Race Booking',
          purpose: 'Simultaneous booking attempt 1.'
        });

      const request2 = request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${studentDavidToken}`)
        .send({
          slotId: raceSlot,
          title: 'Student David Race Booking',
          purpose: 'Simultaneous booking attempt 2.'
        });

      const [res1, res2] = await Promise.all([request1, request2]);

      const statuses = [res1.status, res2.status].sort();

      // Exactly one must be 201 Created and the other must be 409 Conflict
      assert.deepStrictEqual(
        statuses,
        [HTTP_STATUS.CREATED, HTTP_STATUS.CONFLICT],
        `Expected one 201 and one 409, got: ${res1.status} and ${res2.status}`
      );

      // Identify winner and track for cleanup
      const winnerRes = res1.status === HTTP_STATUS.CREATED ? res1 : res2;
      const loserRes = res1.status === HTTP_STATUS.CONFLICT ? res1 : res2;

      createdAppointmentIds.push(winnerRes.body.data.id);
      assert.ok(
        ['SLOT_ALREADY_BOOKED', 'SLOT_UNAVAILABLE', 'UNIQUE_CONSTRAINT_VIOLATION'].includes(loserRes.body.error.code),
        `Unexpected error code: ${loserRes.body.error.code}`
      );

      // 3. Database verification: Exactly ONE appointment exists referencing this slot
      const appointmentsCount = await db.queryOne(
        'SELECT count(*) as count FROM appointments WHERE slot_id = ?;',
        [raceSlot]
      );
      assert.strictEqual(parseInt(appointmentsCount.count, 10), 1);

      // 4. Verify slot is booked
      const slotRecord = await db.queryOne(
        'SELECT is_booked FROM teacher_availability_slots WHERE id = ?;',
        [raceSlot]
      );
      assert.strictEqual(slotRecord.is_booked, 1);
    });
  } finally {
    // Cleanup generated test data to leave database pristine
    for (const apptId of createdAppointmentIds) {
      await db.execute('DELETE FROM appointment_status_history WHERE appointment_id = ?;', [apptId]);
      await db.execute('DELETE FROM appointment_reschedules WHERE appointment_id = ?;', [apptId]);
      await db.execute('DELETE FROM appointments WHERE id = ?;', [apptId]);
    }
    for (const slotId of createdSlotIds) {
      await db.execute('DELETE FROM teacher_availability_slots WHERE id = ?;', [slotId]);
    }
  }

  console.log('\n-----------------------------------------------------------------');
  console.log(`Core Appointment Test Summary: ${passed} passed, ${failed} failed.`);
  console.log('=================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runAppointmentTests();
}

module.exports = { runAppointmentTests };
