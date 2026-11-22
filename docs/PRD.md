# Product Requirements Document (PRD)

## Project: Teacher–Student Appointment System
* **Document Version:** 1.0.0
* **Date:** October 2026
* **Status:** Verified Active Implementation / Roadmap

---

## 1. Problem Statement

In traditional academic institutions, scheduling consultations between students and faculty relies on disorganized email correspondence, paper sign-up sheets, or informal messaging. This causes critical friction:
1. **Scheduling Collisions**: Double-booking faculty office hours when multiple students request the same consultation period.
2. **Lack of Visibility**: Students cannot easily view open office hours, faculty department affiliations, or consultation availability.
3. **Administrative Blindspots**: Department heads and administrators have zero audit visibility into faculty consultation workloads, student engagement, or scheduling disputes.
4. **Rescheduling Friction**: Modifying or cancelling an appointment involves protracted back-and-forth communication with no formal status history.

---

## 2. Target Users & Personas

| Persona | Role | Primary Goals | Key Pain Points |
| :--- | :--- | :--- | :--- |
| **Academic Student** (e.g. Alice Carter) | `STUDENT` | Find professors by department/course, view open consultation slots, book appointments with notes, and track request approval. | Uncertain teacher availability, conflicting bookings, missed updates. |
| **Faculty Member** (e.g. Dr. Robert Miller) | `TEACHER` | Publish office hours slots, review and approve/reject student booking requests, manage confirmed schedule, reschedule consultations. | Schedule congestion, overlapping student requests, back-to-back burnout. |
| **University Administrator** (e.g. Admin User) | `ADMIN` | Monitor university-wide appointment metrics, verify teacher credentials, manage user accounts, inspect immutable audit logs, verify system health. | Inability to track consultation metrics, lack of audit trails for moderation. |

---

## 3. Product Goals

1. **Deterministic Double-Booking Prevention**: Guarantee zero overlapping bookings at both the application and database storage layers.
2. **Transparent Lifecycle Workflow**: Support an explicit state machine: `PENDING` -> `APPROVED` / `REJECTED` -> `COMPLETED`, with support for `CANCELLED` and `RESCHEDULE_PENDING`.
3. **Role-Enforced Privacy & Governance**: Strict separation of concerns ensuring students cannot view other students' private appointments, teachers cannot modify other teachers' schedules, and only admins can manage users or audit trails.
4. **Operational Reliability**: Real-time diagnostic endpoints reporting database connectivity, migration alignment, and process health.

---

## 4. Product Scope

### In-Scope (Implemented & Verified)
* User authentication via JWT with cryptographic token revocation on logout.
* Public faculty directory with department filtering and course affiliation tags.
* Teacher availability slot publishing with start/end UTC timestamps and interval overlap checks.
* Student appointment requests with mandatory title and purpose declarations.
* Conflict detection engine evaluating availability collisions before booking.
* Teacher appointment request review (Approve with notes, Reject with mandatory reason).
* Rescheduling workflow proposing alternate availability slots.
* Cancellation workflow with mandatory justification.
* Consultation completion tracking (`COMPLETED`).
* Administrative appointment monitoring with multi-parameter filtering and status history.
* Administrative teacher management (create, update, verify, status toggle).
* Administrative user management (search, role inspection, activate/suspend account).
* Administrative immutable audit ledger recording security and lifecycle events.
* Administrative system diagnostics (health, readiness, database ping latency, migration status).

### Out-of-Scope (Deferred / Future Scope)
* Multi-factor authentication (MFA / 2FA).
* External calendar synchronization (Google Calendar / Microsoft Outlook iCal sync).
* Video call integration (Zoom / Microsoft Teams webhooks).
* Automated email or SMS dispatch (currently notifications are stored in-app).

---

## 5. User Roles & Capabilities

### 5.1 Student Role (`STUDENT`)
* **Discovery**: Browse list of verified faculty members filterable by department code.
* **Slot Selection**: View active, unbooked availability slots for a selected faculty member.
* **Booking**: Submit consultation requests with validation on minimum text lengths.
* **Tracking**: View personal appointment history and upcoming meetings.
* **Cancellation**: Cancel upcoming consultations prior to completion.

### 5.2 Teacher Role (`TEACHER`)
* **Slot Configuration**: Create discrete availability slots specifying start and end times.
* **Collision Guard**: System rejects any slot that overlaps with the teacher's existing slots.
* **Request Management**: Accept or reject pending student requests. Rejecting an appointment automatically releases the slot back to `available` status.
* **Schedule Review**: Filter confirmed upcoming meetings.
* **Rescheduling**: Propose alternative open slots to students.
* **Session Closeout**: Mark concluded consultations as `COMPLETED`.

### 5.3 Administrator Role (`ADMIN`)
* **System-Wide Oversight**: View, search, and filter all appointments across all departments.
* **Faculty Moderation**: Verify new teacher profiles and activate or suspend faculty accounts.
* **User Accounts Ledger**: View all registered students, teachers, and admins; modify account status (`ACTIVE`, `SUSPENDED`, `PENDING_APPROVAL`).
* **Audit Trail**: Inspect immutable chronological log entries detailing actor, action, entity, IP address, and payload diffs.
* **Infrastructure Health**: Query real-time liveness (`/api/v1/health`) and readiness (`/api/v1/ready`) probes.

---

## 6. Functional Requirements Matrix

| ID | Requirement Description | Role | Status |
| :--- | :--- | :--- | :--- |
| **FR-01** | User authentication with email and password returning JWT and user profile | All | Implemented |
| **FR-02** | User session invalidation via server-side token revocation (`revoked_tokens`) | All | Implemented |
| **FR-03** | Faculty directory browsing with department and name filtering | Student, Admin | Implemented |
| **FR-04** | Office-hour slot creation with interval collision detection | Teacher, Admin | Implemented |
| **FR-05** | Appointment request submission with slot locking | Student | Implemented |
| **FR-06** | Appointment approval with guidance notes | Teacher, Admin | Implemented |
| **FR-07** | Appointment rejection with slot release | Teacher, Admin | Implemented |
| **FR-08** | Appointment rescheduling to an open slot | Teacher, Admin | Implemented |
| **FR-09** | Appointment cancellation with mandatory reason | Student, Teacher, Admin | Implemented |
| **FR-10** | Appointment completion marking session as terminal | Teacher, Admin | Implemented |
| **FR-11** | Administrative user management and account status toggling | Admin | Implemented |
| **FR-12** | Immutable audit log ledger recording administrative actions | Admin | Implemented |
| **FR-13** | Real-time system health and readiness probe reporting | Admin, Public | Implemented |
| **FR-14** | Dynamic notification dispatch on appointment lifecycle events | Student, Teacher | **Pending (Gap)** |
| **FR-15** | Notification mark-as-read capability | Student, Teacher | **Pending (Gap)** |
| **FR-16** | Student consultation rating and review submission | Student | **Pending (Gap)** |

---

## 7. Non-Functional Requirements

### 7.1 Security & Access Control
* Passwords hashed using `bcryptjs` with salt round factor >= 10.
* JWT signed using HMAC-SHA256 with minimum 256-bit secret key.
* Server-side role boundaries enforced on all routes via `rbacMiddleware.js`.
* Strict parameter sanitization and PII redaction in application request logs.

### 7.2 Data Integrity & Concurrency
* Database constraints enforce double-booking prevention (`UNIQUE(slot_id)`).
* All multi-step state mutations (e.g. appointment rejection and slot status release) execute inside isolated database transactions (`db.transaction`).
* UTC timestamp standardization for all temporal comparisons.

### 7.3 Performance & Responsiveness
* Lightweight SQLite query execution with round-trip query latency < 10ms.
* Client-side bundle size under 350kB gzipped using Vite tree-shaking.
* Instant client-side state filtering for tabular user interfaces.

---

## 8. Success Criteria & Metrics

1. **Zero Double-Bookings**: 100% rejection rate for concurrent booking attempts on the same time slot.
2. **Zero Unauthorized Access Violations**: 100% rejection rate (`403 Forbidden`) for cross-role privilege escalation attempts in automated security test suites.
3. **Sub-second Build & Test Cycle**: Full test suite runs in under 20 seconds; frontend production build completes in under 2 seconds.
4. **High Availability Verification**: Readiness probe validates database ping and migration status before traffic routing.
