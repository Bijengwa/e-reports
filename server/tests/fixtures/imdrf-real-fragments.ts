/**
 * Real fragments copied verbatim from the official IMDRF 2026 JSON export (the source file the
 * admin-workflow correction task supplied: "All the jsons in the imdrf page. All the 8 kinds.txt").
 *
 * Every record object below is copied character-for-character from one of the 8 real payloads —
 * nothing here is invented. Field spelling/casing intentionally differs between fragments because
 * the real export itself is inconsistent: the consolidated file spells `"non-IMDRF code"`, the
 * single-annex files spell `"non-imdrf code"`.
 */

/* ───────────────────── Consolidated Annexes A-G (source lines ~20-20210) ───────────────────── */

export const consolidatedAnnexA = [
  {
    code: "A",
    term: "Medical Device Problem",
    definition:
      "Terms/codes for describing problems (malfunction, deterioration of function, failure) of medical devices that have occurred in pre- or postmarket contexts (e.g. clinical studies, clinical evaluation or post-market surveillance)",
    "non-IMDRF code": "",
    status: "Not selectable",
    "status description": "Please use more detailed term within the hierarchy",
    "primary category": "",
    "secondary category": "",
    codehierarchy: "A",
  },
  {
    code: "A01",
    term: "Patient Device Interaction Problem",
    definition: "Problem related to the interaction between the patient and the device.",
    "non-IMDRF code": "MedDRA:10092649:Patient-device interaction issue",
    status: "",
    "status description": "",
    "primary category": "",
    "secondary category": "",
    codehierarchy: "A|A01",
  },
  {
    code: "A0101",
    term: "Patient-Device Incompatibility",
    definition:
      "Problem associated with the interaction between the patient's physiology or anatomy and the device that affects the patient and/or the device.",
    "non-IMDRF code": "MedDRA:10092649:Patient-device interaction issue",
    status: "",
    "status description": "",
    "primary category": "",
    "secondary category": "",
    codehierarchy: "A|A01|A0101",
  },
  {
    code: "A010101",
    term: "Biocompatibility",
    definition:
      "Problem associated with undesirable local or systemic effects due to exposure to medical device materials or leachates from those materials by a patient who has an implant or is receiving treatment with a device made from them.",
    "non-IMDRF code": "",
    status: "",
    "status description": "",
    "primary category": "",
    "secondary category": "",
    codehierarchy: "A|A01|A0101|A010101",
  },
] as const;

export const consolidatedAnnexB = [
  {
    code: "B",
    term: "Type of Investigation",
    definition: "",
    "non-IMDRF code": "",
    status: "Not selectable",
    "status description": "Please use more detailed term within the hierarchy",
    "primary category": "",
    "secondary category": "",
    codehierarchy: "B",
  },
  {
    code: "B01",
    term: "Testing of Actual/Suspected Device",
    definition:
      "The investigation employed relevant empirical testing of the actual device suspected in the reported adverse event in order to establish their functional and other properties and to identify possible causes for the adverse event. Relevant testing would typically be based on test methods used for evaluating safety and performance as described in the latest relevant standards.",
    "non-IMDRF code": "",
    status: "",
    "status description": "",
    "primary category": "",
    "secondary category": "",
    codehierarchy: "B|B01",
  },
  {
    code: "B02",
    term: "Testing of Device from Same Lot/Batch Retained by Manufacturer",
    definition:
      "The investigation employed relevant empirical testing of the device of the same lot or batch than that of the suspected device in the reported adverse event in order to support the identification of possible causes for the adverse event. Testing was performed using the device retained by the manufacturer (i.e. was not shipped). Relevant testing would typically be based on test methods used for evaluating safety and performance as described in the latest relevant standards.",
    "non-IMDRF code": "",
    status: "",
    "status description": "",
    "primary category": "",
    "secondary category": "",
    codehierarchy: "B|B02",
  },
] as const;

export const consolidatedAnnexG = [
  {
    code: "G",
    term: "Medical Device Component",
    definition: "",
    "non-IMDRF code": "",
    status: "Not selectable",
    "status description": "Please use more detailed term within the hierarchy",
    "primary category": "",
    "secondary category": "",
    codehierarchy: "G",
  },
  {
    code: "G01",
    term: "Biological and Chemical",
    definition:
      "Component whose mode of action involves a biological process (ex. test strip which acts on antibodies) and chemical reaction or transformation (ex. activated charcoal absorber).",
    "non-IMDRF code": "",
    status: "Not selectable",
    "status description": "Please use more detailed term within the hierarchy",
    "primary category": "",
    "secondary category": "",
    codehierarchy: "G|G01",
  },
  {
    code: "G01001",
    term: "Absorber",
    definition: "A component or material designed to take in or attenuate a substance.",
    "non-IMDRF code": "",
    status: "",
    "status description": "",
    "primary category": "",
    "secondary category": "",
    codehierarchy: "G|G01|G01001",
  },
] as const;

/** All three real annex fragments above, concatenated exactly as the real consolidated export
 *  interleaves annexes one after another in a single top-level array. */
export const consolidatedFragment = [
  ...consolidatedAnnexA,
  ...consolidatedAnnexB,
  ...consolidatedAnnexG,
];

/* ─────────────────────── Single-annex real exports (no root marker record) ─────────────────── */

/** Annex A single-annex export (source line ~23566). Note: unlike the consolidated shape, there
 *  is no bare `"A"`/codehierarchy `"A"` root record — hierarchies start at `"A01"` directly. */
export const singleAnnexA = [
  {
    code: "A01",
    term: "Patient Device Interaction Problem",
    definition: "Problem related to the interaction between the patient and the device.",
    "non-IMDRF code": "MedDRA:10092649:Patient-device interaction issue",
    status: "",
    "status description": "",
    codehierarchy: "A01",
  },
  {
    code: "A0101",
    term: "Patient-Device Incompatibility",
    definition:
      "Problem associated with the interaction between the patient's physiology or anatomy and the device that affects the patient and/or the device.",
    "non-IMDRF code": "MedDRA:10092649:Patient-device interaction issue",
    status: "",
    "status description": "",
    codehierarchy: "A01|A0101",
  },
  {
    code: "A010101",
    term: "Biocompatibility",
    definition:
      "Problem associated with undesirable local or systemic effects due to exposure to medical device materials or leachates from those materials by a patient who has an implant or is receiving treatment with a device made from them.",
    "non-IMDRF code": "",
    status: "",
    "status description": "",
    codehierarchy: "A01|A0101|A010101",
  },
] as const;

/** Annex C single-annex export (source line ~28305). */
export const singleAnnexC = [
  {
    code: "C01",
    term: "Biological Problem Identified",
    definition: "Problems relating to, caused by or affecting biological processes or living organisms.",
    "non-IMDRF code": "",
    status: "",
    "status description": "",
    codehierarchy: "C01",
  },
  {
    code: "C0101",
    term: "Biocompatibility Problem Identified",
    definition:
      "The device causes cellular or tissue responses that elicit an undesirable local or systemic effect in the recipient or beneficiary of that therapy. (See ISO 10993)",
    "non-IMDRF code": "",
    status: "",
    "status description": "",
    codehierarchy: "C01|C0101",
  },
  {
    code: "C0102",
    term: "Biological Contamination",
    definition:
      "The undesirable presence of living organisms such as bacteria, fungi, or viruses or their products (enzymes or toxins).",
    "non-IMDRF code": "",
    status: "",
    "status description": "",
    codehierarchy: "C01|C0102",
  },
] as const;

/** Annex D single-annex export (source line ~29752). */
export const singleAnnexD = [
  {
    code: "D01",
    term: "Cause Traced to Device Design",
    definition:
      "Problems traced to the design specifications (e.g. in the requirements, testing processes, hazard analysis, implementation strategy).",
    "non-IMDRF code": "",
    status: "",
    "status description": "",
    codehierarchy: "D01",
  },
  {
    code: "D0101",
    term: "Design Inadequate for Purpose",
    definition:
      "Problems traced to design/design features of the device that do not support or interfere with the intended purpose of the device.",
    "non-IMDRF code": "",
    status: "",
    "status description": "",
    codehierarchy: "D01|D0101",
  },
] as const;

/** Annex E single-annex export (source line ~30164). Uses lowercase `"non-imdrf code"` and
 *  carries `"primary category"`/`"secondary category"`, unlike the other single-annex exports. */
export const singleAnnexE = [
  {
    code: "E01",
    term: "Nervous System",
    definition: "Nervous System",
    "non-imdrf code": "",
    "primary category": "",
    "secondary category": "",
    status: "Not selectable",
    "status description": "Please use more detailed term within the hierarchy",
    codehierarchy: "E01",
  },
  {
    code: "E0101",
    term: "Balance Problems",
    definition:
      "A feeling of falling down which can occur whether the person is standing, sitting or lying down.",
    "non-imdrf code": "MedDRA:10049848:Balance disorder",
    "primary category": "",
    "secondary category": "",
    status: "",
    "status description": "",
    codehierarchy: "E01|E0101",
  },
  {
    code: "E0102",
    term: "Brain Injury",
    definition: "Damage to the brain.",
    "non-imdrf code": "MedDRA:10060690:Traumatic brain injury",
    "primary category": "Nervous System",
    "secondary category": "Injury",
    status: "",
    "status description": "",
    codehierarchy: "E01|E0102",
  },
] as const;

/** Real cross-listed record: `E0104` genuinely appears at two different `codehierarchy` positions
 *  in the official export (source lines ~30223 and ~31609) — the same code, deliberately shown
 *  under both the Nervous System (E01) and Vascular System (E05) branches. Used to prove duplicate
 *  detection keys on `codehierarchy`, not `code`. */
export const crossListedE0104UnderE01 = {
  code: "E0104",
  term: "Cerebral Hyperperfusion Syndrome",
  definition:
    "Unexpected increase in cerebral blood flow after carotid endarterectomy (CEA) or carotid artery stenting (CAS).",
  "non-imdrf code": "MedDRA:10064730:Cerebral hyperperfusion syndrome",
  "primary category": "Nervous System",
  "secondary category": "Vascular System",
  status: "",
  "status description": "",
  codehierarchy: "E01|E0104",
} as const;

export const crossListedE0104UnderE05 = {
  code: "E0104",
  term: "Cerebral Hyperperfusion Syndrome",
  definition:
    "Unexpected increase in cerebral blood flow after carotid endarterectomy (CEA) or carotid artery stenting (CAS).",
  "non-imdrf code": "MedDRA:10064730:Cerebral hyperperfusion syndrome",
  "primary category": "Nervous System",
  "secondary category": "Vascular System",
  status: "",
  "status description": "",
  codehierarchy: "E05|E0104",
} as const;

export const singleAnnexE05Root = {
  code: "E05",
  term: "Vascular System",
  definition: "Vascular System",
  "non-imdrf code": "",
  "primary category": "",
  "secondary category": "",
  status: "Not selectable",
  "status description": "Please use more detailed term within the hierarchy",
  codehierarchy: "E05",
} as const;

/** Annex F single-annex export (source line ~41325). */
export const singleAnnexF = [
  {
    code: "F01",
    term: "Change in Therapeutic Response",
    definition: "Change in response to treatment or cure of a disorder or disease.",
    "non-IMDRF code": "",
    status: "",
    "status description": "",
    codehierarchy: "F01",
  },
  {
    code: "F0101",
    term: "Therapeutic Response Decreased",
    definition:
      "A reduction in or complete loss of the desirable and beneficial effects resulting from a medical treatment.",
    "non-IMDRF code": "",
    status: "Modified (technical)",
    "status description": "Definition modified for Release Number 2026. See no. 114 of Change Request Log",
    codehierarchy: "F01|F0101",
  },
] as const;

/** Annex G single-annex export (source line ~42069). */
export const singleAnnexG = [
  {
    code: "G01",
    term: "Biological and Chemical",
    definition:
      "Component whose mode of action involves a biological process (ex. test strip which acts on antibodies) and chemical reaction or transformation (ex. activated charcoal absorber).",
    "non-imdrf code": "",
    status: "Not selectable",
    "status description": "Please use more detailed term within the hierarchy",
    codehierarchy: "G01",
  },
  {
    code: "G01001",
    term: "Absorber",
    definition: "A component or material designed to take in or attenuate a substance.",
    "non-imdrf code": "",
    status: "",
    "status description": "",
    codehierarchy: "G01|G01001",
  },
] as const;

/** A single real record (source line ~44828) whose parent ("G07") is not included in
 *  `singleAnnexG` above — used to exercise "no parent found in this payload" without inventing a
 *  fake hierarchy: this is genuinely what a partial/truncated real export looks like. */
export const orphanedRealRecordG07003 = {
  code: "G07003",
  term: "Insufficient Component Information",
  definition:
    "There is not enough information available to classify the medical device component or there is not enough information available to determine whether a medical device component is affected.",
  "non-imdrf code": "",
  status: "Modified (technical)",
  "status description":
    "Term was added on 27 January 2022. For details, see comment No. 192 of the Change Log (Release Number 2022). Editorial change to term for Release Number 2025. See no. 123 of Change Log. Technical modification to definition for Release Number 2026. See no. 167 of Change Log.",
  codehierarchy: "G07|G07003",
} as const;
