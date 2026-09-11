# Register Implementation Plan

## Executive Summary

The Register feature will be a dedicated, read-only institutional record of adverse events/incidents. It will automatically populate from the existing Orange Report → Assessment → Manager Decision workflow, creating a single source of truth that represents the current state of each case.

---

## 1. Current Data Flow Analysis

### 1.1 Orange Report Creation → Received Status

**Entry Point:** `server/src/doors/public/routes/report-intake.tsx`

**Current Flow:**
```
Public User Submits Orange Report
    ↓
Validation + Intake Processing
    ↓
reports table INSERT
    ├── id (UUID)
    ├── number (e.g., MD-AE/2026/0179)
    ├── status = "received"
    ├── receivedAt = NOW()
    ├── deviceName, severity, channel, facility
    ├── payload (JSONB - immutable form snapshot)
    ├── assessor1UserId (assigned at intake)
    └── assessor1AssignedAt
    ↓
Report is now in the system
```

**Key Fields Available at Receipt:**
- Report number (auto-incremented, unique)
- Date received
- Device name, manufacturer, serial number (in payload)
- Severity level
- Facility location
- Reporter name, contact
- Form version (e.g., "TMDA/DMD/MDV/F/001 Rev 06")
- Channel (online_form, email, hard_copy)
- Full form payload (immutable JSONB)

### 1.2 Assessment Workflow

**First Assessment Flow:**
```
Assessor 1 Assigned (at intake)
    ↓
assessments table INSERT (ordinal = 1)
    ├── id (UUID)
    ├── reportId (FK to reports)
    ├── assessorId (= reports.assessor1UserId)
    ├── ordinal = 1
    ├── formVersion (e.g., "F004 Rev 03")
    ├── payload (JSONB - assessment form snapshot)
    └── submittedAt = NULL (still draft)
    ↓
Assessor 1 Completes & Submits Assessment
    ↓
assessments UPDATE
    ├── submittedAt = NOW()
    ├── conclusion (Section 7.1 text)
    └── payload = completed form
    ↓
reports UPDATE
    ├── status = "awaiting_second_assessor"
    └── assessor2_user_id + assessor2_assigned_at assigned by manager decision
```

**Second Assessment Flow (and beyond):**
```
Manager Decides → Assign Next Assessor
    ↓
reportDecisions table INSERT
    ├── kind = "assign_next_assessor"
    ├── nextAssessorUserId = new assessor
    ├── nextOrdinal = 2 (or 3, 4, ... N)
    ├── decidedByUserId
    └── decidedAt = NOW()
    ↓
reports UPDATE
    ├── assessor2UserId = nextAssessorUserId (or assessor3, etc. if architecture allows)
    ├── status = "second_assessment" (or awaiting_assessment_N)
    └── [same assessor assignment fields reused]
    ↓
assessments table INSERT (ordinal = 2)
    ├── reportId
    ├── assessorId
    ├── ordinal = 2
    └── [same as first, draft → submitted cycle]
    ↓
Manager Reviews Assessment 2, Decides Again
    ↓
assessments UPDATE (ordinal = 2)
    ├── managerComment, managerCommentBy, managerCommentAt
    ↓
reportDecisions table INSERT (for next action)
    └── [repeat cycle or move to assign_work_officer]
```

**Note:** The architecture reuses `assessor1_user_id`, `assessor2_user_id` for storing assessors, and uses the `ordinal` column in assessments to track sequence. Secondary assessments beyond the second reuse the `assessor2_user_id` column with the ordinal tracking the true sequence.

### 1.3 Manager Review & Decision

**Current Model:**
```
Manager Reviews Assessment N
    ↓
assessments UPDATE
    ├── managerComment (the verdict)
    ├── managerCommentBy (manager's ID)
    ├── managerCommentAt = NOW()
    └── [assessment remains as-is, just annotated]
    ↓
Manager Makes a Decision
    ↓
reportDecisions table INSERT
    ├── kind = "assign_next_assessor" → another assessment cycle
    └── OR kind = "assign_work_officer" → final workflow state
    ↓
reports UPDATE
    ├── If assign_next_assessor:
    │   └── status = "awaiting_second_assessor"
    │       assessor2UserId = next assessor
    │
    └── If assign_work_officer:
        ├── status = "assigned_for_work"
        └── [report handed to officer for implementation]
```

**Final Document Creation:**
```
When kind = "assign_work_officer"
    ↓
reportFinalDocuments table INSERT
    ├── reportId (unique)
    ├── decisionId (FK to the assign_work_officer decision)
    ├── approvedByUserId
    ├── approvedAt = NOW()
    ├── resolvedThroughOrdinal (e.g., 2 if A1 + A2 folded in)
    ├── formVersion (e.g., F004 Rev 05)
    └── payload (resolved answers in first assessor's vocabulary)
    ↓
This frozen snapshot is what "Final Reports" shows to the manager
```

---

## 2. Proposed Register Architecture

### 2.1 New Table: `register_entries`

The Register will be a **dedicated table** (not a view) because:
- It must be read-only to users (enforced at role level, not just presentation)
- It represents an institutional record separate from the operational workflow
- It captures the institutional status at a point in time

**Key Columns:**
```
- id (UUID, primary key)
- report_id (FK to reports, unique)
- report_number, date_received
- device_name, device_manufacturer, device_serial_number
- event_severity, event_description, event_location
- reporter_name, reporter_facility, reporter_contact
- supplier_name, supplier_contact
- assessment_causality, assessment_risk_level
- first_assessor_id, first_assessment_conclusion
- second_assessor_id, second_assessment_conclusion
- investigation_status, investigation_findings
- regulatory_action
- register_status (received → approved_and_assigned)
- created_at, updated_at
```

**Why This Approach:**
- Single record per case (one-to-one with reports)
- Automatic population through application service layer
- Read-only presentation layer enforcement (users cannot edit)
- Clear institutional record of the case state at the time of each update
- Efficient querying for reporting/searching with proper indexes

---

## 3. Integration Points

### 3.1 Report Intake (when Orange Report received)
**File:** `server/src/doors/public/routes/report-intake.tsx`
**Action:** Call `createRegisterEntry()` after `reports.insert()` succeeds

### 3.2 First Assessment Submission
**File:** `server/src/doors/staff/routes/assessment.tsx`
**Action:** Call `updateRegisterEntry()` after `assessments.update({ submittedAt = NOW() })`

### 3.3 Manager Decision (Assign Next Assessor)
**File:** `server/src/doors/staff/routes/decisions.tsx`
**Action:** Call `updateRegisterEntry()` after `reportDecisions.insert({ kind: "assign_next_assessor" })`

### 3.4 Manager Decision (Assign Work Officer / Final)
**File:** `server/src/doors/staff/routes/decisions.tsx`
**Action:** Call `updateRegisterEntry()` after `reportFinalDocuments.insert()`

---

## 4. Data Field Mapping

| Register Column | Source | Populated When |
|-----------------|--------|-----------------|
| report_number | reports.number | Orange Report received |
| date_received | reports.receivedAt | Orange Report received |
| device_name | reports.deviceName | Orange Report received |
| device_manufacturer | reports.payload | Orange Report received |
| event_severity | reports.severity | Orange Report received |
| event_description | reports.payload | Orange Report received |
| reporter_name | reports.payload | Orange Report received |
| facility | reports.facility | Orange Report received |
| assessment_causality | assessments.payload | Assessment 1 submitted |
| assessment_risk_level | assessments.payload | Assessment 1 submitted |
| first_assessment_conclusion | assessments.conclusion | Assessment 1 submitted |
| regulatory_action | reportFinalDocuments.payload | Final decision made |
| register_status | (derived from reports.status) | After each update |

---

## 5. UI/Routes Needed

### 5.1 Sidebar Navigation Addition
**File:** `server/src/doors/staff/views/shell.tsx`
- Add new icon `IconRegister()`
- Add nav entry for `/register` (managers & administrators only)
- Update `active` prop type to include `"register"`

### 5.2 New Route: `/register` (GET)
**File:** `server/src/doors/staff/routes/register.tsx` (new)
- Authenticate & authorize (manager/administrator only)
- Execute parameterized search query
- Handle filters: search term, status, severity, date range
- Pagination: limit 50, offset-based

### 5.3 New View: Register Table
**File:** `server/src/doors/staff/views/register.tsx` (new)
- Responsive data table
- Key columns: Report Number, Device, Manufacturer, Severity, Status, Date Received
- Search box, filter dropdowns
- Sortable columns
- Pagination

### 5.4 New Route: `/register/:id` (GET)
**File:** `server/src/doors/staff/routes/register-detail.tsx` (new)
- Fetch single entry, authenticate, authorize

### 5.5 New View: Register Detail
**File:** `server/src/doors/staff/views/register-detail.tsx` (new)
- Complete read-only entry display
- Organized sections: Report Summary, Device Info, Reporter, Event, Assessment, Manager Decision, Regulatory Action

---

## 6. Database Migrations

### Migration: Create `register_entries` Table
**File:** `server/src/db/migrations/XXX_create_register_entries.sql`

Schema:
- UUID id (primary key)
- FK to reports (unique)
- All fields from section 2.1
- Indexes on: status, device_name, manufacturer, severity, date_received, report_id

---

## 7. Service Layer

### New File: `server/src/domain/register.ts`

**Exports:**
- `createRegisterEntry(db, data)` – insert on report intake
- `updateRegisterEntry(db, reportId, data)` – update during workflow
- `getRegisterEntry(db, entryId)` – fetch one entry
- `searchRegisterEntries(db, filters)` – search with pagination

---

## 8. Implementation Checklist

- [ ] Phase 1: Database schema & migration
- [ ] Phase 2: Service layer (create, update, search functions)
- [ ] Phase 3: Workflow integration (call register functions in report/assessment/decision routes)
- [ ] Phase 4: Sidebar navigation (add Register link)
- [ ] Phase 5: Register list view (`/register` route & view)
- [ ] Phase 6: Register detail view (`/register/:id` route & view)
- [ ] Phase 7: Authorization & integration tests
- [ ] Phase 8: Documentation & cleanup

---

## 9. Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Data consistency | Use database transactions; update Register in same transaction as workflow |
| Performance | Proper indexing, server-side pagination with limit 50 |
| Access bypass | Every route enforces `requireRole(["manager", "administrator"])` |
| Workflow regression | Wrap register updates in try-catch; fail open (log error, don't block workflow) |

---

## 10. Notes

- **Read-Only Enforcement:** The Register table is presented as read-only via UI. Database role permissions can enforce this (SELECT only for the application user), but this is optional given the application layer control.
- **No Parallel Data:** Register is not a duplicate; it's a single projection of the operational workflow state.
- **Future Enhancements:** If N > 2 assessments become common, could add `assessments_json` column to store all assessor info beyond first/second.
- **Audit Trail:** `updated_at` on every Register entry change supports compliance auditing.

