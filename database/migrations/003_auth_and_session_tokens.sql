-- ==============================================================================
-- Migration: 003_auth_and_session_tokens.sql
-- Description: Token Revocation Store and Verified Password Hash Baseline
-- ==============================================================================

-- 1. Create Revoked Tokens Store for JWT Invalidation & Logout
CREATE TABLE IF NOT EXISTS revoked_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_id VARCHAR(255) NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMP NOT NULL,
    revoked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_revoked_tokens_token_id ON revoked_tokens(token_id);
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires ON revoked_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_user ON revoked_tokens(user_id);

-- 2. Update initial mock seed passwords to valid bcrypt hashes for 'Password123!'
-- Allows authenticated login testing with seeded accounts:
-- admin@university.edu (ADMIN)
-- robert.miller@university.edu (TEACHER)
-- sarah.jenkins@university.edu (TEACHER)
-- alan.walker@university.edu (TEACHER)
-- mark.peterson@university.edu (TEACHER, PENDING_APPROVAL)
-- alice.carter@student.university.edu (STUDENT)
-- david.kim@student.university.edu (STUDENT)
UPDATE users 
SET password_hash = '$2b$10$wvnNLhxJGUPSd/4nZ7Xwk.sZVZ4Zxy5Awge.GZiY594x4miJEA55m'
WHERE password_hash LIKE '$2b$10$T1K7fGkKqm9p%';
