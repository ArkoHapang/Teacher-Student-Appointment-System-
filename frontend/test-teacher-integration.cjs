/**
 * Teacher Frontend API Integration Verification Suite
 * Validates the API communication layer implemented in frontend/src/services/teacherService.ts
 * against the real backend endpoints and SQLite database.
 */

require('../backend/tests/setup');
const assert = require('assert');
const request = require('supertest');
const app = require('../backend/src/app');
const db = require('../backend/src/config/database');

async function runTeacherIntegration() {
  console.log('\n=================================================================');
  console.log(' Teacher Frontend API Integration Verification                   ');
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
      failed++;
    }
  }

  let teacherToken = null;
  let teacherUserId = 2; // Robert Miller
  let teacherProfileId = 1;
  let studentToken = null;
  let studentUserId = null;
  let createdSlotIds = [];
  let createdAppointmentIds = [];

  const authHeaders = (token) => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  });

  try {
    // 1. Authentication
    await test('Auth: Faculty logs in via /api/v1/auth/login and receives token & TEACHER role', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'robert.miller@university.edu', password: 'Password123!' });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.user.role, 'TEACHER');
      teacherToken = res.body.data.token;
      assert.ok(teacherToken);
    });

    // Student login for appointment interactions
    const stuRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'alice.carter@student.university.edu', password: 'Password123!' });
    studentToken = stuRes.body.data.token;
    studentUserId = stuRes.body.data.user.id;

    // 2. Profile Management
    await test('Workflow 1: Retrieve faculty profile credentials and permitted fields', async () => {
      const res = await request(app)
        .get(`/api/v1/users/${teacherUserId}`)
        .set(authHeaders(teacherToken));
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.email, 'robert.miller@university.edu');
      assert.ok(res.body.data.profile);
      assert.ok(res.body.data.profile.designation);
    });

    await test('Workflow 1: Update permitted faculty profile fields (designation, officeRoom, bio)', async () => {
      const res = await request(app)
        .patch(`/api/v1/teachers/${teacherProfileId}`)
        .set(authHeaders(teacherToken))
        .send({
          firstName: 'Robert',
          lastName: 'Miller',
          designation: 'Distinguished Professor',
          officeRoom: 'Room 401-B',
          bio: 'Specializing in distributed computing and real-time fault-tolerant systems.'
        });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.designation, 'Distinguished Professor');
      assert.strictEqual(res.body.data.officeRoom, 'Room 401-B');
    });

    // 3. Availability Management
    let testSlotId = null;
    const testSlotDate = '2055-08-20';

    await test('Workflow 2: Configure new consultation availability slot', async () => {
      const res = await request(app)
        .post(`/api/v1/teachers/${teacherProfileId}/slots`)
        .set(authHeaders(teacherToken))
        .send({
          slotDate: testSlotDate,
          startTime: '10:00',
          endTime: '10:45'
        });
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      testSlotId = res.body.data.id;
      createdSlotIds.push(testSlotId);
    });

    await test('Workflow 2: Interval collision detection blocks overlapping slot creation (409 Conflict)', async () => {
      const res = await request(app)
        .post(`/api/v1/teachers/${teacherProfileId}/slots`)
        .set(authHeaders(teacherToken))
        .send({
          slotDate: testSlotDate,
          startTime: '10:15',
          endTime: '11:00'
        });
      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.error.code, 'SLOT_OVERLAP');
    });

    await test('Workflow 2: Toggle slot active/inactive availability status', async () => {
      const res = await request(app)
        .patch(`/api/v1/teachers/${teacherProfileId}/slots/${testSlotId}`)
        .set(authHeaders(teacherToken))
        .send({ isActive: false });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.isActive, 0);

      // Re-enable
      const res2 = await request(app)
        .patch(`/api/v1/teachers/${teacherProfileId}/slots/${testSlotId}`)
        .set(authHeaders(teacherToken))
        .send({ isActive: true });
      assert.strictEqual(res2.status, 200);
      assert.strictEqual(res2.body.data.isActive, 1);
    });

    // Create a temporary slot to test deletion of unbooked slot
    await test('Workflow 2: Delete unbooked availability slot', async () => {
      const tempSlotRes = await request(app)
        .post(`/api/v1/teachers/${teacherProfileId}/slots`)
        .set(authHeaders(teacherToken))
        .send({
          slotDate: testSlotDate,
          startTime: '13:00',
          endTime: '13:30'
        });
      assert.strictEqual(tempSlotRes.status, 201);
      const tempSlotId = tempSlotRes.body.data.id;

      const delRes = await request(app)
        .delete(`/api/v1/teachers/${teacherProfileId}/slots/${tempSlotId}`)
        .set(authHeaders(teacherToken));
      assert.strictEqual(delRes.status, 200);
      assert.strictEqual(delRes.body.success, true);
    });

    // 4. Appointment Request Lifecycle
    let testApptId = null;

    await test('Workflow 3 & 4: Student books slot and teacher retrieves assigned appointment request', async () => {
      const bookRes = await request(app)
        .post('/api/v1/appointments')
        .set(authHeaders(studentToken))
        .send({
          slotId: testSlotId,
          title: 'Distributed Systems Consultation',
          purpose: 'Discussing Byzantine fault tolerance implementation details.'
        });
      assert.strictEqual(bookRes.status, 201);
      testApptId = bookRes.body.data.id;
      createdAppointmentIds.push(testApptId);

      // Teacher retrieves requests
      const listRes = await request(app)
        .get('/api/v1/appointments')
        .set(authHeaders(teacherToken));
      assert.strictEqual(listRes.status, 200);
      const found = listRes.body.data.appointments.find(a => a.id === testApptId);
      assert.ok(found, 'Assigned appointment must appear in teacher appointment list');
      assert.strictEqual(found.status, 'PENDING');
    });

    await test('Workflow 4: Teacher approves consultation request with preparation notes', async () => {
      const approveRes = await request(app)
        .post(`/api/v1/appointments/${testApptId}/approve`)
        .set(authHeaders(teacherToken))
        .send({ notes: 'Review PBFT algorithm paper sections 3 and 4 prior to meeting.' });
      assert.strictEqual(approveRes.status, 200);
      assert.strictEqual(approveRes.body.data.status, 'APPROVED');
    });

    await test('Workflow 5: Teacher marks consultation as COMPLETED', async () => {
      const compRes = await request(app)
        .post(`/api/v1/appointments/${testApptId}/complete`)
        .set(authHeaders(teacherToken));
      assert.strictEqual(compRes.status, 200);
      assert.strictEqual(compRes.body.data.status, 'COMPLETED');
    });

    await test('Workflow 6: Student submits feedback and teacher inspects rating', async () => {
      const fbSubmit = await request(app)
        .post(`/api/v1/appointments/${testApptId}/feedback`)
        .set(authHeaders(studentToken))
        .send({ rating: 5, comments: 'Clear explanations and excellent reference material.' });
      assert.strictEqual(fbSubmit.status, 201);

      const fbGet = await request(app)
        .get(`/api/v1/appointments/${testApptId}/feedback`)
        .set(authHeaders(teacherToken));
      assert.strictEqual(fbGet.status, 200);
      assert.strictEqual(fbGet.body.data.rating, 5);
      assert.strictEqual(fbGet.body.data.comments, 'Clear explanations and excellent reference material.');
    });

    // 5. Notifications
    await test('Workflow 7: Teacher retrieves notification feed and marks notification as read', async () => {
      const notifRes = await request(app)
        .get(`/api/v1/users/${teacherUserId}/notifications`)
        .set(authHeaders(teacherToken));
      assert.strictEqual(notifRes.status, 200);
      assert.ok(Array.isArray(notifRes.body.data.notifications));

      if (notifRes.body.data.notifications.length > 0) {
        const notifId = notifRes.body.data.notifications[0].id;
        const markRes = await request(app)
          .patch(`/api/v1/users/${teacherUserId}/notifications/${notifId}/read`)
          .set(authHeaders(teacherToken));
        assert.strictEqual(markRes.status, 200);
      }
    });

    // 6. Security Boundaries
    await test('Authorization: Teacher is blocked from administrative endpoints (403 Forbidden)', async () => {
      const adminRes = await request(app)
        .get('/api/v1/admin/users')
        .set(authHeaders(teacherToken));
      assert.strictEqual(adminRes.status, 403);
    });

    // 7. Logout
    await test('Workflow 8: Teacher logs out and session token is revoked', async () => {
      const logoutRes = await request(app)
        .post('/api/v1/auth/logout')
        .set(authHeaders(teacherToken));
      assert.strictEqual(logoutRes.status, 200);

      // Verify token revocation
      const meRes = await request(app)
        .get('/api/v1/auth/me')
        .set(authHeaders(teacherToken));
      assert.strictEqual(meRes.status, 401);
    });

  } finally {
    // Cleanup created test records
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
    } catch (e) {
      console.warn('Cleanup error:', e.message);
    }
  }

  console.log('\n=================================================================');
  console.log(` Teacher Integration Summary: ${passed} passed, ${failed} failed.`);
  console.log('=================================================================\n');

  if (failed > 0) process.exitCode = 1;
}

runTeacherIntegration();
