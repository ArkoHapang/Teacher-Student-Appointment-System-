# Frontend Client: Teacher–Student Appointment System

## Overview
This directory contains the user-facing web application for the university **Teacher–Student Appointment System**. Built with **React 18**, **TypeScript**, and **Vite**, it delivers a responsive, zero-framework Single Page Application (SPA) powered by a custom Vanilla CSS design token system.

---

## Directory Layout

```text
frontend/
├── src/
│   ├── components/          # Reusable UI component library
│   │   ├── Alert/           # Dismissible alerts (success, error, warning, info)
│   │   ├── Badge/           # Status badges and UserStatusBadge
│   │   ├── Button/          # Primary, secondary, danger, outline, ghost buttons
│   │   ├── Dialog/          # Accessible modal dialogs with backdrop blur
│   │   ├── Feedback/        # LoadingState, ErrorState, EmptyState placeholders
│   │   ├── Form/            # FormField, TextInput, Select, TextArea primitives
│   │   ├── Icons/           # Lightweight SVG icon collection
│   │   ├── Navigation/      # Header, RoleNav, and MobileNav drawer
│   │   └── Table/           # Paginated generic data table with empty states
│   ├── services/            # API communication services
│   │   ├── apiClient.ts     # Centralized fetch wrapper with Bearer token & 401 interception
│   │   ├── authService.ts   # Login, logout, session persistence (localStorage)
│   │   ├── studentService.ts# Teacher discovery, slot booking, appointment cancel
│   │   ├── teacherService.ts# Slot management, request approve/reject, completion
│   │   └── adminService.ts  # Global monitoring, teachers, users, audit, diagnostics
│   ├── styles/              # Design tokens and global CSS
│   │   ├── tokens.css       # Color palettes, typography, spacing, shadows, themes
│   │   ├── reset.css        # Box-sizing, margin resets, baseline elements
│   │   └── global.css       # Surface cards, layout containers, responsive grids
│   ├── types/               # TypeScript type definitions and interfaces
│   │   ├── admin.ts         # Admin user records, audit logs, system diagnostics
│   │   ├── designSystem.ts  # UserRole, UserStatus, AppointmentStatus, NavItem
│   │   ├── student.ts       # Student bookings, profiles, teachers list
│   │   └── teacher.ts       # Availability slots, schedule entries, courses
│   ├── views/               # Role-based page views
│   │   ├── admin/           # Admin views: Appointments, Teachers, Users, Audit, Health
│   │   ├── student/         # Student views: Appointments, Directory, Notifications, Profile
│   │   ├── teacher/         # Teacher views: Requests, Schedule, Availability, Profile
│   │   └── login/           # Role-specific login screens
│   ├── App.tsx              # Root router, role switcher, and session manager
│   └── main.tsx             # Application bootstrap mount point
├── test-admin-integration.cjs # 14-workflow API integration test suite
├── index.html               # SPA HTML entry point
├── package.json             # Frontend dependencies and npm scripts
├── tsconfig.json            # TypeScript compiler configuration
└── vite.config.ts           # Vite dev server and proxy configuration
```

---

## Role-Based View Architecture

The frontend dynamically mounts navigation and views based on the authenticated user's `role`:

### 1. Student Portal (`STUDENT`)
* **My Appointments (`student-appointments`)**: Active and past consultation bookings with status badges and cancellation actions.
* **Faculty Directory (`student-teachers`)**: Searchable list of verified professors filterable by department, featuring booking modals.
* **Notifications (`student-notifications`)**: Alert feed for booking confirmations and updates.
* **Student Profile (`student-profile`)**: Academic identity, student ID number, department, and batch.

### 2. Faculty / Teacher Portal (`TEACHER`)
* **Appointment Requests (`teacher-pending`)**: Pending student consultation requests with one-click **Approve** (with notes) or **Reject** (with reason).
* **Confirmed Schedule (`teacher-schedule`)**: Daily/weekly schedule of upcoming confirmed consultations with meeting closeout (`Complete`).
* **Office Hours & Slots (`teacher-availability`)**: Interactive slot management with collision detection and toggle active/inactive status.
* **Notifications (`teacher-notifications`)**: Faculty alerts for new student consultation requests.
* **Faculty Profile (`teacher-profile`)**: Designation, office room, department, bio, and courses taught.

### 3. Administrative Control Center (`ADMIN`)
* **Appointment Monitor (`admin-appointments`)**: University-wide consultation monitor with multi-attribute filtering and status history timeline modal.
* **Teacher Management (`admin-teachers`)**: Faculty onboarding, verification badges, office room assignments, and account status controls.
* **User Accounts (`admin-users`)**: Comprehensive user directory across all roles with search, status filters, and **Activate / Suspend** actions.
* **Audit Logs (`admin-audit`)**: Immutable administrative audit ledger with JSON detail parsing, actor tracking, and entity filters.
* **System Status (`admin-health`)**: Live platform diagnostics displaying SQLite ping latency, migration synchronization status, server uptime, and process memory utilization.

---

## Design System & Theming

* **Zero Framework Bloat**: Pure Vanilla CSS using custom properties defined in [tokens.css](file:///d:/T-S%20appoinment%20system/frontend/src/styles/tokens.css).
* **Dynamic Theme Switcher**: Toggle between Light and Dark themes via the Header control. The application sets `data-theme="dark"` on `document.documentElement` to transition all token values instantly.
* **Accessible Focus Indicators**: Explicit `:focus-visible` outlines ensuring full keyboard accessibility across all interactive elements.

---

## API Client & Session Management

All backend communication flows through [apiClient.ts](file:///d:/T-S%20appoinment%20system/frontend/src/services/apiClient.ts):
* Automatically injects `Authorization: Bearer <token>` from `localStorage`.
* Standardizes JSON response handling and unwraps `{ success, data, error }` envelopes.
* **Session Expiry & 401 Interception**: When a `401 Unauthorized` response is detected (token expired or revoked), `apiClient` wipes the stored token and triggers `unauthorizedListener`, returning the user to the login screen cleanly.

---

## Development & Build Commands

Run commands from the `frontend/` directory (or use root shortcuts):

```bash
# Start Vite development server (Port 3000 with API proxy to port 5000)
npm run dev

# Run static TypeScript type check (tsc --noEmit)
npm run typecheck

# Build optimized production bundle to dist/
npm run build

# Preview production build locally
npm run preview

# Run frontend API integration test suite
npm test
```

---

## Verified Quality Evidence

* **TypeScript Typecheck**: `tsc --noEmit` exits with code 0 (zero compiler errors).
* **Production Build**: `vite build` bundles 68 modules into 327 kB JS (83 kB gzipped) and 26 kB CSS (5.2 kB gzipped) in ~1.27s.
* **API Integration Tests**: 14/14 passing in `test-admin-integration.cjs`.
