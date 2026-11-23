-- =============================================================================
-- Migration 005: Bugfix Auth Tokens, Security & Performance Indexes
-- Implements token persistence for password recovery, student email verification,
-- faculty onboarding invitations, and essential query performance indexes.
--
-- PRODUCTION DATA SAFETY:
-- This migration strictly creates new tables and indexes. It does NOT insert,
-- modify, or delete any users, teacher profiles, availability slots, or appointments.
-- Demonstration and seed data are reserved exclusively for isolated test fixtures.
-- =============================================================================

-- 1. Create auth_tokens table
CREATE TABLE IF NOT EXISTS auth_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    type VARCHAR(30) NOT NULL CHECK (type IN ('PASSWORD_RESET', 'STUDENT_VERIFICATION', 'TEACHER_INVITATION')),
    expires_at TIMESTAMP NOT NULL,
    used BOOLEAN NOT NULL DEFAULT 0,
    used_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_auth_tokens_lookup ON auth_tokens(token_hash, type, used);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens(user_id, type);

-- 2. Ensure indexes on teacher profiles and appointments for production query performance
CREATE INDEX IF NOT EXISTS idx_teacher_profiles_verified ON teacher_profiles(is_verified);
CREATE INDEX IF NOT EXISTS idx_appointments_student_status ON appointments(student_id, status);
