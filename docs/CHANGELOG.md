# Changelog

All notable changes to the **Teacher–Student Appointment System** are documented in this file.
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) and [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [1.1.0-rc1] - 2026-11-13

### Added
* **Real-Time Notification Streaming Engine (Server-Sent Events / SSE)**:
  * Persistent HTTP SSE stream endpoint at `GET /api/v1/notifications/stream` authenticated via HttpOnly session cookies.
  * In-memory connection registry managing active client connections with periodic 25-second keepalive heartbeats (`:keepalive`).
  * Real-time event broadcasting on appointment lifecycle events (booking, approval, rejection, cancellation, rescheduling) with strict per-user recipient isolation.
  * Frontend `notificationStreamService.ts` with automated exponential backoff reconnection and unread notification count badge synchronization.
* **Student Consultation Feedback & Rating Engine**:
  * Feedback submission API (`POST /api/v1/appointments/:id/feedback`) with validation ensuring only completed appointments can be reviewed once.
  * Star rating (1–5) and optional textual comments with immutable audit log recording (`FEEDBACK_SUBMITTED`).
  * Feedback retrieval API (`GET /api/v1/appointments/:id/feedback`) accessible to participating student, teacher, and system administrators.
  * Frontend StarRating component and consultation feedback review dialog.
* **OpenAPI 3.0.3 Specification & Interactive Swagger UI Documentation**:
  * Complete OpenAPI 3.0.3 specification at `backend/src/docs/openapi.yaml` documenting all 57 mounted API operations across Auth, Admin, Teachers, Appointments, Feedback, Notifications, Departments, and System Health.
  * Interactive Swagger UI served at dual routes (`/docs` and `/api/v1/docs`) with local asset delivery (zero external CDN dependencies).
  * Raw OpenAPI specification endpoints in JSON format at `/api/v1/docs/openapi.json` and `/api-docs.json`.
  * Route-scoped Content-Security-Policy (CSP) override allowing Swagger UI inline scripts and styles while preserving strict CSP across API and SPA routes.
  * Pre-configured cookie-based authentication (`cookieAuth`) and CSRF header interception (`X-Requested-With: XMLHttpRequest`) for Try-It-Out execution.
  * Automated regression test suite (`backend/tests/openapiDocumentation.test.js`) validating HTTP 200, spec validity, and complete 57-route coverage.
* **Release Candidate Packaging & Production Verification**:
  * Unified production build and Express static distribution verification (`npm run build`).
  * End-to-end smoke verification covering auth cookies, CSRF, REST API, SSE streaming, Swagger docs, SPA fallback, and security headers.
  * Verified multi-stage Docker deployment configuration and sanitized `.env.example` template.

### Changed
* **Known Limitations & Architecture Notes**:
  * Documented that SSE connection registry is in-memory for single-instance container deployments, requiring Redis pub/sub backplane for horizontal multi-instance scaling.
  * Clarified local production-mode verification status versus external hosting cloud deployment.

---

## [1.1.0-dev] - 2026-10-24

### Added
* **Administrative User Accounts View (`UserAccountsView.tsx`)**:
  * System-wide user directory supporting text search (by name, email, or #ID).
  * Role filters (`STUDENT`, `TEACHER`, `ADMIN`) and account status filters (`ACTIVE`, `SUSPENDED`, `PENDING_APPROVAL`).
  * Real-time metrics summary cards (Total Users, Students, Faculty, Admins, Active, Suspended).
  * Direct account status toggle action (Activate / Suspend) with optimistic UI updates.
* **Administrative Audit Logs Ledger View (`AuditLogsView.tsx`)**:
  * Immutable audit trail display showing actor identity, target entity (`USER`, `TEACHER_PROFILE`, `APPOINTMENT`), action type, IP address, and timestamp.
  * Formatted JSON viewer for diff metadata inspection.
  * Faceted filters by Action type and Target Entity type.
* **Administrative System Status & Health View (`SystemStatusView.tsx`)**:
  * Real-time liveness and readiness probe metrics dashboard.
  * Live SQLite ping latency display (in milliseconds).
  * Schema migration synchronization monitor (applied count vs total available migrations).
  * Node.js runtime process footprint diagnostics (Resident Set Size and Heap Memory utilization).
* **Backend Admin System Views Test Suite (`backend/tests/adminSystemViews.test.js`)**:
  * 11 comprehensive automated tests validating server-side RBAC enforcement, user status updates, audit logging, and health/readiness endpoints.
* **Frontend Admin API Integration Workflows (`frontend/test-admin-integration.cjs`)**:
  * Expanded integration test runner with Workflows 6 through 9 validating User Accounts, Audit Logs, System Status, and student/teacher 403 Forbidden rejection.
* **Design System Expansion**:
  * Added `'PENDING_APPROVAL'` to `UserStatus` in `designSystem.ts`.
  * Added `'pending'` variant mapping in `UserStatusBadge` (`Badge.tsx`).
* **Comprehensive Project Documentation Suite**:
  * Master root `README.md`, `frontend/README.md`, and 12 technical specifications in `docs/` (`PRD.md`, `SRS.md`, `ARCHITECTURE.md`, `DESIGN.md`, `DATABASE.md`, `API.md`, `SECURITY.md`, `TESTING.md`, `DEPLOYMENT.md`, `IMPLEMENTATION_PLAN.md`, `DECISIONS.md`, `CHANGELOG.md`).

### Fixed
* **Admin Navigation Handler (`frontend/src/App.tsx`)**:
  * Resolved issue where clicking **User Accounts**, **Audit Logs**, and **System Status** did nothing.
  * Expanded `AdminTabId` type union to include `'admin-users'`, `'admin-audit'`, and `'admin-health'`.
  * Updated desktop `RoleNav` and mobile `MobileNav` click handlers to activate all five admin tabs.
  * Mounted `<UserAccountsView />`, `<AuditLogsView />`, and `<SystemStatusView />` inside `<main className="content-wrapper">`.

---

## [1.0.0] - 2026-10-24 (Commit `15f21f4`)

### Added
* **Relational Database Engine & Migrations**:
  * Initial relational schema (`001_initial_schema.sql`) creating 15 core entities with strict foreign key constraints and check validations.
  * Seed dataset (`002_seed_initial_data.sql`) establishing roles, departments, faculty profiles, student accounts, and future availability slots.
  * Authentication and session token migration (`003_auth_and_session_tokens.sql`) introducing `revoked_tokens` table and valid bcrypt test password hashes (`Password123!`).
  * Native Node.js migration runner (`database/migrate.js`) and PowerShell runner (`database/migrate.ps1`).
* **Node.js Express Backend (`backend/`)**:
  * REST API routing mounted under `/api/v1`.
  * Authentication endpoints (`POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `GET /auth/verify`).
  * Server-side cryptographic token revocation engine (`tokenService.js`).
  * Teacher availability slot management with automated interval overlap collision detection (`slotService.js`, `teacherController.js`).
  * Comprehensive appointment consultation lifecycle state machine (`PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`, `RESCHEDULE_PENDING`, `COMPLETED`).
  * Conflict engine evaluating overlapping bookings and availability collisions (`conflictService.js`).
  * Administrative appointment monitor and teacher management services (`adminAppointmentService.js`, `adminTeacherService.js`).
  * Health and readiness diagnostics probes (`/api/v1/health`, `/api/v1/ready`).
  * Security middleware: `authMiddleware.js`, `rbacMiddleware.js`, `rateLimiter.js`, `validator.js`, `errorHandler.js`, `requestLogger.js`.
* **React 18 / TypeScript Frontend (`frontend/`)**:
  * Vite build orchestration.
  * Custom Vanilla CSS design system with CSS custom property tokens (`tokens.css`, `reset.css`, `global.css`).
  * UI component library: `Button`, `Table`, `Badge`, `Alert`, `Dialog`, `Feedback`, `Form`, `Icons`, `Navigation`.
  * Role-based views: Student Portal (`StudentAppointmentsView`, `FindTeachersView`, `StudentNotificationsView`, `StudentProfileView`), Faculty Portal (`TeacherRequestsView`, `TeacherScheduleView`, `TeacherAvailabilityView`, `TeacherNotificationsView`, `TeacherProfileView`), and Admin Portal (`AppointmentMonitorView`, `TeacherManagementView`).
* **Testing Suites**:
  * 12 backend integration test suites (`runAllTests.js`) covering security, appointments, conflicts, teachers, students, auth, and database integration.
* **Production Deployment Configurations**:
  * Multi-stage Docker containerization (`Dockerfile`).
  * Fly.io deployment manifest (`fly.toml`) with persistent storage volume mount on `/data`.
  * Render deployment manifest (`render.yaml`).
