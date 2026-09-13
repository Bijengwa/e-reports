import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  bigserial,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Three roles, not four.
 *
 * The prototype's sidebar lists two assessors separately, but "first" and "second" describe a
 * position within one report's review, not a property of the person. That ordinal lives on
 * `assessments`, which is what lets the manager move a report between assessors without changing
 * anyone's account.
 */
export const userRole = pgEnum("user_role", ["manager", "assessor", "administrator"]);

export const availabilityStatus = pgEnum("availability_status", ["available", "on_leave"]);

export const reportChannel = pgEnum("report_channel", ["online_form", "email", "hard_copy"]);

export const reportSeverity = pgEnum("report_severity", [
  "death",
  "life_threatening",
  "hospitalization",
  "other",
]);

/**
 * The cascade, as data. Transitions are enforced in `domain/`, never by callers.
 *
 * `awaiting_second_assessor` and `second_assessment` are reused for every secondary-assessment
 * cycle (A2, A3, A4, …), not only the second: renaming them would be a value-rename migration for
 * a caption change, and the caption is exactly what changes instead — see `STATUS_LABELS`.
 *
 * `assigned_for_work` is the MVP's real terminal state, added additively. `closed` predates the
 * secondary-assessment cascade and stays for a later "work finished" feature; nothing in this
 * slice writes it.
 */
export const reportStatus = pgEnum("report_status", [
  "received",
  "first_assessment",
  "awaiting_second_assessor",
  "second_assessment",
  "awaiting_decision",
  "closed",
  "assigned_for_work",
]);

/**
 * What one manager decision, recorded in `report_decisions`, was.
 *
 * Two kinds because they hand a report to two different pools for two different reasons — another
 * secondary assessment, or the officer who will carry out the recommended work — and a single
 * "decision" row with both an assessor column and an officer column would let a bug populate both
 * on one event. The CHECK constraint on the table enforces that only the matching columns are ever
 * non-null for a given kind.
 */
export const reportDecisionKind = pgEnum("report_decision_kind", [
  "assign_next_assessor",
  "assign_work_officer",
]);

/**
 * The units a Manager may set a deadline in, closed the same way `reportStatus` is: the database
 * refuses a sixth one rather than trusting every future caller to remember the list.
 */
export const deadlineUnit = pgEnum("deadline_unit", [
  "seconds",
  "minutes",
  "hours",
  "days",
  "weeks",
]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  fullName: text("full_name").notNull(),
  role: userRole("role").notNull(),
  passwordHash: text("password_hash").notNull(),
  /** The administrator's starting password stops working once the user sets their own. */
  mustChangePassword: boolean("must_change_password").notNull().default(true),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSignInAt: timestamp("last_sign_in_at", { withTimezone: true }),
});

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Only the hash is stored. The opaque token itself lives solely in the cookie. */
    tokenHash: text("token_hash").notNull().unique(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
  },
  (t) => [
    index("sessions_user_id_idx").on(t.userId),
    index("sessions_expires_at_idx").on(t.expiresAt),
  ],
);

export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Human-facing identifier, e.g. MD-AE/2026/0179. */
    number: text("number").notNull().unique(),
    channel: reportChannel("channel").notNull(),
    severity: reportSeverity("severity").notNull(),
    status: reportStatus("status").notNull().default("received"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),

    // Normalized because we filter, sort and assign on these.
    deviceName: text("device_name").notNull(),
    facility: text("facility"),
    reporterName: text("reporter_name"),

    /** e.g. "TMDA/DMD/MDV/F/001 Rev 06" — the form the reporter actually filled in. */
    formVersion: text("form_version").notNull(),
    /** Immutable document snapshot. Never queried by business logic. */
    payload: jsonb("payload").notNull(),

    /** Set when an assessor keys in a report that arrived by email or on paper. */
    enteredByUserId: uuid("entered_by_user_id").references(() => users.id),

    /**
     * The Officer this report is waiting on, named by a Manager — never chosen by the application.
     *
     * Null at intake, always: a newly filed report is unassigned until a Manager hands it to
     * someone. Deliberately not `NOT NULL` for that reason — every report starts in the Manager's
     * unassigned queue, whatever the office's staffing looks like at the moment it arrives.
     *
     * Distinct from `entered_by_user_id` above, which records who typed a report in. The typist
     * and the assessor are often the same person and never mean the same thing, so both columns
     * exist and neither is derived from the other.
     *
     * `assessments.ordinal = 1` names the same person once an F004 exists. Nothing writes that
     * table yet; whatever does must read this column rather than choose again.
     */
    assessor1UserId: uuid("assessor1_user_id").references(() => users.id),
    /** When a Manager made the choice. Null exactly when `assessor1_user_id` is. */
    assessor1AssignedAt: timestamp("assessor1_assigned_at", { withTimezone: true }),

    /**
     * The Officer named as second assessor. Null until the first assessment is submitted and the
     * report reaches `awaiting_second_assessor` — nothing chooses this column at intake.
     */
    assessor2UserId: uuid("assessor2_user_id").references(() => users.id),
    /** When the choice was made. Null exactly when `assessor2_user_id` is. */
    assessor2AssignedAt: timestamp("assessor2_assigned_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("reports_status_idx").on(t.status),
    index("reports_received_at_idx").on(t.receivedAt),
    index("reports_severity_idx").on(t.severity),
    // Serves the Manager's workload count for each candidate Officer when choosing who to assign:
    // how many open reports are already theirs. Both columns in this order, because the count
    // filters on the Officer first and the two open statuses second.
    index("reports_assessor1_status_idx").on(t.assessor1UserId, t.status),
    index("reports_assessor2_status_idx").on(t.assessor2UserId, t.status),
  ],
);

/**
 * Hands out the sequential part of a report number, one counter per financial year (1 July - 30
 * June, keyed as e.g. `"2025-26"`).
 *
 * A `count(*) + 1` over `reports` would race: two reporters submitting at the same moment would
 * read the same count and one insert would die on the unique index. Upserting this row and
 * returning the new value is atomic, so concurrent submissions get distinct numbers.
 */
export const reportCounters = pgTable("report_counters", {
  fy: text("fy").primaryKey(),
  lastSerial: integer("last_serial").notNull().default(0),
});

export const assessments = pgTable(
  "assessments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    assessorId: uuid("assessor_id")
      .notNull()
      .references(() => users.id),
    /** 1 = first assessment, 2 = second assessment. */
    ordinal: smallint("ordinal").notNull(),
    /** e.g. "F004 Rev 03". */
    formVersion: text("form_version").notNull(),
    payload: jsonb("payload").notNull(),
    /** Section 7.1 for the first assessor, 7.2 for the second. */
    conclusion: text("conclusion"),
    /** Null means still a draft. */
    submittedAt: timestamp("submitted_at", { withTimezone: true }),

    /**
     * Who handed this ordinal to this Officer, and when, and by what deadline — the generic
     * assignment shape every ordinal shares, A1 included.
     *
     * Before this, only the report row carried anything like it, and only for ordinal 1
     * (`assessor1_user_id`/`assessor1_assigned_at`) — a shape that cannot describe A3, let alone
     * An. This lives here instead because `(report_id, ordinal)` is already this table's identity:
     * an assignment is a fact about one ordinal of one report, the same as the assessor who holds
     * it, and belongs beside that column rather than bolted onto `reports` a second time.
     *
     * All five nullable, and stay that way for a row created before this migration: nothing before
     * it ever recorded who assigned an assessment or by when, and a backfilled guess would be worse
     * than a history that admits what it does not know. For a row created after, an assigning route
     * sets all five together or none of them — never a deadline without an assigner.
     *
     * `dueAt` is the one downstream readers should use. `deadlineValue`/`deadlineUnit` are what the
     * Manager actually chose (e.g. 3 days), kept so the assignment can be shown back to them in
     * their own words rather than re-derived from a timestamp difference.
     */
    assignedByUserId: uuid("assigned_by_user_id").references(() => users.id),
    assignedAt: timestamp("assigned_at", { withTimezone: true }),
    deadlineValue: integer("deadline_value"),
    deadlineUnit: deadlineUnit("deadline_unit"),
    dueAt: timestamp("due_at", { withTimezone: true }),

    /**
     * The manager's review of this assessment.
     *
     * Here rather than in a table of its own because the row already says which report and which
     * assessment: (report_id, ordinal) is unique, so a review cannot be attached to the wrong half
     * of a report's two assessments. Ordinal 2 carries the same three columns, which is the
     * manager's later review of the second assessment.
     *
     * The three move together, and `managerCommentAt` is the one that means "reviewed" — the text
     * is never read without it.
     */
    managerComment: text("manager_comment"),
    managerCommentBy: uuid("manager_comment_by").references(() => users.id),
    managerCommentAt: timestamp("manager_comment_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One first assessment and one second assessment per report, enforced by the database.
    // "The second assessor must differ from the first" is a domain rule, not expressible here.
    uniqueIndex("assessments_report_ordinal_uq").on(t.reportId, t.ordinal),
    index("assessments_assessor_idx").on(t.assessorId),
    // Serves the overdue/near-deadline sweep every open assessment is read by, once something
    // reads one. Unfiltered on `submittedAt`: a partial index would need updating the day a sweep
    // wants "overdue and unsubmitted" and "completed late" from the same column.
    index("assessments_due_at_idx").on(t.dueAt),
  ],
);

/**
 * The manager's comments on individual sections of one assessment.
 *
 * A table where `managerComment` above is three columns, and for the opposite reason: that stores
 * one verdict about a whole assessment and this stores a list about its parts. Both are wanted —
 * the overall review is what the manager concluded, these are their notes in the margin.
 *
 * Keyed on the assessment row itself rather than on (report_id, ordinal), which the unique index
 * above already resolves to exactly this row. Which report a comment belongs to is a join away
 * and is never stored a second time where the two could disagree.
 *
 * `section` is text rather than an enum: the eight the F004 exposes are a property of a form
 * version, not of the database, and the route is what holds the list of what may be written.
 */
export const assessmentComments = pgTable(
  "assessment_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assessmentId: uuid("assessment_id")
      .notNull()
      .references(() => assessments.id, { onDelete: "cascade" }),
    /** Which part of the form. `"1"` … `"8"`, the F004's own section numbers. */
    section: text("section").notNull(),
    authorUserId: uuid("author_user_id")
      .notNull()
      .references(() => users.id),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Both reads this feature makes — the count beside every bar, and one section's thread — filter
    // on the assessment then the section, and want the oldest first.
    index("assessment_comments_assessment_section_idx").on(t.assessmentId, t.section, t.createdAt),
  ],
);

/**
 * One manager decision on a report — the structured history the assessment cascade's repeated
 * "manager reviews, then decides" step needs once there can be any number of secondary
 * assessments.
 *
 * Not folded onto `assessments.manager_comment`: that column is the manager's review of one
 * specific assessment row and stays exactly that. A decision is a different fact — who decided,
 * when, what they decided, and who they handed the report to next — and it does not belong to any
 * one assessment, including the one just read. Overloading `manager_comment` for it would make a
 * later decision look like it belongs to whichever assessor's row it was written onto, which it
 * does not.
 *
 * `reviewed_through_ordinal` records which submitted assessment was the latest one the manager had
 * read when they decided — the fact that makes this row auditable independent of how many more
 * assessments the report accumulates afterward.
 *
 * The CHECK below is the same discipline `f004.ts`'s `A2SectionResponse` already applies to its
 * three degrees: a `kind` carries exactly its own columns, so a decision that claims to be one
 * thing while carrying the other kind's data cannot be written at all.
 */
export const reportDecisions = pgTable(
  "report_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    decidedByUserId: uuid("decided_by_user_id")
      .notNull()
      .references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
    kind: reportDecisionKind("kind").notNull(),
    /** Required for `assign_next_assessor` at the application layer; optional for the other kind. */
    comment: text("comment"),
    reviewedThroughOrdinal: smallint("reviewed_through_ordinal").notNull(),
    /** Set iff kind = assign_next_assessor. */
    nextAssessorUserId: uuid("next_assessor_user_id").references(() => users.id),
    /** The ordinal created as a result — `reviewed_through_ordinal + 1`, stored rather than
     *  recomputed so this row reads on its own for audit and PDF purposes. */
    nextOrdinal: smallint("next_ordinal"),
    /** Set iff kind = assign_work_officer. */
    workOfficerUserId: uuid("work_officer_user_id").references(() => users.id),
  },
  (t) => [
    index("report_decisions_report_idx").on(t.reportId, t.decidedAt),
    check(
      "report_decisions_kind_columns_ck",
      sql`(kind = 'assign_next_assessor' AND next_assessor_user_id IS NOT NULL
             AND next_ordinal IS NOT NULL AND work_officer_user_id IS NULL)
          OR (kind = 'assign_work_officer' AND work_officer_user_id IS NOT NULL
             AND next_assessor_user_id IS NULL AND next_ordinal IS NULL)`,
    ),
  ],
);

export const assessorAvailability = pgTable("assessor_availability", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  status: availabilityStatus("status").notNull().default("available"),
  /** Only meaningful while on leave. */
  until: date("until"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    /** Key in the object store; the storage adapter owns its shape. */
    objectKey: text("object_key").notNull().unique(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    checksumSha256: text("checksum_sha256").notNull(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("attachments_report_idx").on(t.reportId)],
);

/**
 * Append-only. A follow-up migration revokes UPDATE and DELETE from the application's database
 * role, because a trail the application merely promises not to edit is not a trail.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    /** Null for system actions and for anonymous public submissions. */
    actorUserId: uuid("actor_user_id").references(() => users.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_entity_idx").on(t.entityType, t.entityId),
    index("audit_log_at_idx").on(t.at),
  ],
);

/**
 * The Final Document: what the manager actually approved, frozen at the moment they approved it.
 *
 * The third document in a system that has three. `reports.payload` is the Orange Report as the
 * reporter filed it and never changes. `assessments` is the internal working record — A1, A2, A3
 * and every disagreement and clarification along the way. This is neither: it is the one clean set
 * of resolved answers, in the first assessor's own field vocabulary, with the argument left behind
 * in the rows above.
 *
 * Snapshotted rather than derived, and that is the whole reason the table exists. "What exactly did
 * the manager approve?" has to be answerable next year without replaying a resolution that may
 * have been corrected since, over assessment rows that may have gained a sibling. A derived answer
 * is a claim about the present; this is a record of the past.
 *
 * Deliberately not columns on `reports`. That table is granted UPDATE for the status cascade, so a
 * snapshot living there would be a mutable record of an immutable event. Here the application role
 * holds SELECT and INSERT and nothing else, the same discipline `report_decisions` and
 * `assessment_comments` already keep, and the database is what enforces it rather than a promise.
 *
 * One row per report, by unique index: approval is terminal in this MVP and fires only from
 * `awaiting_decision`, which it leaves. The index is what makes a second one impossible rather
 * than merely unlikely.
 */
export const reportFinalDocuments = pgTable(
  "report_final_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reportId: uuid("report_id")
      .notNull()
      .unique()
      .references(() => reports.id, { onDelete: "cascade" }),
    /** The decision that produced it — the `assign_work_officer` row written in the same statement. */
    decisionId: uuid("decision_id")
      .notNull()
      .references(() => reportDecisions.id),
    approvedByUserId: uuid("approved_by_user_id")
      .notNull()
      .references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * The last assessment folded into this document — A1 alone would be 1, A1..A3 would be 3.
     *
     * Stored rather than recomputed, on the same argument as `report_decisions.next_ordinal`: the
     * row has to read on its own for audit and for the PDF, without a join to a table that has
     * since grown rows this document never saw.
     */
    resolvedThroughOrdinal: smallint("resolved_through_ordinal").notNull(),
    /** The F004 revision the resolved answers are keyed by, e.g. "TMDA/DMD/MDV/F/004 Rev 05". */
    formVersion: text("form_version").notNull(),
    /** `{ kind, answers, provenance }` — see `domain/final-document.ts`. */
    payload: jsonb("payload").notNull(),
  },
  (t) => [index("report_final_documents_approved_at_idx").on(t.approvedAt)],
);

/**
 * IMDRF adverse-event terminology, Phase 1.
 *
 * Deliberately its own two tables with no foreign key from anything above this comment. Every
 * table above describes one report's journey through this office's own workflow; these two
 * describe a vocabulary IMDRF publishes once a year and TMDA merely stores — a fact about the
 * world, not about a report. Wiring a report or an assessment to a term is Phase 3's job, and
 * doing it here would make this migration responsible for a workflow decision it has no business
 * making.
 *
 * `draft` / `published` on `imdrfReleases` is the whole lifecycle: an administrator can inspect
 * and replace a draft as many times as an upload needs correcting, but once published a release
 * is immutable — the same argument `reportFinalDocuments` makes for a snapshot, applied to a
 * publication instead of an approval.
 */
export const imdrfReleaseStatus = pgEnum("imdrf_release_status", ["draft", "published"]);

export const imdrfReleases = pgTable("imdrf_releases", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** The business identifier IMDRF and this office both call a "release" — 2026, 2027, … */
  releaseYear: smallint("release_year").notNull().unique(),
  /** e.g. "IMDRF/AE WG/N43", as printed on the source workbook's cover. Admin-entered; nothing in
   *  the workbook itself carries it reliably enough to scrape. */
  documentCode: text("document_code"),
  title: text("title"),
  /** The uploaded workbook's own filename, kept for audit — "which file produced this release?" */
  sourceFileName: text("source_file_name").notNull(),
  status: imdrfReleaseStatus("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /** Null until `publish` is called. Once set, the release's terms are immutable. */
  publishedAt: timestamp("published_at", { withTimezone: true }),
});

/**
 * One term of one release's terminology, at whatever depth its own annex actually has.
 *
 * `level` and `parentTermId` are computed at import time from `codeHierarchy` — the source
 * workbook's own "A|A01|A0101" trail — and never recomputed by a reader. An annex with two levels
 * and an annex with four both fit the same row shape, because nothing here assumes a maximum.
 *
 * `codeHierarchy` is kept verbatim alongside the two derived columns rather than discarded once
 * `level`/`parentTermId` exist: it is source information, useful for verifying an import against
 * the workbook it came from, and cheap to keep.
 */
export const imdrfTerms = pgTable(
  "imdrf_terms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    releaseId: uuid("release_id")
      .notNull()
      .references(() => imdrfReleases.id, { onDelete: "cascade" }),
    /** "A" through "G". Text, not the sheet's position — a future release could reorder sheets. */
    annex: text("annex").notNull(),
    code: text("code").notNull(),
    term: text("term").notNull(),
    definition: text("definition"),
    nonImdrfCode: text("non_imdrf_code"),
    /** Preserved verbatim from the workbook — "New", "Retired (2020)", "Modified (editorial)", or
     *  absent. Never normalized into an enum: the source text is the fact worth keeping, and IMDRF
     *  has never held these values to one spelling (Annex C alone carries both "Modified
     *  (editorial)" and "Modified (Editorial)"). */
    status: text("status"),
    statusDescription: text("status_description"),
    /** Annex E only; null on every other annex's rows. */
    primaryCategory: text("primary_category"),
    secondaryCategory: text("secondary_category"),
    /** The workbook's own "A|A01|A0101" trail. See the table comment. */
    codeHierarchy: text("code_hierarchy").notNull(),
    parentTermId: uuid("parent_term_id").references((): AnyPgColumn => imdrfTerms.id),
    /** `codeHierarchy.split("|").length` at import time. Never assumed to cap at 3. */
    level: smallint("level").notNull(),
    /** The workbook's own row order within its annex, so the browser can show terms the way IMDRF
     *  laid them out rather than in whatever order Postgres happens to return them. */
    sortOrder: integer("sort_order").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The same code can recur in a later release (a 2027 workbook reusing "G02002" is expected,
    // not a collision) — uniqueness is scoped to the release, never global.
    //
    // `code` alone is not unique within one release: IMDRF's own Annex E cross-lists roughly 200
    // terms under more than one category branch, reusing the same code at each hierarchy position
    // (e.g. E0104 "Cerebral Hyperperfusion Syndrome" appears at both E01|E0104, under Nervous
    // System, and E05|E0104, under Vascular System — the same term, deliberately shown in two
    // places). `code_hierarchy` is what is actually unique: two rows may share a code, but never
    // both a code and the exact position in the tree that code was reused at.
    uniqueIndex("imdrf_terms_release_code_hierarchy_uq").on(t.releaseId, t.code, t.codeHierarchy),
    // Serves both "list an annex's terms in source order" and the annex-count summary.
    index("imdrf_terms_release_annex_sort_idx").on(t.releaseId, t.annex, t.sortOrder),
    // Serves "get this term's children", the tree navigation's only query.
    index("imdrf_terms_release_parent_idx").on(t.releaseId, t.parentTermId),
    index("imdrf_terms_release_level_idx").on(t.releaseId, t.level),
    check("imdrf_terms_annex_ck", sql`annex IN ('A','B','C','D','E','F','G')`),
  ],
);

/** Raw binary storage — the uploaded workbook's own bytes, held only while a staging row lives. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

/**
 * The hold between an administrator's "preview" and "confirm" clicks — not terminology data, and
 * deliberately not the tables above: this is one uploaded workbook's bytes and metadata, kept just
 * long enough to be re-validated and imported, or to expire unused.
 *
 * A row here exists in-memory in earlier deployments; it moved to Postgres because that hold has
 * to survive the request landing on a different application instance than the one that served the
 * preview. Render load-balances across instances when scaled, and an in-memory map on one process
 * is invisible to the others — a persistent disk would fix that only for a single instance and
 * block horizontal scaling entirely, where the database this office already runs does not.
 *
 * `token_hash` is a SHA-256 of the actual token, the same discipline `sessions.token_hash` already
 * keeps: the raw token is a bearer credential (whoever holds it may complete this import) and is
 * never written anywhere, including here — only its hash is, so a database dump holds nothing
 * usable. `created_by_user_id` is audit metadata, not a workflow coupling: it says who started an
 * import, the same way `audit_log.actor_user_id` says who did anything else, and carries no
 * foreign key from `reports`, `assessments`, F004 or the Register into IMDRF — see the comment on
 * `imdrfReleases` above for why that boundary matters.
 */
export const imdrfImportStaging = pgTable(
  "imdrf_import_staging",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull().unique(),
    releaseYear: smallint("release_year").notNull(),
    documentCode: text("document_code"),
    title: text("title"),
    sourceFileName: text("source_file_name").notNull(),
    workbookData: bytea("workbook_data").notNull(),
    /** Who started this import. Null if their account is later removed — the row itself still
     *  expires and cleans up on its own, so nothing here depends on the actor surviving. */
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Past this, the row is stale: `previewImdrfImport`/`confirmImdrfImport` sweep expired rows
     *  on every call, so no separate cron job is needed to keep the table from growing unbounded. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("imdrf_import_staging_expires_at_idx").on(t.expiresAt)],
);
