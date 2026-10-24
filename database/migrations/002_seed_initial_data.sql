-- ==============================================================================
-- Migration: 002_seed_initial_data.sql
-- Description: Development Seed Data for Testing & Demonstration
-- Note: Contains baseline roles, departments, test accounts, slots & bookings.
-- ==============================================================================

-- -----------------------------------------------------------------------------
-- 1. Seed Roles
-- -----------------------------------------------------------------------------
INSERT INTO roles (id, name, description) VALUES
(1, 'STUDENT', 'Enrolled university student seeking academic appointments'),
(2, 'TEACHER', 'Academic faculty member offering consultation slots'),
(3, 'ADMIN', 'University system administrator with oversight privileges');

-- -----------------------------------------------------------------------------
-- 2. Seed Academic Departments
-- -----------------------------------------------------------------------------
INSERT INTO departments (id, code, name) VALUES
(1, 'CSE', 'Computer Science and Engineering'),
(2, 'EEE', 'Electrical and Electronic Engineering'),
(3, 'BBA', 'School of Business Administration'),
(4, 'MATH', 'Department of Mathematics'),
(5, 'PHY', 'Department of Physics');

-- -----------------------------------------------------------------------------
-- 3. Seed Users
-- Password hashes use standard bcrypt/argon2 format (default test password: Password123!)
-- Hash value represents $2b$10$abcdef... (mock/test dev hash)
-- -----------------------------------------------------------------------------
INSERT INTO users (id, role_id, email, password_hash, first_name, last_name, status) VALUES
-- Administrator (User 1)
(1, 3, 'admin@university.edu', '$2b$10$T1K7fGkKqm9p/4.2G9oB9.aI8q/k8v9tYp/a7.b6c5d4e3f2g1h0', 'System', 'Administrator', 'ACTIVE'),

-- Teachers (Users 2, 3, 4, 5)
(2, 2, 'robert.miller@university.edu', '$2b$10$T1K7fGkKqm9p/4.2G9oB9.aI8q/k8v9tYp/a7.b6c5d4e3f2g1h0', 'Robert', 'Miller', 'ACTIVE'),
(3, 2, 'sarah.jenkins@university.edu', '$2b$10$T1K7fGkKqm9p/4.2G9oB9.aI8q/k8v9tYp/a7.b6c5d4e3f2g1h0', 'Sarah', 'Jenkins', 'ACTIVE'),
(4, 2, 'alan.walker@university.edu', '$2b$10$T1K7fGkKqm9p/4.2G9oB9.aI8q/k8v9tYp/a7.b6c5d4e3f2g1h0', 'Alan', 'Walker', 'ACTIVE'),
(5, 2, 'mark.peterson@university.edu', '$2b$10$T1K7fGkKqm9p/4.2G9oB9.aI8q/k8v9tYp/a7.b6c5d4e3f2g1h0', 'Mark', 'Peterson', 'PENDING_APPROVAL'),

-- Students (Users 6, 7)
(6, 1, 'alice.carter@student.university.edu', '$2b$10$T1K7fGkKqm9p/4.2G9oB9.aI8q/k8v9tYp/a7.b6c5d4e3f2g1h0', 'Alice', 'Carter', 'ACTIVE'),
(7, 1, 'david.kim@student.university.edu', '$2b$10$T1K7fGkKqm9p/4.2G9oB9.aI8q/k8v9tYp/a7.b6c5d4e3f2g1h0', 'David', 'Kim', 'ACTIVE');

-- -----------------------------------------------------------------------------
-- 4. Seed Teacher Profiles
-- -----------------------------------------------------------------------------
INSERT INTO teacher_profiles (id, user_id, department_id, designation, office_room, bio, is_verified) VALUES
(1, 2, 1, 'Professor', 'Room 402, Engineering Bldg', 'Head of Software Systems Lab. Research in Distributed Systems and Cloud Computing.', 1),
(2, 3, 2, 'Associate Professor', 'Room 305, Science Hall', 'Specialist in Signal Processing and Embedded Systems.', 1),
(3, 4, 3, 'Assistant Professor', 'Room 210, Business Center', 'Lecturer in Financial Markets and Corporate Strategy.', 1),
(4, 5, 1, 'Lecturer', 'Room 415, Engineering Bldg', 'Instructor for Data Structures & Algorithms.', 0);

-- -----------------------------------------------------------------------------
-- 5. Seed Student Profiles
-- -----------------------------------------------------------------------------
INSERT INTO student_profiles (id, user_id, student_id_number, department_id, phone_number, batch) VALUES
(1, 6, 'STU-2026-001', 1, '+1-555-0101', 'Batch 2024'),
(2, 7, 'STU-2026-002', 2, '+1-555-0102', 'Batch 2023');

-- -----------------------------------------------------------------------------
-- 6. Seed Teacher Courses
-- -----------------------------------------------------------------------------
INSERT INTO teacher_courses (id, teacher_id, course_code, course_title) VALUES
(1, 1, 'CSE301', 'Database Systems & Architecture'),
(2, 1, 'CSE401', 'Distributed Operating Systems'),
(3, 2, 'EEE201', 'Electric Circuit Theory'),
(4, 3, 'BBA102', 'Principles of Modern Management');

-- -----------------------------------------------------------------------------
-- 7. Seed Teacher Availability Slots
-- Unambiguous timestamps formatted in UTC RFC 3339 / ISO 8601
-- -----------------------------------------------------------------------------
INSERT INTO teacher_availability_slots (id, teacher_id, slot_date, start_time, end_time, start_timestamp, end_timestamp, is_booked, is_active) VALUES
-- Slots for Dr. Robert Miller (Teacher 1)
(1, 1, '2026-10-20', '10:00:00', '10:30:00', '2026-10-20 10:00:00', '2026-10-20 10:30:00', 1, 1),
(2, 1, '2026-10-20', '10:30:00', '11:00:00', '2026-10-20 10:30:00', '2026-10-20 11:00:00', 0, 1),
(3, 1, '2026-10-20', '11:00:00', '11:30:00', '2026-10-20 11:00:00', '2026-10-20 11:30:00', 0, 1),
(4, 1, '2026-10-15', '09:00:00', '09:30:00', '2026-10-15 09:00:00', '2026-10-15 09:30:00', 1, 1), -- Past completed slot

-- Slots for Dr. Sarah Jenkins (Teacher 2)
(5, 2, '2026-10-21', '14:00:00', '14:30:00', '2026-10-21 14:00:00', '2026-10-21 14:30:00', 0, 1),
(6, 2, '2026-10-21', '14:30:00', '15:00:00', '2026-10-21 14:30:00', '2026-10-21 15:00:00', 0, 1);

-- -----------------------------------------------------------------------------
-- 8. Seed Appointments
-- -----------------------------------------------------------------------------
INSERT INTO appointments (id, student_id, teacher_id, slot_id, title, purpose, status) VALUES
-- Active approved booking: Alice with Dr. Miller
(1, 1, 1, 1, 'Final Year Project Consultation', 'Discussion on database replication strategies and indexing schema.', 'APPROVED'),

-- Past completed booking: David with Dr. Miller
(2, 2, 1, 4, 'Lab Assignment 2 Clarification', 'Review questions regarding transaction isolation levels and B-tree indexing.', 'COMPLETED');

-- -----------------------------------------------------------------------------
-- 9. Seed Appointment Status History
-- -----------------------------------------------------------------------------
INSERT INTO appointment_status_history (id, appointment_id, previous_status, new_status, changed_by, notes) VALUES
(1, 1, NULL, 'PENDING', 6, 'Appointment requested by student Alice Carter'),
(2, 1, 'PENDING', 'APPROVED', 2, 'Request accepted by Dr. Robert Miller. Confirmed for Engineering Bldg Room 402.'),
(3, 2, NULL, 'PENDING', 7, 'Appointment requested by student David Kim'),
(4, 2, 'PENDING', 'APPROVED', 2, 'Approved by Dr. Miller'),
(5, 2, 'APPROVED', 'COMPLETED', 2, 'Consultation successfully held.');

-- -----------------------------------------------------------------------------
-- 10. Seed Consultation Notes
-- -----------------------------------------------------------------------------
INSERT INTO appointment_notes (id, appointment_id, author_id, note) VALUES
(1, 1, 2, 'Please bring your drafted entity relationship diagrams and sample query workloads.'),
(2, 2, 2, 'David demonstrated solid grasp of 2PL concurrency controls. Advised him to review WAL logs.');

-- -----------------------------------------------------------------------------
-- 11. Seed Feedback & Ratings
-- -----------------------------------------------------------------------------
INSERT INTO feedback_ratings (id, appointment_id, student_id, teacher_id, rating, comments) VALUES
(1, 2, 2, 1, 5, 'Dr. Miller explained the transaction isolation nuances clearly with diagrammatic examples. Highly recommended.');

-- -----------------------------------------------------------------------------
-- 12. Seed Notifications
-- -----------------------------------------------------------------------------
INSERT INTO notifications (id, recipient_id, appointment_id, title, message, type, is_read) VALUES
(1, 6, 1, 'Appointment Approved', 'Dr. Robert Miller approved your consultation for Oct 20, 2026 at 10:00 AM in Room 402.', 'STATUS_UPDATE', 0),
(2, 2, 1, 'New Consultation Booked', 'Alice Carter booked an appointment with you for Oct 20, 2026.', 'BOOKING_REQUEST', 1);

-- -----------------------------------------------------------------------------
-- 13. Seed Administrative Audit Logs
-- -----------------------------------------------------------------------------
INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, details, ip_address) VALUES
(1, 1, 'VERIFY_TEACHER', 'TEACHER_PROFILE', '1', '{"verifiedBy": "Admin", "reason": "Academic credentials verified with university registrar"}', '127.0.0.1'),
(2, 1, 'VERIFY_TEACHER', 'TEACHER_PROFILE', '2', '{"verifiedBy": "Admin", "reason": "Credentials confirmed"}', '127.0.0.1');
