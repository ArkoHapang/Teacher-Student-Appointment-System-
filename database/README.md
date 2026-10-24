# Database Architecture & Migration System

## Overview
This directory contains the relational database schema, versioned migrations, seed datasets, migration runner, and automated integrity test suite for the university **Teacher–Student Appointment System**.

## Schema Catalog (15 Entities)

| Table | Purpose | Integrity Rules & Constraints |
| :--- | :--- | :--- |
| `schema_migrations` | Version ledger for executed migrations | `UNIQUE(version)` |
| `roles` | Base system roles (`STUDENT`, `TEACHER`, `ADMIN`) | `UNIQUE(name)`, `CHECK(name IN ...)` |
| `departments` | Academic faculties (CSE, EEE, BBA, MATH, etc.) | `UNIQUE(code)` |
| `users` | User credentials, emails, and account status | `UNIQUE(email)`, `CHECK(status IN ...)` |
| `student_profiles` | Student ID number, academic department, batch | `UNIQUE(user_id)`, `UNIQUE(student_id_number)` |
| `teacher_profiles` | Designation, office room, bio, verification flag | `UNIQUE(user_id)` |
| `teacher_courses` | Courses taught for faceted search | `UNIQUE(teacher_id, course_code)` |
| `teacher_availability_slots`| Consultation time slots with UTC timestamps | `UNIQUE(teacher_id, start_timestamp)`, `CHECK(start < end)` |
| `appointments` | Booked consultation sessions | `UNIQUE(slot_id)`, `CHECK(status IN ...)` |
| `appointment_status_history`| Immutable audit log of lifecycle state changes | `FK(appointment_id)`, `FK(changed_by)` |
| `appointment_reschedules` | Reschedule negotiations & slot proposals | `CHECK(status IN ...)` |
| `appointment_notes` | Teacher consultation notes & student guidance | `FK(appointment_id)` |
| `feedback_ratings` | 1–5 stars evaluation and student reviews | `UNIQUE(appointment_id)`, `CHECK(rating BETWEEN 1 AND 5)` |
| `notifications` | System alerts, booking confirmations & reminders | `CHECK(type IN ...)`, indexed by `is_read` |
| `audit_logs` | Administrative audit trail for user moderation | Indexed by `actor_id`, `action`, `created_at` |

---

## Concurrency & Conflict Protection

1. **Double-Booking Elimination:**
   `appointments.slot_id` has a strict `UNIQUE` constraint. Even if two concurrent requests bypass application-level checks at the exact same millisecond, the database engine guarantees that only one transaction can insert the booking. The second transaction immediately receives a unique constraint violation (`409 Conflict`).
2. **Slot Overlap Prevention:**
   `teacher_availability_slots(teacher_id, start_timestamp)` has a composite `UNIQUE` constraint, preventing teachers from scheduling multiple slots starting at the same time.
3. **Unambiguous Timestamp Representation:**
   All slots store unambiguous UTC timestamps (`start_timestamp`, `end_timestamp`) formatted in ISO 8601 / RFC 3339 (`YYYY-MM-DD HH:MM:SS`), eliminating daylight-saving and timezone discrepancies.
4. **Single-Review Integrity:**
   `feedback_ratings.appointment_id` has a `UNIQUE` constraint, strictly preventing multiple rating submissions for the same appointment.

---

## Migration Commands

### Running Pending Migrations
Execute the migration runner via PowerShell (uses Windows built-in `winsqlite3.dll`):
```powershell
powershell -ExecutionPolicy Bypass -File database/migrate.ps1
```

### Resetting and Re-migrating Clean Database
```powershell
powershell -ExecutionPolicy Bypass -File database/migrate.ps1 -ForceReset
```

### Running Automated Schema & Integrity Tests
Run the 33-point automated test suite:
```powershell
powershell -ExecutionPolicy Bypass -File database/test_schema.ps1
```

---

## Directory Layout
```text
database/
├── migrations/
│   ├── 001_initial_schema.sql      # Core schema DDL & indexes
│   └── 002_seed_initial_data.sql   # Baseline roles, departments, test users & slots
├── appointment_system.db           # SQLite database file (gitignored)
├── schema.sql                      # Cumulative master schema reference
├── migrate.ps1                     # Native Windows migration runner
├── test_schema.ps1                 # Automated integrity test suite
└── README.md                       # Database documentation
```
