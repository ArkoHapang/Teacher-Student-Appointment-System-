-- ==============================================================================
-- Migration: 001_initial_schema.sql
-- Description: Core Schema for University Teacher-Student Appointment System
-- Target: SQLite 3.x / PostgreSQL compatible DDL
-- ==============================================================================

-- -----------------------------------------------------------------------------
-- 0. Schema Migrations Ledger
-- Tracks applied migrations to ensure sequential, idempotent execution.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- -----------------------------------------------------------------------------
-- 1. System Roles
-- Standardized roles: 'STUDENT', 'TEACHER', 'ADMIN'
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(50) NOT NULL UNIQUE CHECK (name IN ('STUDENT', 'TEACHER', 'ADMIN')),
    description VARCHAR(255),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- -----------------------------------------------------------------------------
-- 2. Academic Departments
-- Represents university academic departments (CSE, EEE, BBA, MATH, etc.)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS departments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code VARCHAR(20) NOT NULL UNIQUE,
    name VARCHAR(150) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- -----------------------------------------------------------------------------
-- 3. Users
-- Base authentication credentials and identity for all platform actors.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PENDING_APPROVAL', 'SUSPENDED')),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role_id ON users(role_id);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

-- -----------------------------------------------------------------------------
-- 4. Student Profiles
-- Specific student attributes (Student ID number, academic department, batch).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS student_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    student_id_number VARCHAR(50) NOT NULL UNIQUE,
    department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
    phone_number VARCHAR(25),
    batch VARCHAR(30),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_student_profiles_user_id ON student_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_student_profiles_dept_id ON student_profiles(department_id);

-- -----------------------------------------------------------------------------
-- 5. Teacher Profiles
-- Teacher credentials, designation, room number, bio, and administrative approval.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS teacher_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
    designation VARCHAR(100) NOT NULL,
    office_room VARCHAR(50) NOT NULL,
    bio TEXT,
    is_verified BOOLEAN NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_teacher_profiles_user_id ON teacher_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_teacher_profiles_dept_id ON teacher_profiles(department_id);
CREATE INDEX IF NOT EXISTS idx_teacher_profiles_verified ON teacher_profiles(is_verified);

-- -----------------------------------------------------------------------------
-- 6. Teacher Courses
-- Courses taught or competencies for faceted search (Issue #18).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS teacher_courses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_id INTEGER NOT NULL REFERENCES teacher_profiles(id) ON DELETE CASCADE,
    course_code VARCHAR(30) NOT NULL,
    course_title VARCHAR(150) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(teacher_id, course_code)
);

CREATE INDEX IF NOT EXISTS idx_teacher_courses_teacher_id ON teacher_courses(teacher_id);
CREATE INDEX IF NOT EXISTS idx_teacher_courses_code ON teacher_courses(course_code);

-- -----------------------------------------------------------------------------
-- 7. Teacher Availability Slots
-- Defined consultation intervals. Unambiguous start/end UTC timestamps prevent
-- overlap and time zone ambiguities (Issues #19, #21, #29, #40).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS teacher_availability_slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_id INTEGER NOT NULL REFERENCES teacher_profiles(id) ON DELETE CASCADE,
    slot_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    start_timestamp TIMESTAMP NOT NULL,
    end_timestamp TIMESTAMP NOT NULL,
    is_booked BOOLEAN NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (start_timestamp < end_timestamp),
    UNIQUE (teacher_id, start_timestamp)
);

CREATE INDEX IF NOT EXISTS idx_slots_teacher_date ON teacher_availability_slots(teacher_id, slot_date);
CREATE INDEX IF NOT EXISTS idx_slots_availability ON teacher_availability_slots(teacher_id, is_booked, is_active);
CREATE INDEX IF NOT EXISTS idx_slots_start_timestamp ON teacher_availability_slots(start_timestamp);

-- -----------------------------------------------------------------------------
-- 8. Appointments
-- Central booking entity. UNIQUE(slot_id) strictly prevents duplicate/concurrent
-- double booking at the database engine level (Issues #20, #22, #26, #40).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL REFERENCES student_profiles(id) ON DELETE RESTRICT,
    teacher_id INTEGER NOT NULL REFERENCES teacher_profiles(id) ON DELETE RESTRICT,
    slot_id INTEGER NOT NULL UNIQUE REFERENCES teacher_availability_slots(id) ON DELETE RESTRICT,
    title VARCHAR(200) NOT NULL,
    purpose TEXT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING' CHECK (
        status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'RESCHEDULE_PENDING', 'COMPLETED')
    ),
    cancellation_reason TEXT,
    cancelled_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_appointments_student ON appointments(student_id);
CREATE INDEX IF NOT EXISTS idx_appointments_teacher ON appointments(teacher_id);
CREATE INDEX IF NOT EXISTS idx_appointments_slot ON appointments(slot_id);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);
CREATE INDEX IF NOT EXISTS idx_appointments_created ON appointments(created_at);

-- -----------------------------------------------------------------------------
-- 9. Appointment Status History
-- Immutable audit log of every lifecycle state transition (Issues #26, #39).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS appointment_status_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
    previous_status VARCHAR(30),
    new_status VARCHAR(30) NOT NULL,
    changed_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    notes TEXT,
    changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_status_history_appointment ON appointment_status_history(appointment_id);

-- -----------------------------------------------------------------------------
-- 10. Appointment Reschedules
-- Handles reschedule proposals without corrupting existing bookings (Issue #25).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS appointment_reschedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
    requested_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    original_slot_id INTEGER NOT NULL REFERENCES teacher_availability_slots(id) ON DELETE RESTRICT,
    proposed_slot_id INTEGER NOT NULL REFERENCES teacher_availability_slots(id) ON DELETE RESTRICT,
    reason TEXT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED')),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_reschedules_appointment ON appointment_reschedules(appointment_id);
CREATE INDEX IF NOT EXISTS idx_reschedules_proposed_slot ON appointment_reschedules(proposed_slot_id);

-- -----------------------------------------------------------------------------
-- 11. Appointment Notes / Messages
-- Enables teacher preparation notes and asynchronous communication (Issue #33).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS appointment_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
    author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    note TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notes_appointment ON appointment_notes(appointment_id);

-- -----------------------------------------------------------------------------
-- 12. Feedback & Ratings
-- Post-consultation evaluation. 1..5 stars rating with student comments (Issue #34).
-- UNIQUE(appointment_id) enforces exactly one rating per completed consultation.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS feedback_ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    appointment_id INTEGER NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES student_profiles(id) ON DELETE RESTRICT,
    teacher_id INTEGER NOT NULL REFERENCES teacher_profiles(id) ON DELETE RESTRICT,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comments TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_feedback_teacher ON feedback_ratings(teacher_id);
CREATE INDEX IF NOT EXISTS idx_feedback_student ON feedback_ratings(student_id);

-- -----------------------------------------------------------------------------
-- 13. System Notifications
-- In-app notifications and event reminders for all actors (Issue #27).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
    title VARCHAR(200) NOT NULL,
    message TEXT NOT NULL,
    type VARCHAR(50) NOT NULL CHECK (
        type IN ('BOOKING_REQUEST', 'STATUS_UPDATE', 'RESCHEDULE_REQUEST', 'NOTE_ADDED', 'REMINDER', 'SYSTEM_ALERT')
    ),
    is_read BOOLEAN NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(recipient_id, is_read);

-- -----------------------------------------------------------------------------
-- 14. Administrative Audit Logs
-- Tamper-evident logs of administrative actions & critical overrides (Issue #39).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id VARCHAR(50) NOT NULL,
    details TEXT,
    ip_address VARCHAR(45),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
