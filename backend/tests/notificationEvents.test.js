/**
 * Step 1 — Real-Time Notification Event Service Unit Test Suite
 *
 * Verifies:
 * 1. Register one connection for one user with appropriate headers.
 * 2. Send initial connection confirmation handshake event.
 * 3. Register multiple simultaneous connections for the same user.
 * 4. Publish an event to all connections belonging to a single user.
 * 5. Strict recipient isolation: another user's connection receives zero data.
 * 6. Unregister one connection without affecting other connections of the same user.
 * 7. Remove the user registry entry when its last connection closes.
 * 8. Automatic connection cleanup on client disconnect ('close', 'finish', 'error').
 * 9. Safe handling of closed, destroyed, or erroring response streams during publish.
 * 10. Accurate keep-alive heartbeat comment formatting (:keepalive\n\n) and delivery.
 * 11. Custom keep-alive timer behavior.
 * 12. Input validation: rejection of non-numeric or invalid user IDs.
 * 13. Diagnostics accuracy: getConnectionCount and getUserCount.
 * 14. Transaction afterCommit callbacks execute strictly after commit in registration order.
 * 15. Transaction afterCommit callbacks are discarded and never run on rollback.
 * 16. Synchronous errors in afterCommit callbacks do not fail the transaction return value.
 * 17. Asynchronous rejections in afterCommit callbacks are safely handled.
 * 18. notificationService.createNotification dispatches SSE event strictly post-commit.
 * 19. notificationService.createNotification does not dispatch SSE event on rollback.
 * 20. notificationService.createNotification safely persists without error if tx.afterCommit is absent.
 * 21. Native driver COMMIT failure discards afterCommit callbacks without execution.
 * 22. Non-native driver fallback never executes post-commit callbacks without a real COMMIT.
 */

require('./setup');
const assert = require('assert');
const { EventEmitter } = require('events');
const eventService = require('../src/services/eventService');
const { EventService } = require('../src/services/eventService');
const db = require('../src/config/database');
const notificationService = require('../src/services/notificationService');

/**
 * Creates a mock Express Response object for SSE testing.
 */
function createMockResponse(options = {}) {
  const res = new EventEmitter();
  res.headersSent = false;
  res.statusCode = null;
  res.headers = {};
  res.writtenChunks = [];
  res.writableEnded = options.writableEnded || false;
  res.destroyed = options.destroyed || false;
  res.finished = options.finished || false;

  res.writeHead = function (statusCode, headers) {
    if (res.headersSent) {
      throw new Error('Headers already sent');
    }
    res.statusCode = statusCode;
    res.headers = { ...res.headers, ...headers };
    res.headersSent = true;
    return res;
  };

  res.write = function (chunk) {
    if (options.throwOnWrite) {
      throw new Error('Simulated synchronous write failure');
    }
    if (res.writableEnded || res.destroyed) {
      throw new Error('Cannot write after end/destroy');
    }
    res.writtenChunks.push(chunk.toString());
    return true;
  };

  res.end = function () {
    res.writableEnded = true;
    res.finished = true;
    res.emit('finish');
    res.emit('close');
  };

  res.destroy = function () {
    res.destroyed = true;
    res.writableEnded = true;
    res.emit('close');
  };

  return res;
}

async function runNotificationEventsTests() {
  console.log('\n=================================================================');
  console.log('   Teacher-Student Appointment System: Event Service Tests       ');
  console.log('=================================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      // Ensure clean state before each test
      eventService.reset();
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
    } finally {
      eventService.reset();
    }
  }

  // --------------------------------------------------------------------------
  // Test 1: Single Connection Registration & Headers
  // --------------------------------------------------------------------------
  await test('1. Register one connection for one user with standard SSE headers', () => {
    const res = createMockResponse();
    const registered = eventService.registerConnection(101, res);

    assert.strictEqual(registered, true);
    assert.strictEqual(res.headersSent, true);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers['Content-Type'], 'text/event-stream');
    assert.strictEqual(res.headers['Cache-Control'], 'no-cache, no-transform');
    assert.strictEqual(res.headers['Connection'], 'keep-alive');
    assert.strictEqual(res.headers['X-Accel-Buffering'], 'no');

    assert.strictEqual(eventService.getConnectionCount(101), 1);
    assert.strictEqual(eventService.getUserCount(), 1);
  });

  // --------------------------------------------------------------------------
  // Test 2: Initial Connection Handshake Event
  // --------------------------------------------------------------------------
  await test('2. Send initial connection confirmation handshake event', () => {
    const res = createMockResponse();
    eventService.registerConnection(101, res);

    assert.ok(res.writtenChunks.length >= 1);
    const initialMessage = res.writtenChunks[0];
    assert.ok(initialMessage.startsWith('event: connected\n'));
    assert.ok(initialMessage.includes('"connected":true'));
    assert.ok(initialMessage.includes('"userId":101'));
    assert.ok(initialMessage.endsWith('\n\n'));
  });

  // --------------------------------------------------------------------------
  // Test 3: Multiple Simultaneous Connections for Same User
  // --------------------------------------------------------------------------
  await test('3. Register multiple simultaneous connections for the same user', () => {
    const resTab1 = createMockResponse();
    const resTab2 = createMockResponse();
    const resTab3 = createMockResponse();

    eventService.registerConnection(200, resTab1);
    eventService.registerConnection(200, resTab2);
    eventService.registerConnection(200, resTab3);

    assert.strictEqual(eventService.getConnectionCount(200), 3);
    assert.strictEqual(eventService.getUserCount(), 1);
    assert.strictEqual(eventService.getConnectionCount(), 3);
  });

  // --------------------------------------------------------------------------
  // Test 4: Publish Event to All User Connections
  // --------------------------------------------------------------------------
  await test('4. Publish an event to all connections belonging to one user', () => {
    const resTab1 = createMockResponse();
    const resTab2 = createMockResponse();

    eventService.registerConnection(300, resTab1);
    eventService.registerConnection(300, resTab2);

    const deliveredCount = eventService.sendToUser(300, 'booking_request', {
      appointmentId: 42,
      title: 'Consultation on Distributed Systems'
    });

    assert.strictEqual(deliveredCount, 2);

    // Verify both tabs received the formatted SSE event
    [resTab1, resTab2].forEach((res) => {
      const lastChunk = res.writtenChunks[res.writtenChunks.length - 1];
      assert.ok(lastChunk.includes('event: booking_request\n'));
      assert.ok(lastChunk.includes('"appointmentId":42'));
      assert.ok(lastChunk.includes('"title":"Consultation on Distributed Systems"'));
      assert.ok(lastChunk.endsWith('\n\n'));
    });
  });

  // --------------------------------------------------------------------------
  // Test 5: Strict Recipient Isolation
  // --------------------------------------------------------------------------
  await test('5. Recipient isolation: another user connection receives nothing', () => {
    const resUserA = createMockResponse();
    const resUserB = createMockResponse();

    eventService.registerConnection(401, resUserA);
    eventService.registerConnection(402, resUserB);

    const userBInitialChunkCount = resUserB.writtenChunks.length;

    // Send private alert strictly to User A
    const deliveredCount = eventService.sendToUser(401, 'private_alert', { secret: 'Confidential' });

    assert.strictEqual(deliveredCount, 1);

    // Verify User A received the event
    const userALastChunk = resUserA.writtenChunks[resUserA.writtenChunks.length - 1];
    assert.ok(userALastChunk.includes('event: private_alert\n'));
    assert.ok(userALastChunk.includes('Confidential'));

    // Verify User B received ZERO additional chunks
    assert.strictEqual(resUserB.writtenChunks.length, userBInitialChunkCount);
    for (const chunk of resUserB.writtenChunks) {
      assert.strictEqual(chunk.includes('Confidential'), false);
    }
  });

  // --------------------------------------------------------------------------
  // Test 6: Unregister One Connection Without Affecting Others
  // --------------------------------------------------------------------------
  await test('6. Unregister one connection without removing other connections', () => {
    const resTab1 = createMockResponse();
    const resTab2 = createMockResponse();

    eventService.registerConnection(500, resTab1);
    eventService.registerConnection(500, resTab2);
    assert.strictEqual(eventService.getConnectionCount(500), 2);

    // Unregister tab 1
    const unregistered = eventService.unregisterConnection(500, resTab1);
    assert.strictEqual(unregistered, true);

    assert.strictEqual(eventService.getConnectionCount(500), 1);
    assert.strictEqual(eventService.getUserCount(), 1);

    // Publishing now only sends to tab 2
    const delivered = eventService.sendToUser(500, 'tab_test', { active: true });
    assert.strictEqual(delivered, 1);
  });

  // --------------------------------------------------------------------------
  // Test 7: Complete User Entry Cleanup When Last Connection Closes
  // --------------------------------------------------------------------------
  await test('7. Remove the user registry entry when its last connection closes', () => {
    const res = createMockResponse();
    eventService.registerConnection(600, res);

    assert.strictEqual(eventService.getUserCount(), 1);
    assert.strictEqual(eventService.getConnectionCount(600), 1);

    eventService.unregisterConnection(600, res);

    assert.strictEqual(eventService.getUserCount(), 0);
    assert.strictEqual(eventService.getConnectionCount(600), 0);
    assert.strictEqual(eventService.getConnectionCount(), 0);
  });

  // --------------------------------------------------------------------------
  // Test 8: Automatic Cleanup on Client Disconnect Events
  // --------------------------------------------------------------------------
  await test('8. Verify automatic cleanup after client close/finish event', () => {
    const res = createMockResponse();
    eventService.registerConnection(700, res);

    assert.strictEqual(eventService.getConnectionCount(700), 1);

    // Simulate client closing the browser tab / connection abruptly
    res.emit('close');

    assert.strictEqual(eventService.getConnectionCount(700), 0);
    assert.strictEqual(eventService.getUserCount(), 0);
  });

  // --------------------------------------------------------------------------
  // Test 9: Safe Handling of Closed/Destroyed Streams
  // --------------------------------------------------------------------------
  await test('9. Publishing to closed or destroyed connections does not crash and cleans up', () => {
    const normalRes = createMockResponse();
    const deadRes = createMockResponse({ writableEnded: true, destroyed: true });

    eventService.registerConnection(800, normalRes);
    eventService.registerConnection(800, deadRes);

    assert.strictEqual(eventService.getConnectionCount(800), 2);

    // Attempt publish to both
    const delivered = eventService.sendToUser(800, 'resilient_event', { status: 'OK' });

    // Only the healthy stream should succeed
    assert.strictEqual(delivered, 1);

    // The dead stream must be automatically cleaned up from registry
    assert.strictEqual(eventService.getConnectionCount(800), 1);
  });

  // --------------------------------------------------------------------------
  // Test 10: Keep-Alive Heartbeat Formatting and Delivery
  // --------------------------------------------------------------------------
  await test('10. Keep-alive heartbeat comments are broadcast to all connections', () => {
    const resUserA = createMockResponse();
    const resUserB = createMockResponse();

    eventService.registerConnection(901, resUserA);
    eventService.registerConnection(902, resUserB);

    const initialLengthA = resUserA.writtenChunks.length;
    const initialLengthB = resUserB.writtenChunks.length;

    // Manually trigger keep-alive ping
    const pingedCount = eventService.sendKeepAlive();

    assert.strictEqual(pingedCount, 2);
    assert.strictEqual(resUserA.writtenChunks.length, initialLengthA + 1);
    assert.strictEqual(resUserB.writtenChunks.length, initialLengthB + 1);

    const pingChunkA = resUserA.writtenChunks[resUserA.writtenChunks.length - 1];
    const pingChunkB = resUserB.writtenChunks[resUserB.writtenChunks.length - 1];

    assert.strictEqual(pingChunkA, ':keepalive\n\n');
    assert.strictEqual(pingChunkB, ':keepalive\n\n');
  });

  // --------------------------------------------------------------------------
  // Test 11: Controlled Timer Keep-Alive Lifecycle
  // --------------------------------------------------------------------------
  await test('11. Controlled timer starts when connections exist and stops when empty', async () => {
    const customService = new EventService({ keepAliveIntervalMs: 50 });
    const res = createMockResponse();

    assert.strictEqual(customService.keepAliveTimer, null);

    customService.registerConnection(1001, res);
    assert.ok(customService.keepAliveTimer !== null);

    // Wait for at least one timer tick (60ms)
    await new Promise((resolve) => setTimeout(resolve, 65));

    // Confirm keep-alive comment was written
    const keepAlives = res.writtenChunks.filter((chunk) => chunk === ':keepalive\n\n');
    assert.ok(keepAlives.length >= 1, `Expected at least 1 keepalive, received: ${keepAlives.length}`);

    // Unregister and verify timer is cleared
    customService.unregisterConnection(1001, res);
    assert.strictEqual(customService.keepAliveTimer, null);
    customService.reset();
  });

  // --------------------------------------------------------------------------
  // Test 12: Input Validation Safety
  // --------------------------------------------------------------------------
  await test('12. Input validation: invalid user IDs and handles throw or return 0 safely', () => {
    const res = createMockResponse();

    // Register with invalid user IDs
    assert.throws(() => eventService.registerConnection(null, res), /Invalid numeric userId/);
    assert.throws(() => eventService.registerConnection(-5, res), /Invalid numeric userId/);
    assert.throws(() => eventService.registerConnection('invalid_id', res), /Invalid numeric userId/);
    assert.throws(() => eventService.registerConnection(101, null), /Invalid response stream handle/);

    // sendToUser with invalid recipient
    assert.strictEqual(eventService.sendToUser(null, 'test', {}), 0);
    assert.strictEqual(eventService.sendToUser(-1, 'test', {}), 0);
    assert.strictEqual(eventService.sendToUser(99999, 'test', {}), 0); // Non-existent user
  });

  // --------------------------------------------------------------------------
  // Test 13: SSE Format Specification Compliance
  // --------------------------------------------------------------------------
  await test('13. formatSseEvent produces strict W3C SSE wire format with event ID', () => {
    const raw = eventService.formatSseEvent('status_change', { status: 'APPROVED' }, 105);
    const expected = 'id: 105\nevent: status_change\ndata: {"status":"APPROVED"}\n\n';
    assert.strictEqual(raw, expected);

    const stringData = eventService.formatSseEvent('ping', 'plain text data');
    const expectedString = 'event: ping\ndata: plain text data\n\n';
    assert.strictEqual(stringData, expectedString);
  });

  // --------------------------------------------------------------------------
  // Test 14: Transaction afterCommit Executes Post-Commit in Order
  // --------------------------------------------------------------------------
  await test('14. db.transaction tx.afterCommit callbacks execute in order strictly after commit', async () => {
    const callOrder = [];
    let transactionCommitted = false;

    const result = await db.transaction(async (tx) => {
      tx.afterCommit(() => {
        assert.strictEqual(transactionCommitted, true, 'Callback 1 must run after commit');
        callOrder.push('cb1');
      });

      tx.afterCommit(() => {
        assert.strictEqual(transactionCommitted, true, 'Callback 2 must run after commit');
        callOrder.push('cb2');
      });

      callOrder.push('tx_body');
      transactionCommitted = true;
      return { success: true };
    });

    assert.deepStrictEqual(result, { success: true });
    assert.deepStrictEqual(callOrder, ['tx_body', 'cb1', 'cb2']);
  });

  // --------------------------------------------------------------------------
  // Test 15: Transaction afterCommit Callbacks Discarded on Rollback
  // --------------------------------------------------------------------------
  await test('15. db.transaction tx.afterCommit callbacks are discarded and never run on rollback', async () => {
    let callbackFired = false;

    await assert.rejects(
      async () => {
        await db.transaction(async (tx) => {
          tx.afterCommit(() => {
            callbackFired = true;
          });
          throw new Error('Simulated transaction abortion');
        });
      },
      /Simulated transaction abortion/
    );

    assert.strictEqual(callbackFired, false, 'afterCommit callback must not execute on transaction rollback');
  });

  // --------------------------------------------------------------------------
  // Test 16: Synchronous afterCommit Error Does Not Break Transaction Return
  // --------------------------------------------------------------------------
  await test('16. Synchronous error in afterCommit callback is safely caught and does not fail transaction', async () => {
    let secondCallbackFired = false;

    const result = await db.transaction(async (tx) => {
      tx.afterCommit(() => {
        throw new Error('Explosion in synchronous post-commit handler');
      });
      tx.afterCommit(() => {
        secondCallbackFired = true;
      });
      return { committed: true };
    });

    assert.strictEqual(result.committed, true);
    assert.strictEqual(secondCallbackFired, true, 'Subsequent callbacks must continue running');
  });

  // --------------------------------------------------------------------------
  // Test 17: Asynchronous afterCommit Rejection is Safely Handled
  // --------------------------------------------------------------------------
  await test('17. Asynchronous promise rejection in afterCommit is caught and logged safely', async () => {
    let asyncCallbackFired = false;

    const result = await db.transaction(async (tx) => {
      tx.afterCommit(async () => {
        asyncCallbackFired = true;
        throw new Error('Explosion in async post-commit handler');
      });
      return { done: true };
    });

    assert.strictEqual(result.done, true);
    assert.strictEqual(asyncCallbackFired, true);
  });

  // --------------------------------------------------------------------------
  // Test 18: Notification Service Integrates with tx.afterCommit Post-Commit
  // --------------------------------------------------------------------------
  await test('18. notificationService.createNotification dispatches SSE event strictly post-commit', async () => {
    const user = await db.queryOne("SELECT id FROM users WHERE status = 'ACTIVE' LIMIT 1;");
    assert.ok(user, 'An active user must exist in the database');
    const recipientId = user.id;

    const res = createMockResponse();
    eventService.registerConnection(recipientId, res);

    const initialChunks = res.writtenChunks.length;
    let createdNotificationId = null;

    try {
      await db.transaction(async (tx) => {
        const notif = await notificationService.createNotification(tx, {
          recipientId,
          title: 'Post-Commit Real-Time Test',
          message: 'Verifying notification dispatch after SQLite commit',
          type: notificationService.NOTIFICATION_TYPES.SYSTEM_ALERT
        });
        createdNotificationId = notif.id;

        // Inside transaction: event has NOT been emitted yet
        assert.strictEqual(res.writtenChunks.length, initialChunks, 'No SSE event should be sent prior to commit');
      });

      // After transaction: event must have been emitted
      assert.strictEqual(res.writtenChunks.length, initialChunks + 1, 'SSE event must be sent after commit');
      const latestChunk = res.writtenChunks[res.writtenChunks.length - 1];
      assert.ok(latestChunk.includes('event: notification\n'), 'Event type must be notification');
      assert.ok(latestChunk.includes(`id: ${createdNotificationId}\n`), 'Event ID must match notification primary key');
      assert.ok(latestChunk.includes('"title":"Post-Commit Real-Time Test"'), 'Event payload must contain title');
      assert.ok(latestChunk.includes('"type":"SYSTEM_ALERT"'), 'Event payload must contain notification type');
    } finally {
      if (createdNotificationId) {
        await db.execute('DELETE FROM notifications WHERE id = ?;', [createdNotificationId]);
      }
    }
  });

  // --------------------------------------------------------------------------
  // Test 19: Notification Service Discards Event Dispatch on Transaction Rollback
  // --------------------------------------------------------------------------
  await test('19. notificationService.createNotification does NOT dispatch SSE event on rollback', async () => {
    const user = await db.queryOne("SELECT id FROM users WHERE status = 'ACTIVE' LIMIT 1;");
    assert.ok(user, 'An active user must exist in the database');
    const recipientId = user.id;

    const res = createMockResponse();
    eventService.registerConnection(recipientId, res);

    const initialChunks = res.writtenChunks.length;
    let attemptedNotificationId = null;

    await assert.rejects(
      async () => {
        await db.transaction(async (tx) => {
          const notif = await notificationService.createNotification(tx, {
            recipientId,
            title: 'Rollback Safety Test',
            message: 'This notification should be rolled back and never emitted',
            type: notificationService.NOTIFICATION_TYPES.SYSTEM_ALERT
          });
          attemptedNotificationId = notif.id;

          throw new Error('Forced rollback to verify zero event dispatch');
        });
      },
      /Forced rollback to verify zero event dispatch/
    );

    // After rollback: zero chunks emitted
    assert.strictEqual(res.writtenChunks.length, initialChunks, 'Zero SSE chunks must be dispatched on rollback');

    // Confirm record was rolled back in database
    if (attemptedNotificationId) {
      const persisted = await db.queryOne('SELECT id FROM notifications WHERE id = ?;', [attemptedNotificationId]);
      assert.strictEqual(persisted, null, 'Notification record must not exist in database after rollback');
    }
  });

  // --------------------------------------------------------------------------
  // Test 20: Notification Service Decoupled When tx.afterCommit is Absent
  // --------------------------------------------------------------------------
  await test('20. notificationService.createNotification safely persists without error if tx.afterCommit is absent', async () => {
    let createdNotificationId = null;
    const user = await db.queryOne("SELECT id FROM users WHERE status = 'ACTIVE' LIMIT 1;");
    assert.ok(user, 'An active user must exist in the database');
    const recipientId = user.id;

    // Simulate a bare handle or mock without afterCommit
    const mockTx = {
      execute: (sql, params) => db.execute(sql, params)
    };

    try {
      const notif = await notificationService.createNotification(mockTx, {
        recipientId,
        title: 'Mock Tx Decoupling Test',
        message: 'Notification without afterCommit handle',
        type: notificationService.NOTIFICATION_TYPES.SYSTEM_ALERT
      });
      createdNotificationId = notif.id;

      assert.ok(createdNotificationId, 'Notification should be created successfully');
      assert.strictEqual(notif.recipientId, recipientId);
      assert.strictEqual(notif.isRead, 0);
    } finally {
      if (createdNotificationId) {
        await db.execute('DELETE FROM notifications WHERE id = ?;', [createdNotificationId]);
      }
    }
  });

  // --------------------------------------------------------------------------
  // Test 21: Native Driver COMMIT Failure Discards afterCommit Callbacks
  // --------------------------------------------------------------------------
  await test('21. Native driver COMMIT failure discards afterCommit callbacks without execution', async () => {
    const originalDriver = db._getNativeDriver();
    assert.ok(originalDriver, 'Test environment must have a native driver');

    let commitAttempted = false;
    let callbackFired = false;
    const failingCommitDriver = {
      ...originalDriver,
      exec(sql) {
        if (typeof sql === 'string' && sql.trim().startsWith('COMMIT')) {
          commitAttempted = true;
          throw new Error('Simulated SQLite disk I/O failure during COMMIT');
        }
        return originalDriver.exec(sql);
      }
    };

    try {
      db._setNativeDriver(failingCommitDriver);

      await assert.rejects(
        async () => {
          await db.transaction(async (tx) => {
            tx.afterCommit(() => {
              callbackFired = true;
            });
            return 'tx-success';
          });
        },
        (err) => {
          assert.ok(err.message.includes('Simulated SQLite disk I/O failure during COMMIT'));
          return true;
        }
      );

      assert.strictEqual(commitAttempted, true, 'COMMIT was attempted');
      assert.strictEqual(callbackFired, false, 'afterCommit callback must not execute when COMMIT fails');
    } finally {
      db._setNativeDriver(originalDriver);
    }
  });

  // --------------------------------------------------------------------------
  // Test 22: Non-Native Fallback Never Executes post-commit Callbacks
  // --------------------------------------------------------------------------
  await test('22. Non-native driver fallback never executes post-commit callbacks without a real COMMIT', async () => {
    const originalDriver = db._getNativeDriver();
    assert.ok(originalDriver, 'Test environment must have a native driver');

    let callbackFired = false;

    const user = await db.queryOne("SELECT id FROM users WHERE status = 'ACTIVE' LIMIT 1;");
    assert.ok(user, 'An active user must exist in the database');
    const recipientId = user.id;

    const res = createMockResponse();
    eventService.registerConnection(recipientId, res);
    const initialChunks = res.writtenChunks.length;

    try {
      // Simulate non-native driver fallback where nativeDriver is null
      db._setNativeDriver(null);

      // 1. Plain tx.afterCommit in non-native fallback
      const result = await db.transaction(async (tx) => {
        tx.afterCommit(() => {
          callbackFired = true;
        });
        return { fallbackHandled: true };
      });

      assert.deepStrictEqual(result, { fallbackHandled: true });
      assert.strictEqual(callbackFired, false, 'Non-native fallback must discard afterCommit without running');

      // 2. Notification creation in non-native fallback: record must not dispatch SSE
      await db.transaction(async (tx) => {
        const notif = {
          id: 99999998,
          recipientId,
          appointmentId: null,
          title: 'Fallback Safety Test',
          message: 'Testing fallback post-commit suppression',
          type: 'SYSTEM_ALERT',
          isRead: 0
        };

        tx.afterCommit(() => {
          eventService.sendToUser(recipientId, 'notification', notif, notif.id);
        });
      });

      assert.strictEqual(
        res.writtenChunks.length,
        initialChunks,
        'Zero SSE events should be dispatched when executing in non-native fallback'
      );
    } finally {
      db._setNativeDriver(originalDriver);
    }
  });

  // --------------------------------------------------------------------------
  // Summary & Exit Handling
  // --------------------------------------------------------------------------
  console.log('\n-----------------------------------------------------------------');
  console.log(`Event Service Test Summary: ${passed} passed, ${failed} failed.`);
  console.log('=================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runNotificationEventsTests().catch((err) => {
  console.error('Test suite failed unexpectedly:', err);
  process.exit(1);
});
