# CSPC Equipment Borrowing System

A Node.js and Express app for browsing college equipment, submitting borrowing requests, handling releases and returns, and viewing department-level asset activity.

## Database setup

- For the existing `equipment_borrowing_system` database with `users`, `equipment`, and `borrow_requests`, back it up, select that database, and run `migrations/004_match_existing_legacy_tables.sql` once, followed by `migrations/002_departments_and_sample_equipment.sql`.
- To enable department-scoped administrators on that installation, run `migrations/005_department_admin_role.sql` once after migrations 004 and 002.
- For timed borrowing schedules, overlap-aware stock checks, return-for-correction, and notifications, run `migrations/006_request_workflows_and_notifications.sql` once after the tables and department setup are in place.
- `migrations/001_departments_and_workflows.sql` targets a different older schema variant; do not run it on the legacy database handled by migration 004. This repository does not include a base `schema.sql`; create the core tables using your existing database setup before applying the matching migrations.
- Configure `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `SESSION_SECRET`, and `PORT` in the environment. The default database name is `equipment_borrowing_system`.

The seven departments are CAS, CCS, CEA, CHS, CTDE, CTHBM, and Graduate School (GS). Each department starts with ten department-focused borrowable equipment types, with two units of each available. Students select their department during registration; staff accounts are provisioned by a system administrator. Custodians manage requests and inventory for their department. Deans have read-only utilization dashboards and scoped asset reports. The existing approve-and-release and return flow is retained.

The app seeds its configured demo accounts at startup; change or remove those accounts before production deployment. System administrators can provision a Department Admin for a specific department. Department Admin accounts manage that department's equipment and borrowing requests and can preview/download department-scoped reports; System Admin accounts retain system-wide access.

## Features

- Department-scoped inventory and borrowing requests; system administrators can manage cross-college departments, accounts, and audit activity.
- Custodians can approve/release, reject, and record returned, damaged, or lost equipment.
- Borrow requests include start and return times. Requests reserve stock only for overlapping schedules, and submission checks capacity inside a transaction to prevent simultaneous overbooking.
- Authorized staff can return a request for correction with a reason; borrowers can update and resubmit it.
- Notifications show request updates and due-date reminders. Due reminders are generated once when the borrower opens the dashboard or notifications page.
- Dean dashboards summarize inventory, active borrowing, maintenance, overdue returns, popular equipment, and peak periods.
- Asset reports include current loans, overdue items, borrowing history, utilization, and equipment condition, with CSV download.
