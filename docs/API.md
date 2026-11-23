# REST API Reference & Specification

## Project: Teacher–Student Appointment System
* **Base URL:** `http://localhost:5000/api/v1`
* **API Version:** v1
* **Format:** JSON (`Content-Type: application/json`)
* **Authentication:** HTTP Bearer Header (`Authorization: Bearer <jwt-token>`)

---

## 1. Response Envelope Format

All responses strictly follow a uniform envelope standard:

### Success Envelope
```json
{
  "success": true,
  "data": { ... },
  "message": "Optional human-readable confirmation message"
}
```

### Error Envelope
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE_IDENTIFIER",
    "message": "Descriptive error message explaining failure rationale",
    "details": []
  }
}
```

---

## 2. Health & Diagnostic Endpoints

### 2.1 Liveness Probe
* **Endpoint:** `GET /api/v1/health`
* **Auth Required:** No (Public)
* **Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "status": "UP",
    "service": "teacher-student-appointment-backend",
    "timestamp": "2026-10-24T16:00:00.000Z",
    "uptimeSeconds": 1420.5,
    "environment": "development",
    "memoryUsage": {
      "rssMb": 74.32,
      "heapUsedMb": 38.15
    }
  }
}
```

### 2.2 Readiness Probe
* **Endpoint:** `GET /api/v1/ready`
* **Auth Required:** No (Public)
* **Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "status": "READY",
    "timestamp": "2026-10-24T16:00:00.000Z",
    "checks": {
      "database": {
        "connected": true,
        "latencyMs": 2,
        "path": "D:\\T-S appoinment system\\database\\appointment_system.db"
      },
      "migrations": {
        "isUpToDate": true,
        "totalAvailable": 3,
        "appliedCount": 3,
        "pendingCount": 0,
        "pending": []
      }
    }
  }
}
```

---

## 3. Authentication Endpoints (`/api/v1/auth`)

### 3.1 User Login
* **Endpoint:** `POST /api/v1/auth/login`
* **Auth Required:** No (Rate limited: 10 attempts per minute)
* **Request Body:**
```json
{
  "email": "robert.miller@university.edu",
  "password": "Password123!"
}
```
* **Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": 2,
      "email": "robert.miller@university.edu",
      "first_name": "Robert",
      "last_name": "Miller",
      "role": "TEACHER",
      "status": "ACTIVE"
    }
  }
}
```

### 3.2 User Logout
* **Endpoint:** `POST /api/v1/auth/logout` (or `GET /api/v1/auth/logout`)
* **Auth Required:** Yes
* **Behavior:** Invalidates JWT token ID (`jti`) server-side in `revoked_tokens`.
* **Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "message": "Successfully logged out"
  }
}
```

### 3.3 Current User Profile
* **Endpoint:** `GET /api/v1/auth/me`
* **Auth Required:** Yes
* **Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": 2,
      "email": "robert.miller@university.edu",
      "first_name": "Robert",
      "last_name": "Miller",
      "role": "TEACHER",
      "status": "ACTIVE",
      "profile": {
        "id": 1,
        "department_id": 1,
        "department_name": "Computer Science and Engineering",
        "designation": "Associate Professor",
        "office_room": "UB-401",
        "is_verified": 1
      }
    }
  }
}
```

---

## 4. Faculty & Availability Endpoints (`/api/v1/teachers`)

### 4.1 List Faculty Directory
* **Endpoint:** `GET /api/v1/teachers?departmentId=1&search=Miller`
* **Auth Required:** No (Public directory)
* **Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "teachers": [
      {
        "id": 1,
        "user_id": 2,
        "first_name": "Robert",
        "last_name": "Miller",
        "email": "robert.miller@university.edu",
        "department_name": "Computer Science and Engineering",
        "designation": "Associate Professor",
        "office_room": "UB-401",
        "is_verified": 1,
        "courses": ["CSE101", "CSE311"]
      }
    ]
  }
}
```

### 4.2 Query Faculty Availability Slots
* **Endpoint:** `GET /api/v1/teachers/:id/slots?startDate=2027-01-01`
* **Auth Required:** No
* **Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "slots": [
      {
        "id": 101,
        "teacher_id": 1,
        "start_timestamp": "2027-09-15 10:00:00",
        "end_timestamp": "2027-09-15 10:30:00",
        "is_available": 1,
        "is_active": 1
      }
    ]
  }
}
```

### 4.3 Configure Availability Slot
* **Endpoint:** `POST /api/v1/teachers/:id/slots`
* **Auth Required:** Yes (Teacher matching `:id` or Admin)
* **Request Body:**
```json
{
  "date": "2027-09-15",
  "startTime": "10:00",
  "endTime": "10:30"
}
```
* **Error Example (409 Conflict - Interval Collision):**
```json
{
  "success": false,
  "error": {
    "code": "SLOT_OVERLAP",
    "message": "The proposed time slot overlaps with an existing slot on 2027-09-15 (10:00 - 10:30)."
  }
}
```

---

## 5. Appointment Consultation Endpoints (`/api/v1/appointments`)

### 5.1 Evaluate Booking Collision
* **Endpoint:** `POST /api/v1/appointments/check-conflict`
* **Auth Required:** Yes
* **Request Body:** `{ "slotId": 101 }`
* **Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "hasConflict": false,
    "slotAvailable": true,
    "studentHasConflict": false
  }
}
```

### 5.2 Book Appointment
* **Endpoint:** `POST /api/v1/appointments`
* **Auth Required:** Yes (Student)
* **Request Body:**
```json
{
  "slotId": 101,
  "title": "Algorithm Project Review",
  "purpose": "Need guidance regarding graph optimization and time complexity for assignment 3."
}
```
* **Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "appointment": {
      "id": 822,
      "slot_id": 101,
      "student_id": 1,
      "title": "Algorithm Project Review",
      "status": "PENDING"
    }
  }
}
```

### 5.3 Approve Appointment
* **Endpoint:** `POST /api/v1/appointments/:id/approve`
* **Auth Required:** Yes (Teacher owner or Admin)
* **Request Body:** `{ "notes": "Please bring your rough sketches to the meeting." }`
* **Response (200 OK):** Status updated to `APPROVED`.

### 5.4 Reject Appointment
* **Endpoint:** `POST /api/v1/appointments/:id/reject`
* **Auth Required:** Yes (Teacher owner or Admin)
* **Request Body:** `{ "reason": "Department faculty meeting scheduled during this window." }`
* **Response (200 OK):** Status updated to `REJECTED`; slot is released back to open pool.

### 5.5 Reschedule Appointment
* **Endpoint:** `POST /api/v1/appointments/:id/reschedule`
* **Auth Required:** Yes (Teacher owner, Student owner, or Admin)
* **Request Body:**
```json
{
  "proposedSlotId": 102,
  "reason": "Rescheduling due to lab exam conflict."
}
```

### 5.6 Cancel Appointment
* **Endpoint:** `POST /api/v1/appointments/:id/cancel`
* **Auth Required:** Yes (Student owner, Teacher owner, or Admin)
* **Request Body:** `{ "cancellationReason": "Resolved issue during tutorial session." }`

### 5.7 Mark Appointment Completed
* **Endpoint:** `POST /api/v1/appointments/:id/complete`
* **Auth Required:** Yes (Teacher owner or Admin)
* **Response (200 OK):** Status updated to `COMPLETED`.

### 5.8 Submit Consultation Feedback
* **Endpoint:** `POST /api/v1/appointments/:id/feedback`
* **Auth Required:** Yes (Authenticated Student owner only: `user.role === 'STUDENT'` and `appointment.student_user_id === user.id`)
* **Preconditions:**
  * Appointment must exist and be in `COMPLETED` status.
  * No prior feedback may exist for the appointment (`UNIQUE(appointment_id)`).
* **Request Body:**
```json
{
  "rating": 5,
  "comments": "Very insightful discussion on graph algorithms and system architecture."
}
```
* **Payload Constraints:**
  * `rating` (mandatory): Integer between `1` and `5` inclusive. Rejects non-numbers, decimals, and values outside 1–5 with `400 Bad Request` (`code: 'INVALID_RATING'`).
  * `comments` (optional): String up to `1000` characters. Rejects non-string input with `400 Bad Request` (`code: 'INVALID_COMMENTS'`) and strings exceeding length limit with `400 Bad Request` (`code: 'COMMENTS_TOO_LONG'`). Whitespace-only comments are trimmed to `null`.
* **Side Effects:**
  * Atomically inserts review record into `feedback_ratings` table.
  * Dispatches an in-app `STATUS_UPDATE` notification to the assigned faculty member's user account (`appointment.teacher_user_id`) with title `"Consultation Feedback Received"` and star rating.
* **Response (201 Created):**
```json
{
  "success": true,
  "message": "Consultation feedback submitted successfully.",
  "data": {
    "id": 1,
    "appointmentId": 822,
    "studentId": 3,
    "teacherId": 2,
    "rating": 5,
    "comments": "Very insightful discussion on graph algorithms and system architecture.",
    "createdAt": "2026-10-27 09:15:00"
  }
}
```
* **Error Responses:**
  * `400 Bad Request`: `INVALID_APPOINTMENT_ID` (invalid or non-numeric ID), `INVALID_RATING` (missing, non-integer, or out of 1–5 range), `INVALID_COMMENTS` (non-string), `COMMENTS_TOO_LONG` (> 1000 characters), or `INVALID_APPOINTMENT_STATUS` (consultation status is not `COMPLETED`).
  * `401 Unauthorized`: Missing or invalid JWT access token.
  * `403 Forbidden`: `FORBIDDEN` (user is not a student or is not the student who booked the consultation) or `STUDENT_PROFILE_REQUIRED` (authenticated student account has no associated student profile).
  * `404 Not Found`: `APPOINTMENT_NOT_FOUND` (appointment ID does not exist).
  * `409 Conflict`: `DUPLICATE_FEEDBACK` (feedback has already been recorded for this appointment).

### 5.9 Retrieve Consultation Feedback
* **Endpoint:** `GET /api/v1/appointments/:id/feedback`
* **Auth Required:** Yes (Authenticated Student owner, Assigned Faculty member, or Admin)
* **Authorization Policy:**
  * Owning Student (`appointment.student_user_id === user.id`)
  * Assigned Faculty Member (`appointment.teacher_user_id === user.id`)
  * Administrator (`user.role === 'ADMIN'`)
  * Any other authenticated user receives `403 Forbidden` (`code: 'FORBIDDEN'`).
* **Response When Feedback Exists (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "appointmentId": 822,
    "studentId": 3,
    "teacherId": 2,
    "rating": 5,
    "comments": "Very insightful discussion on graph algorithms and system architecture.",
    "createdAt": "2026-10-27 09:15:00"
  }
}
```
* **Response When No Feedback Exists (200 OK):**
```json
{
  "success": true,
  "data": null
}
```
* **Error Responses:**
  * `400 Bad Request`: `INVALID_APPOINTMENT_ID` (invalid or non-numeric ID).
  * `401 Unauthorized`: Missing or invalid JWT access token.
  * `403 Forbidden`: `FORBIDDEN` (user lacks ownership, faculty assignment, or admin privilege).
  * `404 Not Found`: `APPOINTMENT_NOT_FOUND` (appointment ID does not exist).

---

## 6. Administration Endpoints (`/api/v1/admin/*`)

All routes under `/api/v1/admin/*` are strictly protected by `authenticate` and `authorizeRoles('ADMIN')`. Non-admin requests receive HTTP `403 Forbidden`.

### 6.1 List User Accounts
* **Endpoint:** `GET /api/v1/admin/users`
* **Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "total": 24,
    "users": [
      {
        "id": 1,
        "email": "admin@university.edu",
        "first_name": "System",
        "last_name": "Administrator",
        "role_name": "ADMIN",
        "status": "ACTIVE",
        "created_at": "2026-10-01 00:00:00"
      }
    ]
  }
}
```

### 6.2 Update User Account Status
* **Endpoint:** `PATCH /api/v1/admin/users/:id/status`
* **Request Body:** `{ "status": "SUSPENDED" }`
* **Allowed Statuses:** `ACTIVE`, `PENDING_APPROVAL`, `SUSPENDED`
* **Response (200 OK):**
```json
{
  "success": true,
  "message": "User status updated to SUSPENDED.",
  "data": {
    "userId": 6,
    "status": "SUSPENDED"
  }
}
```

### 6.3 Query Immutable Audit Logs
* **Endpoint:** `GET /api/v1/admin/audit-logs`
* **Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "logs": [
      {
        "id": 1614,
        "actor_id": 1,
        "action": "UPDATE_USER_STATUS",
        "entity_type": "USER",
        "entity_id": "6",
        "details": "{\"previous\":\"ACTIVE\",\"updated\":\"SUSPENDED\"}",
        "ip_address": "127.0.0.1",
        "created_at": "2026-10-24 16:24:22",
        "actor_email": "admin@university.edu",
        "first_name": "System",
        "last_name": "Administrator"
      }
    ]
  }
}
```

### 6.4 Aggregated Appointment Metrics Summary
* **Endpoint:** `GET /api/v1/admin/appointments/summary`
* **Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "summary": {
      "totalAppointments": 44,
      "pendingCount": 12,
      "approvedCount": 18,
      "completedCount": 8,
      "cancelledCount": 4,
      "rejectedCount": 2
    }
  }
}
```

---

## 7. User & Notification Endpoints (`/api/v1/users`)

### 7.1 Retrieve Notifications
* **Endpoint:** `GET /api/v1/users/:id/notifications`
* **Auth Required:** Yes (Owner matching `:id` or Admin)
* **Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "total": 2,
    "notifications": [
      {
        "id": 105,
        "recipientId": 6,
        "appointmentId": 42,
        "title": "Appointment Approved",
        "message": "Your consultation request has been approved by Prof. Robert Miller.",
        "type": "STATUS_UPDATE",
        "isRead": 0,
        "createdAt": "2026-10-24 16:30:00"
      }
    ]
  }
}
```

### 7.2 Mark Single Notification as Read
* **Endpoint:** `PATCH /api/v1/users/:id/notifications/:notificationId/read` (or alias `PATCH /api/v1/users/:id/notifications/:notificationId`)
* **Auth Required:** Yes (Recipient ownership enforced strictly via authenticated identity `req.user.id`)
* **Behavior:** Idempotent update setting `is_read = 1`. Rejects foreign notifications with `403 FORBIDDEN` and nonexistent IDs with `404 NOTIFICATION_NOT_FOUND`.
* **Response (200 OK):**
```json
{
  "success": true,
  "message": "Notification marked as read.",
  "data": {
    "id": 105,
    "recipientId": 6,
    "appointmentId": 42,
    "title": "Appointment Approved",
    "message": "Your consultation request has been approved by Prof. Robert Miller.",
    "type": "STATUS_UPDATE",
    "isRead": 1,
    "createdAt": "2026-10-24 16:30:00"
  }
}
```

### 7.3 Mark All Notifications as Read
* **Endpoint:** `PATCH /api/v1/users/:id/notifications/read-all` (or alias `POST /api/v1/users/:id/notifications/mark-all-read`)
* **Auth Required:** Yes (Recipient ownership enforced directly within SQL update `WHERE recipient_id = req.user.id`)
* **Behavior:** Idempotently sets `is_read = 1` across all unread notifications for the authenticated user without affecting counterparty records.
* **Response (200 OK):**
```json
{
  "success": true,
  "message": "All notifications marked as read.",
  "data": {
    "recipientId": 6,
    "updatedCount": 2
  }
}
```

---

## 8. Known Unimplemented / Gap Endpoints

* **`GET /docs`**: Root endpoint metadata lists `/docs`, but an interactive OpenAPI Swagger UI is not mounted.
