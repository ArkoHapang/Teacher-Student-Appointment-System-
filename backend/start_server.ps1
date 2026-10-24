# ==============================================================================
# Script: backend/start_server.ps1
# Description: Starts the Teacher-Student Appointment Backend Service on Windows
# Endpoints:
#   GET /api/v1/health   - Liveness probe
#   GET /api/v1/ready    - Readiness probe (checks database & migrations)
#   GET /api/v1          - API root catalog
# ==============================================================================

param(
    [int]$Port = 5000,
    [string]$DbPath = "$PSScriptRoot\..\database\appointment_system.db"
)

$ErrorActionPreference = "Stop"

$resolvedDbPath = [System.IO.Path]::GetFullPath($DbPath)

Write-Host "`n=================================================================" -ForegroundColor Cyan
Write-Host "  Teacher-Student Appointment System: Backend Service Starting  " -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "Host:        http://127.0.0.1:$Port"
Write-Host "Database:    $resolvedDbPath"
Write-Host "Environment: development"

$csharp = @'
using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Runtime.InteropServices;
using System.Collections.Generic;

public class WinSqliteLiveServer {
    [DllImport("winsqlite3.dll", EntryPoint = "sqlite3_open", CallingConvention = CallingConvention.Cdecl)]
    public static extern int Open([MarshalAs(UnmanagedType.LPStr)] string filename, out IntPtr db);

    [DllImport("winsqlite3.dll", EntryPoint = "sqlite3_close", CallingConvention = CallingConvention.Cdecl)]
    public static extern int Close(IntPtr db);

    public delegate int CallbackDelegate(IntPtr notUsed, int numCols, [MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 1)] IntPtr[] colValues, [MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 1)] IntPtr[] colNames);

    [DllImport("winsqlite3.dll", EntryPoint = "sqlite3_exec", CallingConvention = CallingConvention.Cdecl)]
    public static extern int ExecWithCallback(IntPtr db, [MarshalAs(UnmanagedType.LPStr)] string sql, CallbackDelegate callback, IntPtr arg, out IntPtr errMsg);

    public static string QueryScalar(string dbPath, string sql) {
        IntPtr db = IntPtr.Zero;
        if (Open(dbPath, out db) != 0) return null;
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
'@

if (-not ([System.Management.Automation.PSTypeName]'WinSqliteLiveServer').Type) {
    Add-Type -TypeDefinition $csharp -Language CSharp
}

# Verify database connection
$alive = [WinSqliteLiveServer]::QueryScalar($resolvedDbPath, "SELECT 1;")
if ($alive -ne "1") {
    Write-Host "[ERROR] Could not connect to database at: $resolvedDbPath" -ForegroundColor Red
    exit 1
}
$migrationCount = [WinSqliteLiveServer]::QueryScalar($resolvedDbPath, "SELECT count(*) FROM schema_migrations;")
Write-Host "[OK] Connected to SQLite database ($migrationCount migrations applied)." -ForegroundColor Green
Write-Host "`nAvailable endpoints:" -ForegroundColor Yellow
Write-Host "  -> Health probe:    http://127.0.0.1:$Port/api/v1/health" -ForegroundColor Green
Write-Host "  -> Readiness probe: http://127.0.0.1:$Port/api/v1/ready" -ForegroundColor Green
Write-Host "  -> API Root:        http://127.0.0.1:$Port/api/v1" -ForegroundColor Green
Write-Host "`nPress Ctrl+C to stop the server.`n" -ForegroundColor DarkGray

$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
$listener.Start()

try {
    while ($true) {
        $client = $listener.AcceptTcpClient()
        $stream = $client.GetStream()
        $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8)
        $requestLine = $reader.ReadLine()

        if ([string]::IsNullOrEmpty($requestLine)) {
            $client.Close()
            continue
        }

        $parts = $requestLine.Split(' ')
        $method = $parts[0]
        $path = if ($parts.Length -ge 2) { $parts[1] } else { "/" }
        $startTime = [System.Diagnostics.Stopwatch]::StartNew()

        $statusCode = 200
        $statusText = "OK"
        $responseJson = ""

        if ($path -eq "/api/v1/health") {
            $responseJson = '{"success":true,"data":{"status":"UP","service":"teacher-student-appointment-backend","environment":"development","timestamp":"' + (Get-Date).ToString("o") + '"}}'
        }
        elseif ($path -eq "/api/v1/ready") {
            $count = [WinSqliteLiveServer]::QueryScalar($resolvedDbPath, "SELECT count(*) FROM schema_migrations;")
            $ping = [WinSqliteLiveServer]::QueryScalar($resolvedDbPath, "SELECT 1;")
            if ($ping -eq "1" -and [int]$count -ge 2) {
                $responseJson = '{"success":true,"data":{"status":"READY","timestamp":"' + (Get-Date).ToString("o") + '","checks":{"database":{"connected":true},"migrations":{"isUpToDate":true,"appliedCount":' + $count + '}}}}'
            } else {
                $statusCode = 503
                $statusText = "Service Unavailable"
                $responseJson = '{"success":false,"error":{"code":"SERVICE_UNAVAILABLE","message":"Database not ready"}}'
            }
        }
        elseif ($path -eq "/api/v1" -or $path -eq "/api/v1/") {
            $responseJson = '{"success":true,"data":{"name":"Teacher-Student Appointment System API","version":"v1","status":"operational","endpoints":{"health":"/api/v1/health","ready":"/api/v1/ready"}}}'
        }
        else {
            $statusCode = 404
            $statusText = "Not Found"
            $responseJson = '{"success":false,"error":{"code":"ROUTE_NOT_FOUND","message":"The requested endpoint does not exist."}}'
        }

        $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($responseJson)
        $header = "HTTP/1.1 $statusCode $statusText`r`n" +
                  "Content-Type: application/json; charset=utf-8`r`n" +
                  "Content-Length: $($bodyBytes.Length)`r`n" +
                  "Access-Control-Allow-Origin: *`r`n" +
                  "Connection: close`r`n`r`n"
        $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)

        $stream.Write($headerBytes, 0, $headerBytes.Length)
        $stream.Write($bodyBytes, 0, $bodyBytes.Length)
        $stream.Flush()
        $client.Close()

        $startTime.Stop()
        $color = if ($statusCode -ge 400) { "Yellow" } else { "Gray" }
        Write-Host "[$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))] $method $path -> $statusCode ($($startTime.ElapsedMilliseconds)ms)" -ForegroundColor $color
    }
}
finally {
    $listener.Stop()
    Write-Host "`n[Server stopped gracefully]" -ForegroundColor Yellow
}
