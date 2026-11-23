# Quality Assurance & Testing Architecture

## Project: Teacher–Student Appointment System
* **Document Version:** 1.0.0
* **Date:** October 2026

---

## 1. Test Suite Architecture & Organization

The system's quality assurance framework spans server-side integration testing, security reviews, frontend API integration verification, and static compiler type-checking:

```text
Test Suites
├── Backend Full Integration Suite (`npm test`)
│   ├── securityDefensiveReview.test.js  # RBAC boundaries, token revocation, timing attacks
│   ├── authService.test.js              # Password hashing, credential validation
│   ├── authController.test.js           # Login, logout, /me routes, rate limiting
│   ├── rbacMiddleware.test.js           # Role & ownership boundary enforcement
│   ├── appointmentService.test.js       # Lifecycle transitions (create, approve, cancel)
│   ├── conflictEngine.test.js           # Overlap prevention & collision detection
│   ├── dbIntegration.test.js            # SQLite transactions, FK cascades, ping
│   ├── e2eFullStackIntegration.test.js  # End-to-end multi-role workflows
│   ├── notificationService.test.js      # Notification query constraints
│   ├── studentWorkflows.test.js         # Student discovery, booking, cancel
│   ├── teacherController.test.js        # Slot creation, update, delete
│   └── teacherWorkflows.test.js         # Teacher request approvals, schedule review
│
├── Notification Dynamic Dispatch Suite (`npm run test:notifications`)
│   └── notifications.test.js            # Phase 3 dynamic dispatch lifecycle notifications
│
├── Notification Read-State Suite (`npm run test:notification-read`)
│   └── notificationReadState.test.js    # Phase 4 read-state persistence, idempotency, RBAC, mark-all
│
├── Admin System Views Suite (`npm run test:admin-system`)
│   └── adminSystemViews.test.js         # RBAC, user status updates, audit trail, health/readiness
│
├── Frontend API Integration Suite (`npm run test:frontend-admin`)
│   └── test-admin-integration.cjs       # 14-workflow API integration test via supertest
│
└── Frontend Static Typecheck & Build
    ├── npm run frontend:typecheck       # TypeScript compiler (tsc --noEmit)
    └── npm run frontend:build           # Production bundle compilation (vite build)
```

---

## 2. Test Execution Commands & Verified Results

All test commands have been executed and verified against the live repository during the project audit:

### 2.1 Backend Full Test Suite (`npm test`)
* **Command:** `node backend/tests/runAllTests.js`
* **Test Suites:** 12 suites executed
* **Status:** **PASS** (12 suites passed, 0 failed, 269 total test assertions passed)
* **Execution Duration:** ~14.4 seconds
* **Key Tested Behaviors:**
  * Double-booking elimination under simulated concurrent requests.
  * Invalid status transition rejection (e.g. canceling a completed consultation).
  * Timing-attack mitigation on invalid login emails.
  * Token invalidation and session wipe upon logout.

### 2.2 Admin System Views Tests (`npm run test:admin-system`)
* **Command:** `node backend/tests/adminSystemViews.test.js`
* **Test Count:** 11 tests executed
* **Status:** **PASS** (11 passed, 0 failed)
* **Verified Assertions:**
  * `[PASS]` RBAC: Student cannot list user accounts (403 Forbidden)
  * `[PASS]` RBAC: Teacher cannot list user accounts (403 Forbidden)
  * `[PASS]` Admin successfully retrieves all user accounts (200 OK)
  * `[PASS]` RBAC: Student cannot modify user status (403 Forbidden)
  * `[PASS]` Validation: Invalid user status is rejected (400 Bad Request)
  * `[PASS]` Admin successfully modifies and restores user status (200 OK)
  * `[PASS]` RBAC: Student cannot access audit logs (403 Forbidden)
  * `[PASS]` RBAC: Teacher cannot access audit logs (403 Forbidden)
  * `[PASS]` Admin successfully retrieves audit logs with actor details (200 OK)
  * `[PASS]` Liveness probe (`/api/v1/health`) reports UP with memory usage
  * `[PASS]` Readiness probe (`/api/v1/ready`) reports READY with database and 3 applied migrations

### 2.3 Frontend Integration Tests (`npm run test:frontend-admin`)
* **Command:** `node frontend/test-admin-integration.cjs`
* **Workflows Tested:** 14 integration workflows
* **Status:** **PASS** (14 passed, 0 failed)
* **Verified Workflows:**
  * Auth login, token extraction, and headers injection.
  * Teacher management listing and single-record inspection.
  * Appointment monitor aggregation summary.
  * Conflict engine collision evaluation.
  * User account retrieval and status patching (`ACTIVE` <-> `SUSPENDED`).
  * Immutable audit ledger querying.
  * Health and readiness diagnostics probes.
  * Cross-role RBAC rejection (Student/Teacher blocked from admin endpoints).
  * Administrative logout and token invalidation.

### 2.4 Dynamic Event Notification Dispatch Suite (`npm run test:notifications`)
* **Command:** `node backend/tests/notifications.test.js`
* **Test Count:** 14 integration tests executed
* **Status:** **PASS** (14 passed, 0 failed)
* **Verified Behaviors:**
  * Dynamic dispatch for booking requests, approvals, rejections, cancellations, reschedules, and administrative actions.
  * Database transaction rollback on failed notification insertion.
  * Permitted enum validation and RBAC recipient authorization.

### 2.5 Notification Read-State Management Suite (`npm run test:notification-read`)
* **Command:** `node backend/tests/notificationReadState.test.js`
* **Test Count:** 10 integration tests executed
* **Status:** **PASS** (10 passed, 0 failed)
* **Verified Behaviors:**
  * Authenticated user marks unread notification as read (`is_read = 1`).
  * Cross-user mutation rejection with `403 FORBIDDEN` (server-side identity enforcement).
  * Unauthenticated rejection (`401 AUTHENTICATION_REQUIRED`).
  * Nonexistent and invalid notification ID handling (`404 NOT_FOUND` / `400 BAD_REQUEST`).
  * Idempotent repeated mark-as-read requests.
  * Frontend failure contract defense (no false successes).
  * Mark-all-as-read updates strictly authenticated user's notifications in parameterized SQL.
  * Full preservation of existing notification retrieval and admin capabilities.

### 2.6 TypeScript Static Type Verification (`npm run frontend:typecheck`)
* **Command:** `npm --prefix frontend run typecheck` (`tsc --noEmit`)
* **Status:** **PASS** (Exit code `0`)
* **Result:** Zero type errors across all React components, views, services, and design system contracts.

### 2.7 Production Build Compilation (`npm run frontend:build`)
* **Command:** `npm --prefix frontend run build` (`tsc && vite build`)
* **Status:** **PASS** (Exit code `0`)
* **Build Artifacts:**
  * `dist/index.html` (0.82 kB)
  * `dist/assets/index-*.css` (26.17 kB)
  * `dist/assets/index-*.js` (330.33 kB)
* **Build Time:** ~2.45 seconds

---

## 3. Test Data Strategy & Database Isolation

* **Isolated Test Runners**: Tests interact with SQLite using transactional execution. State modifications made during test workflows (e.g. toggling user status or configuring temporary test slots) are programmatically restored or rolled back.
* **Seed Accounts**: Tests utilize baseline seeded accounts from migration `002_seed_initial_data.sql` and `003_auth_and_session_tokens.sql` (passwords hashed with `Password123!`).

---

## 4. Testing Limitations & Scope Boundaries

1. **No Code Coverage Metric Claimed**: Coverage reporting (Istanbul / c8) is not currently configured in `package.json`. No unverified percentage claims are made.
2. **Frontend Component Unit Tests**: Component unit tests (e.g., using Jest / Vitest + React Testing Library) are not currently implemented. Frontend testing is executed via API integration scripts (`test-admin-integration.cjs`), TypeScript type checking (`tsc --noEmit`), and Vite production compilation.
3. **End-to-End Browser Testing**: Selenium / Playwright / Cypress browser automation is not integrated into CI; browser behavior is verified via manual QA and headless integration tests.
