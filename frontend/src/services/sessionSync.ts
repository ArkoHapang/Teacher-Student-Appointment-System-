/**
 * Cross-Tab Session Synchronization Service
 *
 * Coordinates logout events across browser tabs/windows using BroadcastChannel
 * with a safe localStorage storage-event fallback when BroadcastChannel is unavailable.
 *
 * Security & Data Minimization:
 * - Event payload is strictly limited to: { type: 'LOGOUT', timestamp: number, tabId: string }
 * - Zero credentials, tokens, cookies, or user profile information transmitted.
 * - Prevents broadcast reflection loops and redundant backend logout invocations.
 */

export interface LogoutSyncEvent {
  type: 'LOGOUT';
  timestamp: number;
  tabId: string;
}

export type RemoteLogoutListener = () => void;

const CHANNEL_NAME = 'ts_auth_channel';
const STORAGE_SYNC_KEY = 'ts_auth_sync_event';

// Generate a unique in-memory tab identifier for this tab instance
function generateTabId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `tab_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

const currentTabId: string = generateTabId();

let broadcastChannelInstance: BroadcastChannel | null = null;
let isBroadcastChannelAvailable: boolean | null = null;
let storageListenerAttached = false;
const listeners = new Set<RemoteLogoutListener>();

function isBroadcastChannelSupported(): boolean {
  if (isBroadcastChannelAvailable !== null) {
    return isBroadcastChannelAvailable;
  }
  try {
    if (typeof window !== 'undefined' && typeof window.BroadcastChannel !== 'undefined') {
      isBroadcastChannelAvailable = true;
      return true;
    }
  } catch {
    // Environment error checking BroadcastChannel
  }
  isBroadcastChannelAvailable = false;
  return false;
}

function isValidLogoutPayload(data: unknown): data is LogoutSyncEvent {
  if (!data || typeof data !== 'object') return false;
  const event = data as Record<string, unknown>;
  return (
    event.type === 'LOGOUT' &&
    typeof event.timestamp === 'number' &&
    typeof event.tabId === 'string' &&
    event.tabId.length > 0
  );
}

function notifyRemoteLogoutListeners(): void {
  for (const listener of Array.from(listeners)) {
    try {
      listener();
    } catch {
      // Prevent single listener error from halting others
    }
  }
}

function handleBroadcastMessage(event: MessageEvent): void {
  const data = event.data;
  if (!isValidLogoutPayload(data)) {
    return;
  }
  // Ignore events originating from this tab
  if (data.tabId === currentTabId) {
    return;
  }
  notifyRemoteLogoutListeners();
}

function handleStorageEvent(event: StorageEvent): void {
  // Only handle our dedicated sync key
  if (event.key !== STORAGE_SYNC_KEY) {
    return;
  }
  // Ignore removal / clearing events
  if (!event.newValue) {
    return;
  }
  try {
    const data = JSON.parse(event.newValue);
    if (!isValidLogoutPayload(data)) {
      return;
    }
    // Ignore events originating from this tab
    if (data.tabId === currentTabId) {
      return;
    }
    notifyRemoteLogoutListeners();
  } catch {
    // Ignore malformed payloads safely
  }
}

function initChannel(): BroadcastChannel | null {
  if (!isBroadcastChannelSupported()) {
    return null;
  }
  if (!broadcastChannelInstance) {
    try {
      broadcastChannelInstance = new BroadcastChannel(CHANNEL_NAME);
      broadcastChannelInstance.onmessage = handleBroadcastMessage;
    } catch {
      isBroadcastChannelAvailable = false;
      broadcastChannelInstance = null;
    }
  }
  return broadcastChannelInstance;
}

function initStorageFallback(): void {
  if (storageListenerAttached) return;
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    try {
      window.addEventListener('storage', handleStorageEvent);
      storageListenerAttached = true;
    } catch {
      // Safe fallback
    }
  }
}

function ensureListening(): void {
  if (isBroadcastChannelSupported()) {
    initChannel();
  } else {
    initStorageFallback();
  }
}

function teardownListeners(): void {
  if (broadcastChannelInstance) {
    try {
      broadcastChannelInstance.close();
    } catch {
      // ignore
    }
    broadcastChannelInstance = null;
  }
  if (storageListenerAttached && typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
    try {
      window.removeEventListener('storage', handleStorageEvent);
    } catch {
      // ignore
    }
    storageListenerAttached = false;
  }
}

export const sessionSync = {
  getTabId(): string {
    return currentTabId;
  },

  getChannelName(): string {
    return CHANNEL_NAME;
  },

  getStorageKey(): string {
    return STORAGE_SYNC_KEY;
  },

  isSupported(): boolean {
    return isBroadcastChannelSupported() || (typeof window !== 'undefined' && typeof window.addEventListener === 'function');
  },

  isBroadcastChannelMode(): boolean {
    return isBroadcastChannelSupported();
  },

  broadcastLogout(): void {
    const event: LogoutSyncEvent = {
      type: 'LOGOUT',
      timestamp: Date.now(),
      tabId: currentTabId
    };

    if (isBroadcastChannelSupported()) {
      try {
        const channel = initChannel();
        if (channel) {
          channel.postMessage(event);
          return;
        }
      } catch {
        // Fall back to storage if postMessage throws
      }
    }

    // Storage-event fallback only when BroadcastChannel is unavailable
    if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_SYNC_KEY, JSON.stringify(event));
        // Remove temporary event data immediately after publishing
        localStorage.removeItem(STORAGE_SYNC_KEY);
      } catch {
        // Safe catch for storage quotas or private mode restrictions
      }
    }
  },

  onRemoteLogout(listener: RemoteLogoutListener): () => void {
    listeners.add(listener);
    ensureListening();

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        teardownListeners();
      }
    };
  },

  // Reset or teardown internal state for clean testing
  cleanup(): void {
    listeners.clear();
    teardownListeners();
    isBroadcastChannelAvailable = null;
  }
};
