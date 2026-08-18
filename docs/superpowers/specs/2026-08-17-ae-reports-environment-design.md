# AE Reports — Environment & Architecture Design

**Date:** 2026-08-17
**Status:** Approved
**Scope:** Build environment, application skeleton, and the architectural constraints all later work must respect.

---

## 1. What the system is

**AE Reports** is a medical device vigilance system for the **Tanzania Medicines and Medical
Devices Authority (TMDA)**. It receives adverse event reports about medical devices and IVDs,
routes them through a two-assessor review, and records a regulatory decision.

The surviving source of truth for scope is the prototype at `ae-reports_3.html` in the repository
root. It encodes the workflow, the four staff roles, the F004 assessment form, and the bilingual
requirement. Where this spec and the prototype disagree, this spec wins; where this spec is
silent, the prototype is the reference.

### 1.1 The two audiences

**Public "orange form"** — `TMDA/DMD/MDV/F/001 Rev 06`. Anonymous, no login. Used by hospitals,
pharmacies, diagnostic centres and consumers. A multi-step wizard that saves as you type, accepts
file attachments, issues a report number (`MD-AE/2026/0185`), and confirms by SMS and email.

**Staff portal** — authenticated. Four roles: Manager, Assessor, Second Assessor, Administrator.
Each role has its own navigation and its own view of the same reports.

### 1.2 The assessment cascade

This workflow is the reason the system exists. Every design decision below serves it.

```
report received (online form / email / paper)  →  number auto-generated
  → system auto-assigns the 1st assessor from those marked Available
  → 1st assessment on form F004 (19 items, pre-filled from the orange form)
  → manager assigns a 2nd, different assessor
  → 2nd assessor reviews the F004 item by item marking agree/differ, writes §7.2
  → manager sees both conclusions side by side, records the decision
  → closed
```

The manager sees every report, every worker and every workload at all times, and may move a
report from one assessor to another at any stage.

### 1.3 Cross-cutting requirements

- **Bilingual English / Swahili** throughout, from day one — not retrofitted.
- **Audit trail**, exportable. This is a regulatory obligation, not a convenience feature.
- **Attachments** on reports, and printable/saveable F004 output.
- **Assessor availability and workload** tracking; assessors on leave are skipped by
  auto-assignment.

---

## 2. Locked decisions

These were decided by the user across design sessions and are **not open for re-litigation**.

| Layer | Choice |
|---|---|
| Runtime | Node (>= 22; v24 LTS in use) + pnpm + TypeScript strict |
| Server | Fastify |
| HTML | `@kitajs/html` — server-rendered TSX, compiled to string concatenation |
| Client JS | **Zero client React.** htmx + small vanilla scripts |
| Data | Drizzle + PostgreSQL |
| Jobs | pg-boss, on the same PostgreSQL |
| Auth | Database sessions + opaque `__Host-` httpOnly cookies. No JWT |
| Storage | S3-compatible (MinIO in production) behind an interface |
| i18n | `en` + `sw` from day one |
| PDF | Headless Chromium rendering the same HTML the browser prints |
| Deploy | Docker Compose (app + Postgres + MinIO + Caddy) on a self-managed VPS |

**Structure:** one application, two strictly separated doors — the public Orange Form and the
staff portal — on **different hostnames** with separate route trees.

### 2.1 Rejected alternatives

Recorded so they are not revisited: Next.js full-stack, NestJS + separate frontends, Remix /
React Router v7, client-side React of any kind, on-premise deployment, managed cloud
(AWS/Azure/GCP), Prisma, Kysely, Alpine.js, preact-render-to-string.

---

## 3. Repository layout

```
src/
├─ server.ts          composition root — builds Fastify, mounts both doors
├─ config.ts          env parsed through Zod at boot; invalid config = crash before listen
├─ doors/
│  ├─ public/         orange form host — routes/, views/
│  └─ staff/          staff portal host — routes/, views/
├─ domain/            framework-free: reports/, assessment/, assignment/, audit/
├─ db/                schema/, migrations/, client.ts
├─ platform/          adapters: storage, sms, email, pdf, clock
├─ views/shared/      layout, TSX primitives, i18n
└─ jobs/              pg-boss handlers
public/               htmx, css, fonts — self-hosted
```

### 3.1 The `domain/` rule

`domain/` imports nothing from Fastify and nothing from `db/`. Report numbering, the report
status state machine, and assessor selection are pure functions, testable without a server or a
database.

This is the boundary that keeps the cascade comprehensible as the assignment and assessment rules
grow. It is the single most important structural constraint in this document.

### 3.2 Self-hosted assets

The prototype loads IBM Plex from Google Fonts. Production self-hosts every font and asset. A
government vigilance portal must not leak reporter traffic to a third-party CDN.

---

## 4. The two doors

Two encapsulated Fastify plugin trees, selected by hostname. Encapsulation is the mechanism: a
public route has no access to the staff door's authentication decorators, so "forgot to check the
session" is not an available mistake.

| | Public door | Staff door |
|---|---|---|
| Session | none | required on every route except login |
| Rate limit | aggressive — unauthenticated and abusable | normal |
| CSP | no inline script | no inline script |
| Uploads | size and MIME capped, scan hook | size and MIME capped, scan hook |

### 4.1 Why different hostnames is a real boundary

The session cookie uses the **`__Host-` prefix**, which forces `Secure`, forces `Path=/`, and
forbids a `Domain` attribute. Without a `Domain` attribute the cookie is host-locked: it is
structurally incapable of being sent to the public hostname.

That is what upgrades "different hostnames" from cosmetic separation to an enforced one.

### 4.2 Session rules

- Opaque random token, stored hashed in the `sessions` table.
- Rotated on any privilege change and on login.
- Both an idle timeout and an absolute timeout.
- Forced password change on first sign-in — the administrator's starting password stops working
  once the user sets their own.

---

## 5. Data model

### 5.1 Versioned JSONB for submitted documents

The orange form is at `Rev 06` and will become `Rev 07`. F004 will evolve too. Submitted answers
are therefore stored as **versioned JSONB** — a `form_version` column plus a `payload` column —
alongside **normalized columns for everything actually queried**: report number, status, severity,
device name, facility, received date, assigned assessors.

Rationale:

- A report filed under Rev 06 must still render and print exactly as submitted, years later. It
  is evidence.
- Forcing a migration for every added or removed field across every historical row is the more
  expensive and riskier path in a regulated audit context.
- The fields we filter, sort and assign on stay in real indexed columns, so queries stay ordinary
  SQL.

**Required discipline:** the payload is an immutable document snapshot. Business logic must never
run ad-hoc SQL against JSONB fields. Anything a business rule depends on belongs in a normalized
column.

### 5.2 Core tables

| Table | Purpose |
|---|---|
| `reports` | number, channel, severity, status, received_at, form_version, payload |
| `assessments` | report_id, assessor_id, ordinal (1 or 2), form_version, payload, conclusion, submitted_at |
| `users` | staff accounts, role, active flag |
| `sessions` | hashed opaque token, user_id, issued_at, last_seen_at, expires_at |
| `assessor_availability` | available / on leave, with an until date |
| `attachments` | report_id, object key, filename, MIME type, size, checksum |
| `audit_log` | append-only: actor, action, entity, before, after, at |

### 5.3 The audit log is append-only at the database level

`UPDATE` and `DELETE` on `audit_log` are **revoked from the application's database role**, not
merely avoided in application code. An append-only trail that the application merely *promises*
not to modify is not an append-only trail.

---

## 6. Environments

### 6.1 Local development on Windows

The development machine has **no Docker and no WSL**, but does have **PostgreSQL 18 installed
natively and running**. Local development therefore does not use containers:

| Concern | Production | Local |
|---|---|---|
| Database | Postgres in compose | native Postgres 18 |
| Object storage | MinIO | filesystem storage adapter |
| Email | SMTP | console/log adapter |
| SMS | Tanzanian aggregator | console/log adapter |

This works only because storage, email and SMS sit behind interfaces. That was the point of the
interfaces, and local development is their first real consumer.

### 6.2 Production

Docker Compose: app, Postgres, MinIO, and Caddy terminating TLS for both hostnames, on a
self-managed VPS.

### 6.3 Configuration

`src/config.ts` parses `process.env` through Zod at boot. Invalid or missing configuration
crashes the process **before it listens** — never at the first request that happens to need it.
`.env.example` is committed; `.env` never is.

---

## 7. Testing

- **Vitest** throughout.
- **Domain logic** unit-tested with no database: numbering, status transitions, assessor
  selection.
- **Route tests** via `fastify.inject()` — no network, no port binding.
- **Integration tests** against a real PostgreSQL with migrations applied fresh.
- **One end-to-end path**, because it is the system's reason for existing:

  > submit orange form → auto-assign → 1st F004 → manager assigns 2nd → 2nd F004 + §7.2 →
  > manager decision → closed

---

## 8. Scaffolding scope

The approved first slice, in order:

1. pnpm project + TypeScript strict + Biome + Vitest
2. Fastify composition root + the two hostname-scoped doors
3. Drizzle schema — `reports`, `assessments`, `users`, `sessions`, `assessor_availability`,
   `attachments`, `audit_log`
4. Public door skeleton rendering a static TSX page
5. Compose definition for Postgres + MinIO + MailHog (written as the production definition; not
   runnable on the current development machine)

Once these exist, the orange form wizard and report-number generation follow.

### 8.1 Explicitly out of scope for this slice

The F004 form itself, the assessment cascade logic, authentication flows, i18n message
extraction, PDF generation, and the SMS and email adapters beyond their interfaces and console
implementations.
