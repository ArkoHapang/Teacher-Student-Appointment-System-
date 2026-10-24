/**
 * Migration Integration Service
 * Inspects versioned migrations against the schema_migrations ledger.
 */

const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const logger = require('../config/logger');

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'database/migrations');

const migrationService = {
  /**
   * Check migration status against the database ledger.
   */
  async getStatus() {
    // 1. Get available migration files
    let availableFiles = [];
    if (fs.existsSync(MIGRATIONS_DIR)) {
      availableFiles = fs.readdirSync(MIGRATIONS_DIR)
        .filter(file => file.endsWith('.sql'))
        .sort();
    }

    // 2. Query applied migrations from database
    let appliedRecords = [];
    try {
      appliedRecords = await db.query(
        'SELECT version, name, applied_at FROM schema_migrations ORDER BY version ASC;'
      );
    } catch (err) {
      logger.warn('[MigrationService] schema_migrations table not found or query failed', { error: err.message });
      return {
        isUpToDate: false,
        totalAvailable: availableFiles.length,
        appliedCount: 0,
        pendingCount: availableFiles.length,
        applied: [],
        pending: availableFiles,
        error: 'Schema migrations table not initialized'
      };
    }

    const appliedVersions = new Set(appliedRecords.map(r => r.version || (r.name ? r.name.split('_')[0] : '')));

    const pending = availableFiles.filter(file => {
      const version = file.split('_')[0];
      return !appliedVersions.has(version);
    });

    return {
      isUpToDate: pending.length === 0,
      totalAvailable: availableFiles.length,
      appliedCount: appliedRecords.length,
      pendingCount: pending.length,
      applied: appliedRecords.map(r => r.name || r.version),
      pending
    };
  }
};

module.exports = migrationService;
