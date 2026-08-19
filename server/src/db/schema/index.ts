import {
  bigint,
  bigserial,
  boolean,
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

/** The cascade, as data. Transitions are enforced in `domain/`, never by callers. */
export const reportStatus = pgEnum("report_status", [
  "received",
  "first_assessment",
  "awaiting_second_assessor",
  "second_assessment",
  "awaiting_decision",
  "closed",
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
     * The Officer this report is waiting on, chosen when it was filed.
     *
     * Null means nobody could be chosen — no active assessor existed at intake — and the report
     * is an orphan waiting for one. Deliberately not `NOT NULL`: refusing a vigilance report
     * because the office is unstaffed would lose the report, which is the one outcome worse than
     * an unassigned one.
     *
     * Distinct from `entered_by_user_id` above, which records who typed a report in. The typist
     * and the assessor are often the same person and never mean the same thing, so both columns
     * exist and neither is derived from the other.
     *
     * `assessments.ordinal = 1` names the same person once an F004 exists. Nothing writes that
     * table yet; whatever does must read this column rather than choose again.
     */
    assessor1UserId: uuid("assessor1_user_id").references(() => users.id),
    /** When the choice was made. Null exactly when `assessor1_user_id` is. */
    assessor1AssignedAt: timestamp("assessor1_assigned_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("reports_status_idx").on(t.status),
    index("reports_received_at_idx").on(t.receivedAt),
    index("reports_severity_idx").on(t.severity),
    // Serves the workload count the assignment runs for every candidate on every intake: how many
    // open reports are this Officer's. Both columns in this order, because the count filters on
    // the Officer first and the two open statuses second.
    index("reports_assessor1_status_idx").on(t.assessor1UserId, t.status),
  ],
);

/**
 * Hands out the sequential part of a report number, one counter per year.
 *
 * A `count(*) + 1` over `reports` would race: two reporters submitting at the same moment would
 * read the same count and one insert would die on the unique index. Incrementing a row and
 * returning the new value is atomic, so concurrent submissions get distinct numbers.
 */
export const reportCounters = pgTable("report_counters", {
  year: integer("year").primaryKey(),
  issued: integer("issued").notNull().default(0),
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One first assessment and one second assessment per report, enforced by the database.
    // "The second assessor must differ from the first" is a domain rule, not expressible here.
    uniqueIndex("assessments_report_ordinal_uq").on(t.reportId, t.ordinal),
    index("assessments_assessor_idx").on(t.assessorId),
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
