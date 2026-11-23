# Frontend Design System & UI Specifications

## Project: Teacher–Student Appointment System
* **Document Version:** 1.0.0
* **Date:** October 2026

---

## 1. Design Philosophy & Guidelines

The Teacher–Student Appointment System frontend is built upon a bespoke Vanilla CSS design system. It eschews generic CSS frameworks in favor of structured design tokens, explicit component interfaces, and semantic HTML5 elements.

### Core Principles
1. **Academic Clarity & Hierarchy**: Dense information layouts (calendars, tabular schedules, audit trails) prioritize scannability and legibility over decorative excess.
2. **Zero Layout Shift & Deterministic States**: Every interactive element explicitly accounts for loading, empty, error, and unauthorized states.
3. **Accessibility First**: Native focus rings, high-contrast WCAG 2.1 AA text ratios, ARIA landmarks, and keyboard-trapped modal dialogs.
4. **Theme Flexibility**: First-class support for Light and Dark themes implemented entirely via CSS custom properties.

---

## 2. Design Tokens Catalog (`frontend/src/styles/tokens.css`)

All colors, typographic scales, spacing units, and elevations are defined as CSS variables under `:root` and `[data-theme="dark"]`.

### 2.1 Color Palette

| Token Category | Variable Name | Light Mode Value | Dark Mode Value | Usage |
| :--- | :--- | :--- | :--- | :--- |
| **Primary Brand** | `--color-primary-500` | `#6366F1` (Indigo) | `#818CF8` | Active states, primary CTA buttons |
| | `--color-primary-600` | `#4F46E5` | `#6366F1` | Brand accents, header borders |
| | `--color-primary-700` | `#4338CA` | `#4F46E5` | Hover states |
| **Success / Active**| `--color-success-700` | `#047857` (Emerald) | `#34D399` | Approved appointments, active users |
| | `--color-success-50` | `#ECFDF5` | `#064E3B` | Success alert backgrounds, badge fills |
| **Warning / Pending**| `--color-warning-700` | `#B45309` (Amber) | `#FBBF24` | Pending requests, rescheduling |
| | `--color-warning-50` | `#FFFBEB` | `#78350F` | Pending badge fills |
| **Danger / Rejected**| `--color-danger-700` | `#B91C1C` (Crimson) | `#F87171` | Suspended users, cancellations |
| | `--color-danger-50` | `#FEF2F2` | `#7F1D1D` | Error alerts, danger badges |
| **Neutral Surfaces** | `--color-bg-app` | `#F8FAFC` (Slate 50) | `#0F172A` (Slate 900) | Root application background |
| | `--color-bg-surface` | `#FFFFFF` | `#1E293B` (Slate 800) | Card and table surfaces |
| | `--color-border` | `#E2E8F0` | `#334155` | Table and card borders |
| **Typography** | `--color-text-main` | `#0F172A` | `#F8FAFC` | Primary headings, body copy |
| | `--color-text-muted` | `#64748B` | `#94A3B8` | Subtitles, metadata, timestamps |

### 2.2 Typography Scale

The application uses modern system font stacks (`system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`):

| Token | Size | Line Height | Weight | Typical Element |
| :--- | :--- | :--- | :--- | :--- |
| `--font-size-xs` | `0.75rem` (12px) | `1rem` | 500 / 600 | Badges, timestamps, micro-copy |
| `--font-size-sm` | `0.875rem` (14px) | `1.25rem` | 400 / 500 | Table cells, form labels, inputs |
| `--font-size-md` | `1rem` (16px) | `1.5rem` | 400 / 600 | Body prose, button labels |
| `--font-size-lg` | `1.125rem` (18px) | `1.75rem` | 600 | Card titles, section headers |
| `--font-size-xl` | `1.25rem` (20px) | `1.75rem` | 700 | Modal titles |
| `--font-size-2xl` | `1.5rem` (24px) | `2rem` | 700 | Primary page titles (`<h1>`) |

### 2.3 Spacing, Radii & Shadows
* **Spacing Scale**: Multiples of 4px (`--space-1`: 4px, `--space-2`: 8px, `--space-3`: 12px, `--space-4`: 16px, `--space-6`: 24px, `--space-8`: 32px).
* **Border Radii**: `--radius-sm`: 4px (inputs, badges), `--radius-md`: 6px (buttons, cards), `--radius-lg`: 8px (dialogs, tables).
* **Elevation**: `--shadow-sm` (subtle border shadow), `--shadow-md` (dropdowns, cards), `--shadow-lg` (modal overlays).

---

## 3. Application Layout & Navigation Structure

```text
+--------------------------------------------------------------------------+
|  HEADER (Brand Mark, App Title, Role Badge, User Info, Theme, Log Out)    |
+--------------------------------------------------------------------------+
|  ROLE NAV (Desktop Sidebar / Horizontal Pills depending on breakpoint)  |
|  - Items: Calendar, Slots, Directory, Users, Audit, System Status        |
+--------------------------------------------------------------------------+
|  CONTENT WRAPPER (<main className="content-wrapper">)                   |
|                                                                          |
|  Page Header (Title, Subtitle, Primary CTA Action)                       |
|  Metrics Cards Grid (Total, Active, Pending, Suspended)                 |
|  Filter Bar (Search Input, Role Select, Status Select, Reset Action)     |
|  Table Container (Columns, Empty State, Pagination Controls)             |
|                                                                          |
+--------------------------------------------------------------------------+
```

### 3.1 Role-Based Navigation Configurations (`Navigation.tsx`)

Navigation items are declared declaratively in `ROLE_NAVIGATION_CONFIGS`:

1. **Student Portal (`STUDENT`)**:
   * `student-appointments`: My Appointments (`#appointments`)
   * `student-teachers`: Faculty Directory (`#teachers`)
   * `student-notifications`: Notifications (`#notifications`)
   * `student-profile`: Student Profile (`#profile`)
2. **Faculty Portal (`TEACHER`)**:
   * `teacher-pending`: Appointment Requests (`#teacher-requests`)
   * `teacher-schedule`: Confirmed Schedule (`#teacher-schedule`)
   * `teacher-availability`: Office Hours & Slots (`#teacher-availability`)
   * `teacher-notifications`: Notifications (`#teacher-notifications`)
   * `teacher-profile`: Faculty Profile (`#teacher-profile`)
3. **Administration (`ADMIN`)**:
   * `admin-appointments`: Appointment Monitor (`#admin-appointments`)
   * `admin-teachers`: Teacher Management (`#admin-teachers`)
   * `admin-users`: User Accounts (`#admin-users`)
   * `admin-audit`: Audit Logs (`#admin-audit`)
   * `admin-health`: System Status (`#admin-health`)

---

## 4. Reusable Component Catalog

All components reside in `frontend/src/components/` and are built as pure TypeScript React components paired with dedicated CSS files:

| Component | Path | Key Props | Description |
| :--- | :--- | :--- | :--- |
| **`Button`** | `Button/Button.tsx` | `variant` (`primary`, `secondary`, `danger`, `outline`, `ghost`), `size` (`sm`, `md`, `lg`), `isLoading` | Accessible button with keyboard focus states and loading spinners. |
| **`Table`** | `Table/Table.tsx` | `columns`, `data`, `keyExtractor`, `emptyMessage`, `pagination`, `onPageChange` | Generically typed data table with pagination and sticky headers. |
| **`Badge`** | `Badge/Badge.tsx` | `variant` (`active`, `pending`, `suspended`, `info`) | Status indicator pill with WCAG-compliant color pairings. |
| **`UserStatusBadge`**| `Badge/Badge.tsx` | `status` (`ACTIVE`, `INACTIVE`, `SUSPENDED`, `PENDING_APPROVAL`) | Specialized badge mapping user lifecycle states to design tokens. |
| **`Alert`** | `Alert/Alert.tsx` | `variant` (`success`, `warning`, `error`, `info`), `onDismiss` | Dismissible banner alert for action notifications. |
| **`Dialog`** | `Dialog/Dialog.tsx` | `isOpen`, `onClose`, `title`, `description` | Accessible modal dialog with backdrop blur, Escape key dismissal, and backdrop click handling. |
| **`Feedback`** | `Feedback/Feedback.tsx`| `LoadingState`, `ErrorState`, `EmptyState` | Standardized asynchronous state placeholders with retry callbacks. |
| **`Form`** | `Form/Form.tsx` | `FormField`, `TextInput`, `Select`, `TextArea` | Accessible form primitives with linked labels and error validation messages. |
| **`Icons`** | `Icons/Icons.tsx` | `CalendarIcon`, `ClockIcon`, `UserIcon`, `UsersIcon`, `ShieldIcon`, `ActivityIcon`, etc. | Zero-dependency inline SVG icons with customizable `size`. |

---

## 5. Responsive Behavior & Breakpoints

* **Desktop (`>= 1024px`)**: Fixed header, horizontal navigation bar, multi-column metric cards, full tabular views.
* **Tablet (`768px - 1023px`)**: Grid layouts collapse to 2 columns; table containers support horizontal overflow scrolling.
* **Mobile (`< 768px`)**:
  * Desktop navigation is hidden.
  * Header displays hamburger menu button triggering `<MobileNav />` drawer.
  * Drawer slides in from left with full role navigation and backdrop dismiss.
  * Action buttons inside tables stack or utilize compact sizes (`size="sm"`).

---

## 6. Accessibility & Usability Standards

* **Keyboard Navigation**: All interactive elements (`<button>`, `<a>`, `<input>`, `<select>`) possess explicit `:focus-visible` outlines using `--color-primary-500`.
* **Screen Reader Landmarks**: Semantic `<header>`, `<nav>`, `<main>`, and `<caption>` elements are implemented throughout.
* **Color Contrast**: All badge text and background combinations achieve >= 4.5:1 contrast ratio against their respective surface backgrounds.
