# ==============================================================================
# Script: database/migrate.ps1
# Description: Production-grade SQLite Migration Runner for Windows
# Uses Windows built-in winsqlite3.dll (Zero external package dependencies)
# ==============================================================================

param(
    [string]$DbPath = "$PSScriptRoot\appointment_system.db",
    [string]$MigrationsDir = "$PSScriptRoot\migrations",
    [switch]$ForceReset,
    [switch]$VerboseOutput
)

$ErrorActionPreference = "Stop"

# ------------------------------------------------------------------------------
# 1. Initialize SQLite Interop Bridge
# ------------------------------------------------------------------------------
$csharpBridge = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;

public class WinSqlite {
    [DllImport("winsqlite3.dll", EntryPoint = "sqlite3_open", CallingConvention = CallingConvention.Cdecl)]
    public static extern int Open([MarshalAs(UnmanagedType.LPStr)] string filename, out IntPtr db);

    [DllImport("winsqlite3.dll", EntryPoint = "sqlite3_close", CallingConvention = CallingConvention.Cdecl)]
    public static extern int Close(IntPtr db);

    [DllImport("winsqlite3.dll", EntryPoint = "sqlite3_exec", CallingConvention = CallingConvention.Cdecl)]
    public static extern int Exec(IntPtr db, [MarshalAs(UnmanagedType.LPStr)] string sql, IntPtr callback, IntPtr arg, out IntPtr errMsg);

    [DllImport("winsqlite3.dll", EntryPoint = "sqlite3_errmsg", CallingConvention = CallingConvention.Cdecl)]
    public static extern IntPtr ErrMsg(IntPtr db);

    public delegate int CallbackDelegate(IntPtr notUsed, int numCols, [MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 1)] IntPtr[] colValues, [MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 1)] IntPtr[] colNames);

    [DllImport("winsqlite3.dll", EntryPoint = "sqlite3_exec", CallingConvention = CallingConvention.Cdecl)]
    public static extern int ExecWithCallback(IntPtr db, [MarshalAs(UnmanagedType.LPStr)] string sql, CallbackDelegate callback, IntPtr arg, out IntPtr errMsg);

    public static string GetLastError(IntPtr db) {
        IntPtr ptr = ErrMsg(db);
        return Marshal.PtrToStringAnsi(ptr);
    }
}
'@

if (-not ([System.Management.Automation.PSTypeName]'WinSqlite').Type) {
    Add-Type -TypeDefinition $csharpBridge -Language CSharp
}

# ------------------------------------------------------------------------------
# 2. Database Execution Helper Functions
# ------------------------------------------------------------------------------
function Execute-SqlNonQuery {
    param([IntPtr]$DbHandle, [string]$Sql)
    $errMsg = [IntPtr]::Zero
    $rc = [WinSqlite]::Exec($DbHandle, $Sql, [IntPtr]::Zero, [IntPtr]::Zero, [ref]$errMsg)
    if ($rc -ne 0) {
        $err = [WinSqlite]::GetLastError($DbHandle)
        throw "SQLite Error (code $rc): $err`nSQL: $Sql"
    }
}

function Query-SqlScalarList {
    param([IntPtr]$DbHandle, [string]$Sql)
    $results = New-Object System.Collections.Generic.List[string]
    $callback = [WinSqlite+CallbackDelegate]{
        param($notUsed, $numCols, $colValues, $colNames)
        if ($numCols -gt 0 -and $colValues[0] -ne [IntPtr]::Zero) {
            $val = [System.Runtime.InteropServices.Marshal]::PtrToStringAnsi($colValues[0])
            $results.Add($val)
        }
        return 0
    }
    $errMsg = [IntPtr]::Zero
    $rc = [WinSqlite]::ExecWithCallback($DbHandle, $Sql, $callback, [IntPtr]::Zero, [ref]$errMsg)
    if ($rc -ne 0) {
        $err = [WinSqlite]::GetLastError($DbHandle)
        throw "SQLite Query Error (code $rc): $err`nSQL: $Sql"
    }
    return $results.ToArray()
}

# ------------------------------------------------------------------------------
# 3. Migration Runner Execution
# ------------------------------------------------------------------------------
Write-Host "`n=================================================================" -ForegroundColor Cyan
Write-Host "     Teacher-Student Appointment System: Database Migration Runner" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "Target Database: $DbPath"
Write-Host "Migrations Dir:  $MigrationsDir"

# Open database
$db = [IntPtr]::Zero
$openRc = [WinSqlite]::Open($DbPath, [ref]$db)
if ($openRc -ne 0) {
    throw "Failed to open SQLite database at '$DbPath'. Error: $([WinSqlite]::GetLastError($db))"
}

try {
    # Enforce Foreign Keys
    Execute-SqlNonQuery -DbHandle $db -Sql "PRAGMA foreign_keys = ON;"

    # Reset schema if requested
    if ($ForceReset) {
        Write-Host "`n[!] Resetting database schema..." -ForegroundColor Yellow
        $tables = Query-SqlScalarList -DbHandle $db -Sql "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';"
        foreach ($table in $tables) {
            Execute-SqlNonQuery -DbHandle $db -Sql "DROP TABLE IF EXISTS [$table];"
        }
        Write-Host "All tables dropped successfully." -ForegroundColor Yellow
    }

    # Ensure ledger table exists
    Execute-SqlNonQuery -DbHandle $db -Sql @"
CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
"@

    # Get list of applied migrations
    $appliedMigrations = @(Query-SqlScalarList -DbHandle $db -Sql "SELECT version FROM schema_migrations ORDER BY version ASC;")

    # Find pending migration files
    $migrationFiles = Get-ChildItem -Path $MigrationsDir -Filter "*.sql" | Sort-Object Name

    if ($migrationFiles.Count -eq 0) {
        Write-Host "No migration files found in '$MigrationsDir'." -ForegroundColor Yellow
        return
    }

    $appliedCount = 0
    $skippedCount = 0

    foreach ($file in $migrationFiles) {
        $version = $file.BaseName.Split('_')[0]
        $name = $file.Name

        if ($appliedMigrations -contains $version) {
            Write-Host "[-] Migration $name already applied. Skipping." -ForegroundColor DarkGray
            $skippedCount++
            continue
        }

        Write-Host "`n[+] Applying migration: $name..." -ForegroundColor Green
        $sqlContent = Get-Content -Path $file.FullName -Raw

        # Execute migration wrapped in atomic transaction
        $startTime = [System.Diagnostics.Stopwatch]::StartNew()
        try {
            Execute-SqlNonQuery -DbHandle $db -Sql "BEGIN TRANSACTION;"
            Execute-SqlNonQuery -DbHandle $db -Sql $sqlContent
            
            # Record migration in ledger
            $recordSql = "INSERT INTO schema_migrations (version, name) VALUES ('$version', '$name');"
            Execute-SqlNonQuery -DbHandle $db -Sql $recordSql
            
            Execute-SqlNonQuery -DbHandle $db -Sql "COMMIT;"
            $startTime.Stop()
            Write-Host "    Migration $name completed in $($startTime.ElapsedMilliseconds) ms." -ForegroundColor Green
            $appliedCount++
        }
        catch {
            Execute-SqlNonQuery -DbHandle $db -Sql "ROLLBACK;"
            throw "Error executing migration '$name': $_"
        }
    }

    Write-Host "`n-----------------------------------------------------------------" -ForegroundColor Cyan
    Write-Host "Migration Summary: $appliedCount applied, $skippedCount up-to-date, $($migrationFiles.Count) total." -ForegroundColor Cyan
    Write-Host "=================================================================`n" -ForegroundColor Cyan
}
finally {
    [WinSqlite]::Close($db) | Out-Null
}
