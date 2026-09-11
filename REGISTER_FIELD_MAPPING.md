# Register Field Mapping & Integration Analysis

## Workflow Integration Points (Code Locations)

### 1. Orange Report Creation/Acceptance
**File:** `server/src/domain/reports.ts` — `storeReport()` function (lines 217-302)
**When:** Public user submits form OR staff member enters paper/email report
**DB Operation:** Atomic transaction INSERTs reports row

**Action Point for Register Sync:** After line 301 (return statement), before transaction commits
- Read: newly created `row.id`, populated fields
- Call: `createRegisterEntry(tx, reportData)`

---

### 2. First Assessment Submission
**File:** `server/src/doors/staff/routes/assessment.tsx` — `POST /reports/:id/assessment-1` (lines 99-182)
**When:** Assessor 1 submits their F004 assessment
**DB Operation:** Atomic transaction UPDATEs assessments row

**Action Point for Register Sync:** After line 170 (status UPDATE for assessments), within same transaction
- Read: newly submitted assessment payload, conclusion, submitted_at
- Call: `updateRegisterEntry(tx, reportId, assessmentData)`

---

### 3. Manager Decision: Assign Next Assessor
**File:** `server/src/doors/staff/routes/decisions.tsx` — `POST /reports/:id/assign-next-assessor` (lines 30-124)
**When:** Manager assigns another assessor for secondary/tertiary review
**DB Operation:** Atomic transaction INSERTs reportDecisions row

**Action Point for Register Sync:** After line 115 (auditLog INSERT), within same transaction
- Read: nextOrdinal, assignment action
- Call: `updateRegisterEntry(tx, reportId, { assessmentOrdinalCount: nextOrdinal, ... })`

---

### 4. Manager Decision: Assign Work Officer (FINAL)
**File:** `server/src/doors/staff/routes/decisions.tsx` — `POST /reports/:id/assign-work-officer` (lines 126-237)
**When:** Manager finalizes assessment chain and approves regulatory action
**DB Operation:** Atomic transaction INSERTs reportDecisions + reportFinalDocuments rows

**Action Point for Register Sync:** After line 228 (auditLog INSERT), within same transaction
- Read: finalDocument payload (regulatory_action, conclusions), reviewedThroughOrdinal, decision.id
- Call: `updateRegisterEntry(tx, reportId, { finalDocumentData, managerData, ... })`

---

## Complete Field Mapping: Excel → Database

Total Register Columns: 56 (from user's Excel workbook, excluding S/N marker)

### Group 1: Report Header (3 columns)

| # | Register Column | Source | DB Table | DB Field | Relationship | Populated When | Type |
|---|---|---|---|---|---|---|---|
| 1 | S/N | (Row sequence) | — | — | Row number in query result | Query execution | Derived |
| 2 | TMDA Report Number | Orange Report | reports | number | Direct | Report intake | Direct |
| 3 | Date Received | Orange Report | reports | received_at | Direct | Report intake | Direct |

---

### Group 2: Device Information (11 columns)

| # | Register Column | Source | DB Table | DB Field(s) | Relationship | Populated When | Type |
|---|---|---|---|---|---|---|---|
| 4 | Device Brand Name | Orange Report | reports.payload | device_brand | Extract device_brand from JSON payload | Report intake | Direct |
| 5 | Device Common Name | Orange Report | reports | device_name | Direct (normalized field) | Report intake | Direct |
| 6 | Size | Orange Report | reports.payload | device_size | Extract from JSON payload | Report intake | Direct |
| 7 | Batch/Lot/Serial Number | Orange Report | reports.payload | device_serial_number, device_batch_number | Extract from JSON payload | Report intake | Direct |
| 8 | Device Type | Orange Report | reports.payload | device_type | Extract from JSON payload | Report intake | Direct |
| 9 | Manufacturing Date | Orange Report | reports.payload | manufacturing_date | Extract from JSON payload | Report intake | Direct |
| 10 | Expiry Date | Orange Report | reports.payload | expiry_date | Extract from JSON payload | Report intake | Direct |
| 11 | Name and Physical Address of Manufacturer | Orange Report | reports.payload | manufacturer_name, manufacturer_address | Extract from JSON payload | Report intake | Direct |
| 12 | Manufacturing Country | Orange Report | reports.payload | manufacturing_country | Extract from JSON payload | Report intake | Direct |
| 13 | Device Classification | Orange Report | reports.payload | device_classification | Extract from JSON payload | Report intake | Direct |
| 14 | IMDRF Classification | Orange Report / Assessment | reports.payload or assessments.payload | imdrf_classification | Extract from form (may be in F001 or F004) | Report intake or Assessment | Direct |

---

### Group 3: Supplier & Manufacturer (5 columns)

| # | Register Column | Source | DB Table | DB Field(s) | Relationship | Populated When | Type |
|---|---|---|---|---|---|---|---|
| 15 | Name of the Supplier (If applicable) | Orange Report | reports.payload | supplier_name, supplier_contact | Extract from JSON payload | Report intake | Direct |
| 16 | Supplier Contact/Address | Orange Report | reports.payload | supplier_contact, supplier_address | Extract from JSON payload | Report intake | Direct |
| (Manufacturer cols 11, 12 above) |

---

### Group 4: Reporter/Facility (3 columns)

| # | Register Column | Source | DB Table | DB Field(s) | Relationship | Populated When | Type |
|---|---|---|---|---|---|---|---|
| 17 | Reporter Details (Name) | Orange Report | reports.payload | reporter_name | Extract from JSON | Report intake | Direct |
| 18 | Reporter Contact (Phone/Email) | Orange Report | reports.payload | phone, email | Extract from JSON payload | Report intake | Direct |
| 19 | Reporter Facility/Address | Orange Report | reports.payload | facility_address | Extract from JSON payload | Report intake | Direct |

---

### Group 5: Event/Incident (8 columns)

| # | Register Column | Source | DB Table | DB Field(s) | Relationship | Populated When | Type |
|---|---|---|---|---|---|---|---|
| 20 | Adverse Event(s)/Incident(s) Description | Orange Report | reports.payload | incident_narrative, event_narrative | Extract from JSON | Report intake | Direct |
| 21 | Date of Onset of Event(s) | Orange Report | reports.payload | incident_date | Extract from JSON | Report intake | Direct |
| 22 | Date of Report | Orange Report | reports.payload | report_date | Extract from JSON | Report intake | Direct |
| 23 | Place/Location of Event(s) | Orange Report | reports.payload | device_location | Extract from JSON | Report intake | Direct |
| 24 | Region | Orange Report | reports.payload | location | Extract from JSON | Report intake | Direct |
| 25 | Type of Report | Orange Report | reports | channel | Direct (online_form, email, hard_copy) | Report intake | Direct |
| 26 | Event Seriousness (Yes/No) | Orange Report | reports | severity | Derived: severity != "other" → Yes/No | Report intake | Derived |
| 27 | (Derived Status) | Workflow | reports | status | Workflow state indicator | Ongoing | Derived |

---

### Group 6: Investigation (5 columns)

| # | Register Column | Source | DB Table | DB Field(s) | Relationship | Populated When | Type |
|---|---|---|---|---|---|---|---|
| 28 | Investigation Needed (Yes/No) | Assessment | assessments.payload | [inferred from F004 answers] | Extract from assessment section | Assessment 1 submitted | Direct |
| 29 | Investigation Status | Workflow | assessments + reports.status | [inferred] | Derive from: submitted assessments, open assessments, manager decision | Assessment submitted | Derived |
| 30 | Investigation Findings | Assessment | assessments.payload | investigation_findings | Extract from F004 section | Assessment 1 or 2 submitted | Direct |
| 31 | Investigation Conclusion | Assessment | assessments.payload | investigation_conclusion | Extract from F004 section | Assessment 1 or 2 submitted | Direct |
| 32 | Causality Assessment | Assessment | assessments.payload | causality | Extract from F004 section 6.2 (or equivalent) | Assessment 1 submitted | Direct |

---

### Group 7: Risk & Regulatory (3 columns)

| # | Register Column | Source | DB Table | DB Field(s) | Relationship | Populated When | Type |
|---|---|---|---|---|---|---|---|
| 33 | Risk Assessment | Assessment | assessments.payload | risk_assessment, risk_level | Extract from F004 section | Assessment 1 submitted | Direct |
| 34 | Regulatory Action(s) Taken | Final Document | report_final_documents.payload | recommended_action, regulatory_action | Extract from resolved F004 | Work officer assigned | Direct |
| 35 | (Derived) Regulatory Status | Workflow | reports.status | — | Derive from final document existence | Work officer assigned | Derived |

---

### Group 8: Assessment Information (5 columns)

| # | Register Column | Source | DB Table | DB Field(s) | Relationship | Populated When | Type |
|---|---|---|---|---|---|---|---|
| 36 | 1st Assessor Name | User + Assessment | users.full_name (via assessments.assessor_id WHERE ordinal=1) | FK join: assessments(report_id, ordinal=1).assessor_id → users.id.full_name | Assessment 1 created at intake or submitted | Assessment created (intake) | Direct |
| 37 | Date of Assessment (1st) | Assessment | assessments.submitted_at (WHERE ordinal=1) | Direct field, NULL if still draft | — | Assessment 1 submitted | Direct |
| 38 | 1st Assessor Conclusion | Assessment | assessments.conclusion (WHERE ordinal=1) | Section 7.1 text from F004 | — | Assessment 1 submitted | Direct |
| 39 | 2nd Assessor Name | User + Assessment | users.full_name (via assessments.assessor_id WHERE ordinal>1, max submitted ordinal) | FK join: assessments(report_id, ordinal>1).assessor_id → users.id.full_name | Secondary assessment created or submitted | Assessment N>1 created | Direct |
| 40 | Date of Assessment (2nd+) | Assessment | assessments.submitted_at (WHERE ordinal=max submitted ordinal>1) | Direct field, NULL if still draft | Store highest submitted ordinal | Assessment N>1 submitted | Direct |

---

### Group 9: Manager Decision (5 columns)

| # | Register Column | Source | DB Table | DB Field(s) | Relationship | Populated When | Type |
|---|---|---|---|---|---|---|---|
| 41 | Manager Decision (Pending/Approved) | Manager Workflow | report_decisions.kind + reports.status | Derive: if assign_work_officer exists → "Approved"; else "Pending" | — | Manager makes final decision | Derived |
| 42 | Manager Name (Decided By) | Manager Workflow | users.full_name (via report_decisions.decided_by_user_id) | FK join: report_decisions.decided_by_user_id → users.id.full_name | — | Manager makes final decision | Direct |
| 43 | Date of Manager Decision | Manager Workflow | report_decisions.decided_at | Direct field | — | Manager makes final decision | Direct |
| 44 | Manager Comment/Rationale | Manager Workflow | report_decisions.comment | Direct field (may be NULL) | — | Manager makes decision (optional for first, required for subsequent) | Direct |
| 45 | Assessment Count (Ordinal Reached) | Assessment | assessments (max ordinal) or report_final_documents.resolved_through_ordinal | Derived: count distinct ordinal or use resolved_through_ordinal | — | Each assessment submitted or final document created | Derived |

---

### Group 10: Acknowledgement & Status (3 columns)

| # | Register Column | Source | DB Table | DB Field(s) | Relationship | Populated When | Type |
|---|---|---|---|---|---|---|---|
| 46 | Acknowledgement Sent (Yes/No / Date) | (Future Feature) | — | — | Not yet implemented in workflow | — | — |
| 47 | Acknowledgement / Feedback | (Future Feature) | — | — | Not yet implemented in workflow | — | — |
| 48 | Overall Status | Workflow | reports.status | Direct field | — | Report lifecycle | Direct |

---

### Remaining Derived/Metadata (8 columns to complete 56)

| # | Register Column | Source | DB Table | DB Field(s) | Relationship | Populated When | Type |
|---|---|---|---|---|---|---|---|
| 49 | Date Record Created | Metadata | register_entries.created_at | Direct timestamp | — | Register entry created | Direct |
| 50 | Date Record Last Updated | Metadata | register_entries.updated_at | Direct timestamp | — | Any field updated | Direct |
| 51-56 | (Additional institutional fields from Excel) | Excel Reference | — | [Verify against actual Excel] | — | — | — |

**Note:** Exact count of 56 and remaining field names require confirmation against the actual Excel workbook. The above covers all major conceptual categories. User to verify final column list.

---

## Data Flow Diagram

```
ORANGE REPORT INTAKE (storeReport)
  ↓
  reports.INSERT (id, number, channel, severity, deviceName, facility, ...)
  ↓
  [SYNC POINT 1]
  ↓
  register_entries.INSERT
    ├── report_id, report_number, date_received
    ├── device_* (all from reports.payload)
    ├── event_* (all from reports.payload)
    ├── reporter_name, reporter_facility, reporter_contact
    ├── supplier_name, supplier_contact
    ├── manufacturer_*, manufacturing_country
    ├── first_assessor_id = reports.assessor1UserId (if assigned)
    ├── first_assessor_name = users.full_name (join)
    └── register_status = "received"
  ↓
  ════════════════════════════════════════════════════════════
  ↓
  FIRST ASSESSMENT SUBMISSION (assessment.tsx POST)
  ↓
  assessments.INSERT/UPDATE (ordinal=1, payload, conclusion, submitted_at)
  ↓
  reports.UPDATE status → "awaiting_second_assessor"
  ↓
  [SYNC POINT 2]
  ↓
  register_entries.UPDATE
    ├── first_assessment_submitted_at = assessments.submitted_at
    ├── first_assessment_conclusion = assessments.conclusion
    ├── assessment_causality = assessments.payload.causality
    ├── assessment_risk_level = assessments.payload.risk_level
    ├── investigation_status = "in_progress" (derived)
    ├── investigation_findings = assessments.payload.investigation_findings
    ├── investigation_conclusion = assessments.payload.investigation_conclusion
    └── register_status = "first_assessment_submitted"
  ↓
  ════════════════════════════════════════════════════════════
  ↓
  MANAGER DECISION: ASSIGN NEXT ASSESSOR (decisions.tsx POST)
  ↓
  assessments.INSERT (ordinal=2/3/.../N, assessor_id=chosen, payload='{}')
  ↓
  report_decisions.INSERT (kind="assign_next_assessor", next_assessor_user_id, next_ordinal)
  ↓
  reports.UPDATE status → "second_assessment"
  ↓
  [SYNC POINT 3]
  ↓
  register_entries.UPDATE
    ├── assessment_ordinal_count = next_ordinal
    └── register_status = "awaiting_secondary_assessment"
  ↓
  ════════════════════════════════════════════════════════════
  ↓
  SECONDARY ASSESSMENT SUBMISSION (assessment.tsx POST)
  ↓
  assessments.UPDATE (ordinal=N, payload, conclusion, submitted_at)
  ↓
  [SYNC POINT 2B (similar to 2)]
  ↓
  register_entries.UPDATE
    ├── second_assessor_id = assessments.assessor_id (max submitted ordinal > 1)
    ├── second_assessor_name = users.full_name (join)
    ├── second_assessment_submitted_at = assessments.submitted_at
    ├── second_assessment_conclusion = assessments.conclusion
    └── assessment_causality, assessment_risk_level updated from latest assessment
  ↓
  [Repeat: manager assigns again OR approves work]
  ↓
  ════════════════════════════════════════════════════════════
  ↓
  MANAGER DECISION: APPROVE & ASSIGN WORK OFFICER (decisions.tsx POST)
  ↓
  report_decisions.INSERT (kind="assign_work_officer", work_officer_user_id, reviewed_through_ordinal)
  ↓
  report_final_documents.INSERT (report_id, decision_id, resolved_through_ordinal, payload=finalF004)
  ↓
  reports.UPDATE status → "assigned_for_work"
  ↓
  [SYNC POINT 4]
  ↓
  register_entries.UPDATE
    ├── manager_decision_status = "approved"
    ├── manager_decided_by_id = session.userId
    ├── manager_decided_at = NOW()
    ├── manager_final_action = "assigned_for_work"
    ├── regulatory_action = report_final_documents.payload.recommended_action
    ├── assessment_ordinal_count = reviewed_through_ordinal
    └── register_status = "approved_and_assigned"
  ↓
  ════════════════════════════════════════════════════════════
  ↓
  REGISTER RECORD COMPLETE
  └── One institutional record per Orange Report
      Progressive enrichment, read-only to users
```

---

## Architecture: Dedicated Table (`register_entries`)

### Schema (SQL)

```sql
CREATE TABLE register_entries (
  -- Identity
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL UNIQUE REFERENCES reports(id) ON DELETE CASCADE,
  
  -- Report metadata
  report_number TEXT NOT NULL UNIQUE,
  report_channel TEXT NOT NULL,
  date_received TIMESTAMP WITH TIME ZONE NOT NULL,
  
  -- Device information (all extractable from reports.payload)
  device_brand TEXT,
  device_common_name TEXT NOT NULL,
  device_size TEXT,
  device_serial_number TEXT,
  device_batch_number TEXT,
  device_type TEXT,
  manufacturing_date DATE,
  expiry_date DATE,
  device_classification TEXT,
  imdrf_classification TEXT,
  
  -- Manufacturer
  manufacturer_name TEXT,
  manufacturer_address TEXT,
  manufacturing_country TEXT,
  
  -- Supplier
  supplier_name TEXT,
  supplier_contact TEXT,
  
  -- Reporter/Facility
  reporter_name TEXT,
  reporter_facility TEXT,
  reporter_contact TEXT,
  
  -- Event/Incident
  event_description TEXT,
  event_severity TEXT NOT NULL, -- death, life_threatening, hospitalization, other
  event_date DATE,
  event_location TEXT,
  region TEXT,
  type_of_report TEXT,
  event_seriousness BOOLEAN, -- derived: severity != "other"
  
  -- Investigation
  investigation_needed BOOLEAN,
  investigation_status TEXT, -- pending, in_progress, completed
  investigation_findings TEXT,
  investigation_conclusion TEXT,
  
  -- Assessment (1st)
  causality_assessment TEXT,
  risk_assessment TEXT,
  assessment_ordinal_count SMALLINT DEFAULT 1,
  
  first_assessor_id UUID REFERENCES users(id),
  first_assessor_name TEXT,
  first_assessment_submitted_at TIMESTAMP WITH TIME ZONE,
  first_assessment_conclusion TEXT,
  
  -- Assessment (2nd+)
  second_assessor_id UUID REFERENCES users(id),
  second_assessor_name TEXT,
  second_assessment_submitted_at TIMESTAMP WITH TIME ZONE,
  second_assessment_conclusion TEXT,
  
  -- Manager decision
  manager_decision_status TEXT, -- pending, approved
  manager_decided_by_id UUID REFERENCES users(id),
  manager_decided_by_name TEXT,
  manager_decided_at TIMESTAMP WITH TIME ZONE,
  manager_final_action TEXT, -- assigned_for_work, etc.
  manager_comment TEXT,
  
  -- Regulatory action
  regulatory_action TEXT,
  
  -- Acknowledgement (future)
  acknowledgement_sent_at TIMESTAMP WITH TIME ZONE,
  acknowledgement_feedback TEXT,
  
  -- Register status (institutional record state)
  register_status TEXT NOT NULL DEFAULT 'received',
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Indexes for searching and filtering
CREATE INDEX register_entries_report_idx ON register_entries(report_id);
CREATE INDEX register_entries_status_idx ON register_entries(register_status);
CREATE INDEX register_entries_device_idx ON register_entries(device_common_name);
CREATE INDEX register_entries_manufacturer_idx ON register_entries(manufacturer_name);
CREATE INDEX register_entries_severity_idx ON register_entries(event_severity);
CREATE INDEX register_entries_date_received_idx ON register_entries(date_received DESC);
CREATE INDEX register_entries_assessor1_idx ON register_entries(first_assessor_id);
CREATE INDEX register_entries_created_idx ON register_entries(created_at DESC);
```

### Why This Architecture

✓ Efficient querying (indexed, no complex joins)
✓ Institutional record property (immutable once written, read-only to users)
✓ Fast pagination and filtering (critical for large registers)
✓ Atomic updates with workflow (same transaction, no race conditions)
✓ Single record per report (no duplication of assessment rows)
✓ Future-proof (can add columns without touching operational tables)

---

## Service Layer: Functions to Implement

**File:** `server/src/domain/register.ts` (to be created)

```typescript
export async function createRegisterEntry(
  tx: Transaction,
  data: RegisterEntryInput
): Promise<void>

export async function updateRegisterEntry(
  tx: Transaction,
  reportId: string,
  data: Partial<RegisterEntry>
): Promise<void>

export async function getRegisterEntry(
  db: Database,
  entryId: string
): Promise<RegisterEntry | null>

export async function searchRegisterEntries(
  db: Database,
  filters: {
    search?: string; // search across report number, device, manufacturer
    status?: string;
    severity?: string;
    dateFrom?: Date;
    dateTo?: Date;
    limit?: number;
    offset?: number;
  }
): Promise<{ entries: RegisterEntry[]; total: number }>
```

---

## Summary: What Needs User Confirmation

1. **Field Count:** User stated 56 meaningful columns (excluding S/N). Mapping covers conceptual groups; exact remaining field names require confirmation against actual Excel.

2. **Architecture Choice:** Dedicated `register_entries` table (Option A) recommended for:
   - Performance
   - Institutional record property
   - Atomic synchronization
   - **Confirm user agrees with this approach**

3. **Synchronization Points:** Four atomic updates proposed at:
   - Orange Report intake (after reports.INSERT)
   - First Assessment submit (after assessments.INSERT, same transaction)
   - Manager assigns next assessor (after reportDecisions.INSERT, same transaction)
   - Manager assigns work officer & finalizes (after reportFinalDocuments.INSERT, same transaction)
   - **Confirm these points are correct**

4. **Payload Extraction:** Multiple fields come from `reports.payload` (JSON) and `assessments.payload` (JSON). Exact keys/structure need verification against actual form versions used.

5. **Access Control:** Register visible to ALL authenticated staff (not restricted to managers/administrators).
   - **Confirm this interpretation is correct**

---

## Ready for Implementation?

**Status:** ⏳ **AWAITING USER APPROVAL**

Once confirmed:
- ✅ Analysis complete
- ✅ Field mapping verified
- ✅ Integration points identified
- ✅ Architecture decided
- ✅ Service layer defined

**Then:** Proceed to Phase 1 implementation (migration, schema, service functions).

