-- ==============================================================================
-- Migration: 004_secure_admin_bootstrap.sql
-- Description: Administrator Credential Security Remediation (BLK-01)
-- 1. Create audit ledger for secure one-time administrator bootstrap
-- 2. Invalidate default seed administrator credentials in fresh/migrated state
-- ==============================================================================

-- 1. Create Admin Bootstrap State Ledger
CREATE TABLE IF NOT EXISTS admin_bootstrap_state (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bootstrapped_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    bootstrapped_by VARCHAR(255) NOT NULL,
    ip_address VARCHAR(45)
);

CREATE INDEX IF NOT EXISTS idx_admin_bootstrap_state_admin ON admin_bootstrap_state(admin_id);

-- 2. Neutralize hardcoded default test administrator password
-- Replaces the known public bcrypt hash for 'Password123!' with an unmatchable disabled token
-- so that default credentials can NEVER authenticate in a freshly initialized database.
UPDATE users
SET password_hash = '$2b$10$DISABLED_PENDING_BOOTSTRAP_INVALID_HASH_VALUE_00000000000000'
WHERE email = 'admin@university.edu'
  AND role_id = (SELECT id FROM roles WHERE name = 'ADMIN')
  AND password_hash = '$2b$10$wvnNLhxJGUPSd/4nZ7Xwk.sZVZ4Zxy5Awge.GZiY594x4miJEA55m';
