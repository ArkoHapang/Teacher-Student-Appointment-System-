/**
 * Centralized Client IP Resolver
 *
 * Resolves the true client IP address safely in production behind Fly Proxy
 * and in local development environments.
 *
 * Security Invariants:
 * 1. NEVER blindly trust arbitrary X-Forwarded-For headers.
 * 2. Only trust Fly-Client-IP when running on Fly.io or when explicitly configured.
 * 3. Strictly validate candidate IP addresses using net.isIP (IPv4 and IPv6).
 * 4. Reject malformed, oversized (> 45 chars), empty, or non-string inputs.
 * 5. Normalize IPv6-mapped IPv4 representations (::ffff:127.0.0.1 -> 127.0.0.1).
 * 6. Always provide a safe socket remote address fallback.
 */

const net = require('net');

const MAX_IP_STRING_LENGTH = 45; // Maximum length of standard IPv6 string

/**
 * Normalize an IP string: strip IPv6-mapped IPv4 prefix and scope IDs.
 * @param {string} ip
 * @returns {string}
 */
function normalizeIp(ip) {
  if (!ip || typeof ip !== 'string') return '127.0.0.1';
  let cleaned = ip.trim();

  // Strip IPv6 scope identifier if present (e.g., fe80::1%eth0)
  const percentIdx = cleaned.indexOf('%');
  if (percentIdx !== -1) {
    cleaned = cleaned.substring(0, percentIdx);
  }

  // Normalize IPv6-mapped IPv4: ::ffff:192.0.2.1 -> 192.0.2.1
  if (cleaned.startsWith('::ffff:')) {
    const candidateV4 = cleaned.substring(7);
    if (net.isIPv4(candidateV4)) {
      return candidateV4;
    }
  }

  // Normalize IPv6 loopback ::1 to standard representation
  if (cleaned === '::1') {
    return '127.0.0.1';
  }

  return cleaned;
}

/**
 * Validate that an input string is a valid IPv4 or IPv6 address.
 * @param {any} candidate
 * @returns {boolean}
 */
function isValidIp(candidate) {
  if (!candidate || typeof candidate !== 'string') return false;
  const trimmed = candidate.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_IP_STRING_LENGTH) return false;
  const normalized = normalizeIp(trimmed);
  return net.isIP(normalized) !== 0;
}

/**
 * Determine whether the current runtime environment is running behind Fly Proxy
 * or configured to accept Fly proxy headers.
 * @returns {boolean}
 */
function isFlyProxyTrusted() {
  // Explicit configuration override
  if (process.env.TRUST_FLY_PROXY === 'false') {
    return false;
  }
  if (process.env.TRUST_FLY_PROXY === 'true') {
    return true;
  }

  // Fly.io automatically injects FLY_APP_NAME, FLY_MACHINE_ID, and FLY_REGION into containers
  const isFlyPlatform = Boolean(process.env.FLY_APP_NAME || process.env.FLY_REGION || process.env.FLY_MACHINE_ID);
  if (isFlyPlatform) {
    return true;
  }

  // In test environment, allow simulated headers unless explicitly disabled
  const isTest = process.env.NODE_ENV === 'test';
  return isTest;
}

/**
 * Safely resolve the client IP address from an Express request object.
 *
 * Evaluation Order:
 * 1. If Fly Proxy is trusted and Fly-Client-IP header is present:
 *    - Validate using isValidIp().
 *    - If valid, normalize and return.
 * 2. If candidate header is missing or malformed, fall back to socket remoteAddress.
 * 3. Normalize socket remoteAddress.
 * 4. Fall back to '127.0.0.1' if socket address is unavailable or invalid.
 *
 * @param {import('express').Request} req
 * @returns {string} Normalized, verified IP address
 */
function resolveClientIp(req) {
  if (!req) return '127.0.0.1';

  // 1. Check Fly-Client-IP if proxy trust is active
  if (isFlyProxyTrusted() && req.headers) {
    const flyClientIpRaw = req.headers['fly-client-ip'];
    if (typeof flyClientIpRaw === 'string') {
      const trimmed = flyClientIpRaw.trim();
      if (isValidIp(trimmed)) {
        return normalizeIp(trimmed);
      }
    }
  }

  // 2. Safe socket address fallback
  const socket = req.socket || req.connection;
  const socketAddress = socket && socket.remoteAddress ? socket.remoteAddress : null;

  if (typeof socketAddress === 'string') {
    const trimmedSocket = socketAddress.trim();
    if (isValidIp(trimmedSocket)) {
      return normalizeIp(trimmedSocket);
    }
  }

  // 3. Absolute fail-safe fallback
  return '127.0.0.1';
}

/**
 * Express middleware that resolves client IP and safely attaches it as req.clientIp
 * and defines req.ip getter for transparent compatibility across all handlers.
 */
function clientIpMiddleware(req, res, next) {
  const ip = resolveClientIp(req);
  req.clientIp = ip;
  try {
    Object.defineProperty(req, 'ip', {
      configurable: true,
      enumerable: true,
      get() {
        return ip;
      }
    });
  } catch (err) {
    // Fallback if property is non-configurable
    req.ip = ip;
  }
  next();
}

module.exports = {
  resolveClientIp,
  isValidIp,
  normalizeIp,
  isFlyProxyTrusted,
  clientIpMiddleware
};
