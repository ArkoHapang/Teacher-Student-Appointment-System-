/**
 * Conflict Detection Test Suite (GitHub Issue #40)
 * Validates:
 * 1. Exact duplicate time slots
 * 2. Partial overlap (starts during / ends during)
 * 3. One appointment contained inside another (or enclosing another)
 * 4. Adjacent appointments (half-open intervals [start, end) do NOT overlap)
 * 5. Different teachers at the same time (no conflict across different faculty)
 * 6. Cancelled and rejected appointments (do NOT block availability)
 * 7. Rescheduling into an occupied or overlapping slot (rejects with 409)
 * 8. Rescheduling ignores the appointment being edited
 * 9. Teacher booked outside available hours
 * 10. Invalid start and end times (chronology, duration, past timestamps)
 * 11. Standalone conflict detection API (POST /api/v1/appointments/check-conflict)
 * 12. Simultaneous concurrent booking attempts for overlapping slots (atomic serialization)
 */

const assert = require('assert');
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/database');
const conflictService = require('../src/services/conflictService');
const HTTP_STATUS = require('../src/constants/httpStatusCodes');
const { APPOINTMENT_STATUS } = require('../src/constants/roles');

async function runConflictTests() {
  console.log('\n=================================================================');
  console.log(' Teacher-Student Appointment System: Issue #40 Conflict Tests   ');
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

  // 1. Establish tokens
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

  const createdSlotIds = [];
  const createdAppointmentIds = [];

  const createTestSlot = async ({
    teacherId = 1,
    date = '2026-11-20',
    start = '10:00:00',
    end = '10:30:00',
    isActive = 1,
    isBooked = 0
  } = {}) => {
    const startTimestamp = `${date} ${start}`;
    const endTimestamp = `${date} ${end}`;

    // Clean up any stale matching slots from aborted prior test runs
    const existing = await db.query(
      'SELECT id FROM teacher_availability_slots WHERE teacher_id = ? AND start_timestamp = ?;',
      [teacherId, startTimestamp]
    );
    for (const row of existing) {
      if (row.id > 6) {
        await db.execute('DELETE FROM appointment_status_history WHERE appointment_id IN (SELECT id FROM appointments WHERE slot_id = ?);', [row.id]);
        await db.execute('DELETE FROM appointment_reschedules WHERE original_slot_id = ? OR proposed_slot_id = ? OR appointment_id IN (SELECT id FROM appointments WHERE slot_id = ?);', [row.id, row.id, row.id]);
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

  // Pre-test cleanup to guarantee test idempotency across repeated runs
  await db.execute(`
    DELETE FROM appointment_status_history WHERE appointment_id IN (SELECT id FROM appointments WHERE slot_id IN (SELECT id FROM teacher_availability_slots WHERE slot_date >= '2026-11-20'));
    DELETE FROM appointment_reschedules WHERE original_slot_id IN (SELECT id FROM teacher_availability_slots WHERE slot_date >= '2026-11-20') OR proposed_slot_id IN (SELECT id FROM teacher_availability_slots WHERE slot_date >= '2026-11-20') OR appointment_id IN (SELECT id FROM appointments WHERE slot_id IN (SELECT id FROM teacher_availability_slots WHERE slot_date >= '2026-11-20'));
    DELETE FROM appointments WHERE slot_id IN (SELECT id FROM teacher_availability_slots WHERE slot_date >= '2026-11-20');
    DELETE FROM teacher_availability_slots WHERE slot_date >= '2026-11-20' AND id > 6;
  `);

  try {
    // -------------------------------------------------------------------------
    // Suite 1: Pure Mathematical Interval-Overlap Engine Proofs
    // -------------------------------------------------------------------------
    console.log('[Suite 1] Pure Mathematical Interval-Overlap Engine Proofs...');

    await test('Interval overlap: Exact duplicate intervals return TRUE', async () => {
      const overlap = conflictService.hasIntervalOverlap(
        '2026-11-20 10:00:00', '2026-11-20 10:30:00',
        '2026-11-20 10:00:00', '2026-11-20 10:30:00'
      );
      assert.strictEqual(overlap, true);
    });

    await test('Interval overlap: Partial overlap (starts during) returns TRUE', async () => {
      // Existing: 10:00 - 11:00, Requested: 10:30 - 11:30
      const overlap = conflictService.hasIntervalOverlap(
        '2026-11-20 10:00:00', '2026-11-20 11:00:00',
        '2026-11-20 10:30:00', '2026-11-20 11:30:00'
      );
      assert.strictEqual(overlap, true);
    });

    await test('Interval overlap: Partial overlap (ends during) returns TRUE', async () => {
      // Existing: 10:00 - 11:00, Requested: 09:30 - 10:30
      const overlap = conflictService.hasIntervalOverlap(
        '2026-11-20 10:00:00', '2026-11-20 11:00:00',
        '2026-11-20 09:30:00', '2026-11-20 10:30:00'
      );
      assert.strictEqual(overlap, true);
    });

    await test('Interval overlap: Contained inside returns TRUE', async () => {
      // Existing: 10:00 - 11:00, Requested: 10:15 - 10:45
      const overlap = conflictService.hasIntervalOverlap(
        '2026-11-20 10:00:00', '2026-11-20 11:00:00',
        '2026-11-20 10:15:00', '2026-11-20 10:45:00'
      );
      assert.strictEqual(overlap, true);
    });

    await test('Interval overlap: Enclosing returns TRUE', async () => {
      // Existing: 10:15 - 10:45, Requested: 10:00 - 11:00
      const overlap = conflictService.hasIntervalOverlap(
        '2026-11-20 10:15:00', '2026-11-20 10:45:00',
        '2026-11-20 10:00:00', '2026-11-20 11:00:00'
      );
      assert.strictEqual(overlap, true);
    });

    await test('Interval overlap: Adjacent after [10:00, 10:30) and [10:30, 11:00) returns FALSE (half-open rule)', async () => {
      const overlap = conflictService.hasIntervalOverlap(
        '2026-11-20 10:00:00', '2026-11-20 10:30:00',
        '2026-11-20 10:30:00', '2026-11-20 11:00:00'
      );
      assert.strictEqual(overlap, false);
    });

    await test('Interval overlap: Adjacent before [10:30, 11:00) and [10:00, 10:30) returns FALSE (half-open rule)', async () => {
      const overlap = conflictService.hasIntervalOverlap(
        '2026-11-20 10:30:00', '2026-11-20 11:00:00',
        '2026-11-20 10:00:00', '2026-11-20 10:30:00'
      );
      assert.strictEqual(overlap, false);
    });

    // -------------------------------------------------------------------------
    // Suite 2: Conflict Detection in Appointment Booking Workflow
    // -------------------------------------------------------------------------
    console.log('\n[Suite 2] Booking Workflow Conflict Detection...');

    await test('Detects exact duplicate time slot conflict: second booking rejected with 409 Conflict', async () => {
      const slot1 = await createTestSlot({ teacherId: 1, date: '2026-11-21', start: '10:00:00', end: '10:30:00' });

      // Alice books slot 1
      const book1 = await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${studentAliceToken}`)
        .send({
          slotId: slot1,
          title: 'Thesis Guidance',
          purpose: 'Discuss paper chapter 1'
        });
      assert.strictEqual(book1.status, HTTP_STATUS.CREATED);
      createdAppointmentIds.push(book1.body.data.id);

      // David attempts to book the exact same slot
      const book2 = await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${studentDavidToken}`)
        .send({
          slotId: slot1,
          title: 'Duplicate Attempt',
          purpose: 'Should be rejected as conflict'
        });

      assert.strictEqual(book2.status, HTTP_STATUS.CONFLICT);
      assert.strictEqual(book2.body.success, false);
      assert.ok(['APPOINTMENT_CONFLICT', 'SLOT_UNAVAILABLE', 'SLOT_ALREADY_BOOKED'].includes(book2.body.error.code));
    });

    await test('Detects partial overlap (starts during): rejects booking with 409 Conflict', async () => {
      // Existing Slot: 11:00 to 12:00
      const baseSlot = await createTestSlot({ teacherId: 1, date: '2026-11-21', start: '11:00:00', end: '12:00:00' });
      // Overlapping Slot: 11:30 to 12:30 (starts during baseSlot)
      const overlapSlot = await createTestSlot({ teacherId: 1, date: '2026-11-21', start: '11:30:00', end: '12:30:00' });

      // Book base slot
      const res1 = await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${studentAliceToken}`)
        .send({
          slotId: baseSlot,
          title: 'Base Consultation',
          purpose: 'Testing partial overlap starts during'
        });
      assert.strictEqual(res1.status, HTTP_STATUS.CREATED);
      createdAppointmentIds.push(res1.body.data.id);

      // Attempt to book overlapping slot for same teacher
      const res2 = await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${studentDavidToken}`)
        .send({
          slotId: overlapSlot,
          title: 'Conflicting Overlap',
          purpose: 'Must be rejected due to overlap'
        });

      assert.strictEqual(res2.status, HTTP_STATUS.CONFLICT);
      assert.strictEqual(res2.body.error.code, 'APPOINTMENT_CONFLICT');
      assert.ok(res2.body.error.details.conflictingAppointments.length >= 1);
    });

    await test('Detects partial overlap (ends during): rejects booking with 409 Conflict', async () => {
      // Existing Slot: 14:00 to 15:00
      const baseSlot = await createTestSlot({ teacherId: 1, date: '2026-11-21', start: '14:00:00', end: '15:00:00' });
      // Overlapping Slot: 13:30 to 14:30 (ends during baseSlot)
      const overlapSlot = await createTestSlot({ teacherId: 1, date: '2026-11-21', start: '13:30:00', end: '14:30:00' });

      const res1 = await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${studentAliceToken}`)
        .send({
          slotId: baseSlot,
          title: 'Afternoon Base',
          purpose: 'Testing partial overlap ends during'
        });
      assert.strictEqual(res1.status, HTTP_STATUS.CREATED);
      createdAppointmentIds.push(res1.body.data.id);

      const res2 = await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${studentDavidToken}`)
        .send({
          slotId: overlapSlot,
          title: 'Pre-Overlap Attempt',
          purpose: 'Should be rejected'
        });

      assert.strictEqual(res2.status, HTTP_STATUS.CONFLICT);
      assert.strictEqual(res2.body.error.code, 'APPOINTMENT_CONFLICT');
    });

    await test('Detects one appointment contained inside another: rejects booking with 409 Conflict', async () => {
      // Existing Slot: 16:00 to 18:00 (wide slot)
      const wideSlot = await createTestSlot({ teacherId: 1, date: '2026-11-21', start: '16:00:00', end: '18:00:00' });
      // Inside Slot: 16:30 to 17:30 (strictly inside wideSlot)
      const insideSlot = await createTestSlot({ teacherId: 1, date: '2026-11-21', start: '16:30:00', end: '17:30:00' });

      const res1 = await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${studentAliceToken}`)
        .send({
          slotId: wideSlot,
          title: 'Wide Block Consultation',
          purpose: 'Enclosing slot reservation'
        });
      assert.strictEqual(res1.status, HTTP_STATUS.CREATED);
      createdAppointmentIds.push(res1.body.data.id);

      const res2 = await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${studentDavidToken}`)
        .send({
          slotId: insideSlot,
          title: 'Inside Block Attempt',
          purpose: 'Must be blocked by wide consultation'
        });

      assert.strictEqual(res2.status, HTTP_STATUS.CONFLICT);
      assert.strictEqual(res2.body.error.code, 'APPOINTMENT_CONFLICT');
    });

    await test('Allows adjacent appointments for same teacher without conflict (201 Created)', async () => {
      // Slot A: 09:00 to 09:30
      const slotA = await createTestSlot({ teacherId: 1, date: '2026-11-22', start: '09:00:00', end: '09:30:00' });
      // Slot B: 09:30 to 10:00 (adjacent immediately after Slot A)
      const slotB = await createTestSlot({ teacherId: 1, date: '2026-11-22', start: '09:30:00', end: '10:00:00' });

      const res1 = await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${studentAliceToken}`)
        .send({
          slotId: slotA,
          title: 'Morning Slot A',
          purpose: 'Adjacent test part 1'
        });
      assert.strictEqual(res1.status, HTTP_STATUS.CREATED);
      createdAppointmentIds.push(res1.body.data.id);

      const res2 = await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${studentDavidToken}`)
        .send({
          slotId: slotB,
          title: 'Morning Slot B',
          purpose: 'Adjacent test part 2'
        });
      assert.strictEqual(res2.status, HTTP_STATUS.CREATED);
      createdAppointmentIds.push(res2.body.data.id);
    });

    await test('Allows different teachers at the exact same time without conflict (201 Created)', async () => {
      // Teacher 1 (Dr. Miller) at 10:00 - 10:30
      const millerSlot = await createTestSlot({ teacherId: 1, date: '2026-11-22', start: '10:00:00', end: '10:30:00' });
      // Teacher 2 (Dr. Jenkins) at exact same time: 10:00 - 10:30
      const jenkinsSlot = await createTestSlot({ teacherId: 2, date: '2026-11-22', start: '10:00:00', end: '10:30:00' });

      const res1 = await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${studentAliceToken}`)
        .send({
          slotId: millerSlot,
          title: 'Consultation with Dr. Miller',
          purpose: 'Different teachers concurrent booking test 1'
        });
      assert.strictEqual(res1.status, HTTP_STATUS.CREATED);
      createdAppointmentIds.push(res1.body.data.id);

      const res2 = await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${studentDavidToken}`)
        .send({
          slotId: jenkinsSlot,
          title: 'Consultation with Dr. Jenkins',
          purpose: 'Different teachers concurrent booking test 2'
        });
      assert.strictEqual(res2.status, HTTP_STATUS.CREATED);
      createdAppointmentIds.push(res2.body.data.id);
    });

    await test('Cancelled appointments do NOT conflict: released time can be booked with 201 Created', async () => {
      // 1. Create slot and book it
      const cancelSlot = await createTestSlot({ teacherId: 1, date: '2026-11-23', start: '11:00:00', end: '11:30:00' });
      const bookRes = await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${studentAliceToken}`)
        .send({
          slotId: cancelSlot,
          title: 'To Be Cancelled',
          purpose: 'Testing cancelled non-blocking status'
        });
      assert.strictEqual(bookRes.status, HTTP_STATUS.CREATED);
      const apptId = bookRes.body.data.id;
      createdAppointmentIds.push(apptId);

      // 2. Cancel the appointment
      const cancelRes = await request(app)
        .post(`/api/v1/appointments/${apptId}/cancel`)
        .set('Authorization', `Bearer ${studentAliceToken}`)
        .send({ cancellationReason: 'Student cannot attend' });
      assert.strictEqual(cancelRes.status, HTTP_STATUS.OK);

      // 3. Verify check-conflict on the cancelled slot reports no active conflict
      const conflictCheck = await request(app)
        .post('/api/v1/appointments/check-conflict')
        .set('Authorization', `Bearer ${studentDavidToken}`)
        .send({ slotId: cancelSlot });
      assert.strictEqual(conflictCheck.status, HTTP_STATUS.OK);
      assert.strictEqual(conflictCheck.body.data.hasConflict, false);

      // 4. David books an overlapping slot (11:15 - 11:45) on that same released window
      // If Alice's appointment were still active, this overlapping slot would be blocked with 409
      const releasedWindowSlot = await createTestSlot({ teacherId: 1, date: '2026-11-23', start: '11:15:00', end: '11:45:00' });
      const rebookRes = await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${studentDavidToken}`)
        .send({
          slotId: releasedWindowSlot,
          title: 'Rebooking Released Window',
          purpose: 'Should succeed because previous overlapping appointment was cancelled'
        });

      assert.strictEqual(rebookRes.status, HTTP_STATUS.CREATED);
      createdAppointmentIds.push(rebookRes.body.data.id);
    });

    // -------------------------------------------------------------------------
    // Suite 3: Rescheduling Conflict Detection
    // -------------------------------------------------------------------------
    console.log('\n[Suite 3] Rescheduling Conflict Detection...');

    let reschedApptId = null;
    let originalSlot = null;
    let occupiedSlot = null;
    let freeSlot = null;

    await test('Setup appointments for rescheduling conflict scenarios', async () => {
      // Slot 1: Appointment A (to be rescheduled)
      originalSlot = await createTestSlot({ teacherId: 1, date: '2026-11-24', start: '09:00:00', end: '09:30:00' });
      // Slot 2: Appointment B (occupies 10:00 - 10:30)
      occupiedSlot = await createTestSlot({ teacherId: 1, date: '2026-11-24', start: '10:00:00', end: '10:30:00' });
      // Slot 3: Free slot (14:00 - 14:30)
      freeSlot = await createTestSlot({ teacherId: 1, date: '2026-11-24', start: '14:00:00', end: '14:30:00' });

      // Alice books Slot 1
      const resA = await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${studentAliceToken}`)
        .send({
          slotId: originalSlot,
          title: 'Alice Reschedule Target',
          purpose: 'Will attempt to reschedule'
        });
      reschedApptId = resA.body.data.id;
      createdAppointmentIds.push(reschedApptId);

      // David books Slot 2 (occupied)
      const resB = await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${studentDavidToken}`)
        .send({
          slotId: occupiedSlot,
          title: 'David Occupying Slot',
          purpose: 'Blocks slot 2'
        });
      createdAppointmentIds.push(resB.body.data.id);
    });

    await test('Rescheduling into an occupied slot is rejected with 409 Conflict', async () => {
      const res = await request(app)
        .post(`/api/v1/appointments/${reschedApptId}/reschedule`)
        .set('Authorization', `Bearer ${studentAliceToken}`)
        .send({
          proposedSlotId: occupiedSlot,
          reason: 'Attempting to reschedule into David occupied slot'
        });

      assert.strictEqual(res.status, HTTP_STATUS.CONFLICT);
      assert.ok(['APPOINTMENT_CONFLICT', 'SLOT_UNAVAILABLE', 'SLOT_ALREADY_BOOKED'].includes(res.body.error.code));
    });

    await test('Rescheduling ignores the appointment being edited and succeeds into a non-overlapping slot (200 OK)', async () => {
      const res = await request(app)
        .post(`/api/v1/appointments/${reschedApptId}/reschedule`)
        .set('Authorization', `Bearer ${studentAliceToken}`)
        .send({
          proposedSlotId: freeSlot,
          reason: 'Valid reschedule to afternoon'
        });

      assert.strictEqual(res.status, HTTP_STATUS.OK);
      assert.strictEqual(res.body.data.newSlotId, freeSlot);

      // Verify original slot is freed
      const oldSlot = await db.queryOne('SELECT is_booked FROM teacher_availability_slots WHERE id = ?;', [originalSlot]);
      assert.strictEqual(oldSlot.is_booked, 0);

      // Verify target slot is booked
      const newSlot = await db.queryOne('SELECT is_booked FROM teacher_availability_slots WHERE id = ?;', [freeSlot]);
      assert.strictEqual(newSlot.is_booked, 1);
    });

    // -------------------------------------------------------------------------
    // Suite 4: Standalone Conflict Detection API (POST /check-conflict)
    // -------------------------------------------------------------------------
    console.log('\n[Suite 4] Standalone Conflict API (POST /api/v1/appointments/check-conflict)...');

    await test('API detects conflict when proposed slot overlaps with an existing appointment', async () => {
      const res = await request(app)
        .post('/api/v1/appointments/check-conflict')
        .set('Authorization', `Bearer ${studentAliceToken}`)
        .send({
          slotId: occupiedSlot
        });

      assert.strictEqual(res.status, HTTP_STATUS.OK);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.hasConflict, true);
      assert.ok(
        ['OVERLAPPING_APPOINTMENT', 'SLOT_ALREADY_BOOKED'].includes(res.body.data.conflictType)
      );
    });

    await test('API reports NO conflict for an available, non-overlapping slot', async () => {
      const cleanSlot = await createTestSlot({ teacherId: 1, date: '2026-11-25', start: '09:00:00', end: '09:30:00' });

      const res = await request(app)
        .post('/api/v1/appointments/check-conflict')
        .set('Authorization', `Bearer ${studentAliceToken}`)
        .send({
          slotId: cleanSlot
        });

      assert.strictEqual(res.status, HTTP_STATUS.OK);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.hasConflict, false);
    });

    await test('API detects teacher being booked outside available hours', async () => {
      // Check a time where Teacher 1 has no availability slot configured (e.g. at midnight)
      const res = await request(app)
        .post('/api/v1/appointments/check-conflict')
        .set('Authorization', `Bearer ${studentAliceToken}`)
        .send({
          teacherId: 1,
          startTimestamp: '2026-11-25 03:00:00',
          endTimestamp: '2026-11-25 03:30:00'
        });

      assert.strictEqual(res.status, HTTP_STATUS.OK);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.hasConflict, true);
      assert.strictEqual(res.body.data.conflictType, 'OUTSIDE_AVAILABLE_HOURS');
    });

    await test('API detects invalid start and end times (start >= end)', async () => {
      const res = await request(app)
        .post('/api/v1/appointments/check-conflict')
        .set('Authorization', `Bearer ${studentAliceToken}`)
        .send({
          teacherId: 1,
          startTimestamp: '2026-11-25 11:00:00',
          endTimestamp: '2026-11-25 10:00:00' // end before start!
        });

      assert.strictEqual(res.status, HTTP_STATUS.OK);
      assert.strictEqual(res.body.data.hasConflict, true);
      assert.strictEqual(res.body.data.conflictType, 'INVALID_TIME_RANGE');
    });

    // -------------------------------------------------------------------------
    // Suite 5: Simultaneous Concurrent Requests for Overlapping Slots
    // -------------------------------------------------------------------------
    console.log('\n[Suite 5] Concurrency & Simultaneous Overlapping Booking Attempts...');

    await test('Simultaneous booking of overlapping slots: exactly ONE succeeds (201) and one is rejected (409)', async () => {
      // Slot 1: 15:00 - 15:45
      const overlapSlot1 = await createTestSlot({ teacherId: 1, date: '2026-11-26', start: '15:00:00', end: '15:45:00' });
      // Slot 2: 15:30 - 16:15 (overlaps with Slot 1!)
      const overlapSlot2 = await createTestSlot({ teacherId: 1, date: '2026-11-26', start: '15:30:00', end: '16:15:00' });

      // Dispatch concurrent requests simultaneously
      const req1 = request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${studentAliceToken}`)
        .send({
          slotId: overlapSlot1,
          title: 'Concurrent Alice Overlap Booking',
          purpose: 'Racing for overlapping slot 1'
        });

      const req2 = request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${studentDavidToken}`)
        .send({
          slotId: overlapSlot2,
          title: 'Concurrent David Overlap Booking',
          purpose: 'Racing for overlapping slot 2'
        });

      const [res1, res2] = await Promise.all([req1, req2]);

      const statuses = [res1.status, res2.status].sort();

      // Exactly one must be 201 Created and the other must be 409 Conflict
      assert.deepStrictEqual(
        statuses,
        [HTTP_STATUS.CREATED, HTTP_STATUS.CONFLICT],
        `Expected [201, 409], got [${res1.status}, ${res2.status}]`
      );

      const winner = res1.status === HTTP_STATUS.CREATED ? res1 : res2;
      const loser = res1.status === HTTP_STATUS.CONFLICT ? res1 : res2;

      createdAppointmentIds.push(winner.body.data.id);
      assert.ok(
        ['APPOINTMENT_CONFLICT', 'SLOT_UNAVAILABLE', 'SLOT_ALREADY_BOOKED'].includes(loser.body.error.code)
      );

      // Verify DB: exactly ONE appointment was created across the two overlapping slots
      const countRow = await db.queryOne(
        'SELECT count(*) as count FROM appointments WHERE slot_id IN (?, ?);',
        [overlapSlot1, overlapSlot2]
      );
      assert.strictEqual(parseInt(countRow.count, 10), 1);
    });

  } finally {
    // Proactively clean up test fixtures
    for (const apptId of createdAppointmentIds) {
      await db.execute('DELETE FROM appointment_status_history WHERE appointment_id = ?;', [apptId]);
      await db.execute('DELETE FROM appointment_reschedules WHERE appointment_id = ?;', [apptId]);
      await db.execute('DELETE FROM appointments WHERE id = ?;', [apptId]);
    }
    for (const slotId of createdSlotIds) {
      await db.execute('DELETE FROM appointment_reschedules WHERE original_slot_id = ? OR proposed_slot_id = ?;', [slotId, slotId]);
      await db.execute('DELETE FROM teacher_availability_slots WHERE id = ?;', [slotId]);
    }
  }

  console.log('\n-----------------------------------------------------------------');
  console.log(`Issue #40 Conflict Test Summary: ${passed} passed, ${failed} failed.`);
  console.log('=================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runConflictTests();
}

module.exports = { runConflictTests };
