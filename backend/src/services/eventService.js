/**
 * Real-Time Server-Sent Events (SSE) Event Service
 *
 * Manages authenticated user-specific SSE connection streams,
 * keep-alive heartbeats, safe disconnection cleanup, and recipient isolation.
 *
 * Single-instance in-memory registry designed for unified container deployment.
 */

const { EventEmitter } = require('events');
const logger = require('../config/logger');

const DEFAULT_KEEP_ALIVE_INTERVAL_MS = 25000;

class EventService extends EventEmitter {
  constructor(options = {}) {
    super();
    // Map<number, Set<import('express').Response>>: userId -> Set of active Response objects
    this.connections = new Map();
    this.keepAliveIntervalMs = options.keepAliveIntervalMs || DEFAULT_KEEP_ALIVE_INTERVAL_MS;
    this.keepAliveTimer = null;
  }

  /**
   * Format an SSE data frame according to the W3C EventSource specification.
   *
   * @param {string} [event] - Optional event type name
   * @param {any} data - Event payload (serialized to JSON if object)
   * @param {string|number} [id] - Optional event identifier
   * @returns {string} Formatted SSE payload
   */
  formatSseEvent(event, data, id = null) {
    let payload = '';
    if (id !== null && id !== undefined) {
      payload += `id: ${id}\n`;
    }
    if (event) {
      payload += `event: ${event}\n`;
    }
    const serialized = typeof data === 'string' ? data : JSON.stringify(data);
    payload += `data: ${serialized}\n\n`;
    return payload;
  }

  /**
   * Format a comment frame (used for SSE keep-alive heartbeat).
   *
   * @param {string} [comment='keepalive']
   * @returns {string} Formatted SSE comment
   */
  formatSseComment(comment = 'keepalive') {
    return `:${comment}\n\n`;
  }

  /**
   * Safely write data to a response stream without crashing if the connection is destroyed.
   *
   * @param {import('express').Response} res
   * @param {string} payload
   * @returns {boolean} True if successfully written, false otherwise
   */
  safeWrite(res, payload) {
    if (!res || res.writableEnded || res.destroyed || res.finished) {
      return false;
    }
    try {
      res.write(payload);
      if (typeof res.flush === 'function') {
        res.flush();
      }
      return true;
    } catch (err) {
      logger.warn(`[EventService] Failed to write to response stream: ${err.message}`);
      return false;
    }
  }

  /**
   * Register an incoming Express Response stream for an authenticated user.
   * Configures standard SSE headers, transmits initial handshake, and hooks cleanup.
   *
   * @param {number|string} userId - Authenticated user identifier
   * @param {import('express').Response} res - Express response object
   * @param {Object} [options]
   * @param {boolean} [options.writeHeaders=true] - Whether to write SSE headers automatically
   * @returns {boolean} True if registration succeeded
   */
  registerConnection(userId, res, options = {}) {
    const parsedUserId = parseInt(userId, 10);
    if (!parsedUserId || isNaN(parsedUserId) || parsedUserId <= 0) {
      throw new Error(`[EventService] Invalid numeric userId for registration: ${userId}`);
    }

    if (!res || typeof res.write !== 'function') {
      throw new Error('[EventService] Invalid response stream handle provided for registration.');
    }

    // 1. Establish SSE headers if not already sent and requested
    const shouldWriteHeaders = options.writeHeaders !== false;
    if (shouldWriteHeaders && !res.headersSent && typeof res.writeHead === 'function') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
      });
      if (typeof res.flushHeaders === 'function') {
        res.flushHeaders();
      }
    }

    // 2. Add connection to user's set
    if (!this.connections.has(parsedUserId)) {
      this.connections.set(parsedUserId, new Set());
    }
    const userConnections = this.connections.get(parsedUserId);
    userConnections.add(res);

    // 3. Ensure keep-alive heartbeat loop is active
    this.startKeepAlive();

    // 4. Send initial handshake confirmation event
    const handshakePayload = this.formatSseEvent('connected', {
      connected: true,
      userId: parsedUserId,
      timestamp: new Date().toISOString()
    });
    this.safeWrite(res, handshakePayload);

    // 5. Register idempotent cleanup listeners on response close/finish/error
    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      this.unregisterConnection(parsedUserId, res);
    };

    if (typeof res.on === 'function') {
      res.on('close', cleanup);
      res.on('finish', cleanup);
      res.on('error', cleanup);
    }

    logger.debug(`[EventService] User #${parsedUserId} registered connection (Total for user: ${userConnections.size}, Users: ${this.connections.size})`);
    return true;
  }

  /**
   * Unregister an existing Response stream for a user.
   * Cleans up empty user entries and stops heartbeat if no connections remain.
   *
   * @param {number|string} userId
   * @param {import('express').Response} res
   * @returns {boolean} True if a connection was found and removed
   */
  unregisterConnection(userId, res) {
    const parsedUserId = parseInt(userId, 10);
    if (!parsedUserId || !this.connections.has(parsedUserId)) {
      return false;
    }

    const userConnections = this.connections.get(parsedUserId);
    const removed = userConnections.delete(res);

    if (userConnections.size === 0) {
      this.connections.delete(parsedUserId);
    }

    if (this.connections.size === 0) {
      this.stopKeepAlive();
    }

    logger.debug(`[EventService] User #${parsedUserId} unregistered connection (Remaining for user: ${userConnections.size}, Users: ${this.connections.size})`);
    return removed;
  }

  /**
   * Publish an SSE event strictly to all active connections belonging to a single recipient user.
   * Guarantees strict recipient isolation: other users receive nothing.
   *
   * @param {number|string} recipientId - User ID of the target recipient
   * @param {string} event - Event name (e.g. 'notification', 'booking_request')
   * @param {any} data - Serializable payload
   * @param {string|number} [id=null] - Optional event ID
   * @returns {number} Count of successful transmissions
   */
  sendToUser(recipientId, event, data, id = null) {
    const parsedRecipientId = parseInt(recipientId, 10);
    if (!parsedRecipientId || isNaN(parsedRecipientId) || parsedRecipientId <= 0) {
      logger.warn(`[EventService] sendToUser called with invalid recipientId: ${recipientId}`);
      return 0;
    }

    const userConnections = this.connections.get(parsedRecipientId);
    if (!userConnections || userConnections.size === 0) {
      return 0;
    }

    const payload = this.formatSseEvent(event, data, id);
    let successCount = 0;
    const deadConnections = [];

    for (const res of userConnections) {
      const written = this.safeWrite(res, payload);
      if (written) {
        successCount++;
      } else {
        deadConnections.push(res);
      }
    }

    // Clean up any sockets that failed write
    for (const deadRes of deadConnections) {
      this.unregisterConnection(parsedRecipientId, deadRes);
    }

    logger.debug(`[EventService] Published '${event}' to User #${parsedRecipientId} (${successCount}/${userConnections.size + deadConnections.length} streams delivered)`);
    return successCount;
  }

  /**
   * Broadcast a keep-alive heartbeat comment to all active connections across all users.
   *
   * @returns {number} Total active connections messaged
   */
  sendKeepAlive() {
    if (this.connections.size === 0) {
      return 0;
    }

    const commentPayload = this.formatSseComment('keepalive');
    let totalPings = 0;
    const deadEntries = [];

    for (const [userId, userConnections] of this.connections.entries()) {
      for (const res of userConnections) {
        const written = this.safeWrite(res, commentPayload);
        if (written) {
          totalPings++;
        } else {
          deadEntries.push({ userId, res });
        }
      }
    }

    for (const { userId, res } of deadEntries) {
      this.unregisterConnection(userId, res);
    }

    return totalPings;
  }

  /**
   * Start recurring keep-alive timer if not already running.
   */
  startKeepAlive() {
    if (this.keepAliveTimer) {
      return;
    }

    this.keepAliveTimer = setInterval(() => {
      this.sendKeepAlive();
    }, this.keepAliveIntervalMs);

    // Unref timer so it does not block Node.js test process termination
    if (typeof this.keepAliveTimer.unref === 'function') {
      this.keepAliveTimer.unref();
    }
  }

  /**
   * Stop recurring keep-alive timer.
   */
  stopKeepAlive() {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  /**
   * Diagnostic: Return total active connections for a user, or across all users if omitted.
   *
   * @param {number|string} [userId]
   * @returns {number}
   */
  getConnectionCount(userId = null) {
    if (userId !== null && userId !== undefined) {
      const parsedUserId = parseInt(userId, 10);
      const userConnections = this.connections.get(parsedUserId);
      return userConnections ? userConnections.size : 0;
    }

    let total = 0;
    for (const userSet of this.connections.values()) {
      total += userSet.size;
    }
    return total;
  }

  /**
   * Diagnostic: Return count of distinct authenticated users currently holding active connections.
   *
   * @returns {number}
   */
  getUserCount() {
    return this.connections.size;
  }

  /**
   * Complete reset of all active connections and timers (used for test teardown).
   */
  reset() {
    this.stopKeepAlive();
    this.connections.clear();
  }
}

// Singleton instance for in-process application use
const eventService = new EventService();

module.exports = eventService;
module.exports.EventService = EventService;
