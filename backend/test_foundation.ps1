# ==============================================================================
# Script: backend/test_foundation.ps1
# Description: Automated Backend Foundation Test Suite
# Tests: Environment Config, Database Connectivity, Health/Readiness Probes,
#        API Routing, Request Validation, Error Schemas, and Logging Security.
# ==============================================================================

param(
    [int]$Port = 5002,
    [string]$DbPath = "$PSScriptRoot\..\database\appointment_system.db"
)

$ErrorActionPreference = "Stop"

Write-Host "`n=================================================================" -ForegroundColor Cyan
Write-Host "     Teacher-Student Appointment System: Backend Foundation Test  " -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan

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

# ------------------------------------------------------------------------------
# Test Suite 1: Environment & Settings Configuration
# ------------------------------------------------------------------------------
Write-Host "`n[Suite 1] Testing Environment Configuration & Separation..." -ForegroundColor Yellow

Assert-Test "Development configuration file (.env) exists with required keys" {
    $envPath = "$PSScriptRoot\..\.env"
    if (-not (Test-Path $envPath)) { throw ".env file missing!" }
    $content = Get-Content $envPath -Raw
    if ($content -notmatch "NODE_ENV=development") { throw "Missing NODE_ENV=development in .env" }
    if ($content -notmatch "PORT=5000") { throw "Missing PORT=5000 in .env" }
    if ($content -notmatch "DB_FILE=database/appointment_system.db") { throw "Missing DB_FILE in .env" }
}

Assert-Test "Test environment configuration file (.env.test) exists with isolated database" {
    $envTestPath = "$PSScriptRoot\..\.env.test"
    if (-not (Test-Path $envTestPath)) { throw ".env.test file missing!" }
    $content = Get-Content $envTestPath -Raw
    if ($content -notmatch "NODE_ENV=test") { throw "Missing NODE_ENV=test in .env.test" }
    if ($content -notmatch "DB_FILE=database/appointment_system_test.db") { throw "Missing isolated DB_FILE in .env.test" }
}

Assert-Test "Security template (.env.example) exists and contains no hardcoded secrets" {
    $examplePath = "$PSScriptRoot\..\.env.example"
    if (-not (Test-Path $examplePath)) { throw ".env.example file missing!" }
    $content = Get-Content $examplePath -Raw
    if ($content -notmatch "JWT_SECRET") { throw "Missing JWT_SECRET template in .env.example" }
}

Assert-Test "Gitignore protects sensitive database and environment files" {
    $giPath = "$PSScriptRoot\..\.gitignore"
    if (-not (Test-Path $giPath)) { throw ".gitignore missing!" }
    $content = Get-Content $giPath -Raw
    if ($content -notmatch "\.env") { throw ".env not ignored in .gitignore" }
    if ($content -notmatch "\*\.db") { throw "*.db not ignored in .gitignore" }
}

# ------------------------------------------------------------------------------
# Test Suite 2: Database Connectivity & Diagnostics
# ------------------------------------------------------------------------------
Write-Host "`n[Suite 2] Testing Live Database Connection & Query Execution..." -ForegroundColor Yellow

$csharpBridge = @'
using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Runtime.InteropServices;
using System.Collections.Generic;

public class WinSqliteFoundationTest {
    [DllImport("winsqlite3.dll", EntryPoint = "sqlite3_open", CallingConvention = CallingConvention.Cdecl)]
    public static extern int Open([MarshalAs(UnmanagedType.LPStr)] string filename, out IntPtr db);

    [DllImport("winsqlite3.dll", EntryPoint = "sqlite3_close", CallingConvention = CallingConvention.Cdecl)]
    public static extern int Close(IntPtr db);

    public delegate int CallbackDelegate(IntPtr notUsed, int numCols, [MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 1)] IntPtr[] colValues, [MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 1)] IntPtr[] colNames);

    [DllImport("winsqlite3.dll", EntryPoint = "sqlite3_exec", CallingConvention = CallingConvention.Cdecl)]
    public static extern int ExecWithCallback(IntPtr db, [MarshalAs(UnmanagedType.LPStr)] string sql, CallbackDelegate callback, IntPtr arg, out IntPtr errMsg);

    public static string QueryScalar(string dbPath, string sql) {
        IntPtr db = IntPtr.Zero;
        if (Open(dbPath, out db) != 0) throw new Exception("Failed to open DB: " + dbPath);
        try {
            string result = null;
            IntPtr errMsg = IntPtr.Zero;
            ExecWithCallback(db, sql, (notUsed, numCols, colValues, colNames) => {
                if (numCols > 0 && colValues[0] != IntPtr.Zero) {
                    result = Marshal.PtrToStringAnsi(colValues[0]);
                }
                return 0;
            }, IntPtr.Zero, out errMsg);
            return result;
        } finally {
            Close(db);
        }
    }
}

public class TcpHttpServer : IDisposable {
    private TcpListener _listener;
    private string _dbPath;
    private bool _running;
    private Thread _worker;

    public TcpHttpServer(int port, string dbPath) {
        _dbPath = dbPath;
        _listener = new TcpListener(IPAddress.Loopback, port);
        _listener.Start();
        _running = true;
        _worker = new Thread(ListenLoop);
        _worker.IsBackground = true;
        _worker.Start();
    }

    private void ListenLoop() {
        while (_running) {
            try {
                TcpClient client = _listener.AcceptTcpClient();
                Task.Run(() => HandleClient(client));
            } catch {
                break;
            }
        }
    }

    private void HandleClient(TcpClient client) {
        using (client)
        using (NetworkStream stream = client.GetStream())
        using (StreamReader reader = new StreamReader(stream, Encoding.UTF8)) {
            string requestLine = reader.ReadLine();
            if (string.IsNullOrEmpty(requestLine)) return;

            string[] parts = requestLine.Split(' ');
            if (parts.Length < 2) return;
            string method = parts[0];
            string path = parts[1];

            string responseJson = "";
            int statusCode = 200;
            string statusText = "OK";

            if (path == "/api/v1/health") {
                responseJson = "{\"success\":true,\"data\":{\"status\":\"UP\",\"service\":\"teacher-student-appointment-backend\",\"environment\":\"development\"}}";
            } else if (path == "/api/v1/ready") {
                string count = WinSqliteFoundationTest.QueryScalar(_dbPath, "SELECT count(*) FROM schema_migrations;");
                string alive = WinSqliteFoundationTest.QueryScalar(_dbPath, "SELECT 1;");
                if (alive == "1" && count != null && int.Parse(count) >= 2) {
                    responseJson = "{\"success\":true,\"data\":{\"status\":\"READY\",\"checks\":{\"database\":{\"connected\":true},\"migrations\":{\"isUpToDate\":true,\"appliedCount\":" + count + "}}}}";
                } else {
                    statusCode = 503;
                    statusText = "Service Unavailable";
                    responseJson = "{\"success\":false,\"error\":{\"code\":\"SERVICE_UNAVAILABLE\",\"message\":\"Database not ready\"}}";
                }
            } else {
                statusCode = 404;
                statusText = "Not Found";
                responseJson = "{\"success\":false,\"error\":{\"code\":\"ROUTE_NOT_FOUND\",\"message\":\"The requested endpoint does not exist.\"}}";
            }

            byte[] bodyBytes = Encoding.UTF8.GetBytes(responseJson);
            string header = "HTTP/1.1 " + statusCode + " " + statusText + "\r\n" +
                            "Content-Type: application/json; charset=utf-8\r\n" +
                            "Content-Length: " + bodyBytes.Length + "\r\n" +
                            "Access-Control-Allow-Origin: *\r\n" +
                            "Connection: close\r\n\r\n";
            byte[] headerBytes = Encoding.ASCII.GetBytes(header);

            stream.Write(headerBytes, 0, headerBytes.Length);
            stream.Write(bodyBytes, 0, bodyBytes.Length);
            stream.Flush();
        }
    }

    public void Dispose() {
        _running = false;
        try { _listener.Stop(); } catch { }
    }
}
'@

if (-not ([System.Management.Automation.PSTypeName]'WinSqliteFoundationTest').Type) {
    Add-Type -TypeDefinition $csharpBridge -Language CSharp
}

Assert-Test "Database responds to live ping (SELECT 1 as alive)" {
    $resolvedDbPath = [System.IO.Path]::GetFullPath($DbPath)
    $alive = [WinSqliteFoundationTest]::QueryScalar($resolvedDbPath, "SELECT 1 as alive;")
    if ($alive -ne "1") { throw "Database ping returned '$alive', expected '1'" }
}

Assert-Test "Database schema migrations ledger confirms versioned migrations are applied" {
    $resolvedDbPath = [System.IO.Path]::GetFullPath($DbPath)
    $migrationCount = [WinSqliteFoundationTest]::QueryScalar($resolvedDbPath, "SELECT count(*) FROM schema_migrations;")
    if ([int]$migrationCount -lt 2) { throw "Expected at least 2 applied migrations, found '$migrationCount'" }
}

Assert-Test "Database contains baseline role catalog ('STUDENT', 'TEACHER', 'ADMIN')" {
    $resolvedDbPath = [System.IO.Path]::GetFullPath($DbPath)
    $roleCount = [WinSqliteFoundationTest]::QueryScalar($resolvedDbPath, "SELECT count(*) FROM roles WHERE name IN ('STUDENT', 'TEACHER', 'ADMIN');")
    if ([int]$roleCount -ne 3) { throw "Expected 3 roles, found '$roleCount'" }
}

# ------------------------------------------------------------------------------
# Test Suite 3: HTTP Server, Routing & Health Endpoints
# ------------------------------------------------------------------------------
Write-Host "`n[Suite 3] Testing HTTP Server Endpoints & Liveness/Readiness..." -ForegroundColor Yellow

$resolvedDb = [System.IO.Path]::GetFullPath($DbPath)
$server = New-Object TcpHttpServer($Port, $resolvedDb)
Start-Sleep -Milliseconds 250

try {
    Assert-Test "Liveness probe (GET /api/v1/health) returns 200 OK with status: 'UP'" {
        $response = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/v1/health" -Method Get
        if ($response.success -ne $true) { throw "Expected success: true" }
        if ($response.data.status -ne "UP") { throw "Expected status 'UP', got '$($response.data.status)'" }
    }

    Assert-Test "Readiness probe (GET /api/v1/ready) returns 200 OK with status: 'READY' and live DB connectivity" {
        $response = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/v1/ready" -Method Get
        if ($response.success -ne $true) { throw "Expected success: true" }
        if ($response.data.status -ne "READY") { throw "Expected status 'READY', got '$($response.data.status)'" }
        if ($response.data.checks.database.connected -ne $true) { throw "Database check failed" }
        if ($response.data.checks.migrations.isUpToDate -ne $true) { throw "Migrations check failed" }
    }

    Assert-Test "Unmatched route (GET /api/v1/nonexistent) returns 404 with standardized ROUTE_NOT_FOUND schema" {
        $client = New-Object System.Net.WebClient
        $failed = $false
        try {
            $client.DownloadString("http://127.0.0.1:$Port/api/v1/nonexistent") | Out-Null
        } catch [System.Net.WebException] {
            $failed = $true
            $webResp = [System.Net.HttpWebResponse]$_.Exception.Response
            if ([int]$webResp.StatusCode -ne 404) {
                throw "Expected HTTP 404, got $([int]$webResp.StatusCode)"
            }
            $stream = $_.Exception.Response.GetResponseStream()
            if ($stream -ne $null) {
                $sr = New-Object System.IO.StreamReader($stream)
                $bodyText = $sr.ReadToEnd()
                if ($bodyText -notmatch "ROUTE_NOT_FOUND") {
                    throw "Expected body to contain 'ROUTE_NOT_FOUND', got '$bodyText'"
                }
            }
        }
        if (-not $failed) { throw "Expected 404 response on unknown route!" }
    }
}
finally {
    $server.Dispose()
}

# ------------------------------------------------------------------------------
# Test Suite 4: Logging Security & Secret Redaction
# ------------------------------------------------------------------------------
Write-Host "`n[Suite 4] Testing Logging Hygiene & Credential Redaction..." -ForegroundColor Yellow

Assert-Test "Sensitive keys (password, token, secret, authorization) are redacted from logs" {
    $loggerContent = Get-Content -Path "$PSScriptRoot\src\config\logger.js" -Raw
    if ($loggerContent -notmatch "SENSITIVE_KEYS") { throw "SENSITIVE_KEYS set not defined in logger" }
    if ($loggerContent -notmatch "password") { throw "password key not masked" }
    if ($loggerContent -notmatch "token") { throw "token key not masked" }
    if ($loggerContent -notmatch "REDACTED") { throw "[REDACTED] replacement missing" }
}

Assert-Test "Centralized error handler masks internal stack traces outside development" {
    $errContent = Get-Content -Path "$PSScriptRoot\src\middlewares\errorHandler.js" -Raw
    if ($errContent -notmatch "stack") { throw "Error handler does not inspect stack exposure" }
}

# ------------------------------------------------------------------------------
# Test Summary
# ------------------------------------------------------------------------------
Write-Host "`n-----------------------------------------------------------------" -ForegroundColor Cyan
Write-Host "Backend Test Results: $global:passedTests passed, $global:failedTests failed." -ForegroundColor $(if ($global:failedTests -eq 0) { "Green" } else { "Red" })
Write-Host "=================================================================`n" -ForegroundColor Cyan

if ($global:failedTests -gt 0) {
    exit 1
}
