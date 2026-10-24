/**
 * Cross-Platform Database Migration Runner
 * Supports Linux (Docker / Render / Fly.io) and Windows using node:sqlite or better-sqlite3.
 * Zero external package dependencies.
 */

const fs = require('fs');
const path = require('path');

// Determine database path and migrations directory
const args = process.argv.slice(2);
const isForceReset = args.includes('--reset') || args.includes('-ForceReset') || args.includes('--force-reset');

const customDbArg = args.find(a => a.startsWith('--db='));
const defaultDbPath = process.env.DB_FILE || path.resolve(__dirname, 'appointment_system.db');
const dbPath = customDbArg ? path.resolve(process.cwd(), customDbArg.split('=')[1]) : path.resolve(process.cwd(), defaultDbPath);

const customMigArg = args.find(a => a.startsWith('--migrations='));
const migrationsDir = customMigArg ? path.resolve(process.cwd(), customMigArg.split('=')[1]) : path.resolve(__dirname, 'migrations');

// Ensure target directory exists for database file
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

console.log('\n=================================================================');
console.log('     Teacher-Student Appointment System: Database Migration Runner');
console.log('=================================================================');
console.log(`Target Database: ${dbPath}`);
console.log(`Migrations Dir:  ${migrationsDir}`);

// Connect using native drivers
let db = null;

try {
  const { DatabaseSync } = require('node:sqlite');
  const syncDb = new DatabaseSync(dbPath);
  syncDb.exec('PRAGMA foreign_keys = ON;');
  db = {
    exec(sql) { return syncDb.exec(sql); },
    all(sql, ...params) { return syncDb.prepare(sql).all(...params); },
    run(sql, ...params) { return syncDb.prepare(sql).run(...params); },
    close() { syncDb.close(); }
  };
} catch (err1) {
  try {
    const BetterSqlite3 = require('better-sqlite3');
    const bDb = new BetterSqlite3(dbPath);
    bDb.pragma('foreign_keys = ON');
    db = {
      exec(sql) { return bDb.exec(sql); },
      all(sql, ...params) { return bDb.prepare(sql).all(...params); },
      run(sql, ...params) { return bDb.prepare(sql).run(...params); },
      close() { bDb.close(); }
    };
  } catch (err2) {
    console.error('[Error] No supported SQLite driver found (requires Node.js >= 22.5.0 with node:sqlite or better-sqlite3).');
    console.error(err1.message);
    process.exit(1);
  }
}

try {
  // 1. Force Reset if requested
  if (isForceReset) {
    console.log('\n[!] Resetting database schema...');
    const tables = db.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';");
    for (const t of tables) {
      db.exec(`DROP TABLE IF EXISTS "${t.name}";`);
    }
    console.log('All tables dropped successfully.');
  }

  // 2. Ensure schema_migrations ledger exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version VARCHAR(50) NOT NULL UNIQUE,
      name VARCHAR(255) NOT NULL,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 3. Get applied migrations
  const appliedRows = db.all('SELECT version FROM schema_migrations ORDER BY version ASC;');
  const appliedSet = new Set(appliedRows.map(r => String(r.version)));

  // 4. Find migration files
  if (!fs.existsSync(migrationsDir)) {
    console.warn(`[!] Migrations directory not found at: ${migrationsDir}`);
    process.exit(0);
  }

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.warn(`[!] No migration files found in: ${migrationsDir}`);
    process.exit(0);
  }

  let appliedCount = 0;
  let skippedCount = 0;

  for (const file of files) {
    const version = file.split('_')[0];
    if (appliedSet.has(version)) {
      console.log(`[-] Migration ${file} already applied. Skipping.`);
      skippedCount++;
      continue;
    }

    console.log(`\n[+] Applying migration: ${file}...`);
    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf8');

    const startTime = Date.now();
    db.exec('BEGIN TRANSACTION;');
    try {
      db.exec(sql);
      db.run('INSERT INTO schema_migrations (version, name) VALUES (?, ?);', version, file);
      db.exec('COMMIT;');
      const durationMs = Date.now() - startTime;
      console.log(`    Migration ${file} completed in ${durationMs} ms.`);
      appliedCount++;
    } catch (migErr) {
      try { db.exec('ROLLBACK;'); } catch (rbErr) {}
      console.error(`\n[FAIL] Error executing migration '${file}':`, migErr.message);
      process.exit(1);
    }
  }

  console.log('\n-----------------------------------------------------------------');
  console.log(`Migration Summary: ${appliedCount} applied, ${skippedCount} up-to-date, ${files.length} total.`);
  console.log('=================================================================\n');

} finally {
  if (db && db.close) {
    try { db.close(); } catch (e) {}
  }
}
