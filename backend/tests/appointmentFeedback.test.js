/**
 * Appointment Feedback & Consultation Rating Integration Test Suite (Phase 5 — Step 2A)
 *
 * Verifies Phase 5 requirements:
 * ---------------------------------------------------------------------------------
 * Submission Coverage:
 * 1. Valid completed appointment: rating and comments persist correctly; HTTP 201.
 * 2. Rating-only submission: omitted or empty comments are stored consistently with the service contract (null).
 * 3. Rating values 1 and 5 are accepted.
 * 4. Ratings 0, 6, non-integer values, numeric strings, null, and missing values are rejected.
 * 5. Comments exceeding 1000 characters are rejected.
 * 6. Whitespace-only comments are normalized according to the service contract (null).
 * 7. Nonexistent and malformed appointment IDs return documented errors (404 / 400).
 * 8. Pending, approved, cancelled, and reschedule-pending appointments cannot receive feedback.
 * 9. A student cannot review another student's appointment (403 Forbidden).
 * 10. A teacher cannot submit student feedback (403 Forbidden).
 * 11. An unauthenticated request is rejected (401 Unauthorized).
 * 12. Duplicate feedback returns HTTP 409 with the expected error code (DUPLICATE_FEEDBACK).
 * 13. Concurrent duplicate submissions cannot create more than one feedback record.
 *
 * Retrieval Coverage:
 * 14. The owning student can retrieve feedback (200 OK).
 * 15. The assigned teacher can retrieve feedback (200 OK).
 * 16. An administrator can retrieve feedback (200 OK).
 * 17. An unrelated student or teacher cannot retrieve feedback (403 Forbidden).
 * 18. An authorized user receives data: null when an existing appointment has no feedback (200 OK).
 * 19. A nonexistent appointment returns the documented 404 response (APPOINTMENT_NOT_FOUND).
 * 20. Malformed appointment IDs return the documented validation error (INVALID_APPOINTMENT_ID / 400).
 *
 * Persistence and Transaction Safety Coverage:
 * 21. Confirm the database contains the expected feedback row and profile IDs.
 * 22. Confirm a successful submission creates exactly one notification for the assigned teacher's user account.
 * 23. Confirm unrelated users do not receive that notification.
 * 24. Verify transaction rollback behavior when notification creation fails, using established safe testing technique.
 * 25. Confirm the database uniqueness constraint prevents duplicate feedback even under competing requests.
 */

require('./setup');
const assert = require('assert');
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/database');
const notificationService = require('../src/services/notificationService');
const HTTP_STATUS = require('../src/constants/httpStatusCodes');
const { ROLES, APPOINTMENT_STATUS } = require('../src/constants/roles');

async function runAppointmentFeedbackTests() {
  console.log('\n=================================================================');
  console.log(' Teacher-Student Appointment System: Appointment Feedback Tests ');
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
      if (err.stack && process.env.DEBUG) console.error(err.stack);
      failed++;
    }
  }

  // Tracking arrays for guaranteed teardown cleanup
  const createdSlotIds = [];
  const createdAppointmentIds = [];
  const createdFeedbackIds = [];
  const createdNotificationIds = [];

  let slotCounter = 0;

  // Helper: Create a dedicated teacher availability slot on a distinct future date to guarantee no collision
  async function createTestSlot(teacherProfileId, startTime = '10:00:00', endTime = '10:30:00') {
    slotCounter++;
    const offsetDays = 30000 + slotCounter;
    const slotDate = new Date(Date.now() + 86400000 * offsetDays).toISOString().slice(0, 10);
    const startTimestamp = `${slotDate} ${startTime}`;
    const endTimestamp = `${slotDate} ${endTime}`;
    const res = await db.execute(
      `INSERT INTO teacher_availability_slots (teacher_id, slot_date, start_time, end_time, start_timestamp, end_timestamp, is_booked, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, 1, CURRENT_TIMESTAMP);`,
      [teacherProfileId, slotDate, startTime, endTime, startTimestamp, endTimestamp]
    );
    createdSlotIds.push(res.lastInsertRowid);
    return { id: res.lastInsertRowid, slotDate, startTime, endTime };
  }

  // Helper: Create a test appointment with specific lifecycle status
  async function createTestAppointment(studentProfileId, teacherProfileId, status = APPOINTMENT_STATUS.COMPLETED, title = 'Consultation Feedback Test') {
    const slot = await createTestSlot(teacherProfileId);
    const isBooked = [APPOINTMENT_STATUS.APPROVED, APPOINTMENT_STATUS.COMPLETED, APPOINTMENT_STATUS.RESCHEDULE_PENDING].includes(status) ? 1 : 0;
    await db.execute('UPDATE teacher_availability_slots SET is_booked = ? WHERE id = ?;', [isBooked, slot.id]);

    const res = await db.execute(
      `INSERT INTO appointments (student_id, teacher_id, slot_id, title, purpose, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'Academic discussion and consultation feedback testing.', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`,
      [studentProfileId, teacherProfileId, slot.id, title, status]
    );
    const apptId = res.lastInsertRowid;
    createdAppointmentIds.push(apptId);

    await db.execute(
      `INSERT INTO appointment_status_history (appointment_id, previous_status, new_status, changed_by, notes, changed_at)
       VALUES (?, NULL, ?, 1, 'Initial test setup', CURRENT_TIMESTAMP);`,
      [apptId, status]
    );

    return { id: apptId, slotId: slot.id, status, title };
  }

  // Helper: Login and obtain auth token
  const login = async (email, password = 'Password123!') => {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password });
    if (res.status !== 200 || !res.body.data || !res.body.data.token) {
      throw new Error(`Failed to login as ${email}: ${JSON.stringify(res.body)}`);
    }
    return {
      token: res.body.data.token,
      user: res.body.data.user
    };
  };

  try {
    // -----------------------------------------------------------------
    // Dynamic Test Setup: Resolve existing active seed accounts
    // -----------------------------------------------------------------
    const studentRecords = await db.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, sp.id as profile_id
       FROM users u
       JOIN roles r ON u.role_id = r.id
       JOIN student_profiles sp ON u.id = sp.user_id
       WHERE r.name = 'STUDENT' AND u.status = 'ACTIVE'
       ORDER BY u.id ASC;`
    );
    assert.ok(studentRecords.length >= 2, 'At least two active student records required for isolation tests');

    const teacherRecords = await db.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, tp.id as profile_id
       FROM users u
       JOIN roles r ON u.role_id = r.id
       JOIN teacher_profiles tp ON u.id = tp.user_id
       WHERE r.name = 'TEACHER' AND u.status = 'ACTIVE' AND tp.is_verified = 1
       ORDER BY u.id ASC;`
    );
    assert.ok(teacherRecords.length >= 2, 'At least two active verified teacher records required for isolation tests');

    const adminRecord = await db.queryOne(
      `SELECT u.id, u.email, u.first_name, u.last_name
       FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE r.name = 'ADMIN' AND u.status = 'ACTIVE'
       LIMIT 1;`
    );
    assert.ok(adminRecord, 'An active administrator user is required');

    // Authenticate test actors
    const student1Auth = await login(studentRecords[0].email);
    const student2Auth = await login(studentRecords[1].email);
    const teacher1Auth = await login(teacherRecords[0].email);
    const teacher2Auth = await login(teacherRecords[1].email);
    const adminAuth = await login(adminRecord.email);

    const student1 = { user: student1Auth.user, token: student1Auth.token, profileId: studentRecords[0].profile_id };
    const student2 = { user: student2Auth.user, token: student2Auth.token, profileId: studentRecords[1].profile_id };
    const teacher1 = { user: teacher1Auth.user, token: teacher1Auth.token, profileId: teacherRecords[0].profile_id };
    const teacher2 = { user: teacher2Auth.user, token: teacher2Auth.token, profileId: teacherRecords[1].profile_id };
    const admin = { user: adminAuth.user, token: adminAuth.token };

    // =================================================================
    // SECTION 1: SUBMISSION TESTS
    // =================================================================

    // 1. Valid completed appointment: rating and comments persist correctly; HTTP 201
    let appt1;
    await test('1. Valid completed appointment: rating and comments persist correctly; HTTP 201', async () => {
      appt1 = await createTestAppointment(student1.profileId, teacher1.profileId, APPOINTMENT_STATUS.COMPLETED, 'Advisory on Capstone Thesis');

      const res = await request(app)
        .post(`/api/v1/appointments/${appt1.id}/feedback`)
        .set('Authorization', `Bearer ${student1.token}`)
        .send({
          rating: 4,
          comments: 'Clear explanations and very helpful guidance on the capstone thesis.'
        });

      assert.strictEqual(res.status, HTTP_STATUS.CREATED, `Expected 201 Created, got ${res.status}: ${JSON.stringify(res.body)}`);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.message, 'Consultation feedback submitted successfully.');
      assert.ok(res.body.data);
      assert.strictEqual(res.body.data.appointmentId, appt1.id);
      assert.strictEqual(res.body.data.studentId, student1.profileId);
      assert.strictEqual(res.body.data.teacherId, teacher1.profileId);
      assert.strictEqual(res.body.data.rating, 4);
      assert.strictEqual(res.body.data.comments, 'Clear explanations and very helpful guidance on the capstone thesis.');
      assert.ok(res.body.data.id, 'Feedback ID should be generated');
      assert.ok(res.body.data.createdAt, 'Created timestamp should be returned');

      createdFeedbackIds.push(res.body.data.id);
    });

    // 2. Rating-only submission: omitted or empty comments are stored consistently with the service contract (null)
    await test('2. Rating-only submission: omitted or empty comments are stored consistently (null)', async () => {
      // 2a. Omitted comments field entirely
      const appt2a = await createTestAppointment(student1.profileId, teacher1.profileId, APPOINTMENT_STATUS.COMPLETED);
      const res2a = await request(app)
        .post(`/api/v1/appointments/${appt2a.id}/feedback`)
        .set('Authorization', `Bearer ${student1.token}`)
        .send({ rating: 3 });

      assert.strictEqual(res2a.status, HTTP_STATUS.CREATED);
      assert.strictEqual(res2a.body.success, true);
      assert.strictEqual(res2a.body.data.rating, 3);
      assert.strictEqual(res2a.body.data.comments, null, 'Omitted comments should normalize to null');
      createdFeedbackIds.push(res2a.body.data.id);

      const dbRow2a = await db.queryOne('SELECT comments FROM feedback_ratings WHERE id = ?;', [res2a.body.data.id]);
      assert.strictEqual(dbRow2a.comments, null, 'Database row comments should be null when omitted');

      // 2b. Explicit empty string comments
      const appt2b = await createTestAppointment(student1.profileId, teacher1.profileId, APPOINTMENT_STATUS.COMPLETED);
      const res2b = await request(app)
        .post(`/api/v1/appointments/${appt2b.id}/feedback`)
        .set('Authorization', `Bearer ${student1.token}`)
        .send({ rating: 4, comments: '' });

      assert.strictEqual(res2b.status, HTTP_STATUS.CREATED);
      assert.strictEqual(res2b.body.success, true);
      assert.strictEqual(res2b.body.data.rating, 4);
      assert.strictEqual(res2b.body.data.comments, null, 'Empty string comments should normalize to null');
      createdFeedbackIds.push(res2b.body.data.id);

      const dbRow2b = await db.queryOne('SELECT comments FROM feedback_ratings WHERE id = ?;', [res2b.body.data.id]);
      assert.strictEqual(dbRow2b.comments, null, 'Database row comments should be null when empty string provided');
    });

    // 3. Rating values 1 and 5 are accepted
    await test('3. Rating values 1 and 5 are accepted at the allowed boundaries', async () => {
      // Minimum rating = 1
      const apptMin = await createTestAppointment(student1.profileId, teacher1.profileId, APPOINTMENT_STATUS.COMPLETED);
      const resMin = await request(app)
        .post(`/api/v1/appointments/${apptMin.id}/feedback`)
        .set('Authorization', `Bearer ${student1.token}`)
        .send({ rating: 1, comments: 'Session was rushed.' });

      assert.strictEqual(resMin.status, HTTP_STATUS.CREATED);
      assert.strictEqual(resMin.body.data.rating, 1);
      createdFeedbackIds.push(resMin.body.data.id);

      // Maximum rating = 5
      const apptMax = await createTestAppointment(student1.profileId, teacher1.profileId, APPOINTMENT_STATUS.COMPLETED);
      const resMax = await request(app)
        .post(`/api/v1/appointments/${apptMax.id}/feedback`)
        .set('Authorization', `Bearer ${student1.token}`)
        .send({ rating: 5, comments: 'Exceptional mentoring session!' });

      assert.strictEqual(resMax.status, HTTP_STATUS.CREATED);
      assert.strictEqual(resMax.body.data.rating, 5);
      createdFeedbackIds.push(resMax.body.data.id);
    });

    // 4. Ratings 0, 6, non-integer values, numeric strings, null, and missing values are rejected
    await test('4. Ratings 0, 6, non-integer values, numeric strings, null, and missing values are rejected', async () => {
      const apptInvalid = await createTestAppointment(student1.profileId, teacher1.profileId, APPOINTMENT_STATUS.COMPLETED);

      const invalidPayloads = [
        { desc: 'rating 0 (below min)', payload: { rating: 0, comments: 'Invalid 0' } },
        { desc: 'rating 6 (above max)', payload: { rating: 6, comments: 'Invalid 6' } },
        { desc: 'rating -1 (negative)', payload: { rating: -1, comments: 'Negative' } },
        { desc: 'rating 3.5 (float / non-integer)', payload: { rating: 3.5, comments: 'Float' } },
        { desc: 'rating "4" (numeric string)', payload: { rating: '4', comments: 'String' } },
        { desc: 'rating null', payload: { rating: null, comments: 'Null rating' } },
        { desc: 'missing rating property', payload: { comments: 'No rating here' } },
        { desc: 'empty object payload', payload: {} }
      ];

      for (const item of invalidPayloads) {
        const res = await request(app)
          .post(`/api/v1/appointments/${apptInvalid.id}/feedback`)
          .set('Authorization', `Bearer ${student1.token}`)
          .send(item.payload);

        assert.strictEqual(
          res.status,
          HTTP_STATUS.BAD_REQUEST,
          `Expected 400 Bad Request for ${item.desc}, got ${res.status}: ${JSON.stringify(res.body)}`
        );
        assert.strictEqual(res.body.success, false);
      }

      // Confirm no feedback was written to the database for this appointment
      const feedbackCount = await db.queryOne(
        'SELECT count(*) as count FROM feedback_ratings WHERE appointment_id = ?;',
        [apptInvalid.id]
      );
      assert.strictEqual(parseInt(feedbackCount.count, 10), 0, 'No feedback row should exist for rejected submissions');
    });

    // 5. Comments exceeding 1000 characters are rejected
    await test('5. Comments exceeding 1000 characters are rejected', async () => {
      const apptCommentBound = await createTestAppointment(student1.profileId, teacher1.profileId, APPOINTMENT_STATUS.COMPLETED);

      // Comments of length 1001
      const tooLongComments = 'a'.repeat(1001);
      const resTooLong = await request(app)
        .post(`/api/v1/appointments/${apptCommentBound.id}/feedback`)
        .set('Authorization', `Bearer ${student1.token}`)
        .send({ rating: 4, comments: tooLongComments });

      assert.strictEqual(resTooLong.status, HTTP_STATUS.BAD_REQUEST);
      assert.strictEqual(resTooLong.body.success, false);

      // Verify boundary of exactly 1000 characters is accepted
      const exact1000Comments = 'b'.repeat(1000);
      const resExact1000 = await request(app)
        .post(`/api/v1/appointments/${apptCommentBound.id}/feedback`)
        .set('Authorization', `Bearer ${student1.token}`)
        .send({ rating: 4, comments: exact1000Comments });

      assert.strictEqual(resExact1000.status, HTTP_STATUS.CREATED);
      assert.strictEqual(resExact1000.body.data.comments.length, 1000);
      createdFeedbackIds.push(resExact1000.body.data.id);
    });

    // 6. Whitespace-only comments are normalized according to the service contract
    await test('6. Whitespace-only comments are normalized according to the service contract', async () => {
      const apptWhitespace = await createTestAppointment(student1.profileId, teacher1.profileId, APPOINTMENT_STATUS.COMPLETED);

      const res = await request(app)
        .post(`/api/v1/appointments/${apptWhitespace.id}/feedback`)
        .set('Authorization', `Bearer ${student1.token}`)
        .send({ rating: 5, comments: '   \t  \n   ' });

      assert.strictEqual(res.status, HTTP_STATUS.CREATED);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.comments, null, 'Whitespace-only comments must normalize to null');
      createdFeedbackIds.push(res.body.data.id);

      const dbRow = await db.queryOne('SELECT comments FROM feedback_ratings WHERE id = ?;', [res.body.data.id]);
      assert.strictEqual(dbRow.comments, null, 'Database column must store NULL for whitespace-only comments');
    });

    // 7. Nonexistent and malformed appointment IDs return documented errors
    await test('7. Nonexistent and malformed appointment IDs return documented errors', async () => {
      // 7a. Nonexistent ID (404 APPOINTMENT_NOT_FOUND)
      const res404 = await request(app)
        .post('/api/v1/appointments/99999999/feedback')
        .set('Authorization', `Bearer ${student1.token}`)
        .send({ rating: 5, comments: 'Ghost appointment' });

      assert.strictEqual(res404.status, HTTP_STATUS.NOT_FOUND);
      assert.strictEqual(res404.body.success, false);
      assert.strictEqual(res404.body.error.code, 'APPOINTMENT_NOT_FOUND');

      // 7b. Malformed IDs (400 INVALID_APPOINTMENT_ID)
      const malformedIds = ['invalid-id', '0', '-42', 'abc'];
      for (const badId of malformedIds) {
        const resBadId = await request(app)
          .post(`/api/v1/appointments/${badId}/feedback`)
          .set('Authorization', `Bearer ${student1.token}`)
          .send({ rating: 5 });

        assert.strictEqual(resBadId.status, HTTP_STATUS.BAD_REQUEST);
        assert.strictEqual(resBadId.body.success, false);
        assert.strictEqual(resBadId.body.error.code, 'INVALID_APPOINTMENT_ID');
      }
    });

    // 8. Pending, approved, cancelled, and reschedule-pending appointments cannot receive feedback
    await test('8. Pending, approved, cancelled, and reschedule-pending appointments cannot receive feedback', async () => {
      const nonCompletedStatuses = [
        APPOINTMENT_STATUS.PENDING,
        APPOINTMENT_STATUS.APPROVED,
        APPOINTMENT_STATUS.CANCELLED,
        APPOINTMENT_STATUS.RESCHEDULE_PENDING
      ];

      for (const st of nonCompletedStatuses) {
        const appt = await createTestAppointment(student1.profileId, teacher1.profileId, st);
        const res = await request(app)
          .post(`/api/v1/appointments/${appt.id}/feedback`)
          .set('Authorization', `Bearer ${student1.token}`)
          .send({ rating: 5, comments: 'Premature feedback attempt' });

        assert.strictEqual(
          res.status,
          HTTP_STATUS.BAD_REQUEST,
          `Expected 400 Bad Request for status '${st}', got ${res.status}`
        );
        assert.strictEqual(res.body.success, false);
        assert.strictEqual(res.body.error.code, 'INVALID_APPOINTMENT_STATUS');
        assert.ok(res.body.error.message.includes(st), `Error message should mention current status '${st}'`);
      }
    });

    // 9. A student cannot review another student's appointment
    await test("9. A student cannot review another student's appointment (403 Forbidden)", async () => {
      const apptStudent1 = await createTestAppointment(student1.profileId, teacher1.profileId, APPOINTMENT_STATUS.COMPLETED);

      // Student 2 attempts to submit feedback for Student 1's appointment
      const res = await request(app)
        .post(`/api/v1/appointments/${apptStudent1.id}/feedback`)
        .set('Authorization', `Bearer ${student2.token}`)
        .send({ rating: 5, comments: 'Impostor student review attempt.' });

      assert.strictEqual(res.status, HTTP_STATUS.FORBIDDEN);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'FORBIDDEN');

      // Verify no feedback was recorded
      const feedbackRow = await db.queryOne('SELECT id FROM feedback_ratings WHERE appointment_id = ?;', [apptStudent1.id]);
      assert.strictEqual(feedbackRow, null);
    });

    // 10. A teacher cannot submit student feedback
    await test('10. A teacher cannot submit student feedback (403 Forbidden)', async () => {
      const apptTeacherAttempt = await createTestAppointment(student1.profileId, teacher1.profileId, APPOINTMENT_STATUS.COMPLETED);

      // Assigned Teacher 1 attempts to submit
      const resTeacher1 = await request(app)
        .post(`/api/v1/appointments/${apptTeacherAttempt.id}/feedback`)
        .set('Authorization', `Bearer ${teacher1.token}`)
        .send({ rating: 5, comments: 'Faculty submitting feedback' });

      assert.strictEqual(resTeacher1.status, HTTP_STATUS.FORBIDDEN);
      assert.strictEqual(resTeacher1.body.success, false);
      assert.strictEqual(resTeacher1.body.error.code, 'FORBIDDEN');

      // Unrelated Teacher 2 attempts to submit
      const resTeacher2 = await request(app)
        .post(`/api/v1/appointments/${apptTeacherAttempt.id}/feedback`)
        .set('Authorization', `Bearer ${teacher2.token}`)
        .send({ rating: 5, comments: 'Foreign faculty submitting feedback' });

      assert.strictEqual(resTeacher2.status, HTTP_STATUS.FORBIDDEN);
      assert.strictEqual(resTeacher2.body.success, false);
      assert.strictEqual(resTeacher2.body.error.code, 'FORBIDDEN');
    });

    // 11. An unauthenticated request is rejected
    await test('11. An unauthenticated request is rejected (401 Unauthorized)', async () => {
      const apptAuthCheck = await createTestAppointment(student1.profileId, teacher1.profileId, APPOINTMENT_STATUS.COMPLETED);

      // Missing Authorization header
      const resNoAuth = await request(app)
        .post(`/api/v1/appointments/${apptAuthCheck.id}/feedback`)
        .send({ rating: 5 });

      assert.strictEqual(resNoAuth.status, HTTP_STATUS.UNAUTHORIZED);
      assert.strictEqual(resNoAuth.body.success, false);
      assert.strictEqual(resNoAuth.body.error.code, 'AUTHENTICATION_REQUIRED');

      // Invalid / forged bearer token
      const resBadToken = await request(app)
        .post(`/api/v1/appointments/${apptAuthCheck.id}/feedback`)
        .set('Authorization', 'Bearer invalid.bogus.token')
        .send({ rating: 5 });

      assert.strictEqual(resBadToken.status, HTTP_STATUS.UNAUTHORIZED);
      assert.strictEqual(resBadToken.body.success, false);
      assert.strictEqual(resBadToken.body.error.code, 'INVALID_TOKEN');
    });

    // 12. Duplicate feedback returns HTTP 409 with the expected error code
    await test('12. Duplicate feedback returns HTTP 409 with the expected error code (DUPLICATE_FEEDBACK)', async () => {
      const apptDuplicate = await createTestAppointment(student1.profileId, teacher1.profileId, APPOINTMENT_STATUS.COMPLETED);

      // First submission succeeds
      const resFirst = await request(app)
        .post(`/api/v1/appointments/${apptDuplicate.id}/feedback`)
        .set('Authorization', `Bearer ${student1.token}`)
        .send({ rating: 4, comments: 'First review' });

      assert.strictEqual(resFirst.status, HTTP_STATUS.CREATED);
      createdFeedbackIds.push(resFirst.body.data.id);

      // Second submission for the same appointment must return 409 Conflict
      const resSecond = await request(app)
        .post(`/api/v1/appointments/${apptDuplicate.id}/feedback`)
        .set('Authorization', `Bearer ${student1.token}`)
        .send({ rating: 5, comments: 'Second review attempt' });

      assert.strictEqual(resSecond.status, HTTP_STATUS.CONFLICT);
      assert.strictEqual(resSecond.body.success, false);
      assert.strictEqual(resSecond.body.error.code, 'DUPLICATE_FEEDBACK');
    });

    // 13. Concurrent duplicate submissions cannot create more than one feedback record
    await test('13. Concurrent duplicate submissions cannot create more than one feedback record', async () => {
      const apptRace = await createTestAppointment(student1.profileId, teacher1.profileId, APPOINTMENT_STATUS.COMPLETED);

      // Launch competing concurrent feedback requests
      const concurrentRequests = [
        request(app).post(`/api/v1/appointments/${apptRace.id}/feedback`).set('Authorization', `Bearer ${student1.token}`).send({ rating: 4, comments: 'Concurrent attempt A' }),
        request(app).post(`/api/v1/appointments/${apptRace.id}/feedback`).set('Authorization', `Bearer ${student1.token}`).send({ rating: 5, comments: 'Concurrent attempt B' }),
        request(app).post(`/api/v1/appointments/${apptRace.id}/feedback`).set('Authorization', `Bearer ${student1.token}`).send({ rating: 3, comments: 'Concurrent attempt C' })
      ];

      const responses = await Promise.all(concurrentRequests);

      const createdResponses = responses.filter(r => r.status === HTTP_STATUS.CREATED);
      const conflictResponses = responses.filter(r => r.status === HTTP_STATUS.CONFLICT);

      assert.strictEqual(createdResponses.length, 1, 'Exactly one concurrent submission must succeed with 201');
      assert.strictEqual(conflictResponses.length, responses.length - 1, 'All competing concurrent requests must receive 409 Conflict');

      for (const conf of conflictResponses) {
        assert.strictEqual(conf.body.error.code, 'DUPLICATE_FEEDBACK');
      }

      createdFeedbackIds.push(createdResponses[0].body.data.id);

      // Verify that database holds strictly 1 feedback record for this appointment
      const countRow = await db.queryOne(
        'SELECT count(*) as count FROM feedback_ratings WHERE appointment_id = ?;',
        [apptRace.id]
      );
      assert.strictEqual(parseInt(countRow.count, 10), 1, 'Database must enforce exactly one feedback row per appointment');
    });

    // =================================================================
    // SECTION 2: RETRIEVAL TESTS
    // =================================================================

    // Shared appointment with submitted feedback for retrieval tests
    const apptRetrieval = await createTestAppointment(student1.profileId, teacher1.profileId, APPOINTMENT_STATUS.COMPLETED, 'Advanced Distributed Algorithms Review');
    const subRes = await request(app)
      .post(`/api/v1/appointments/${apptRetrieval.id}/feedback`)
      .set('Authorization', `Bearer ${student1.token}`)
      .send({ rating: 5, comments: 'Invaluable feedback on consensus protocols and Paxos.' });
    assert.strictEqual(subRes.status, HTTP_STATUS.CREATED);
    const feedbackDetails = subRes.body.data;
    createdFeedbackIds.push(feedbackDetails.id);

    // 14. The owning student can retrieve feedback
    await test('14. The owning student can retrieve feedback (200 OK)', async () => {
      const res = await request(app)
        .get(`/api/v1/appointments/${apptRetrieval.id}/feedback`)
        .set('Authorization', `Bearer ${student1.token}`);

      assert.strictEqual(res.status, HTTP_STATUS.OK);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data);
      assert.strictEqual(res.body.data.id, feedbackDetails.id);
      assert.strictEqual(res.body.data.appointmentId, apptRetrieval.id);
      assert.strictEqual(res.body.data.studentId, student1.profileId);
      assert.strictEqual(res.body.data.teacherId, teacher1.profileId);
      assert.strictEqual(res.body.data.rating, 5);
      assert.strictEqual(res.body.data.comments, 'Invaluable feedback on consensus protocols and Paxos.');
    });

    // 15. The assigned teacher can retrieve feedback
    await test('15. The assigned teacher can retrieve feedback (200 OK)', async () => {
      const res = await request(app)
        .get(`/api/v1/appointments/${apptRetrieval.id}/feedback`)
        .set('Authorization', `Bearer ${teacher1.token}`);

      assert.strictEqual(res.status, HTTP_STATUS.OK);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data);
      assert.strictEqual(res.body.data.id, feedbackDetails.id);
      assert.strictEqual(res.body.data.appointmentId, apptRetrieval.id);
      assert.strictEqual(res.body.data.rating, 5);
      assert.strictEqual(res.body.data.comments, 'Invaluable feedback on consensus protocols and Paxos.');
    });

    // 16. An administrator can retrieve feedback
    await test('16. An administrator can retrieve feedback (200 OK)', async () => {
      const res = await request(app)
        .get(`/api/v1/appointments/${apptRetrieval.id}/feedback`)
        .set('Authorization', `Bearer ${admin.token}`);

      assert.strictEqual(res.status, HTTP_STATUS.OK);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data);
      assert.strictEqual(res.body.data.id, feedbackDetails.id);
      assert.strictEqual(res.body.data.rating, 5);
    });

    // 17. An unrelated student or teacher cannot retrieve feedback
    await test('17. An unrelated student or teacher cannot retrieve feedback (403 Forbidden)', async () => {
      // Unrelated Student 2
      const resStudent2 = await request(app)
        .get(`/api/v1/appointments/${apptRetrieval.id}/feedback`)
        .set('Authorization', `Bearer ${student2.token}`);

      assert.strictEqual(resStudent2.status, HTTP_STATUS.FORBIDDEN);
      assert.strictEqual(resStudent2.body.success, false);
      assert.strictEqual(resStudent2.body.error.code, 'FORBIDDEN');

      // Unrelated Teacher 2
      const resTeacher2 = await request(app)
        .get(`/api/v1/appointments/${apptRetrieval.id}/feedback`)
        .set('Authorization', `Bearer ${teacher2.token}`);

      assert.strictEqual(resTeacher2.status, HTTP_STATUS.FORBIDDEN);
      assert.strictEqual(resTeacher2.body.success, false);
      assert.strictEqual(resTeacher2.body.error.code, 'FORBIDDEN');
    });

    // 18. An authorized user receives data: null when an existing appointment has no feedback
    await test('18. An authorized user receives data: null when an existing appointment has no feedback (200 OK)', async () => {
      const apptNoFeedback = await createTestAppointment(student1.profileId, teacher1.profileId, APPOINTMENT_STATUS.COMPLETED);

      // Student owner gets data: null
      const resStudent = await request(app)
        .get(`/api/v1/appointments/${apptNoFeedback.id}/feedback`)
        .set('Authorization', `Bearer ${student1.token}`);
      assert.strictEqual(resStudent.status, HTTP_STATUS.OK);
      assert.strictEqual(resStudent.body.success, true);
      assert.strictEqual(resStudent.body.data, null);

      // Assigned teacher gets data: null
      const resTeacher = await request(app)
        .get(`/api/v1/appointments/${apptNoFeedback.id}/feedback`)
        .set('Authorization', `Bearer ${teacher1.token}`);
      assert.strictEqual(resTeacher.status, HTTP_STATUS.OK);
      assert.strictEqual(resTeacher.body.success, true);
      assert.strictEqual(resTeacher.body.data, null);

      // Admin gets data: null
      const resAdmin = await request(app)
        .get(`/api/v1/appointments/${apptNoFeedback.id}/feedback`)
        .set('Authorization', `Bearer ${admin.token}`);
      assert.strictEqual(resAdmin.status, HTTP_STATUS.OK);
      assert.strictEqual(resAdmin.body.success, true);
      assert.strictEqual(resAdmin.body.data, null);
    });

    // 19. A nonexistent appointment returns the documented 404 response
    await test('19. A nonexistent appointment returns the documented 404 response (APPOINTMENT_NOT_FOUND)', async () => {
      const res = await request(app)
        .get('/api/v1/appointments/99999999/feedback')
        .set('Authorization', `Bearer ${student1.token}`);

      assert.strictEqual(res.status, HTTP_STATUS.NOT_FOUND);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'APPOINTMENT_NOT_FOUND');
    });

    // 20. Malformed appointment IDs return the documented validation error
    await test('20. Malformed appointment IDs return documented validation error (INVALID_APPOINTMENT_ID / 400)', async () => {
      const malformedIds = ['not-a-number', '0', '-99'];
      for (const badId of malformedIds) {
        const res = await request(app)
          .get(`/api/v1/appointments/${badId}/feedback`)
          .set('Authorization', `Bearer ${student1.token}`);

        assert.strictEqual(res.status, HTTP_STATUS.BAD_REQUEST);
        assert.strictEqual(res.body.success, false);
        assert.strictEqual(res.body.error.code, 'INVALID_APPOINTMENT_ID');
      }
    });

    // =================================================================
    // SECTION 3: PERSISTENCE AND TRANSACTION SAFETY
    // =================================================================

    // 21. Confirm the database contains the expected feedback row and profile IDs
    await test('21. Confirm the database contains the expected feedback row and profile IDs', async () => {
      const apptPersist = await createTestAppointment(student1.profileId, teacher1.profileId, APPOINTMENT_STATUS.COMPLETED);

      const res = await request(app)
        .post(`/api/v1/appointments/${apptPersist.id}/feedback`)
        .set('Authorization', `Bearer ${student1.token}`)
        .send({ rating: 5, comments: 'Persisted feedback verification.' });

      assert.strictEqual(res.status, HTTP_STATUS.CREATED);
      const createdId = res.body.data.id;
      createdFeedbackIds.push(createdId);

      // Direct database verification
      const dbRow = await db.queryOne(
        `SELECT id, appointment_id, student_id, teacher_id, rating, comments, created_at
         FROM feedback_ratings
         WHERE id = ?;`,
        [createdId]
      );

      assert.ok(dbRow, 'Feedback row must exist in the database');
      assert.strictEqual(dbRow.appointment_id, apptPersist.id);
      assert.strictEqual(dbRow.student_id, student1.profileId);
      assert.strictEqual(dbRow.teacher_id, teacher1.profileId);
      assert.strictEqual(dbRow.rating, 5);
      assert.strictEqual(dbRow.comments, 'Persisted feedback verification.');
      assert.ok(dbRow.created_at, 'created_at timestamp must be recorded');
    });

    // 22. Confirm a successful submission creates exactly one notification for the assigned teacher's user account
    let apptNotif;
    await test("22. Confirm a successful submission creates exactly one notification for the assigned teacher's user account", async () => {
      apptNotif = await createTestAppointment(student1.profileId, teacher1.profileId, APPOINTMENT_STATUS.COMPLETED, 'Database Indexing Consultation');

      const res = await request(app)
        .post(`/api/v1/appointments/${apptNotif.id}/feedback`)
        .set('Authorization', `Bearer ${student1.token}`)
        .send({ rating: 5, comments: 'Super helpful feedback on B-tree indexing.' });

      assert.strictEqual(res.status, HTTP_STATUS.CREATED);
      createdFeedbackIds.push(res.body.data.id);

      // Query notifications created for this appointment and recipient
      const notifs = await db.query(
        `SELECT id, recipient_id, appointment_id, title, message, type, is_read, created_at
         FROM notifications
         WHERE appointment_id = ? AND recipient_id = ?;`,
        [apptNotif.id, teacher1.user.id]
      );

      assert.strictEqual(notifs.length, 1, 'Exactly one notification must be generated for the assigned teacher');
      const teacherNotif = notifs[0];
      createdNotificationIds.push(teacherNotif.id);

      assert.strictEqual(teacherNotif.recipient_id, teacher1.user.id, "Notification recipient must be teacher's user ID, not profile ID");
      assert.strictEqual(teacherNotif.type, notificationService.NOTIFICATION_TYPES.STATUS_UPDATE);
      assert.strictEqual(teacherNotif.title, 'Consultation Feedback Received');
      assert.ok(teacherNotif.message.includes('5/5 stars'), 'Notification message must include star rating');
      assert.ok(teacherNotif.message.includes(apptNotif.title), 'Notification message must reference appointment title');
      assert.strictEqual(teacherNotif.is_read, 0, 'Initial notification state must be unread (0)');
    });

    // 23. Confirm unrelated users do not receive that notification
    await test('23. Confirm unrelated users do not receive that notification', async () => {
      // Check that the student who submitted does NOT receive this teacher feedback notification
      const studentNotifCount = await db.queryOne(
        'SELECT count(*) as count FROM notifications WHERE appointment_id = ? AND recipient_id = ?;',
        [apptNotif.id, student1.user.id]
      );
      assert.strictEqual(parseInt(studentNotifCount.count, 10), 0, 'Submitting student must not receive feedback notification');

      // Check that unrelated student does not receive it
      const student2NotifCount = await db.queryOne(
        'SELECT count(*) as count FROM notifications WHERE appointment_id = ? AND recipient_id = ?;',
        [apptNotif.id, student2.user.id]
      );
      assert.strictEqual(parseInt(student2NotifCount.count, 10), 0, 'Unrelated student must not receive feedback notification');

      // Check that unrelated teacher does not receive it
      const teacher2NotifCount = await db.queryOne(
        'SELECT count(*) as count FROM notifications WHERE appointment_id = ? AND recipient_id = ?;',
        [apptNotif.id, teacher2.user.id]
      );
      assert.strictEqual(parseInt(teacher2NotifCount.count, 10), 0, 'Unrelated teacher must not receive feedback notification');

      // Check that admin does not receive it
      const adminNotifCount = await db.queryOne(
        'SELECT count(*) as count FROM notifications WHERE appointment_id = ? AND recipient_id = ?;',
        [apptNotif.id, admin.user.id]
      );
      assert.strictEqual(parseInt(adminNotifCount.count, 10), 0, 'Admin must not receive feedback notification');
    });

    // 24. Verify transaction rollback behavior when notification creation fails, using repository's established safe testing technique
    await test('24. Verify transaction rollback behavior when notification creation fails', async () => {
      const apptRollback = await createTestAppointment(student1.profileId, teacher1.profileId, APPOINTMENT_STATUS.COMPLETED, 'Transaction Rollback Test');

      const originalCreateNotification = notificationService.createNotification;

      try {
        // Temporarily stub createNotification to trigger transaction rollback
        notificationService.createNotification = async () => {
          throw new Error('Simulated notification dispatch failure for transaction rollback test');
        };

        const res = await request(app)
          .post(`/api/v1/appointments/${apptRollback.id}/feedback`)
          .set('Authorization', `Bearer ${student1.token}`)
          .send({ rating: 5, comments: 'This submission must be rolled back.' });

        assert.strictEqual(
          res.status,
          HTTP_STATUS.INTERNAL_SERVER_ERROR,
          `Expected 500 on transaction failure, got ${res.status}`
        );
      } finally {
        // Restore original function immediately
        notificationService.createNotification = originalCreateNotification;
      }

      // Verify that feedback row was rolled back completely
      const feedbackRow = await db.queryOne(
        'SELECT id FROM feedback_ratings WHERE appointment_id = ?;',
        [apptRollback.id]
      );
      assert.strictEqual(feedbackRow, null, 'Feedback record must not persist when transaction rolls back');

      // Verify that no notification was persisted
      const notifRow = await db.queryOne(
        'SELECT id FROM notifications WHERE appointment_id = ?;',
        [apptRollback.id]
      );
      assert.strictEqual(notifRow, null, 'Notification must not persist when transaction rolls back');

      // Verify subsequent submission succeeds on the same appointment now that transaction rolled back cleanly
      const retryRes = await request(app)
        .post(`/api/v1/appointments/${apptRollback.id}/feedback`)
        .set('Authorization', `Bearer ${student1.token}`)
        .send({ rating: 5, comments: 'Clean retry after rollback.' });

      assert.strictEqual(retryRes.status, HTTP_STATUS.CREATED);
      assert.strictEqual(retryRes.body.success, true);
      createdFeedbackIds.push(retryRes.body.data.id);
    });

    // 25. Confirm the database uniqueness constraint prevents duplicate feedback even under competing requests
    await test('25. Confirm the database uniqueness constraint prevents duplicate feedback even under competing requests', async () => {
      const apptConstraint = await createTestAppointment(student1.profileId, teacher1.profileId, APPOINTMENT_STATUS.COMPLETED);

      // Direct insertion of primary feedback record
      const initialInsert = await db.execute(
        `INSERT INTO feedback_ratings (appointment_id, student_id, teacher_id, rating, comments, created_at)
         VALUES (?, ?, ?, 4, 'Original record', CURRENT_TIMESTAMP);`,
        [apptConstraint.id, student1.profileId, teacher1.profileId]
      );
      createdFeedbackIds.push(initialInsert.lastInsertRowid);

      // Direct competing insert bypassing application pre-checks must throw UNIQUE constraint violation
      let caughtDbError = null;
      try {
        await db.execute(
          `INSERT INTO feedback_ratings (appointment_id, student_id, teacher_id, rating, comments, created_at)
           VALUES (?, ?, ?, 5, 'Bypass insert attempt', CURRENT_TIMESTAMP);`,
          [apptConstraint.id, student1.profileId, teacher1.profileId]
        );
      } catch (err) {
        caughtDbError = err;
      }

      assert.ok(caughtDbError, 'Direct duplicate insert should fail at the database level');
      assert.ok(
        caughtDbError.message && caughtDbError.message.includes('UNIQUE constraint failed'),
        `Expected UNIQUE constraint failed, got: ${caughtDbError ? caughtDbError.message : 'none'}`
      );

      // Verify row count remains strictly 1
      const count = await db.queryOne(
        'SELECT count(*) as count FROM feedback_ratings WHERE appointment_id = ?;',
        [apptConstraint.id]
      );
      assert.strictEqual(parseInt(count.count, 10), 1, 'Database must preserve strict 1:1 relationship between appointment and feedback');
    });

  } finally {
    // -----------------------------------------------------------------
    // Teardown: Safely clean up only records generated by this test suite
    // -----------------------------------------------------------------
    try {
      if (createdFeedbackIds.length > 0) {
        const ph = createdFeedbackIds.map(() => '?').join(',');
        await db.execute(`DELETE FROM feedback_ratings WHERE id IN (${ph});`, createdFeedbackIds);
      }

      if (createdAppointmentIds.length > 0) {
        const ph = createdAppointmentIds.map(() => '?').join(',');
        await db.execute(`DELETE FROM feedback_ratings WHERE appointment_id IN (${ph});`, createdAppointmentIds);
        await db.execute(`DELETE FROM appointment_status_history WHERE appointment_id IN (${ph});`, createdAppointmentIds);
        await db.execute(`DELETE FROM appointment_reschedules WHERE appointment_id IN (${ph});`, createdAppointmentIds);
        await db.execute(`DELETE FROM notifications WHERE appointment_id IN (${ph});`, createdAppointmentIds);
        await db.execute(`DELETE FROM appointments WHERE id IN (${ph});`, createdAppointmentIds);
      }

      if (createdNotificationIds.length > 0) {
        const ph = createdNotificationIds.map(() => '?').join(',');
        await db.execute(`DELETE FROM notifications WHERE id IN (${ph});`, createdNotificationIds);
      }

      if (createdSlotIds.length > 0) {
        const ph = createdSlotIds.map(() => '?').join(',');
        await db.execute(`DELETE FROM teacher_availability_slots WHERE id IN (${ph});`, createdSlotIds);
      }
    } catch (cleanupErr) {
      console.warn('[AppointmentFeedbackTest] Teardown cleanup warning:', cleanupErr.message);
    }
  }

  console.log('\n-----------------------------------------------------------------');
  console.log(`Appointment Feedback Test Summary: ${passed} passed, ${failed} failed.`);
  console.log('=================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

// Execute test suite when run directly
if (require.main === module) {
  runAppointmentFeedbackTests().catch((err) => {
    console.error('Test suite execution failed:', err);
    process.exit(1);
  });
}

module.exports = { runAppointmentFeedbackTests };
