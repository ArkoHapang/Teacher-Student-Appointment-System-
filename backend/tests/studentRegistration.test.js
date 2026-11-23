/**
 * Student Self-Registration Test Suite
 * Validates:
 * 1. Successful student self-registration with full profile persistence
 * 2. Database persistence verification across users and student_profiles
 * 3. Secure bcrypt password hashing (no plaintext stored)
 * 4. Duplicate email rejection (409 Conflict)
 * 5. Duplicate student ID number rejection (409 Conflict)
 * 6. Missing mandatory fields rejection (400 Bad Request)
 * 7. Weak password complexity rejection (400 Bad Request)
 * 8. Invalid department ID rejection (400 Bad Request)
 * 9. Privilege escalation prevention (server-side role & status containment)
 * 10. Atomic transaction rollback on failure (no orphan user accounts)
 * 11. Immediate login authentication with newly registered credentials
 * 12. Administrative user-management visibility
 * 13. Public department directory endpoint (GET /api/v1/departments)
 */

require('./setup');
const assert = require('assert');
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/database');
const passwordService = require('../src/services/passwordService');
const { registrationRateLimiter, loginRateLimiter } = require('../src/middlewares/rateLimiter');
const HTTP_STATUS = require('../src/constants/httpStatusCodes');

async function runRegistrationTests() {
  console.log('\n=================================================================');
  console.log(' Teacher-Student Appointment System: Student Registration Tests  ');
  console.log('=================================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      registrationRateLimiter.reset();
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

  // Tracking created test entities for targeted cleanup
  const createdUserIds = [];

  const cleanup = async () => {
    if (createdUserIds.length > 0) {
      const placeholders = createdUserIds.map(() => '?').join(', ');
      await db.execute(`DELETE FROM audit_logs WHERE actor_id IN (${placeholders});`, createdUserIds);
      await db.execute(`DELETE FROM student_profiles WHERE user_id IN (${placeholders});`, createdUserIds);
      await db.execute(`DELETE FROM users WHERE id IN (${placeholders});`, createdUserIds);
      createdUserIds.length = 0;
    }
  };

  try {
    // Reset rate limiters before test execution
    registrationRateLimiter.reset();
    loginRateLimiter.reset();

    // -------------------------------------------------------------
    // Test 1: Successful Registration
    // -------------------------------------------------------------
    let registeredUser = null;
    let registeredProfile = null;
    let registeredToken = null;

    await test('1. Successful registration with all valid supported fields', async () => {
      const payload = {
        email: 'test.student.reg1@university.edu',
        password: 'SecurePass123!',
        firstName: 'Elena',
        lastName: 'Rostova',
        studentIdNumber: 'STU-REG-001',
        departmentId: 1,
        batch: 'Batch 2026',
        phoneNumber: '+1-555-0191'
      };

      const res = await request(app)
        .post('/api/v1/auth/register')
        .send(payload)
        .expect(HTTP_STATUS.CREATED);

      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data);
      assert.ok(res.body.data.user);
      assert.ok(res.body.data.profile);
      assert.ok(res.body.data.token);

      registeredUser = res.body.data.user;
      registeredProfile = res.body.data.profile;
      registeredToken = res.body.data.token;
      createdUserIds.push(registeredUser.id);

      assert.strictEqual(registeredUser.email, 'test.student.reg1@university.edu');
      assert.strictEqual(registeredUser.firstName, 'Elena');
      assert.strictEqual(registeredUser.lastName, 'Rostova');
      assert.strictEqual(registeredUser.role, 'STUDENT');
      assert.strictEqual(registeredUser.status, 'ACTIVE');

      assert.strictEqual(registeredProfile.studentIdNumber, 'STU-REG-001');
      assert.strictEqual(registeredProfile.departmentId, 1);
      assert.strictEqual(registeredProfile.batch, 'Batch 2026');
      assert.strictEqual(registeredProfile.phoneNumber, '+1-555-0191');
    });

    // -------------------------------------------------------------
    // Test 2: Database Persistence Verification
    // -------------------------------------------------------------
    await test('2. Verify user and student profile database persistence', async () => {
      assert.ok(registeredUser && registeredUser.id, 'Prior registration must have succeeded');

      const userRow = await db.queryOne(
        `SELECT u.id, u.email, u.first_name, u.last_name, u.status, r.name as role_name
         FROM users u
         JOIN roles r ON u.role_id = r.id
         WHERE u.id = ?;`,
        [registeredUser.id]
      );
      assert.ok(userRow, 'User row must exist in database');
      assert.strictEqual(userRow.email, 'test.student.reg1@university.edu');
      assert.strictEqual(userRow.first_name, 'Elena');
      assert.strictEqual(userRow.last_name, 'Rostova');
      assert.strictEqual(userRow.role_name, 'STUDENT');
      assert.strictEqual(userRow.status, 'ACTIVE');

      const profileRow = await db.queryOne(
        `SELECT sp.*, d.code as department_code
         FROM student_profiles sp
         JOIN departments d ON sp.department_id = d.id
         WHERE sp.user_id = ?;`,
        [registeredUser.id]
      );
      assert.ok(profileRow, 'Student profile row must exist in database');
      assert.strictEqual(profileRow.student_id_number, 'STU-REG-001');
      assert.strictEqual(profileRow.department_id, 1);
      assert.strictEqual(profileRow.batch, 'Batch 2026');
      assert.strictEqual(profileRow.phone_number, '+1-555-0191');
    });

    // -------------------------------------------------------------
    // Test 3: Password Hashing Verification
    // -------------------------------------------------------------
    await test('3. Verify bcrypt password hashing and ensure plaintext is not stored', async () => {
      const userRow = await db.queryOne('SELECT password_hash FROM users WHERE id = ?;', [registeredUser.id]);
      assert.ok(userRow && userRow.password_hash, 'Password hash must exist');
      assert.notStrictEqual(userRow.password_hash, 'SecurePass123!', 'Plaintext password must never be stored');
      assert.ok(userRow.password_hash.startsWith('$2'), 'Must be a valid bcrypt hash format');
      assert.strictEqual(userRow.password_hash.length, 60, 'Bcrypt hash length must be exactly 60 characters');

      const isMatch = await passwordService.verifyPassword('SecurePass123!', userRow.password_hash);
      assert.strictEqual(isMatch, true, 'Stored bcrypt hash must verify with original password');
    });

    // -------------------------------------------------------------
    // Test 4: Duplicate Email Rejection
    // -------------------------------------------------------------
    await test('4. Reject duplicate email with 409 Conflict', async () => {
      const payload = {
        email: 'test.student.reg1@university.edu', // Duplicate
        password: 'AnotherPassword123!',
        firstName: 'Clone',
        lastName: 'User',
        studentIdNumber: 'STU-REG-002',
        departmentId: 1
      };

      const res = await request(app)
        .post('/api/v1/auth/register')
        .send(payload)
        .expect(HTTP_STATUS.CONFLICT);

      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'DUPLICATE_EMAIL');
    });

    // -------------------------------------------------------------
    // Test 5: Duplicate Student ID Rejection
    // -------------------------------------------------------------
    await test('5. Reject duplicate student ID number with 409 Conflict', async () => {
      const payload = {
        email: 'different.email@university.edu',
        password: 'AnotherPassword123!',
        firstName: 'Unique',
        lastName: 'Person',
        studentIdNumber: 'STU-REG-001', // Duplicate ID
        departmentId: 1
      };

      const res = await request(app)
        .post('/api/v1/auth/register')
        .send(payload)
        .expect(HTTP_STATUS.CONFLICT);

      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'DUPLICATE_STUDENT_ID');
    });

    // -------------------------------------------------------------
    // Test 6: Missing Mandatory Fields
    // -------------------------------------------------------------
    await test('6. Reject missing mandatory fields with 400 Bad Request', async () => {
      // Missing email
      const res1 = await request(app)
        .post('/api/v1/auth/register')
        .send({
          password: 'Password123!',
          firstName: 'No',
          lastName: 'Email',
          studentIdNumber: 'STU-999',
          departmentId: 1
        })
        .expect(HTTP_STATUS.BAD_REQUEST);
      assert.strictEqual(res1.body.success, false);

      // Missing studentIdNumber
      const res2 = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: 'no.id@university.edu',
          password: 'Password123!',
          firstName: 'No',
          lastName: 'Id',
          departmentId: 1
        })
        .expect(HTTP_STATUS.BAD_REQUEST);
      assert.strictEqual(res2.body.success, false);

      // Missing firstName
      const res3 = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: 'no.first@university.edu',
          password: 'Password123!',
          lastName: 'User',
          studentIdNumber: 'STU-998',
          departmentId: 1
        })
        .expect(HTTP_STATUS.BAD_REQUEST);
      assert.strictEqual(res3.body.success, false);
    });

    // -------------------------------------------------------------
    // Test 7: Weak Password Rejection
    // -------------------------------------------------------------
    await test('7. Reject weak passwords with 400 Bad Request', async () => {
      const payload = {
        email: 'weak.password@university.edu',
        password: 'simplepassword', // Lacks uppercase, digits, symbols
        firstName: 'Weak',
        lastName: 'Password',
        studentIdNumber: 'STU-REG-WEAK',
        departmentId: 1
      };

      const res = await request(app)
        .post('/api/v1/auth/register')
        .send(payload)
        .expect(HTTP_STATUS.BAD_REQUEST);

      assert.strictEqual(res.body.success, false);
      assert.ok(
        res.body.error.code === 'WEAK_PASSWORD' || res.body.error.code === 'VALIDATION_ERROR',
        'Expected WEAK_PASSWORD or VALIDATION_ERROR'
      );
    });

    // -------------------------------------------------------------
    // Test 8: Invalid Department ID Rejection
    // -------------------------------------------------------------
    await test('8. Reject invalid department IDs with 400 Bad Request', async () => {
      const payload = {
        email: 'invalid.dept@university.edu',
        password: 'ValidPassword123!',
        firstName: 'Invalid',
        lastName: 'Dept',
        studentIdNumber: 'STU-REG-DEPT',
        departmentId: 9999 // Non-existent department
      };

      const res = await request(app)
        .post('/api/v1/auth/register')
        .send(payload)
        .expect(HTTP_STATUS.BAD_REQUEST);

      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'DEPARTMENT_NOT_FOUND');
    });

    // -------------------------------------------------------------
    // Test 9: Privilege Escalation Prevention
    // -------------------------------------------------------------
    await test('9. Reject privilege escalation attempts; account strictly bound to STUDENT role', async () => {
      const payload = {
        email: 'escalation.attempt@university.edu',
        password: 'ValidPassword123!',
        firstName: 'Malicious',
        lastName: 'Actor',
        studentIdNumber: 'STU-REG-ESC',
        departmentId: 1,
        // Hostile privilege escalation payload
        role: 'ADMIN',
        roleId: 3,
        role_id: 3,
        status: 'SUSPENDED',
        is_verified: 1
      };

      const res = await request(app)
        .post('/api/v1/auth/register')
        .send(payload)
        .expect(HTTP_STATUS.CREATED);

      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.user.role, 'STUDENT', 'User response role must strictly be STUDENT');
      assert.strictEqual(res.body.data.user.status, 'ACTIVE', 'User response status must strictly be ACTIVE');

      const createdId = res.body.data.user.id;
      createdUserIds.push(createdId);

      const dbUser = await db.queryOne(
        `SELECT u.status, r.name as role_name
         FROM users u
         JOIN roles r ON u.role_id = r.id
         WHERE u.id = ?;`,
        [createdId]
      );
      assert.strictEqual(dbUser.role_name, 'STUDENT', 'Database role must strictly be STUDENT');
      assert.strictEqual(dbUser.status, 'ACTIVE', 'Database status must strictly be ACTIVE');
    });

    // -------------------------------------------------------------
    // Test 10: Atomic Rollback on Failure
    // -------------------------------------------------------------
    await test('10. Verify atomic rollback when profile creation fails (zero orphan users)', async () => {
      // Simulate profile collision while user insert succeeds:
      // We'll prepare a situation where email is unique, but studentIdNumber collides with an existing profile
      const uniqueEmail = 'rollback.test@university.edu';
      const duplicateStudentId = 'STU-REG-001'; // Already held by Test 1

      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: uniqueEmail,
          password: 'Password123!',
          firstName: 'Rollback',
          lastName: 'Tester',
          studentIdNumber: duplicateStudentId,
          departmentId: 1
        })
        .expect(HTTP_STATUS.CONFLICT);

      assert.strictEqual(res.body.success, false);

      // Verify that NO user record exists for uniqueEmail (atomic rollback succeeded)
      const orphanUser = await db.queryOne('SELECT id FROM users WHERE LOWER(email) = ?;', [uniqueEmail]);
      assert.strictEqual(orphanUser, null, 'Rollback must ensure no orphan user record remains in database');
    });

    // -------------------------------------------------------------
    // Test 11: Immediate Login Authentication
    // -------------------------------------------------------------
    await test('11. Verify newly registered credentials authenticate via /api/v1/auth/login', async () => {
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'test.student.reg1@university.edu',
          password: 'SecurePass123!'
        })
        .expect(HTTP_STATUS.OK);

      assert.strictEqual(loginRes.body.success, true);
      assert.ok(loginRes.body.data.token, 'Must return signed access token');
      assert.strictEqual(loginRes.body.data.user.email, 'test.student.reg1@university.edu');
      assert.strictEqual(loginRes.body.data.user.role, 'STUDENT');
    });

    // -------------------------------------------------------------
    // Test 12: Admin User-Management Visibility
    // -------------------------------------------------------------
    await test('12. Verify newly registered student appears in admin user list', async () => {
      // 1. Authenticate as Administrator
      const adminLoginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'admin@university.edu',
          password: 'Password123!'
        })
        .expect(HTTP_STATUS.OK);

      const adminToken = adminLoginRes.body.data.token;
      assert.ok(adminToken, 'Admin token acquired');

      // 2. Query admin users endpoint
      const usersRes = await request(app)
        .get('/api/v1/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(HTTP_STATUS.OK);

      assert.strictEqual(usersRes.body.success, true);
      const userList = usersRes.body.data.users;
      assert.ok(Array.isArray(userList), 'Users list must be an array');

      const found = userList.find((u) => u.email === 'test.student.reg1@university.edu');
      assert.ok(found, 'Newly registered student must be visible in admin user list');
      assert.strictEqual(found.role_name, 'STUDENT');
      assert.strictEqual(found.status, 'ACTIVE');
    });

    // -------------------------------------------------------------
    // Test 13: Public Department Directory
    // -------------------------------------------------------------
    await test('13. Verify public department directory endpoint (GET /api/v1/departments)', async () => {
      const deptRes = await request(app)
        .get('/api/v1/departments')
        .expect(HTTP_STATUS.OK);

      assert.strictEqual(deptRes.body.success, true);
      assert.ok(Array.isArray(deptRes.body.data.departments));
      assert.ok(deptRes.body.data.departments.length >= 5);

      const cseDept = deptRes.body.data.departments.find((d) => d.code === 'CSE');
      assert.ok(cseDept, 'CSE department must exist in directory');
      assert.strictEqual(cseDept.name, 'Computer Science and Engineering');
    });

    // -------------------------------------------------------------
    // Test 14: Rate Limit Exceeded Rejection
    // -------------------------------------------------------------
    await test('14. Reject registration after exceeding rate limit (5 attempts per 15 min)', async () => {
      registrationRateLimiter.reset();

      // Submit 5 requests to hit threshold
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post('/api/v1/auth/register')
          .send({ email: `rate.limit.${i}@test.com` });
      }

      // 6th request must be rejected with 429 Too Many Requests
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ email: 'rate.limit.6@test.com' })
        .expect(HTTP_STATUS.TOO_MANY_REQUESTS);

      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'RATE_LIMIT_EXCEEDED');
      assert.ok(res.headers['retry-after'], 'Must contain Retry-After header');
    });

  } finally {
    // Teardown created test entities
    await cleanup();
  }

  console.log('\n-----------------------------------------------------------------');
  console.log(`Student Registration Test Summary: ${passed} passed, ${failed} failed out of ${passed + failed} tests.`);
  console.log('=================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runRegistrationTests().catch((err) => {
  console.error('Unhandled test suite error:', err);
  process.exit(1);
});
