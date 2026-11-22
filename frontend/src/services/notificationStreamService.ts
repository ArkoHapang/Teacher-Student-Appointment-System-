/**
 * Centralized Real-Time Notification Stream Service (Frontend)
 *
 * Manages the native browser EventSource connection to /api/v1/notifications/stream
 * using same-origin HttpOnly cookie credentials.
 *
 * Guarantees:
 * 1. Singleton connection lifecycle per authenticated user session.
 * 2. Deduplicated connections across React StrictMode & re-render cycles.
 * 3. Multi-subscriber event distribution registry.
 * 4. Safe event parsing and payload validation.
 * 5. Zero tokens or user IDs exposed in query parameters / URLs.
 * 6. Clean disconnection upon logout or session termination.
 */

export interface RealtimeNotificationPayload {
  id: number;
  recipientId: number;
  userId?: number;
  appointmentId?: number | null;
  title: string;
  message: string;
  type: string;
  isRead: number;
  createdAt?: string;
}

export type NotificationListener = (notification: RealtimeNotificationPayload) => void;

class NotificationStreamService {
  private eventSource: EventSource | null = null;
  private currentUserId: number | null = null;
  private listeners: Set<NotificationListener> = new Set();
  private streamUrl = '/api/v1/notifications/stream';

  /**
   * Establish an SSE connection for the given authenticated user.
   * If already connected for the same user, preserves the existing stream.
   * If the authenticated user ID changed, closes the previous stream before reconnecting.
   *
   * @param userId Authenticated user ID from trusted server session context
   */
  public connect(userId: number): void {
    const parsedId = Number(userId);
    if (!parsedId || isNaN(parsedId) || parsedId <= 0) {
      return;
    }

    // 1. If user ID changed, cleanly disconnect prior stream
    if (this.currentUserId !== null && this.currentUserId !== parsedId) {
      this.disconnect();
    }

    // 2. Prevent duplicate connections if stream is already open or connecting
    if (
      this.eventSource &&
      this.currentUserId === parsedId &&
      this.eventSource.readyState !== EventSource.CLOSED
    ) {
      return;
    }

    // Clean up any closed handle
    if (this.eventSource) {
      try {
        this.eventSource.close();
      } catch {}
      this.eventSource = null;
    }

    const connectionUserId = parsedId;
    this.currentUserId = parsedId;

    try {
      // Native browser EventSource with same-origin credentials
      const es = new EventSource(this.streamUrl, {
        withCredentials: true
      });

      this.eventSource = es;

      // Handle 'connected' handshake
      es.addEventListener('connected', () => {
        // Handshake confirmed by server
      });

      // Handle 'notification' events
      es.addEventListener('notification', (event: MessageEvent) => {
        // Discard stale events if this connection is no longer the active EventSource
        // or if the authenticated user has changed or logged out
        if (this.eventSource !== es || this.currentUserId !== connectionUserId) {
          return;
        }
        this.handleIncomingNotification(event, connectionUserId);
      });

      // Handle connection errors
      es.onerror = () => {
        // Native EventSource automatically attempts backoff reconnection when readyState is CONNECTING.
        // If readyState is CLOSED (e.g. terminal network failure or 401 response), clean up the handle.
        if (es.readyState === EventSource.CLOSED) {
          if (this.eventSource === es) {
            this.eventSource = null;
          }
        }
      };
    } catch {
      this.eventSource = null;
    }
  }

  /**
   * Safely parse and validate an incoming SSE notification event frame.
   */
  private handleIncomingNotification(event: MessageEvent, expectedUserId?: number): void {
    if (!event || typeof event.data !== 'string') {
      return;
    }

    // Require an active authenticated user context
    const targetUserId = expectedUserId ?? this.currentUserId;
    if (!targetUserId || targetUserId <= 0) {
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(event.data);
    } catch {
      // Discard malformed JSON without crashing application
      return;
    }

    if (!payload || typeof payload !== 'object') {
      return;
    }

    const data = payload as Record<string, unknown>;

    // 1. Require a valid numeric notification ID
    const id = Number(data.id);
    if (!id || isNaN(id) || id <= 0) {
      return;
    }

    // 2. Require an explicit, valid recipient identity from the payload contract.
    // The backend notification model uses 'recipientId' (with 'userId' or 'recipient_id' as established contract aliases).
    // NEVER fall back to or silently substitute targetUserId when the recipient property is missing.
    const rawRecipient = data.recipientId ?? data.userId ?? data.recipient_id;
    if (rawRecipient === undefined || rawRecipient === null) {
      return;
    }

    const recipientId = Number(rawRecipient);
    if (!recipientId || isNaN(recipientId) || recipientId <= 0) {
      return;
    }

    // 3. Verify recipient identity belongs strictly to the currently authenticated user session.
    // Explicitly reject notifications addressed to a different user.
    if (recipientId !== targetUserId) {
      return;
    }

    // 4. Require valid, non-empty title, message, and type strings
    const title = typeof data.title === 'string' ? data.title.trim() : '';
    const message = typeof data.message === 'string' ? data.message.trim() : '';
    const type = typeof data.type === 'string' ? data.type.trim() : '';

    if (!title || !message || !type) {
      return;
    }

    const normalized: RealtimeNotificationPayload = {
      id,
      recipientId,
      userId: recipientId,
      appointmentId: data.appointmentId !== undefined && data.appointmentId !== null ? Number(data.appointmentId) : null,
      title,
      message,
      type,
      isRead: Number(data.isRead) === 1 ? 1 : 0,
      createdAt: typeof data.createdAt === 'string' && data.createdAt.trim() ? data.createdAt : new Date().toISOString()
    };

    // Distribute to all active subscribers
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(normalized);
      } catch {
        // Prevent single subscriber error from interrupting others
      }
    }
  }

  /**
   * Register a subscriber listener to receive incoming real-time notifications.
   * Returns an unsubscribe function for React useEffect cleanup.
   *
   * @param listener Callback function receiving incoming notification
   * @returns Unsubscribe function
   */
  public onNotification(listener: NotificationListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Check whether an active or connecting EventSource handle exists.
   */
  public isConnected(): boolean {
    return Boolean(
      this.eventSource &&
      this.eventSource.readyState !== EventSource.CLOSED
    );
  }

  /**
   * Retrieve currently connected user ID, if any.
   */
  public getConnectedUserId(): number | null {
    return this.eventSource && this.eventSource.readyState !== EventSource.CLOSED
      ? this.currentUserId
      : null;
  }

  /**
   * Explicitly disconnect and terminate the active stream.
   * Invoked upon logout, remote logout, or user session change.
   */
  public disconnect(): void {
    if (this.eventSource) {
      try {
        this.eventSource.close();
      } catch {}
      this.eventSource = null;
    }
    this.currentUserId = null;
  }
}

export const notificationStreamService = new NotificationStreamService();
