/**
 * Database Connection & Execution Manager
 * Connects to SQLite with Foreign Key support and Transaction orchestration.
 * Executes real database queries against the approved database file.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const env = require('./env');
const logger = require('./logger');

/**
 * Fail-fast safety guard: Refuses to open the development database if running in test mode
 * or if test runner/files are detected in process arguments.
 */
function assertDatabaseSafety(targetDbFile) {
  const normalizedTarget = path.normalize(path.resolve(targetDbFile)).toLowerCase();
  const devDbPath = path.normalize(path.resolve(process.cwd(), 'database/appointment_system.db')).toLowerCase();

  const isTestEnv = (process.env.NODE_ENV === 'test');
  const isTestArg = process.argv.some(arg =>
    arg.includes('test') || arg.endsWith('.test.js') || arg.endsWith('test-admin-integration.cjs')
  );
  const isTestMain = Boolean(
    (require.main && require.main.filename && (require.main.filename.includes('test') || require.main.filename.includes('test-admin-integration.cjs'))) ||
    (process.mainModule && process.mainModule.filename && (process.mainModule.filename.includes('test') || process.mainModule.filename.includes('test-admin-integration.cjs')))
  );

  if (isTestEnv || isTestArg || isTestMain) {
    if (normalizedTarget === devDbPath) {
      throw new Error(`[CRITICAL SAFETY VIOLATION] Refusing database connection! Test process attempted to open development database: ${targetDbFile}`);
    }
  }
}

// Enforce fail-fast safety check before initiating connection
assertDatabaseSafety(env.db.file);

// Ensure target directory exists for database file
const dbDir = path.dirname(env.db.file);
if (!fs.existsSync(dbDir)) {
  try {
    fs.mkdirSync(dbDir, { recursive: true });
  } catch (dirErr) {
    logger.warn(`[Database] Could not ensure directory exists: ${dbDir} (${dirErr.message})`);
  }
}

let nativeDriver = null;

// Attempt to load native drivers (better-sqlite3, node:sqlite, sqlite3)
try {
  const BetterSqlite3 = require('better-sqlite3');
  nativeDriver = new BetterSqlite3(env.db.file);
  nativeDriver.pragma('foreign_keys = ON');
  logger.info(`[Database] Connected via better-sqlite3 to ${env.db.file}`);
} catch (e) {
  try {
    const { DatabaseSync } = require('node:sqlite');
    const syncDb = new DatabaseSync(env.db.file);
    syncDb.exec('PRAGMA foreign_keys = ON;');
    nativeDriver = {
      prepare(sql) {
        const stmt = syncDb.prepare(sql);
        return {
          all: (...params) => stmt.all(...params),
          get: (...params) => stmt.get(...params),
          run: (...params) => stmt.run(...params)
        };
      },
      pragma(cmd) {
        syncDb.exec(`PRAGMA ${cmd};`);
      },
      exec(sql) {
        syncDb.exec(sql);
      }
    };
    logger.info(`[Database] Connected via node:sqlite to ${env.db.file}`);
  } catch (err2) {
    try {
      const sqlite3 = require('sqlite3');
      // Driver available if installed
    } catch (err) {
      // Falls back to resilient Windows native bridge
    }
  }
}


/**
 * Execute real SQL via Windows native bridge when node SQLite driver is not compiled
 */
function executeNativeBridge(sql, isQuery = true) {
  const dbPath = env.db.file;
  assertDatabaseSafety(dbPath);
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database file not found at: ${dbPath}`);
  }

  const script = `
$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;

public class WinSqliteBridgeJs {
    [DllImport("winsqlite3.dll", EntryPoint = "sqlite3_open", CallingConvention = CallingConvention.Cdecl)]
    public static extern int Open([MarshalAs(UnmanagedType.LPStr)] string filename, out IntPtr db);

    [DllImport("winsqlite3.dll", EntryPoint = "sqlite3_close", CallingConvention = CallingConvention.Cdecl)]
    public static extern int Close(IntPtr db);

    public delegate int CallbackDelegate(IntPtr notUsed, int numCols, [MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 1)] IntPtr[] colValues, [MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 1)] IntPtr[] colNames);

    [DllImport("winsqlite3.dll", EntryPoint = "sqlite3_exec", CallingConvention = CallingConvention.Cdecl)]
    public static extern int ExecWithCallback(IntPtr db, [MarshalAs(UnmanagedType.LPStr)] string sql, CallbackDelegate callback, IntPtr arg, out IntPtr errMsg);

    [DllImport("winsqlite3.dll", EntryPoint = "sqlite3_errmsg", CallingConvention = CallingConvention.Cdecl)]
    public static extern IntPtr ErrMsg(IntPtr db);

    public static string ExecuteQuery(string dbPath, string sql) {
        IntPtr db = IntPtr.Zero;
        if (Open(dbPath, out db) != 0) throw new Exception("Failed to open DB");
        try {
            List<Dictionary<string, string>> rows = new List<Dictionary<string, string>>();
            IntPtr errMsg = IntPtr.Zero;
            ExecWithCallback(db, "PRAGMA foreign_keys = ON;", null, IntPtr.Zero, out errMsg);
            int rc = ExecWithCallback(db, sql, (notUsed, numCols, colValues, colNames) => {
                Dictionary<string, string> row = new Dictionary<string, string>();
                for (int i = 0; i < numCols; i++) {
                    string colName = Marshal.PtrToStringAnsi(colNames[i]);
                    string colVal = colValues[i] != IntPtr.Zero ? Marshal.PtrToStringAnsi(colValues[i]) : null;
                    row[colName] = colVal;
                }
                rows.Add(row);
                return 0;
            }, IntPtr.Zero, out errMsg);
            if (rc != 0) {
                string err = Marshal.PtrToStringAnsi(ErrMsg(db));
                throw new Exception("SQLite Error: " + err);
            }
            System.Web.Script.Serialization.JavaScriptSerializer js = new System.Web.Script.Serialization.JavaScriptSerializer();
            return js.Serialize(rows);
        } finally {
            Close(db);
        }
    }
}
'@ -ReferencedAssemblies "System.Web.Extensions"
[WinSqliteBridgeJs]::ExecuteQuery("${dbPath.replace(/\\/g, '\\\\')}", @"
${sql}
"@)
`;

  try {
    const output = execFileSync('powershell', ['-NoProfile', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024
    });
    return JSON.parse(output.trim() || '[]');
  } catch (error) {
    throw new Error(`Database execution failed: ${error.message}`);
  }
}

const db = {
  /**
   * Run a query that returns multiple rows.
   */
  async query(sql, params = []) {
    if (nativeDriver) {
      const stmt = nativeDriver.prepare(sql);
      return stmt.all(...params);
    }
    return executeNativeBridge(sql, true);
  },

  /**
   * Run a query that returns a single row.
   */
  async queryOne(sql, params = []) {
    if (nativeDriver) {
      const stmt = nativeDriver.prepare(sql);
      const row = stmt.get ? stmt.get(...params) : stmt.all(...params)[0];
      return row || null;
    }
    const rows = await this.query(sql, params);
    return rows.length > 0 ? rows[0] : null;
  },

  /**
   * Execute an INSERT, UPDATE, or DELETE statement.
   */
  async execute(sql, params = []) {
    if (nativeDriver) {
      const stmt = nativeDriver.prepare(sql);
      const info = stmt.run(...params);
      return {
        changes: info.changes,
        lastInsertRowid: info.lastInsertRowid
      };
    }
    const result = executeNativeBridge(sql, false);
    return {
      changes: 1,
      lastInsertRowid: null
    };
  },

  /**
   * Health ping: returns true if database is accessible and responsive.
   */
  async ping() {
    const start = Date.now();
    const result = await this.queryOne('SELECT 1 as alive;');
    const latencyMs = Date.now() - start;
    return {
      connected: !!result,
      latencyMs
    };
  },

  /**
   * Get the database file path.
   */
  getPath() {
    return env.db.file;
  },

  /**
   * Execute an atomic transaction block.
   * Uses BEGIN IMMEDIATE to acquire exclusive write locks and eliminate race condition deadlocks.
   * Automatically commits on success and rolls back on failure.
   * Supports transaction-scoped afterCommit(callback) post-commit event dispatch.
   *
   * TRANSACTION GUARANTEES & NON-DRIVER FALLBACK LIMITATIONS:
   * - When nativeDriver is active (better-sqlite3 / node:sqlite), multi-statement
   *   atomic transactions are fully supported with BEGIN IMMEDIATE and COMMIT/ROLLBACK.
   *   Post-commit callbacks registered via tx.afterCommit(callback) run strictly after
   *   a confirmed, successful COMMIT.
   * - When nativeDriver is unavailable (PowerShell winsqlite3 fallback bridge), each query
   *   executes in an isolated ad-hoc process and atomic multi-statement transactions cannot
   *   be guaranteed. In this fallback mode, no true database COMMIT takes place; therefore,
   *   post-commit callbacks are strictly discarded and never executed, preventing false
   *   post-commit side effects (such as premature or invalid SSE event emissions).
   */
  async transaction(fn) {
    const postCommitCallbacks = [];
    const tx = {
      query: (sql, params) => this.query(sql, params),
      queryOne: (sql, params) => this.queryOne(sql, params),
      execute: (sql, params) => this.execute(sql, params),
      ping: () => this.ping(),
      getPath: () => this.getPath(),
      transaction: (nestedFn) => this.transaction(nestedFn),
      afterCommit: (callback) => {
        if (typeof callback === 'function') {
          postCommitCallbacks.push(callback);
        }
      }
    };

    if (nativeDriver) {
      if (nativeDriver.exec) {
        nativeDriver.exec('BEGIN IMMEDIATE;');
      } else {
        await this.execute('BEGIN IMMEDIATE;');
      }
      try {
        const result = await fn(tx);
        if (nativeDriver.exec) {
          nativeDriver.exec('COMMIT;');
        } else {
          await this.execute('COMMIT;');
        }

        // Execute post-commit callbacks safely ONLY after confirmed successful COMMIT
        for (const cb of postCommitCallbacks) {
          try {
            const ret = cb();
            if (ret && typeof ret.catch === 'function') {
              ret.catch((asyncErr) => {
                logger.error(`[Database] Asynchronous post-commit callback error: ${asyncErr.message}`, { error: asyncErr });
              });
            }
          } catch (syncErr) {
            logger.error(`[Database] Synchronous post-commit callback error: ${syncErr.message}`, { error: syncErr });
          }
        }

        return result;
      } catch (err) {
        try {
          if (nativeDriver.exec) {
            nativeDriver.exec('ROLLBACK;');
          } else {
            await this.execute('ROLLBACK;');
          }
        } catch (rbErr) {
          // Rollback error swallowed if already rolled back by sqlite
        }
        // Notice: postCommitCallbacks are discarded on rollback or commit failure
        throw err;
      }
    }

    // Non-native fallback: cannot guarantee atomic transaction boundary or confirmed COMMIT.
    // Discard any registered postCommitCallbacks so they never execute without a real COMMIT.
    const result = await fn(tx);
    if (postCommitCallbacks.length > 0) {
      logger.warn(
        `[Database] Non-native driver fallback cannot guarantee transactional COMMIT; discarded ${postCommitCallbacks.length} post-commit callback(s).`
      );
      postCommitCallbacks.length = 0;
    }
    return result;
  },

  /**
   * Safely backup the live SQLite database using VACUUM INTO.
   * Creates an atomic, consistent, non-locking backup even with WAL mode active.
   * @param {string} destinationPath
   */
  async backup(destinationPath) {
    if (!destinationPath || typeof destinationPath !== 'string') {
      throw new Error('[Database] Valid destinationPath string is required for backup.');
    }
    const resolvedDest = path.resolve(destinationPath);
    if (fs.existsSync(resolvedDest)) {
      throw new Error(`[Database] Backup destination already exists: ${resolvedDest}. Cannot overwrite existing file.`);
    }
    const destDir = path.dirname(resolvedDest);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    const escapedDest = resolvedDest.replace(/'/g, "''");
    if (nativeDriver && nativeDriver.exec) {
      nativeDriver.exec(`VACUUM INTO '${escapedDest}';`);
    } else {
      await this.execute(`VACUUM INTO '${escapedDest}';`);
    }
    logger.info(`[Database] Consistent backup created successfully at: ${resolvedDest}`);
    return { path: resolvedDest };
  },

  /**
   * Internal test helper for inspecting or simulating driver states.
   */
  _getNativeDriver() {
    return nativeDriver;
  },
  _setNativeDriver(driver) {
    nativeDriver = driver;
  }
};

module.exports = db;
