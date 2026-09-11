# Register: Complete 56-Column Field Mapping

**Phase 2 Deliverable: Definitive Field Mapping**
**Based on:** Excel prototype (e-reports-register-table-prototype.html)
**Authoritative Sources:** form-schema.ts, f004.ts, database schema

This document maps each of the 56 Register columns to existing e-Reports database entities and fields. Used in Phases 4-8 for schema definition, service layer implementation, and workflow integration.

---

## Quick Reference: All 56 Columns

Position 1: S/N (row sequence)
Positions 2–3: Report metadata (number, date received)
Positions 4–13: Device info (brand, common name, size, serial, type, dates, manufacturer, country, supplier)
Positions 14–20: Event info (description, date, location, region, report type, reporter, seriousness)
Positions 21–45: IMDRF & investigation (device component, problem, clinical sign, health impact, investigation)
Positions 46–48: Status & assessments (investigation status, causality, risk)
Position 49: Regulatory action
Positions 50–53: Assessor information (1st assessor name/date, 2nd assessor name/date)
Position 54: Acknowledgement/feedback
Positions 55–56: Reserved

---

## Detailed Mapping (For Implementation Reference)

### S/N Position 1
- **Register Column:** S/N
- **Derivation:** ROW_NUMBER() OVER (ORDER BY date_received DESC, report_number DESC)
- **Type:** Derived (row position)

### Positions 2–3: Report Metadata

| Pos | Column | Source | Table | Field | Population Event | Type |
|-----|--------|--------|-------|-------|------------------|------|
| 2 | TMDA Report Number | Orange Report | reports | number | Report intake | Direct |
| 3 | Date Received | Orange Report | reports | received_at | Report intake | Direct |

### Positions 4–13: Device Information

| Pos | Column | Source | Payload Key | Population | Type |
|-----|--------|--------|-------------|-----------|------|
| 4 | Device Brand Name | reports.payload | brand_name | Report intake | Direct |
| 5 | Device Common Name | reports | device_name | Report intake | Direct |
| 6 | Size | reports.payload | size | Report intake | Direct |
| 7 | Batch/Lot/Serial Number | reports.payload | batch_number, serial_number | Report intake | Direct |
| 8 | Device Type | reports.payload | (form-determined) | Report intake | Direct |
| 9 | Manufacturing Date | reports.payload | manufacturing_date | Report intake | Direct |
| 10 | Expiry Date | reports.payload | expiry_date | Report intake | Direct |
| 11 | Name and Physical Address of Manufacturer | reports.payload | manufacturer, manufacturer_address | Report intake | Direct |
| 12 | Manufacturing Country | reports.payload | manufacturing_country | Report intake | Direct |
| 13 | Name of the Supplier (If applicable) | reports.payload | supplier | Report intake | Direct |

### Positions 14–20: Event/Incident Information

| Pos | Column | Source | Payload Key | Population | Type |
|-----|--------|--------|-------------|-----------|------|
| 14 | Adverse Event(s)/Incident(s) Description | reports.payload | incident_narrative, event_narrative | Report intake | Direct |
| 15 | Date of Onset of Event(s) | reports.payload | incident_date | Report intake | Direct |
| 16 | Date of the Report | reports.payload | report_date | Report intake | Direct |
| 17 | Place/Location of Event(s) | reports.payload | device_location | Report intake | Direct |
| 18 | Region | reports.payload | location | Report intake | Direct |
| 19 | Type of Report | reports | channel | Report intake | Direct |
| 20 | Reporter Details (Name/Contact) | reports.payload | reporter_name, phone, email | Report intake | Direct |

### Position 21: Event Seriousness

| Pos | Column | Source | Field | Derivation | Population | Type |
|-----|--------|--------|-------|-----------|-----------|------|
| 21 | Event Seriousness (Yes/No) | reports | severity | severity ≠ "other" → Yes; else No | Report intake | Derived |

### Positions 22–45: IMDRF Classification & Investigation

**Status:** Payload keys in positions 22–45 must be verified from actual F004 form structure in domain/f004.ts.

- Positions 22–25: Device Component (Levels 1–3 + IMDRF codes)
- Positions 26–29: Device Problem (Levels 1–3 + IMDRF codes)
- Positions 30–33: Clinical Sign (Levels 1–3 + IMDRF codes)
- Positions 34–37: Health Impact (Levels 1–3 + IMDRF codes)
- Position 37: Investigation Type (IMDRF codes)
- Positions 38–42: Investigation Findings (Levels + codes)
- Positions 43–45: Investigation Conclusions (Levels + codes)

**All populate from:** assessments.payload
**Population Event:** Assessment submitted (Assessment 1 or higher)
**Type:** Direct (extract from F004 section payloads)

### Position 46: Investigation Status

| Pos | Column | Source | Derivation | Population | Type |
|-----|--------|--------|-----------|-----------|------|
| 46 | Investigation Status (Done/Not Done) | assessments state | Derived from assessment presence, completion, manager decisions | As assessments progress | Derived |

### Position 47: Causality Assessment

| Pos | Column | Source | Payload Key | Population | Type |
|-----|--------|--------|-------------|-----------|------|
| 47 | Causality Assessment (Unrelated/Possible/Probable/Certain) | assessments.payload | causality (verify exact key) | Assessment submitted | Direct |

### Position 48: Risk Assessment

| Pos | Column | Source | Payload Key | Population | Type |
|-----|--------|--------|-------------|-----------|------|
| 48 | Risk Assessment (Critical/High/Medium/Low) | assessments.payload | risk_assessment or risk_level (verify) | Assessment submitted | Direct |

### Position 49: Regulatory Action(s) Taken

| Pos | Column | Source | Payload Key / Field | Population | Type |
|-----|--------|--------|-------------------|-----------|------|
| 49 | Regulatory Action(s) Taken | report_final_documents.payload | recommended_action or regulatory_action (verify) | Manager finalizes (assign_work_officer) | Direct |

### Positions 50–53: Assessor Information

| Pos | Column | Source | Join Logic | Population | Type |
|-----|--------|--------|-----------|-----------|------|
| 50 | 1st Assessor Name | users (via assessments) | assessments.assessor_id WHERE ordinal=1 → users.full_name | Assessment 1 created (intake) | Direct |
| 51 | Date of Assessment (1st) | assessments | submitted_at WHERE ordinal=1 | Assessment 1 submitted | Direct |
| 52 | 2nd Assessor Name | users (via assessments) | assessments.assessor_id WHERE ordinal>1, MAX(ordinal, submitted) → users.full_name | Secondary submitted | Direct |
| 53 | Date of Assessment (2nd+) | assessments | submitted_at WHERE ordinal>1, MAX(ordinal, submitted) | Secondary submitted | Direct |

### Position 54: Acknowledgement / Feedback

| Pos | Column | Source | Status | Type |
|-----|--------|--------|--------|------|
| 54 | Acknowledgement / Feedback | (Future feature) | Not yet implemented in workflow | N/A |

### Positions 55–56: Reserved

| Pos | Column | Status |
|-----|--------|--------|
| 55–56 | Column 56, Column 57 | Reserved for future institutional fields |

---

## Critical Payload Key Verification

**Before Phase 4 implementation, verify the exact payload keys in f004.ts for:**

1. **IMDRF Classification sections** (Positions 22–45)
   - Device Component preferred-term levels & codes
   - Device Problem preferred-term levels & codes
   - Clinical Sign preferred-term levels & codes
   - Health Impact preferred-term levels & codes
   - Investigation Type, Findings, Conclusions

2. **Assessment conclusions** (Position 47–48)
   - Exact key for causality assessment
   - Exact key for risk assessment

3. **Regulatory action** (Position 49)
   - Exact field in report_final_documents.payload that holds regulatory action recommendation

**Method:** Read domain/f004.ts, search for F004Answers type definition and section field keys. Cross-reference with the actual form rendering code to confirm payload structure.

---

## Assessment Ordinal Strategy

**Do not assume exactly 2 assessors:**

- **1st Assessor:** assessments WHERE report_id = X AND ordinal = 1
- **2nd+ Assessor:** assessments WHERE report_id = X AND ordinal > 1 AND submitted_at IS NOT NULL, sorted by ordinal DESC, take the first (highest completed ordinal)

This supports A1→A2, A1→A2→A3, A1→A2→A3→...→An sequences without modification.

---

## Database Constraints

- **register_entries.report_id** → UNIQUE, FK to reports.id ON DELETE CASCADE
- **One Register entry per Orange Report** (enforce via unique constraint on report_id)
- No concurrent Register rows for assessments
- All Register updates happen in same transaction as workflow operation (atomicity)

---

## Implementation Checklist for Phase 4–8

- [ ] Verify all payload keys in f004.ts (Phase 4 blocker)
- [ ] Define register_entries table schema (56 columns + metadata)
- [ ] Create appropriate indexes (status, device_name, manufacturer, severity, date_received)
- [ ] Implement domain/register.ts service functions
- [ ] Hook createFromReport into domain/reports.ts storeReport
- [ ] Hook updateFromAssessment into assessment.tsx POST
- [ ] Hook updateFromManagerDecision into decisions.tsx (assign_next_assessor)
- [ ] Hook updateFromFinalState into decisions.tsx (assign_work_officer)
- [ ] Create /register routes and views
- [ ] Add sidebar navigation
- [ ] Write integration tests (full lifecycle)

---

## Next Immediate Action

Verify payload keys in domain/f004.ts for IMDRF sections and assessment conclusions before proceeding to Phase 3 (architecture decision).

