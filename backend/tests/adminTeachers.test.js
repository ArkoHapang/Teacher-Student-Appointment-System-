/**
 * Admin Teacher Management Test Suite (GitHub Issue #37)
 * Comprehensive automated verification for administrative teacher operations:
 * 1. Security & RBAC: Enforce ADMIN permissions, reject Students and Teachers (403), reject Unauthenticated (401).
 * 2. Paginated list retrieval, page/limit bounds, and multi-field sorting.
 * 3. Search and filtering (name, email, department, designation, status, verification).
 * 4. Individual teacher detail retrieval (courses, slot/appointment metrics, no password leaks).
 * 5. Teacher creation (atomic user + profile + courses, duplicate email guard, validation).
 * 6. Permitted field updates, duplicate email check, role immutability defense.
 * 7. Status & availability management: deactivation/suspension, slot deactivation, upcoming appointment handling.
 * 8. Audit ledger verification for administrative operations.
 */

const assert = require('assert');
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/database');
const HTTP_STATUS = require('../src/constants/httpStatusCodes');
const { USER_STATUS } = require('../src/constants/roles');

async function runAdminTeacherTests() {
  console.log('\n=================================================================');
  console.log(' Teacher-Student Appointment System: Issue #37 Admin Teacher Tests');
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

  // Pre-cleanup in case of previous interrupted runs
  const existingAlan = await db.queryOne("SELECT id FROM users WHERE email = 'alan.turing@university.edu';");
  if (existingAlan) {
    const profile = await db.queryOne('SELECT id FROM teacher_profiles WHERE user_id = ?;', [existingAlan.id]);
    if (profile) {
      await db.execute('DELETE FROM appointments WHERE teacher_id = ?;', [profile.id]);
      await db.execute('DELETE FROM teacher_availability_slots WHERE teacher_id = ?;', [profile.id]);
      await db.execute('DELETE FROM teacher_courses WHERE teacher_id = ?;', [profile.id]);
      await db.execute('DELETE FROM teacher_profiles WHERE id = ?;', [profile.id]);
    }
    await db.execute('DELETE FROM users WHERE id = ?;', [existingAlan.id]);
  }

  // Track created entities for deterministic cleanup
  const createdUserIds = [];
  const createdTeacherProfileIds = [];
  const createdSlotIds = [];
  const createdAppointmentIds = [];

  try {
    // -------------------------------------------------------------
    // Section 1: Security & RBAC Enforcement
    // -------------------------------------------------------------
    await test('Security: Student is rejected from listing teachers (403 Forbidden)', async () => {
      const res = await request(app)
        .get('/api/v1/admin/teachers')
        .set('Authorization', `Bearer ${studentToken}`);
      assert.strictEqual(res.status, HTTP_STATUS.FORBIDDEN);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'FORBIDDEN');
    });

    await test('Security: Teacher is rejected from listing teachers (403 Forbidden)', async () => {
      const res = await request(app)
        .get('/api/v1/admin/teachers')
        .set('Authorization', `Bearer ${teacherToken}`);
      assert.strictEqual(res.status, HTTP_STATUS.FORBIDDEN);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'FORBIDDEN');
    });

    await test('Security: Unauthenticated request is rejected (401 Unauthorized)', async () => {
      const res = await request(app)
        .get('/api/v1/admin/teachers');
      assert.strictEqual(res.status, HTTP_STATUS.UNAUTHORIZED);
      assert.strictEqual(res.body.success, false);
    });

    await test('Security: Non-admin is rejected from creating a teacher (403 Forbidden)', async () => {
      const res = await request(app)
        .post('/api/v1/admin/teachers')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({
          firstName: 'Unauthorized',
          lastName: 'User',
          email: 'unauth@university.edu',
          departmentId: 1,
          designation: 'Lecturer',
          officeRoom: 'Room 101'
        });
      assert.strictEqual(res.status, HTTP_STATUS.FORBIDDEN);
      assert.strictEqual(res.body.success, false);
    });

    await test('Security: Non-admin is rejected from editing a teacher profile (403 Forbidden)', async () => {
      const res = await request(app)
        .patch('/api/v1/admin/teachers/1')
        .set('Authorization', `Bearer ${teacherToken}`)
        .send({ designation: 'Associate Professor' });
      assert.strictEqual(res.status, HTTP_STATUS.FORBIDDEN);
    });

    await test('Security: Non-admin is rejected from updating teacher status (403 Forbidden)', async () => {
      const res = await request(app)
        .patch('/api/v1/admin/teachers/1/status')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ status: 'SUSPENDED' });
      assert.strictEqual(res.status, HTTP_STATUS.FORBIDDEN);
    });

    // -------------------------------------------------------------
    // Section 2: Paginated List Retrieval & Bounds
    // -------------------------------------------------------------
    await test('Pagination: Admin retrieves default paginated teacher list', async () => {
      const res = await request(app)
        .get('/api/v1/admin/teachers')
        .set('Authorization', `Bearer ${adminToken}`);

      assert.strictEqual(res.status, HTTP_STATUS.OK);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data.total >= 4, 'Should have at least 4 seeded teachers');
      assert.strictEqual(res.body.data.page, 1);
      assert.strictEqual(res.body.data.limit, 10);
      assert.ok(Array.isArray(res.body.data.teachers));
      assert.ok(res.body.data.teachers.length >= 4);

      // Verify structure of items and ensure NO password hash is exposed
      const firstTeacher = res.body.data.teachers[0];
      assert.ok(firstTeacher.id);
      assert.ok(firstTeacher.email);
      assert.ok(firstTeacher.firstName);
      assert.ok(firstTeacher.lastName);
      assert.ok(firstTeacher.department);
      assert.ok(firstTeacher.department.code);
      assert.ok(firstTeacher.metrics);
      assert.strictEqual(firstTeacher.password_hash, undefined, 'Sensitive password_hash must never be leaked');
      assert.strictEqual(firstTeacher.password, undefined, 'Sensitive password must never be leaked');
    });

    await test('Pagination: Limit and page query params are respected', async () => {
      const res = await request(app)
        .get('/api/v1/admin/teachers?limit=2&page=1')
        .set('Authorization', `Bearer ${adminToken}`);

      assert.strictEqual(res.status, HTTP_STATUS.OK);
      assert.strictEqual(res.body.data.limit, 2);
      assert.strictEqual(res.body.data.page, 1);
      assert.strictEqual(res.body.data.teachers.length, 2);
      assert.ok(res.body.data.totalPages >= 2);

      const resPage2 = await request(app)
        .get('/api/v1/admin/teachers?limit=2&page=2')
        .set('Authorization', `Bearer ${adminToken}`);

      assert.strictEqual(resPage2.status, HTTP_STATUS.OK);
      assert.strictEqual(resPage2.body.data.page, 2);
      assert.strictEqual(resPage2.body.data.teachers.length, 2);
      // Verify page 2 has different teachers than page 1
      assert.notStrictEqual(res.body.data.teachers[0].id, resPage2.body.data.teachers[0].id);
    });

    await test('Sorting: Teachers can be sorted by name ASC/DESC and email', async () => {
      const resAsc = await request(app)
        .get('/api/v1/admin/teachers?sortBy=name&sortOrder=ASC')
        .set('Authorization', `Bearer ${adminToken}`);
      assert.strictEqual(resAsc.status, HTTP_STATUS.OK);
      const namesAsc = resAsc.body.data.teachers.map((t) => t.lastName);
      const sortedNames = [...namesAsc].sort((a, b) => a.localeCompare(b));
      assert.deepStrictEqual(namesAsc, sortedNames, 'Names should be in ascending order');

      const resDesc = await request(app)
        .get('/api/v1/admin/teachers?sortBy=name&sortOrder=DESC')
        .set('Authorization', `Bearer ${adminToken}`);
      assert.strictEqual(resDesc.status, HTTP_STATUS.OK);
      const namesDesc = resDesc.body.data.teachers.map((t) => t.lastName);
      const expectedDesc = [...namesDesc].sort((a, b) => b.localeCompare(a));
      assert.deepStrictEqual(namesDesc, expectedDesc, 'Names should be in descending order');
    });

    // -------------------------------------------------------------
    // Section 3: Search and Filtering
    // -------------------------------------------------------------
    await test('Search: Keyword search finds teachers by last name', async () => {
      const res = await request(app)
        .get('/api/v1/admin/teachers?search=Miller')
        .set('Authorization', `Bearer ${adminToken}`);
      assert.strictEqual(res.status, HTTP_STATUS.OK);
      assert.strictEqual(res.body.data.total, 1);
      assert.strictEqual(res.body.data.teachers[0].lastName, 'Miller');
    });

    await test('Search: Keyword search finds teachers by email', async () => {
      const res = await request(app)
        .get('/api/v1/admin/teachers?search=sarah.jenkins')
        .set('Authorization', `Bearer ${adminToken}`);
      assert.strictEqual(res.status, HTTP_STATUS.OK);
      assert.strictEqual(res.body.data.total, 1);
      assert.strictEqual(res.body.data.teachers[0].email, 'sarah.jenkins@university.edu');
    });

    await test('Search: Keyword search finds teachers by department code', async () => {
      const res = await request(app)
        .get('/api/v1/admin/teachers?search=CSE')
        .set('Authorization', `Bearer ${adminToken}`);
      assert.strictEqual(res.status, HTTP_STATUS.OK);
      assert.ok(res.body.data.total >= 2);
      for (const t of res.body.data.teachers) {
        assert.ok(
          t.department.code.includes('CSE') ||
          t.firstName.includes('CSE') ||
          t.lastName.includes('CSE') ||
          t.designation.includes('CSE')
        );
      }
    });

    await test('Filter: Filter teachers by departmentId', async () => {
      const res = await request(app)
        .get('/api/v1/admin/teachers?departmentId=1') // CSE
        .set('Authorization', `Bearer ${adminToken}`);
      assert.strictEqual(res.status, HTTP_STATUS.OK);
      for (const t of res.body.data.teachers) {
        assert.strictEqual(t.department.id, 1);
      }
    });

    await test('Filter: Filter teachers by status and verification', async () => {
      const resActive = await request(app)
        .get('/api/v1/admin/teachers?status=ACTIVE')
        .set('Authorization', `Bearer ${adminToken}`);
      assert.strictEqual(resActive.status, HTTP_STATUS.OK);
      for (const t of resActive.body.data.teachers) {
        assert.strictEqual(t.status, 'ACTIVE');
      }

      const resVerified = await request(app)
        .get('/api/v1/admin/teachers?isVerified=1')
        .set('Authorization', `Bearer ${adminToken}`);
      assert.strictEqual(resVerified.status, HTTP_STATUS.OK);
      for (const t of resVerified.body.data.teachers) {
        assert.strictEqual(t.isVerified, 1);
      }
    });

    // -------------------------------------------------------------
    // Section 4: Individual Teacher Detail View
    // -------------------------------------------------------------
    await test('View Details: Retrieve teacher record with courses and statistics', async () => {
      const res = await request(app)
        .get('/api/v1/admin/teachers/1')
        .set('Authorization', `Bearer ${adminToken}`);

      assert.strictEqual(res.status, HTTP_STATUS.OK);
      assert.strictEqual(res.body.success, true);
      const teacher = res.body.data.teacher;
      assert.strictEqual(teacher.id, 1);
      assert.strictEqual(teacher.email, 'robert.miller@university.edu');
      assert.strictEqual(teacher.firstName, 'Robert');
      assert.strictEqual(teacher.lastName, 'Miller');
      assert.strictEqual(teacher.status, 'ACTIVE');
      assert.strictEqual(teacher.department.code, 'CSE');
      assert.ok(Array.isArray(teacher.courses), 'Should have courses array');
      assert.ok(teacher.courses.some((c) => c.courseCode === 'CSE301'));
      assert.ok(teacher.stats, 'Should contain appointment and slot stats');
      assert.ok(typeof teacher.stats.totalSlots === 'number');
      assert.ok(typeof teacher.stats.totalAppointments === 'number');

      // Privacy check: no password fields exposed
      assert.strictEqual(teacher.password_hash, undefined);
      assert.strictEqual(teacher.password, undefined);
    });

    await test('View Details: Non-existent teacher returns 404 Not Found', async () => {
      const res = await request(app)
        .get('/api/v1/admin/teachers/999999')
        .set('Authorization', `Bearer ${adminToken}`);

      assert.strictEqual(res.status, HTTP_STATUS.NOT_FOUND);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'TEACHER_NOT_FOUND');
    });

    await test('View Details: Invalid non-numeric teacher ID returns 400 Bad Request', async () => {
      const res = await request(app)
        .get('/api/v1/admin/teachers/not-a-number')
        .set('Authorization', `Bearer ${adminToken}`);

      assert.strictEqual(res.status, HTTP_STATUS.BAD_REQUEST);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'INVALID_TEACHER_ID');
    });

    // -------------------------------------------------------------
    // Section 5: Teacher Record Creation
    // -------------------------------------------------------------
    let createdTeacherId = null;
    let createdUserId = null;

    await test('Create Teacher: Successfully creates user, teacher profile, and courses', async () => {
      const newTeacherData = {
        email: 'alan.turing@university.edu',
        password: 'SecurePassword123!',
        firstName: 'Alan',
        lastName: 'Turing',
        departmentId: 1, // CSE
        designation: 'Full Professor',
        officeRoom: 'Alan Hall 401',
        bio: 'Pioneer of theoretical computer science and artificial intelligence.',
        isVerified: 1,
        courses: [
          { courseCode: 'CSE501', courseTitle: 'Advanced Computability & Automata' },
          { courseCode: 'CSE502', courseTitle: 'Cryptographic Protocols' }
        ]
      };

      const res = await request(app)
        .post('/api/v1/admin/teachers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(newTeacherData);

      assert.strictEqual(res.status, HTTP_STATUS.CREATED);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data.teacher.id);
      assert.ok(res.body.data.teacher.userId);
      assert.strictEqual(res.body.data.teacher.email, 'alan.turing@university.edu');
      assert.strictEqual(res.body.data.teacher.firstName, 'Alan');
      assert.strictEqual(res.body.data.teacher.status, 'ACTIVE');
      assert.strictEqual(res.body.data.teacher.isVerified, 1);
      assert.strictEqual(res.body.data.teacher.courses.length, 2);
      assert.strictEqual(res.body.data.teacher.password_hash, undefined);

      createdTeacherId = res.body.data.teacher.id;
      createdUserId = res.body.data.teacher.userId;
      createdTeacherProfileIds.push(createdTeacherId);
      createdUserIds.push(createdUserId);

      // Verify role in database is strictly TEACHER
      const userDb = await db.queryOne(
        `SELECT u.id, u.email, r.name as role_name
         FROM users u
         JOIN roles r ON u.role_id = r.id
         WHERE u.id = ?;`,
        [createdUserId]
      );
      assert.strictEqual(userDb.role_name, 'TEACHER');

      // Verify audit log entry
      const audit = await db.queryOne(
        "SELECT id, action, entity_id FROM audit_logs WHERE action = 'CREATE_TEACHER' AND entity_id = ? ORDER BY id DESC LIMIT 1;",
        [String(createdTeacherId)]
      );
      assert.ok(audit, 'Audit log entry must be recorded for CREATE_TEACHER');
    });

    await test('Create Teacher: Duplicate email returns 409 Conflict', async () => {
      const duplicateData = {
        email: 'alan.turing@university.edu', // Duplicate
        firstName: 'Duplicate',
        lastName: 'Turing',
        departmentId: 1,
        designation: 'Lecturer',
        officeRoom: 'Room 202'
      };

      const res = await request(app)
        .post('/api/v1/admin/teachers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(duplicateData);

      assert.strictEqual(res.status, HTTP_STATUS.CONFLICT);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'DUPLICATE_EMAIL');
    });

    await test('Create Teacher: Invalid email format returns 400 Bad Request', async () => {
      const badEmailData = {
        email: 'not-an-email',
        firstName: 'John',
        lastName: 'Doe',
        departmentId: 1,
        designation: 'Lecturer',
        officeRoom: 'Room 101'
      };

      const res = await request(app)
        .post('/api/v1/admin/teachers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(badEmailData);

      assert.strictEqual(res.status, HTTP_STATUS.BAD_REQUEST);
      assert.strictEqual(res.body.error.code, 'VALIDATION_ERROR');
    });

    await test('Create Teacher: Missing required fields returns 400 Bad Request', async () => {
      const missingNameData = {
        email: 'noname@university.edu',
        // firstName missing
        lastName: 'Doe',
        departmentId: 1,
        designation: 'Lecturer',
        officeRoom: 'Room 101'
      };

      const res = await request(app)
        .post('/api/v1/admin/teachers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(missingNameData);

      assert.strictEqual(res.status, HTTP_STATUS.BAD_REQUEST);
      assert.strictEqual(res.body.error.code, 'VALIDATION_ERROR');
    });

    await test('Create Teacher: Non-existent departmentId returns 400 Bad Request', async () => {
      const badDeptData = {
        email: 'nodept@university.edu',
        firstName: 'Jane',
        lastName: 'Doe',
        departmentId: 99999, // Non-existent
        designation: 'Lecturer',
        officeRoom: 'Room 101'
      };

      const res = await request(app)
        .post('/api/v1/admin/teachers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(badDeptData);

      assert.strictEqual(res.status, HTTP_STATUS.BAD_REQUEST);
      assert.strictEqual(res.body.error.code, 'DEPARTMENT_NOT_FOUND');
    });

    // -------------------------------------------------------------
    // Section 6: Edit Permitted Profile & Account Fields
    // -------------------------------------------------------------
    await test('Update Teacher: Successfully updates permitted fields', async () => {
      const updateData = {
        firstName: 'Sir Alan',
        lastName: 'Turing-OM',
        designation: 'Distinguished University Chair',
        officeRoom: 'Alan Tower 900',
        bio: 'Father of modern computing and artificial intelligence.',
        isVerified: 1
      };

      const res = await request(app)
        .patch(`/api/v1/admin/teachers/${createdTeacherId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(updateData);

      assert.strictEqual(res.status, HTTP_STATUS.OK);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.teacher.firstName, 'Sir Alan');
      assert.strictEqual(res.body.data.teacher.lastName, 'Turing-OM');
      assert.strictEqual(res.body.data.teacher.designation, 'Distinguished University Chair');
      assert.strictEqual(res.body.data.teacher.officeRoom, 'Alan Tower 900');

      // Verify audit log recorded
      const audit = await db.queryOne(
        "SELECT id, action, entity_id FROM audit_logs WHERE action = 'UPDATE_TEACHER' AND entity_id = ? ORDER BY id DESC LIMIT 1;",
        [String(createdTeacherId)]
      );
      assert.ok(audit, 'Audit log entry must be recorded for UPDATE_TEACHER');
    });

    await test('Update Teacher: Role elevation attempt is rejected (ROLE_IMMUTABLE)', async () => {
      const elevationAttempt = {
        role: 'ADMIN',
        role_id: 1,
        designation: 'Hacked Chair'
      };

      const res = await request(app)
        .patch(`/api/v1/admin/teachers/${createdTeacherId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(elevationAttempt);

      assert.strictEqual(res.status, HTTP_STATUS.BAD_REQUEST);
      assert.strictEqual(res.body.error.code, 'ROLE_IMMUTABLE');

      // Verify database role has NOT changed
      const user = await db.queryOne('SELECT role_id FROM users WHERE id = ?;', [createdUserId]);
      const role = await db.queryOne('SELECT name FROM roles WHERE id = ?;', [user.role_id]);
      assert.strictEqual(role.name, 'TEACHER', 'Role must remain TEACHER');
    });

    await test('Update Teacher: Updating email to another existing user returns 409 Conflict', async () => {
      const duplicateUpdate = {
        email: 'robert.miller@university.edu' // Existing email
      };

      const res = await request(app)
        .patch(`/api/v1/admin/teachers/${createdTeacherId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(duplicateUpdate);

      assert.strictEqual(res.status, HTTP_STATUS.CONFLICT);
      assert.strictEqual(res.body.error.code, 'DUPLICATE_EMAIL');
    });

    await test('Update Teacher: Updating non-existent teacher returns 404 Not Found', async () => {
      const res = await request(app)
        .patch('/api/v1/admin/teachers/999999')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ designation: 'Ghost' });

      assert.strictEqual(res.status, HTTP_STATUS.NOT_FOUND);
      assert.strictEqual(res.body.error.code, 'TEACHER_NOT_FOUND');
    });

    // -------------------------------------------------------------
    // Section 7: Status & Availability Management
    // -------------------------------------------------------------
    // Setup test slots and upcoming appointment for the newly created teacher
    let futureSlot1Id = null;
    let futureSlot2Id = null;
    let appointmentId = null;

    const slot1Res = await db.execute(
      `INSERT INTO teacher_availability_slots (teacher_id, slot_date, start_time, end_time, start_timestamp, end_timestamp, is_booked, is_active)
       VALUES (?, '2026-10-25', '10:00:00', '11:00:00', datetime('now', '+2 days', 'start of day', '+10 hours'), datetime('now', '+2 days', 'start of day', '+11 hours'), 1, 1);`,
      [createdTeacherId]
    );
    futureSlot1Id = slot1Res.lastInsertRowid;
    createdSlotIds.push(futureSlot1Id);

    const slot2Res = await db.execute(
      `INSERT INTO teacher_availability_slots (teacher_id, slot_date, start_time, end_time, start_timestamp, end_timestamp, is_booked, is_active)
       VALUES (?, '2026-10-26', '14:00:00', '15:00:00', datetime('now', '+3 days', 'start of day', '+14 hours'), datetime('now', '+3 days', 'start of day', '+15 hours'), 0, 1);`,
      [createdTeacherId]
    );
    futureSlot2Id = slot2Res.lastInsertRowid;
    createdSlotIds.push(futureSlot2Id);

    const apptRes = await db.execute(
      `INSERT INTO appointments (student_id, teacher_id, slot_id, title, purpose, status)
       VALUES (1, ?, ?, 'Turing Machine Project Review', 'Discussion on Turing machines', 'APPROVED');`,
      [createdTeacherId, futureSlot1Id]
    );
    appointmentId = apptRes.lastInsertRowid;
    createdAppointmentIds.push(appointmentId);

    await test('Status Management: Suspending teacher deactivates unbooked future slots while preserving upcoming appointments', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/teachers/${createdTeacherId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          status: 'SUSPENDED',
          cancelUpcoming: false
        });

      assert.strictEqual(res.status, HTTP_STATUS.OK);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.status, 'SUSPENDED');
      assert.strictEqual(res.body.data.deactivatedSlotsCount, 1, 'Unbooked slot2 should be deactivated');
      assert.strictEqual(res.body.data.upcomingAppointmentsCount, 1, 'Booked appointment should be preserved');

      // Verify unbooked slot2 is now inactive
      const slot2 = await db.queryOne('SELECT is_active FROM teacher_availability_slots WHERE id = ?;', [futureSlot2Id]);
      assert.strictEqual(slot2.is_active, 0, 'Unbooked future slot must be deactivated');

      // Verify appointment is still APPROVED
      const appt = await db.queryOne('SELECT status FROM appointments WHERE id = ?;', [appointmentId]);
      assert.strictEqual(appt.status, 'APPROVED', 'Upcoming appointment should remain preserved');

      // Verify audit log entry
      const audit = await db.queryOne(
        "SELECT id, action, details FROM audit_logs WHERE action = 'UPDATE_TEACHER_STATUS' AND entity_id = ? ORDER BY id DESC LIMIT 1;",
        [String(createdTeacherId)]
      );
      assert.ok(audit);
      const details = JSON.parse(audit.details);
      assert.strictEqual(details.updatedStatus, 'SUSPENDED');
    });

    await test('Status Management: Suspending with cancelUpcoming=true cancels consultations and releases slots', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/teachers/${createdTeacherId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          status: 'SUSPENDED',
          cancelUpcoming: true,
          cancellationReason: 'Faculty on unexpected sabbatical.'
        });

      assert.strictEqual(res.status, HTTP_STATUS.OK);
      assert.strictEqual(res.body.data.cancelledAppointmentsCount, 1);
      assert.strictEqual(res.body.data.upcomingAppointmentsCount, 0);

      // Verify appointment is CANCELLED in DB
      const appt = await db.queryOne('SELECT status, cancellation_reason FROM appointments WHERE id = ?;', [appointmentId]);
      assert.strictEqual(appt.status, 'CANCELLED');
      assert.strictEqual(appt.cancellation_reason, 'Faculty on unexpected sabbatical.');

      // Verify appointment status history recorded
      const history = await db.queryOne(
        'SELECT previous_status, new_status, notes FROM appointment_status_history WHERE appointment_id = ? ORDER BY id DESC LIMIT 1;',
        [appointmentId]
      );
      assert.strictEqual(history.previous_status, 'APPROVED');
      assert.strictEqual(history.new_status, 'CANCELLED');

      // Verify slot1 is now unbooked and deactivated
      const slot1 = await db.queryOne('SELECT is_booked, is_active FROM teacher_availability_slots WHERE id = ?;', [futureSlot1Id]);
      assert.strictEqual(slot1.is_booked, 0);
      assert.strictEqual(slot1.is_active, 0);
    });

    await test('Status Management: Reactivating teacher restores ACTIVE status and sets isVerified=1', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/teachers/${createdTeacherId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'ACTIVE' });

      assert.strictEqual(res.status, HTTP_STATUS.OK);
      assert.strictEqual(res.body.data.status, 'ACTIVE');

      const user = await db.queryOne('SELECT status FROM users WHERE id = ?;', [createdUserId]);
      assert.strictEqual(user.status, 'ACTIVE');

      const profile = await db.queryOne('SELECT is_verified FROM teacher_profiles WHERE id = ?;', [createdTeacherId]);
      assert.strictEqual(profile.is_verified, 1);
    });

    await test('Status Management: Invalid status returns 400 Bad Request', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/teachers/${createdTeacherId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'INVALID_STATUS' });

      assert.strictEqual(res.status, HTTP_STATUS.BAD_REQUEST);
      assert.strictEqual(res.body.error.code, 'INVALID_STATUS');
    });

    // -------------------------------------------------------------
    // Section 8: Preserving Appointment History Integrity
    // -------------------------------------------------------------
    await test('Data Integrity: Historical completed appointments remain intact when faculty is deactivated', async () => {
      // Create past completed appointment
      const pastSlotRes = await db.execute(
        `INSERT INTO teacher_availability_slots (teacher_id, slot_date, start_time, end_time, start_timestamp, end_timestamp, is_booked, is_active)
         VALUES (?, '2026-10-09', '09:00:00', '10:00:00', datetime('now', '-10 days'), datetime('now', '-10 days', '+1 hour'), 1, 0);`,
        [createdTeacherId]
      );
      const pastSlotId = pastSlotRes.lastInsertRowid;
      createdSlotIds.push(pastSlotId);

      const pastApptRes = await db.execute(
        `INSERT INTO appointments (student_id, teacher_id, slot_id, title, purpose, status)
         VALUES (1, ?, ?, 'Algorithm Consultation', 'Historical consultation on algorithms', 'COMPLETED');`,
        [createdTeacherId, pastSlotId]
      );
      const pastApptId = pastApptRes.lastInsertRowid;
      createdAppointmentIds.push(pastApptId);

      // Suspend teacher again
      await request(app)
        .patch(`/api/v1/admin/teachers/${createdTeacherId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'SUSPENDED', cancelUpcoming: true });

      // Verify completed appointment was NOT cancelled or corrupted
      const completedAppt = await db.queryOne('SELECT status, purpose FROM appointments WHERE id = ?;', [pastApptId]);
      assert.strictEqual(completedAppt.status, 'COMPLETED', 'Historical completed appointments must remain intact');
    });

  } finally {
    // Deterministic test data cleanup
    console.log('\n--- Cleaning up temporary test data ---');
    for (const apptId of createdAppointmentIds) {
      await db.execute('DELETE FROM appointment_status_history WHERE appointment_id = ?;', [apptId]);
      await db.execute('DELETE FROM appointments WHERE id = ?;', [apptId]);
    }
    for (const slotId of createdSlotIds) {
      await db.execute('DELETE FROM teacher_availability_slots WHERE id = ?;', [slotId]);
    }
    for (const profileId of createdTeacherProfileIds) {
      await db.execute('DELETE FROM teacher_courses WHERE teacher_id = ?;', [profileId]);
      await db.execute('DELETE FROM teacher_profiles WHERE id = ?;', [profileId]);
    }
    for (const userId of createdUserIds) {
      await db.execute('DELETE FROM users WHERE id = ?;', [userId]);
    }
    // Clean up test audit logs created during this run
    for (const profileId of createdTeacherProfileIds) {
      await db.execute("DELETE FROM audit_logs WHERE entity_type = 'TEACHER_PROFILE' AND entity_id = ?;", [String(profileId)]);
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
  runAdminTeacherTests().catch((err) => {
    console.error('Fatal error during test run:', err);
    process.exit(1);
  });
}

module.exports = runAdminTeacherTests;
