# Backend Foundation: Teacher-Student Appointment System

## Overview
This directory contains the core backend architecture, routing engine, configuration managers, middlewares, database connectors, and health/readiness diagnostics for the university **Teacher–Student Appointment System**.

---

## Architecture & Directory Layout

```text
backend/
├── src/
│   ├── config/
│   │   ├── env.js              # Environment settings (.env / .env.test loader)
│   │   ├── database.js         # SQLite connection manager with real queries & FKs
│   │   └── logger.js           # Structured logger with sensitive credential redaction
│   ├── constants/
│   │   ├── httpStatusCodes.js  # Standard HTTP status code definitions
│   │   └── roles.js            # System roles (STUDENT, TEACHER, ADMIN) & statuses
│   ├── middlewares/
│   │   ├── requestLogger.js    # Incoming request logger with PII & query sanitization
│   │   ├── validator.js        # Request payload & parameter validation middleware
│   │   └── errorHandler.js     # Centralized error handler with consistent error schema
│   ├── controllers/
│   │   └── healthController.js # Liveness (/health) and readiness (/ready) controller
│   ├── routes/
│   │   ├── healthRoutes.js     # Diagnostics endpoint definitions
│   │   └── index.js            # Root versioned API router mounted at /api/v1
│   ├── services/
│   │   └── migrationService.js # Inspects schema_migrations ledger vs migration files
│   ├── app.js                  # Express application factory & middleware pipeline
│   └── server.js               # Server bootstrap with pre-flight DB checks
├── tests/
│   └── foundation.test.js      # Foundation unit and integration test suite
├── start_server.ps1            # Windows native backend server runner
├── test_foundation.ps1         # Automated 12-point backend foundation test suite
└── README.md                   # Backend documentation
```

---

## Environment Configuration

Application settings are managed through environment files:
- `.env`: Development environment settings (Port `5000`, `database/appointment_system.db`).
- `.env.test`: Isolated test environment settings (Port `5001`, `database/appointment_system_test.db`).
- `.env.example`: Template for deployment with secrets omitted.

---

## Running the Backend Server

### Windows Host (Native Execution)
To start the live backend service listening on `http://127.0.0.1:5000`:
```powershell
powershell -ExecutionPolicy Bypass -File backend/start_server.ps1
```

### Node.js / npm Execution
```bash
npm start
# or
node backend/src/server.js
```

---

## Health & Diagnostics Endpoints

### 1. Liveness Probe
* **Endpoint:** `GET /api/v1/health`
* **Response:**
  ```json
  {
    "success": true,
    "data": {
      "status": "UP",
      "service": "teacher-student-appointment-backend",
      "environment": "development",
      "timestamp": "2026-10-16T16:00:00.000Z"
    }
  }
  ```

### 2. Readiness Probe
* **Endpoint:** `GET /api/v1/ready`
* **Behavior:** Performs live database ping (`SELECT 1`), verifies `schema_migrations` ledger, and checks for pending migrations.
* **Response (HTTP 200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "status": "READY",
      "checks": {
        "database": {
          "connected": true
        },
        "migrations": {
          "isUpToDate": true,
          "appliedCount": 2
        }
      }
    }
  }
  ```

---

## Authentication & Server-Side Authorization

The backend implements JWT token-based authentication with cryptographic password hashing (bcrypt), database-backed token revocation, and server-side role-based access control (RBAC).

### Key Security Features
1. **Password Hashing:** Passwords are salted and hashed with adaptive bcrypt (cost factor 10). Passwords are never stored in plaintext and never returned in API responses.
2. **Timing Attack Protection:** Constant-time dummy verification on non-existent accounts prevents timing-based user enumeration.
3. **Session & Token Revocation:** Logout explicitly invalidates access tokens before their natural expiration by recording their unique `jti` in the `revoked_tokens` table.
4. **Brute-Force & Credential Leakage Defense:**
   - In-memory rate limiting locks out accounts/IPs after 5 consecutive failed attempts (HTTP 429 Too Many Requests with `Retry-After` header).
   - Structured logger automatically redacts `password`, `token`, `secret`, `authorization`, and sensitive keys.
5. **Environment Configuration Safeguards:** Production environments enforce a 32+ character non-default `JWT_SECRET`. Server refuses to boot if insecure secrets are detected in production.

### Server-Side Authorization Rules
| Rule | Policy | Server-Side Enforcement |
|------|--------|--------------------------|
| **Admin Boundary** | Students & Teachers must not access administrative functions | `authorizeRoles(ROLES.ADMIN)` blocks non-admin tokens with HTTP 403 Forbidden |
| **Teacher Boundary** | Teachers must not manage other teachers unless explicitly authorized | `authorizeTeacherManagement()` allows teachers to manage only their own profile/slots; blocks modifying peers with HTTP 403 Forbidden |
| **Private Records** | Users must not access other users' private records without permission | `authorizeOwnerOrAdmin()` ensures users access only their own records (`id == req.user.id`); Admin has oversight access |
| **Server Enforcement** | Privileges cannot be bypassed by frontend tampering | All checks enforced on Express middleware and database queries |

### Authentication & Authorization API Endpoints

| Method | Endpoint | Access Level | Description |
|--------|----------|--------------|-------------|
| `POST` | `/api/v1/auth/login` | Public | Authenticates credentials, returns signed JWT & user profile |
| `POST` | `/api/v1/auth/logout` | Authenticated | Revokes access token in `revoked_tokens` table |
| `GET` | `/api/v1/auth/me` | Authenticated | Retrieves current authenticated user & role-specific profile |
| `GET` | `/api/v1/auth/verify` | Authenticated | Confirms token validity and identity |
| `GET` | `/api/v1/admin/users` | ADMIN only | Lists all users with role and status |
| `PATCH`| `/api/v1/admin/users/:id/status` | ADMIN only | Updates user account status (ACTIVE, SUSPENDED, etc.) |
| `GET` | `/api/v1/admin/teachers` | ADMIN only | Paginated teacher directory with search, filtering, and stats |
| `POST`| `/api/v1/admin/teachers` | ADMIN only | Creates teacher account + faculty profile + course assignments |
| `GET` | `/api/v1/admin/teachers/:id` | ADMIN only | Retrieves detailed teacher record with slot & appointment metrics |
| `PATCH`| `/api/v1/admin/teachers/:id` | ADMIN only | Edits permitted faculty fields (role elevation defended) |
| `PATCH`| `/api/v1/admin/teachers/:id/status` | ADMIN only | Activates, deactivates, or suspends teacher status & handles slots |
| `PATCH`| `/api/v1/admin/teachers/:id/verify` | ADMIN only | Verifies academic teacher credentials |
| `GET` | `/api/v1/admin/appointments/summary` | ADMIN only | Real-time counts and metrics across all appointments |
| `GET` | `/api/v1/admin/appointments` | ADMIN only | Paginated appointment listing with filters (status, teacher, student, date) & search |
| `GET` | `/api/v1/admin/appointments/:id` | ADMIN only | Detailed appointment view with student, teacher, slot, history, and feedback |
| `GET` | `/api/v1/admin/appointments/:id/history` | ADMIN only | Full chronological status transition history |
| `PATCH`| `/api/v1/admin/appointments/:id` | ADMIN only | Corrects permitted appointment metadata (title, purpose) |
| `PATCH`| `/api/v1/admin/appointments/:id/status` | ADMIN only | Enforces lifecycle transitions (PENDING -> APPROVED, CANCELLED, etc.) |
| `POST`| `/api/v1/admin/appointments/:id/reschedule` | ADMIN only | Reschedules appointment with conflict detection & atomic slot migration |
| `GET` | `/api/v1/admin/audit-logs` | ADMIN only | Views system audit logs |
| `GET` | `/api/v1/users/:id` | Owner or ADMIN | Retrieves private user profile |
| `PATCH`| `/api/v1/users/:id` | Owner or ADMIN | Updates personal profile |
| `GET` | `/api/v1/teachers` | Public / Auth | Lists teacher faculty directory |
| `GET` | `/api/v1/teachers/:id` | Public / Auth | Gets teacher profile details |
| `PATCH`| `/api/v1/teachers/:id` | Self or ADMIN | Updates teacher profile (office, bio, designation) |

---

## Running Tests

### 1. Admin Appointment Monitoring & Management (33 Tests - GitHub Issues #38 & #39)
Runs tests covering paginated listing, multi-criteria filtering, search, metrics summary, detailed views, metadata corrections, lifecycle state machine enforcement, rescheduling conflict detection, and audit history:
```bash
npm run test:admin-appointments
```

### 2. Admin Teacher Management Test Suite (31 Tests - GitHub Issue #37)
Runs tests covering pagination, searching, filtering, creation, editing, role elevation defense, status lifecycle, appointment preservation, and audit logging:
```bash
npm run test:teachers
```

### 2. Conflict Detection Test Suite (22 Tests - GitHub Issue #40)
```bash
npm run test:conflicts
```

### 3. Core Appointment Test Suite (35 Tests)
```bash
npm run test:appointments
```

### 4. Authentication & RBAC Test Suite (35 Tests)
```bash
npm run test:auth
```

### 5. Automated Foundation & Schema Test Suites (PowerShell)
```powershell
powershell -ExecutionPolicy Bypass -File backend/test_foundation.ps1
powershell -ExecutionPolicy Bypass -File database/test_schema.ps1
```

