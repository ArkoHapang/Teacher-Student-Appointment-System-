# Prioritized Implementation Roadmap

## Project: Teacher–Student Appointment System
* **Document Version:** 1.0.0
* **Date:** October 2026

---

## 1. Executive Summary & Audit Context

The comprehensive architectural audit and Admin panel verification confirmed that the core scheduling engine, conflict detection, double-booking prevention, and role-based access control are robust, verified by automated test suites.

This document outlines the prioritized implementation phases to complete remaining functional gaps identified during the audit, sequenced by architectural dependency and user impact.

```mermaid
gantt
    title Implementation Phases
    dateFormat  YYYY-MM-DD
    section Completed
    Phase 1: Admin Panel Restoration & Verification :done, p1, 2026-10-24, 2026-10-24
    Phase 2: Comprehensive Project Documentation    :done, p2, 2026-10-24, 2026-10-24
    section Pending Approval
    Phase 3: Dynamic Event Notification Dispatch    :active, p3, 2026-10-25, 2026-10-26
    Phase 4: Notification Read-State Management     :p4, 2026-10-26, 2026-10-27
    Phase 5: Student Consultation Feedback Engine   :p5, 2026-10-27, 2026-10-28
    Phase 6: OpenAPI / Swagger Specification Mount :p6, 2026-10-28, 2026-10-29
```

---

## 2. Completed Milestones

### Phase 1: Admin Panel Navigation Restoration & Verification (Completed)
* **Status:** Verified and functional in the working tree.
* **Delivered Artifacts:**
  * Created `UserAccountsView.tsx` with user search, role/status filtering, and activate/suspend controls.
  * Created `AuditLogsView.tsx` with immutable audit trail inspection and JSON diff parsing.
  * Created `SystemStatusView.tsx` with live database ping, migration alignment, and process memory footprint metrics.
  * Created `adminSystemViews.test.js` (11 backend tests passing).
  * Expanded `adminService.ts`, `App.tsx`, and design system types.
  * Verified: 12 backend test suites passed (269 tests), 14 frontend integration tests passed, 0 TypeScript errors, clean production bundle.

### Phase 2: Professional Technical Documentation (Completed)
* **Status:** Completed.
* **Delivered Artifacts:** Master `README.md`, `PRD.md`, `SRS.md`, `ARCHITECTURE.md`, `DESIGN.md`, `DATABASE.md`, `API.md`, `SECURITY.md`, `TESTING.md`, `DEPLOYMENT.md`, `IMPLEMENTATION_PLAN.md`, `DECISIONS.md`, `CHANGELOG.md`, and `frontend/README.md`.

---

## 3. Pending Implementation Roadmap (Awaiting Approval)

---

### Phase 3: Dynamic Event Notification Dispatch (Priority: High)

#### 3.1 Problem Statement
The `notifications` table exists in the SQLite schema and is queried via `GET /api/v1/users/:id/notifications`. However, the backend currently lacks automated event dispatch during appointment lifecycle transitions. The UI only displays static notifications seeded during initial migration.

#### 3.2 Proposed Implementation
1. **Create Notification Service**: Implement `backend/src/services/notificationService.js` exposing:
   ```javascript
   async function createNotification(tx, { recipientId, appointmentId, title, message, type })
   ```
2. **Hook Lifecycle Events in `appointmentService.js`**:
   * **On Booking Request (`createAppointment`)**: Dispatch `BOOKING_REQUEST` notification to teacher (`"New appointment requested by [Student Name]"`).
   * **On Approval (`approveAppointment`)**: Dispatch `APPROVAL` notification to student (`"Your appointment request for [Title] was approved"`).
   * **On Rejection (`rejectAppointment`)**: Dispatch `REJECTION` notification to student (`"Appointment request rejected: [Reason]"`).
   * **On Cancellation (`cancelAppointment`)**: Dispatch `CANCELLATION` notification to the counter-party with the cancellation reason.
   * **On Reschedule (`rescheduleAppointment`)**: Dispatch `RESCHEDULE` notification with proposed new time slot details.
3. **Execution Guardrail**: All notification inserts must execute within the same database transaction (`tx`) as the appointment status change to guarantee consistency.
4. **Verification**: Add automated integration tests in `backend/tests/notificationService.test.js` verifying that each lifecycle event produces a corresponding record in `notifications`.

---

### Phase 4: Notification Read-State Management (Priority: Medium)

#### 4.1 Problem Statement
The `notifications` table includes an `is_read BOOLEAN DEFAULT 0` column and index, but there is no API endpoint or UI interaction to mark notifications as read. As a result, unread badges remain perpetually active.

#### 4.2 Proposed Implementation
1. **Backend Route & Controller**:
   * Add route: `PATCH /api/v1/users/:id/notifications/:notificationId/read` in `userRoutes.js`.
   * Enforce ownership via `authorizeOwnerOrAdmin('id')`.
   * Update database record: `UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?;`.
   * Add batch route: `POST /api/v1/users/:id/notifications/mark-all-read`.
2. **Frontend UI Integration**:
   * Add `markNotificationAsRead` and `markAllNotificationsAsRead` to `studentService.ts` and `teacherService.ts`.
   * Add "Mark as Read" action button on individual notification cards in `StudentNotificationsView.tsx` and `TeacherNotificationsView.tsx`.
   * Add "Mark All as Read" header button.
3. **Verification**: Verify that clicking "Mark as Read" updates the card style, clears the unread badge, and persists on page reload.

---

### Phase 5: Student Consultation Feedback & Rating Engine (Priority: Medium)

#### 5.1 Problem Statement
The `feedback_ratings` table exists in the database schema (`rating INT CHECK 1-5`, `comments TEXT`, `UNIQUE(appointment_id)`) and is surfaced in `adminAppointmentService.js`, but students currently have no mechanism to submit reviews for concluded appointments.

#### 5.2 Proposed Implementation
1. **Backend Route & Controller**:
   * Add route: `POST /api/v1/appointments/:id/feedback` in `appointmentRoutes.js`.
   * Validation: Verify user is the student who booked the appointment (`student_id = studentProfile.id`).
   * Constraint: Verify appointment status is strictly `COMPLETED`.
   * Insert record into `feedback_ratings`.
2. **Frontend UI Integration**:
   * Add feedback rating dialog in `StudentAppointmentsView.tsx` with star selector (1–5) and comment input.
   * Render "Leave Feedback" button exclusively on appointments with status `COMPLETED` that lack an existing feedback record.
3. **Verification**: Add integration test in `backend/tests/appointments.test.js` validating rating range (1–5), single-submission uniqueness constraint, and non-completed appointment rejection.

---

### Phase 6: Interactive OpenAPI / Swagger Documentation (Priority: Low)

#### 6.1 Problem Statement
The meta endpoint `GET /api/v1/` lists documentation at `'/docs'`, but navigating there returns 404 because no Swagger UI or OpenAPI definition is mounted.

#### 6.2 Proposed Implementation
1. Install `swagger-ui-express` and `yamljs`.
2. Create `backend/src/docs/openapi.yaml` documenting all versioned endpoints, schemas, and security schemes (`BearerAuth`).
3. Mount Swagger UI at `/docs` and `/api/v1/docs` in `backend/src/app.js`.
4. Verification: Query `GET /api/v1/docs` and confirm HTTP 200 with interactive Swagger UI rendering.

---

## 4. Phase Execution Protocol

Before starting any implementation phase:
1. **Obtain Explicit User Approval**: Do not modify source code without user authorization.
2. **Preserve Existing Functionality**: Run existing test suites (`npm test`, `npm run test:admin-system`, `npm run test:frontend-admin`) before and after edits.
3. **Adhere to Invariants**: Never commit untested code or bypass RBAC middleware.
