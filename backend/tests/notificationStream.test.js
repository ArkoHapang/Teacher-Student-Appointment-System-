/**
 * Step 3 — Backend SSE Notification Stream Test Suite
 *
 * Verifies:
 * 1. Unauthenticated requests are rejected (401).
 * 2. SSE headers and initial handshake format are correct.
 * 3. Authenticated student can establish an SSE connection.
 * 4. Authenticated teacher can establish an SSE connection.
 * 5. Authenticated administrator can establish an SSE connection.
 * 6. Cookie-based authentication works without a stream ticket.
 * 7. Strict recipient isolation: user receives only their own stream events.
 * 8. Multiple simultaneous connections for the same user work (multi-tab support).
 * 9. Closing a client connection removes its registration.
 * 10. Client-side spoofing (?userId=) is ignored; identity is bound strictly to req.user.id.
 * 11. Existing notification routes remain functional.
 * 12. Isolated test database safety verification.
 */

require('./setup');
const assert = require('assert');
const http = require('http');
const app = require('../src/app');
const db = require('../src/config/database');
const eventService = require('../src/services/eventService');
const env = require('../src/config/env');

let server;
let baseUrl;

/**
 * Helper to make standard JSON HTTP requests.
 */
function makeRequest(method, path, body = null, token = null, cookie = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (cookie) headers['Cookie'] = cookie;

    const req = http.request(url, { method, headers }, (res) => {
      let raw = '';
      res.on('data', (chunk) => (raw += chunk));
      res.on('end', () => {
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = raw;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

/**
 * Helper to open an SSE stream connection and track chunks.
 */
function openSseStream(path, { token, cookie, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const reqHeaders = { ...headers };
    if (token) reqHeaders['Authorization'] = `Bearer ${token}`;
    if (cookie) reqHeaders['Cookie'] = cookie;

    const req = http.request(url, { method: 'GET', headers: reqHeaders }, (res) => {
      const chunks = [];
      const waiters = [];

      res.on('data', (chunk) => {
        const text = chunk.toString();
        chunks.push(text);

        for (let i = waiters.length - 1; i >= 0; i--) {
          if (waiters[i].predicate(text)) {
            waiters[i].resolve(text);
            waiters.splice(i, 1);
          }
        }
      });

      const client = {
        statusCode: res.statusCode,
        headers: res.headers,
        req,
        res,
        chunks,
        waitForChunk: (predicate, timeoutMs = 2000) => {
          return new Promise((waitResolve, waitReject) => {
            for (const c of chunks) {
              if (predicate(c)) return waitResolve(c);
            }
            const timer = setTimeout(() => {
              waitReject(new Error(`Timed out after ${timeoutMs}ms waiting for SSE chunk`));
            }, timeoutMs);

            waiters.push({
              predicate,
              resolve: (c) => {
                clearTimeout(timer);
                waitResolve(c);
              }
            });
          });
        },
        close: () => {
          try {
            req.destroy();
          } catch {}
        }
      };

      resolve(client);
    });

    req.on('error', reject);
    req.end();
  });
}

async function runNotificationStreamTests() {
  console.log('\n=================================================================');
  console.log('   Teacher-Student Appointment System: SSE Stream Endpoint Tests ');
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
      if (err.stack) {
        console.error(`         ${err.stack.split('\n').slice(1, 4).join('\n')}`);
      }
      failed++;
    }
  }

  // 1. Start temporary test server
  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  const openClients = [];
  function trackClient(client) {
    openClients.push(client);
    return client;
  }

  try {
    // 2. Retrieve test users & authenticate across roles
    const studentRecord = await db.queryOne(
      "SELECT u.id, u.email FROM users u JOIN roles r ON u.role_id = r.id JOIN student_profiles sp ON u.id = sp.user_id WHERE r.name = 'STUDENT' AND u.status = 'ACTIVE' LIMIT 1;"
    );
    const teacherRecord = await db.queryOne(
      "SELECT u.id, u.email FROM users u JOIN roles r ON u.role_id = r.id JOIN teacher_profiles tp ON u.id = tp.user_id WHERE r.name = 'TEACHER' AND u.status = 'ACTIVE' AND tp.is_verified = 1 LIMIT 1;"
    );
    const adminRecord = await db.queryOne(
      "SELECT u.id, u.email FROM users u JOIN roles r ON u.role_id = r.id WHERE r.name = 'ADMIN' AND u.status = 'ACTIVE' LIMIT 1;"
    );

    assert.ok(studentRecord, 'Student user must exist in test database');
    assert.ok(teacherRecord, 'Teacher user must exist in test database');
    assert.ok(adminRecord, 'Admin user must exist in test database');

    const studentLogin = await makeRequest('POST', '/api/v1/auth/login', {
      email: studentRecord.email,
      password: 'Password123!'
    });
    assert.strictEqual(studentLogin.status, 200, 'Student login failed');
    const studentToken = studentLogin.body.data.token;
    const studentCookie = studentLogin.headers['set-cookie']
      ? studentLogin.headers['set-cookie'][0].split(';')[0]
      : `token=${studentToken}`;

    const teacherLogin = await makeRequest('POST', '/api/v1/auth/login', {
      email: teacherRecord.email,
      password: 'Password123!'
    });
    assert.strictEqual(teacherLogin.status, 200, 'Teacher login failed');
    const teacherToken = teacherLogin.body.data.token;
    const teacherCookie = teacherLogin.headers['set-cookie']
      ? teacherLogin.headers['set-cookie'][0].split(';')[0]
      : `token=${teacherToken}`;

    const adminLogin = await makeRequest('POST', '/api/v1/auth/login', {
      email: adminRecord.email,
      password: 'Password123!'
    });
    assert.strictEqual(adminLogin.status, 200, 'Admin login failed');
    const adminToken = adminLogin.body.data.token;
    const adminCookie = adminLogin.headers['set-cookie']
      ? adminLogin.headers['set-cookie'][0].split(';')[0]
      : `token=${adminToken}`;

    // --------------------------------------------------------------------------
    // Test 1: Unauthenticated request rejected (401)
    // --------------------------------------------------------------------------
    await test('1. Unauthenticated request to /api/v1/notifications/stream is rejected with 401', async () => {
      const client = trackClient(await openSseStream('/api/v1/notifications/stream'));
      assert.strictEqual(client.statusCode, 401, 'Should return HTTP 401 Unauthorized');
      const bodyChunk = await client.waitForChunk((c) => c.includes('AUTHENTICATION_REQUIRED'));
      assert.ok(bodyChunk.includes('AUTHENTICATION_REQUIRED'), 'Should contain AUTHENTICATION_REQUIRED error code');
      client.close();
    });

    // --------------------------------------------------------------------------
    // Test 2: SSE headers and initial handshake are correct
    // --------------------------------------------------------------------------
    await test('2. SSE headers and initial connected handshake event are properly formatted', async () => {
      const client = trackClient(await openSseStream('/api/v1/notifications/stream', { token: studentToken }));
      assert.strictEqual(client.statusCode, 200, 'Stream should return HTTP 200');

      // Validate W3C SSE headers
      assert.ok(client.headers['content-type'].includes('text/event-stream'), 'Content-Type must be text/event-stream');
      assert.ok(client.headers['cache-control'].includes('no-cache'), 'Cache-Control must be no-cache');
      assert.strictEqual(client.headers['connection'], 'keep-alive', 'Connection must be keep-alive');

      // Validate initial handshake
      const handshake = await client.waitForChunk((c) => c.includes('event: connected'));
      assert.ok(handshake.includes('event: connected'), 'Must contain connected event');
      assert.ok(handshake.includes(`"userId":${studentRecord.id}`), 'Must confirm correct authenticated userId');
      client.close();
    });

    // --------------------------------------------------------------------------
    // Test 3: Authenticated student can establish an SSE connection
    // --------------------------------------------------------------------------
    await test('3. Authenticated student establishes active SSE connection', async () => {
      const client = trackClient(await openSseStream('/api/v1/notifications/stream', { token: studentToken }));
      assert.strictEqual(client.statusCode, 200);
      assert.ok(eventService.getConnectionCount(studentRecord.id) >= 1, 'Student connection must be registered in eventService');
      client.close();
    });

    // --------------------------------------------------------------------------
    // Test 4: Authenticated teacher can establish an SSE connection
    // --------------------------------------------------------------------------
    await test('4. Authenticated teacher establishes active SSE connection', async () => {
      const client = trackClient(await openSseStream('/api/v1/notifications/stream', { token: teacherToken }));
      assert.strictEqual(client.statusCode, 200);
      assert.ok(eventService.getConnectionCount(teacherRecord.id) >= 1, 'Teacher connection must be registered in eventService');
      client.close();
    });

    // --------------------------------------------------------------------------
    // Test 5: Authenticated administrator can establish an SSE connection
    // --------------------------------------------------------------------------
    await test('5. Authenticated administrator establishes active SSE connection', async () => {
      const client = trackClient(await openSseStream('/api/v1/notifications/stream', { token: adminToken }));
      assert.strictEqual(client.statusCode, 200);
      assert.ok(eventService.getConnectionCount(adminRecord.id) >= 1, 'Admin connection must be registered in eventService');
      client.close();
    });

    // --------------------------------------------------------------------------
    // Test 6: Cookie-based authentication works without a stream ticket
    // --------------------------------------------------------------------------
    await test('6. Cookie-based authentication establishes SSE stream without stream ticket', async () => {
      // Connect using exclusively the session cookie (no Authorization header, no ticket query parameter)
      const client = trackClient(await openSseStream('/api/v1/notifications/stream', { cookie: studentCookie }));
      assert.strictEqual(client.statusCode, 200, 'Cookie authentication must establish stream with 200 OK');

      const handshake = await client.waitForChunk((c) => c.includes('event: connected'));
      assert.ok(handshake.includes(`"userId":${studentRecord.id}`), 'Handshake must match cookie-authenticated identity');
      client.close();
    });

    // --------------------------------------------------------------------------
    // Test 7: Strict recipient isolation: user receives only their own stream events
    // --------------------------------------------------------------------------
    await test('7. Strict recipient isolation: user receives only their own notification events', async () => {
      const studentClient = trackClient(await openSseStream('/api/v1/notifications/stream', { token: studentToken }));
      const teacherClient = trackClient(await openSseStream('/api/v1/notifications/stream', { token: teacherToken }));

      // Wait for both to finish initial handshake
      await studentClient.waitForChunk((c) => c.includes('event: connected'));
      await teacherClient.waitForChunk((c) => c.includes('event: connected'));

      const initialTeacherChunkCount = teacherClient.chunks.length;

      // Dispatch event exclusively to the student
      const notificationPayload = {
        id: 77701,
        recipientId: studentRecord.id,
        title: 'Confidential Student Alert',
        message: 'This message is intended solely for the student.',
        type: 'STATUS_UPDATE',
        isRead: 0
      };
      eventService.sendToUser(studentRecord.id, 'notification', notificationPayload, notificationPayload.id);

      // Student stream receives the event
      const studentEvent = await studentClient.waitForChunk((c) => c.includes('Confidential Student Alert'));
      assert.ok(studentEvent.includes('event: notification'), 'Student must receive event of type notification');
      assert.ok(studentEvent.includes('Confidential Student Alert'), 'Student must receive expected notification title');

      // Wait briefly to confirm teacher stream receives zero new chunks
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.strictEqual(
        teacherClient.chunks.length,
        initialTeacherChunkCount,
        'Teacher stream must receive ZERO chunks from student notification'
      );

      studentClient.close();
      teacherClient.close();
    });

    // --------------------------------------------------------------------------
    // Test 8: Multiple simultaneous connections for the same user work
    // --------------------------------------------------------------------------
    await test('8. Multiple simultaneous connections for the same user receive published events', async () => {
      const tab1 = trackClient(await openSseStream('/api/v1/notifications/stream', { token: studentToken }));
      const tab2 = trackClient(await openSseStream('/api/v1/notifications/stream', { token: studentToken }));

      await tab1.waitForChunk((c) => c.includes('event: connected'));
      await tab2.waitForChunk((c) => c.includes('event: connected'));

      assert.strictEqual(eventService.getConnectionCount(studentRecord.id), 2, 'User must have 2 active connections');

      // Dispatch event to student
      const multiTabNotification = {
        id: 77702,
        recipientId: studentRecord.id,
        title: 'Multi-Tab Broadcast',
        message: 'Syncing across active browser tabs.',
        type: 'SYSTEM_ALERT',
        isRead: 0
      };
      eventService.sendToUser(studentRecord.id, 'notification', multiTabNotification, multiTabNotification.id);

      const tab1Received = await tab1.waitForChunk((c) => c.includes('Multi-Tab Broadcast'));
      const tab2Received = await tab2.waitForChunk((c) => c.includes('Multi-Tab Broadcast'));

      assert.ok(tab1Received.includes('Multi-Tab Broadcast'), 'Tab 1 must receive broadcast');
      assert.ok(tab2Received.includes('Multi-Tab Broadcast'), 'Tab 2 must receive broadcast');

      tab1.close();
      tab2.close();
    });

    // --------------------------------------------------------------------------
    // Test 9: Closing a client connection removes its registration
    // --------------------------------------------------------------------------
    await test('9. Closing client connection removes its registration from eventService', async () => {
      const client = trackClient(await openSseStream('/api/v1/notifications/stream', { token: studentToken }));
      await client.waitForChunk((c) => c.includes('event: connected'));

      const countBefore = eventService.getConnectionCount(studentRecord.id);
      assert.ok(countBefore >= 1);

      // Close the client connection
      client.close();

      // Allow event loop to process 'close' / socket termination
      await new Promise((resolve) => setTimeout(resolve, 100));

      const countAfter = eventService.getConnectionCount(studentRecord.id);
      assert.strictEqual(countAfter, countBefore - 1, 'Connection count must decrement upon client closure');
    });

    // --------------------------------------------------------------------------
    // Test 10: Client-side spoofing (?userId=) is ignored
    // --------------------------------------------------------------------------
    await test('10. Client cannot spoof recipient via ?userId query parameter', async () => {
      // Student attempts to request stream for teacher via query param
      const client = trackClient(
        await openSseStream(`/api/v1/notifications/stream?userId=${teacherRecord.id}`, { token: studentToken })
      );
      assert.strictEqual(client.statusCode, 200);

      const handshake = await client.waitForChunk((c) => c.includes('event: connected'));
      // Handshake MUST confirm studentRecord.id, NOT teacherRecord.id
      assert.ok(
        handshake.includes(`"userId":${studentRecord.id}`),
        'Stream must be registered strictly under authenticated req.user.id'
      );
      assert.ok(
        !handshake.includes(`"userId":${teacherRecord.id}`),
        'Stream must NOT be registered under spoofed query param userId'
      );

      client.close();
    });

    // --------------------------------------------------------------------------
    // Test 11: Existing notification routes remain functional
    // --------------------------------------------------------------------------
    await test('11. Existing user notification endpoints and API catalog remain functional', async () => {
      // 1. Fetch user notifications via existing route
      const notifRes = await makeRequest(
        'GET',
        `/api/v1/users/${studentRecord.id}/notifications`,
        null,
        studentToken
      );
      assert.strictEqual(notifRes.status, 200, 'GET /api/v1/users/:id/notifications should return 200');
      assert.ok(Array.isArray(notifRes.body.data.notifications), 'Should return notifications array');

      // 2. Fetch API catalog to verify notifications stream is listed
      const catalogRes = await makeRequest('GET', '/api/v1');
      assert.strictEqual(catalogRes.status, 200);
      assert.strictEqual(
        catalogRes.body.data.endpoints.notifications.stream,
        'GET /api/v1/notifications/stream',
        'API catalog must expose stream endpoint'
      );
    });

    // --------------------------------------------------------------------------
    // Test 12: Database safety verification
    // --------------------------------------------------------------------------
    await test('12. Database safety: test runs in test mode against isolated test database', () => {
      assert.strictEqual(process.env.NODE_ENV, 'test', 'NODE_ENV must be test');
      assert.ok(
        !env.db.file.toLowerCase().endsWith('appointment_system.db'),
        'Test execution must never point to development appointment_system.db'
      );
      assert.ok(
        env.db.file.toLowerCase().includes('test'),
        'Test execution must point to dedicated test database'
      );
    });

  } finally {
    // Clean up any remaining open streams
    for (const c of openClients) {
      c.close();
    }
    eventService.reset();

    // Close temporary server
    await new Promise((resolve) => server.close(resolve));
  }

  // --------------------------------------------------------------------------
  // Summary & Exit Handling
  // --------------------------------------------------------------------------
  console.log('\n-----------------------------------------------------------------');
  console.log(`Notification Stream Test Summary: ${passed} passed, ${failed} failed.`);
  console.log('=================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runNotificationStreamTests().catch((err) => {
  console.error('Test suite failed unexpectedly:', err);
  process.exit(1);
});
