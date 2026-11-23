-- =============================================================================
-- Migration 006: Allow NULL actor_id in audit_logs for system events (Issue #58)
-- Allows automated, cron, and system background events to record audit entries
-- without requiring a human actor account.
-- =============================================================================

CREATE TABLE IF NOT EXISTS audit_logs_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id VARCHAR(50) NOT NULL,
    details TEXT,
    ip_address VARCHAR(45),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO audit_logs_new (id, actor_id, action, entity_type, entity_id, details, ip_address, created_at)
SELECT id, actor_id, action, entity_type, entity_id, details, ip_address, created_at FROM audit_logs;

DROP TABLE audit_logs;

ALTER TABLE audit_logs_new RENAME TO audit_logs;

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
