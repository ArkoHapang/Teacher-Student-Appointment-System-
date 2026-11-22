# Architectural Decision Records (ADRs)

## Project: Teacher–Student Appointment System
* **Document Version:** 1.0.0
* **Date:** October 2026

This document records the foundational architectural decisions made for the system, their evaluated alternatives, technical rationale, and downstream consequences.

---

## ADR-001: Utilization of Node.js Native SQLite (`node:sqlite`)

* **Status:** Accepted & Implemented
* **Date:** October 2026

### Context
The application requires a robust relational database with ACID transaction semantics, foreign key cascading, and complex multi-table joins (users, roles, departments, appointments, slots, audit logs).

### Alternatives Considered
1. **External Database Server (PostgreSQL / MySQL)**: Highly scalable for distributed environments, but introduces external infrastructure requirements, connection pool tuning, and local development setup complexity.
2. **Third-Party Compiled SQLite Driver (`sqlite3` / `better-sqlite3`)**: Good local performance, but relies on `node-gyp` and native C++ build toolchains (Python, Visual Studio build tools) that frequently fail across varied developer environments or lightweight Alpine Linux containers.
3. **Native Node.js SQLite (`node:sqlite`)**: Built directly into Node.js 22+ core runtime.

### Decision
Adopt Node.js 22+ built-in `node:sqlite` as the primary database engine with fallback handling for standard drivers.

### Rationale & Consequences
* **Zero C++ Build Friction**: Eliminates native compilation dependencies and container build failures.
* **Extreme Low Latency**: In-process synchronous/asynchronous SQLite execution provides 1–3ms query round-trip times.
* **Single-File Simplicity**: Backups and local setup require simply handling `database/appointment_system.db`.
* **Consequence**: Constrains concurrent writes to a single thread; mandates single-instance container deployment in production (e.g. Fly.io `min_machines_running = 1`).

---

## ADR-002: Bespoke Vanilla CSS Design System with CSS Tokens

* **Status:** Accepted & Implemented
* **Date:** October 2026

### Context
The frontend user interface requires high academic clarity, dense tabular data presentations, fast initial load times, and reliable dark/light theme switching across varied device viewports.

### Alternatives Considered
1. **TailwindCSS**: Rapid utility authoring, but introduces extensive class string churn in JSX, build-time purging dependencies, and potential inconsistency in design token semantics.
2. **Component Libraries (MUI / Ant Design / Chakra UI)**: Rich pre-built components, but introduces large runtime JavaScript bundles (often > 500kB), rigid opinionated styling overrides, and accessibility quirks.
3. **Vanilla CSS with Design Tokens (`frontend/src/styles/tokens.css`)**: Pure CSS custom properties controlling colors, spacing, typography scales, and shadows.

### Decision
Implement a bespoke Vanilla CSS design system using native CSS variables, paired with modular per-component stylesheets (`Button.css`, `Table.css`, `Dialog.css`).

### Rationale & Consequences
* **Lightweight Bundle**: Entire compiled production CSS is only ~26 kB (5.2 kB gzipped).
* **Instant Theming**: Light and dark themes switch dynamically by updating `data-theme` attribute on document root, without component re-renders.
* **Total Control**: Zero CSS framework overrides; full control over accessibility focus rings and table layouts.

---

## ADR-003: Server-Side Cryptographic Token Revocation (`revoked_tokens`)

* **Status:** Accepted & Implemented
* **Date:** October 2026

### Context
Standard JSON Web Tokens (JWT) are stateless. When a user logs out, the token remains cryptographically valid until its expiration time (`exp`) has elapsed, creating a session hijacking window.

### Alternatives Considered
1. **Stateless JWT with Short TTL**: Rely exclusively on token expiration (e.g. 15 minutes). Fails to provide immediate invalidation when an admin suspends a compromised account.
2. **Redis Centralized Blacklist**: Fast key expiration, but introduces an external in-memory data store dependency.
3. **Relational Database Token Revocation Store (`revoked_tokens`)**: Persist revoked token UUID identifiers (`jti`) with expiration timestamps in SQLite.

### Decision
Include a unique UUID v4 `jti` claim in every issued JWT. On logout, insert `jti`, `user_id`, and `expires_at` into the `revoked_tokens` table. Enforce verification in `authMiddleware.js`.

### Rationale & Consequences
* **Immediate Revocation**: Logout instantly invalidates the session across all API endpoints.
* **Zero New Infrastructure**: Uses existing SQLite database.
* **Self-Pruning Capability**: Revoked tokens whose `expires_at` has elapsed can be pruned via routine background maintenance without affecting active sessions.

---

## ADR-004: Storage-Layer Double-Booking Elimination via Composite Unique Constraints

* **Status:** Accepted & Implemented
* **Date:** October 2026

### Context
Consultation booking platforms are prone to race conditions: if two students submit booking requests for the same slot at the exact same millisecond, standard application-level `SELECT` checks may see the slot as open for both requests, resulting in double-booking.

### Alternatives Considered
1. **Application-Level Mutex / Lock**: In-memory locking or semaphores. Fails if requests are distributed or server restarts.
2. **Optimistic Locking with Version Counter**: Requires repeated retry loops.
3. **Database Unconditional Unique Constraint (`UNIQUE(slot_id)`)**: Enforced at the relational engine level.

### Decision
Declare `UNIQUE(slot_id)` on the `appointments` table and wrap booking workflows in explicit SQLite database transactions (`BEGIN IMMEDIATE`).

### Rationale & Consequences
* **Mathematical Invariant**: Double-booking is physically impossible at the storage layer. The second concurrent transaction receives a unique constraint violation from SQLite.
* **Deterministic Error Handling**: The application catches the SQLite constraint violation and returns a standard HTTP `409 Conflict` (`code: 'SLOT_ALREADY_BOOKED'`).

---

## ADR-005: Multi-Stage Production Container with Embedded Static Assets

* **Status:** Accepted & Implemented
* **Date:** October 2026

### Context
Deploying decoupled frontend and backend applications typically requires hosting two separate cloud services (e.g. Vercel for frontend + Railway for backend), introducing cross-origin CORS latency, multiple DNS configurations, and coordination overhead.

### Alternatives Considered
1. **Separate Frontend & Backend Deployments**: Good for large teams, but introduces CORS complexity and multi-service management.
2. **Unified Multi-Stage Docker Container**: Node 22 Alpine container compiling Vite frontend assets in Stage 1 and serving them via Express static middleware in Stage 2.

### Decision
Adopt a single multi-stage [Dockerfile](file:///d:/T-S%20appoinment%20system/Dockerfile) serving both the API (`/api/v1/*`) and the SPA static distribution (`frontend/dist`) from the same origin on port 5000.

### Rationale & Consequences
* **Zero CORS Overhead**: Frontend and API share the exact same host and protocol in production.
* **Single Deployment Target**: One Docker container deployed to Fly.io or Render manages the entire application lifecycle.
* **Non-Root Execution**: Container runs securely as non-root user `node`.
