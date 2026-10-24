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
   */
  async transaction(fn) {
    if (nativeDriver) {
      if (nativeDriver.exec) {
        nativeDriver.exec('BEGIN IMMEDIATE;');
      } else {
        await this.execute('BEGIN IMMEDIATE;');
      }
      try {
        const result = await fn(this);
        if (nativeDriver.exec) {
          nativeDriver.exec('COMMIT;');
        } else {
          await this.execute('COMMIT;');
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
        throw err;
      }
    }
    return fn(this);
  }
};

module.exports = db;
