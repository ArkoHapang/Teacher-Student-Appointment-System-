# ==============================================================================
# Script: database/test_schema.ps1
# Description: Automated Database Schema & Integrity Test Suite
# Tests: Tables, Foreign Keys, Unique Keys, Check Constraints, Conflict Checking
# ==============================================================================

param(
    [string]$DbPath = "$PSScriptRoot\appointment_system.db"
)

$ErrorActionPreference = "Stop"

# ------------------------------------------------------------------------------
# 1. Initialize Interop Bridge
# ------------------------------------------------------------------------------
$csharpBridge = @'
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;

public class WinSqliteTestRunner {
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

    public static string QueryScalar(IntPtr db, string sql) {
        string result = null;
        IntPtr errMsg = IntPtr.Zero;
        ExecWithCallback(db, sql, (notUsed, numCols, colValues, colNames) => {
            if (numCols > 0 && colValues[0] != IntPtr.Zero) {
                result = Marshal.PtrToStringAnsi(colValues[0]);
            }
            return 0;
        }, IntPtr.Zero, out errMsg);
        return result;
    }

    public static string[] QueryList(IntPtr db, string sql) {
        List<string> list = new List<string>();
        IntPtr errMsg = IntPtr.Zero;
        ExecWithCallback(db, sql, (notUsed, numCols, colValues, colNames) => {
            if (numCols > 0 && colValues[0] != IntPtr.Zero) {
                list.Add(Marshal.PtrToStringAnsi(colValues[0]));
            }
            return 0;
        }, IntPtr.Zero, out errMsg);
        return list.ToArray();
    }
}
'@

if (-not ([System.Management.Automation.PSTypeName]'WinSqliteTestRunner').Type) {
    Add-Type -TypeDefinition $csharpBridge -Language CSharp
}

function Execute-Sql {
    param([IntPtr]$DbHandle, [string]$Sql)
    $errMsg = [IntPtr]::Zero
    $rc = [WinSqliteTestRunner]::Exec($DbHandle, $Sql, [IntPtr]::Zero, [IntPtr]::Zero, [ref]$errMsg)
    if ($rc -ne 0) {
        $err = [WinSqliteTestRunner]::GetLastError($DbHandle)
        throw "SQLite Error (code $rc): $err"
    }
}

# ------------------------------------------------------------------------------
# 2. Test Execution Harness
# ------------------------------------------------------------------------------
Write-Host "`n=================================================================" -ForegroundColor Cyan
Write-Host "       Teacher-Student Appointment System: Schema Test Suite       " -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan

# Open isolated in-memory test database
$db = [IntPtr]::Zero
$openRc = [WinSqliteTestRunner]::Open(":memory:", [ref]$db)
if ($openRc -ne 0) {
    throw "Failed to open in-memory test database."
}

$passedTests = 0
$failedTests = 0

function Assert-Test {
    param(
        [string]$TestName,
        [scriptblock]$TestBlock
    )
    try {
        & $TestBlock
        Write-Host "  [PASS] $TestName" -ForegroundColor Green
        $global:passedTests++
    }
    catch {
        Write-Host "  [FAIL] $TestName" -ForegroundColor Red
        Write-Host "         Error: $_" -ForegroundColor DarkRed
        $global:failedTests++
    }
}

try {
    # --------------------------------------------------------------------------
    # Test Suite 1: Migration Execution
    # --------------------------------------------------------------------------
    Write-Host "`n[Suite 1] Applying Schema & Seed Migrations..." -ForegroundColor Yellow
    
    Execute-Sql -DbHandle $db -Sql "PRAGMA foreign_keys = ON;"
    
    $m1 = Get-Content -Path "$PSScriptRoot\migrations\001_initial_schema.sql" -Raw
    $m2 = Get-Content -Path "$PSScriptRoot\migrations\002_seed_initial_data.sql" -Raw

    Assert-Test "Migration 001_initial_schema.sql executes without syntax or DDL errors" {
        Execute-Sql -DbHandle $db -Sql "BEGIN TRANSACTION; $m1 COMMIT;"
    }

    Assert-Test "Migration 002_seed_initial_data.sql seeds realistic dev records cleanly" {
        Execute-Sql -DbHandle $db -Sql "BEGIN TRANSACTION; $m2 COMMIT;"
    }

    # --------------------------------------------------------------------------
    # Test Suite 2: Table Existence & Structural Completeness
    # --------------------------------------------------------------------------
    Write-Host "`n[Suite 2] Verifying Table Existence (15 Required Entities)..." -ForegroundColor Yellow

    $requiredTables = @(
        'schema_migrations',
        'roles',
        'departments',
        'users',
        'student_profiles',
        'teacher_profiles',
        'teacher_courses',
        'teacher_availability_slots',
        'appointments',
        'appointment_status_history',
        'appointment_reschedules',
        'appointment_notes',
        'feedback_ratings',
        'notifications',
        'audit_logs'
    )

    $existingTables = [WinSqliteTestRunner]::QueryList($db, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';")

    foreach ($table in $requiredTables) {
        Assert-Test "Entity table '$table' exists in database catalog" {
            if (-not ($existingTables -contains $table)) {
                throw "Table '$table' is missing from schema!"
            }
        }
    }

    # --------------------------------------------------------------------------
    # Test Suite 3: Referential Integrity & Foreign Key Enforcement
    # --------------------------------------------------------------------------
    Write-Host "`n[Suite 3] Testing Foreign Key Constraints & Cascade Protection..." -ForegroundColor Yellow

    Assert-Test "Reject user creation with non-existent role_id (FK violation)" {
        $failed = $false
        try {
            Execute-Sql -DbHandle $db -Sql "INSERT INTO users (role_id, email, password_hash, first_name, last_name) VALUES (9999, 'orphan@test.edu', 'hash', 'Orphan', 'User');"
        } catch {
            $failed = $true
        }
        if (-not $failed) { throw "Expected foreign key rejection on invalid role_id!" }
    }

    Assert-Test "Reject student profile with non-existent department_id (FK violation)" {
        $failed = $false
        try {
            Execute-Sql -DbHandle $db -Sql "INSERT INTO student_profiles (user_id, student_id_number, department_id) VALUES (1, 'FAKE-01', 9999);"
        } catch {
            $failed = $true
        }
        if (-not $failed) { throw "Expected foreign key rejection on invalid department_id!" }
    }

    # --------------------------------------------------------------------------
    # Test Suite 4: Conflict Checking & Uniqueness Guards
    # --------------------------------------------------------------------------
    Write-Host "`n[Suite 4] Testing Conflict Detection & Unique Integrity Constraints..." -ForegroundColor Yellow

    Assert-Test "Reject duplicate user email (UNIQUE email constraint)" {
        $failed = $false
        try {
            Execute-Sql -DbHandle $db -Sql "INSERT INTO users (role_id, email, password_hash, first_name, last_name) VALUES (1, 'admin@university.edu', 'hash', 'Copy', 'Cat');"
        } catch {
            $failed = $true
        }
        if (-not $failed) { throw "Expected uniqueness rejection on duplicate email!" }
    }

    Assert-Test "Reject duplicate student_id_number (UNIQUE student_id_number constraint)" {
        $failed = $false
        try {
            Execute-Sql -DbHandle $db -Sql "INSERT INTO student_profiles (user_id, student_id_number, department_id) VALUES (1, 'STU-2026-001', 1);"
        } catch {
            $failed = $true
        }
        if (-not $failed) { throw "Expected uniqueness rejection on duplicate student_id_number!" }
    }

    Assert-Test "Conflict Engine: Reject overlapping start slot for same teacher (UNIQUE teacher_id, start_timestamp)" {
        $failed = $false
        try {
            # Slot 1 already exists for teacher 1 at '2026-10-20 10:00:00'
            Execute-Sql -DbHandle $db -Sql "INSERT INTO teacher_availability_slots (teacher_id, slot_date, start_time, end_time, start_timestamp, end_timestamp) VALUES (1, '2026-10-20', '10:00:00', '10:45:00', '2026-10-20 10:00:00', '2026-10-20 10:45:00');"
        } catch {
            $failed = $true
        }
        if (-not $failed) { throw "Expected conflict rejection on overlapping slot start timestamp!" }
    }

    Assert-Test "Double-Booking Guard: Reject concurrent booking of already reserved slot (UNIQUE slot_id)" {
        $failed = $false
        try {
            # Slot 1 is already booked by appointment 1
            Execute-Sql -DbHandle $db -Sql "INSERT INTO appointments (student_id, teacher_id, slot_id, title, purpose, status) VALUES (2, 1, 1, 'Duplicate Booking Attempt', 'Testing double booking', 'PENDING');"
        } catch {
            $failed = $true
        }
        if (-not $failed) { throw "Expected database constraint rejection on double booking slot_id 1!" }
    }

    Assert-Test "Single-Review Guard: Reject multiple feedback ratings for same appointment (UNIQUE appointment_id)" {
        $failed = $false
        try {
            # Appointment 2 already has a feedback rating
            Execute-Sql -DbHandle $db -Sql "INSERT INTO feedback_ratings (appointment_id, student_id, teacher_id, rating, comments) VALUES (2, 2, 1, 4, 'Second review attempt');"
        } catch {
            $failed = $true
        }
        if (-not $failed) { throw "Expected uniqueness rejection on duplicate feedback for appointment 2!" }
    }

    # --------------------------------------------------------------------------
    # Test Suite 5: Check Constraints & Value Domain Validations
    # --------------------------------------------------------------------------
    Write-Host "`n[Suite 5] Testing Value Domain & Check Constraints..." -ForegroundColor Yellow

    Assert-Test "Reject slot where start_timestamp >= end_timestamp (CHECK constraint)" {
        $failed = $false
        try {
            Execute-Sql -DbHandle $db -Sql "INSERT INTO teacher_availability_slots (teacher_id, slot_date, start_time, end_time, start_timestamp, end_timestamp) VALUES (1, '2026-11-01', '12:00:00', '11:00:00', '2026-11-01 12:00:00', '2026-11-01 11:00:00');"
        } catch {
            $failed = $true
        }
        if (-not $failed) { throw "Expected rejection when start timestamp is after end timestamp!" }
    }

    Assert-Test "Reject feedback rating greater than 5 stars (CHECK rating <= 5)" {
        $failed = $false
        try {
            # Appointment 1 has no feedback yet
            Execute-Sql -DbHandle $db -Sql "INSERT INTO feedback_ratings (appointment_id, student_id, teacher_id, rating, comments) VALUES (1, 1, 1, 6, 'Invalid 6 star rating');"
        } catch {
            $failed = $true
        }
        if (-not $failed) { throw "Expected rejection on feedback rating > 5!" }
    }

    Assert-Test "Reject feedback rating lower than 1 star (CHECK rating >= 1)" {
        $failed = $false
        try {
            Execute-Sql -DbHandle $db -Sql "INSERT INTO feedback_ratings (appointment_id, student_id, teacher_id, rating, comments) VALUES (1, 1, 1, 0, 'Invalid 0 star rating');"
        } catch {
            $failed = $true
        }
        if (-not $failed) { throw "Expected rejection on feedback rating < 1!" }
    }

    Assert-Test "Reject invalid appointment status value (CHECK status enum)" {
        $failed = $false
        try {
            Execute-Sql -DbHandle $db -Sql "INSERT INTO appointments (student_id, teacher_id, slot_id, title, purpose, status) VALUES (1, 1, 2, 'Title', 'Purpose', 'INVALID_STATUS');"
        } catch {
            $failed = $true
        }
        if (-not $failed) { throw "Expected rejection on invalid status value!" }
    }

    # --------------------------------------------------------------------------
    # Test Suite 6: Seed Data Verification & Query Integrity
    # --------------------------------------------------------------------------
    Write-Host "`n[Suite 6] Testing Seed Data Records & Query Interoperability..." -ForegroundColor Yellow

    Assert-Test "Verify seeded admin user exists with active status" {
        $adminCount = [WinSqliteTestRunner]::QueryScalar($db, "SELECT count(*) FROM users WHERE email='admin@university.edu' AND status='ACTIVE';")
        if ([int]$adminCount -ne 1) { throw "Expected 1 active admin user, found '$adminCount'" }
    }

    Assert-Test "Verify seeded teacher profiles (3 verified, 1 pending approval)" {
        $verifiedCount = [WinSqliteTestRunner]::QueryScalar($db, "SELECT count(*) FROM teacher_profiles WHERE is_verified=1;")
        $pendingCount = [WinSqliteTestRunner]::QueryScalar($db, "SELECT count(*) FROM teacher_profiles WHERE is_verified=0;")
        if ([int]$verifiedCount -ne 3 -or [int]$pendingCount -ne 1) {
            throw "Teacher verification counts incorrect! Verified: '$verifiedCount', Pending: '$pendingCount'"
        }
    }

    Assert-Test "Verify seeded appointment and status history relationship" {
        $historyCount = [WinSqliteTestRunner]::QueryScalar($db, "SELECT count(*) FROM appointment_status_history WHERE appointment_id=1;")
        if ([int]$historyCount -lt 2) { throw "Expected at least 2 status history records for appointment 1, found '$historyCount'" }
    }

    Assert-Test "Verify seeded notifications delivered to users" {
        $notifCount = [WinSqliteTestRunner]::QueryScalar($db, "SELECT count(*) FROM notifications;")
        if ([int]$notifCount -ne 2) { throw "Expected 2 notifications, found '$notifCount'" }
    }

    Assert-Test "Verify audit log records administrative changes" {
        $auditCount = [WinSqliteTestRunner]::QueryScalar($db, "SELECT count(*) FROM audit_logs WHERE action='VERIFY_TEACHER';")
        if ([int]$auditCount -ne 2) { throw "Expected 2 VERIFY_TEACHER audit logs, found '$auditCount'" }
    }

    # --------------------------------------------------------------------------
    # Summary
    # --------------------------------------------------------------------------
    Write-Host "`n-----------------------------------------------------------------" -ForegroundColor Cyan
    Write-Host "Test Results: $global:passedTests passed, $global:failedTests failed." -ForegroundColor $(if ($global:failedTests -eq 0) { "Green" } else { "Red" })
    Write-Host "=================================================================`n" -ForegroundColor Cyan

    if ($global:failedTests -gt 0) {
        exit 1
    }
}
finally {
    [WinSqliteTestRunner]::Close($db) | Out-Null
}
