import type { MessageKey } from "../i18n/index.js";
import { isValidPhone } from "./phone.js";

/**
 * The shape of the orange form, as data.
 *
 * One table drives four things that used to disagree with each other: which fields each step
 * renders, which are mandatory, which only become mandatory once another answer is given, and
 * what the server refuses to move past. Adding a field in the view and forgetting it here is the
 * failure this is designed to make impossible.
 */

export type Step = 1 | 2 | 3 | 4 | 5;

export const FIRST_STEP: Step = 1;
export const LAST_STEP: Step = 5;
export const STEPS: readonly Step[] = [1, 2, 3, 4, 5];

/** Answers as they come back off the wire: one value per field, several for a checkbox group. */
export type Answers = Record<string, string | string[]>;

/**
 * Every field name the form owns, grouped by the step that renders it.
 *
 * The wizard is stateless: on each submit the answers for steps the reporter is not looking at are
 * re-emitted as hidden inputs. This table is what tells the two apart, so a field missing from it
 * would be silently dropped the moment the reporter moves to another step.
 */
export const STEP_FIELDS: Record<Step, readonly string[]> = {
  1: [
    "report_type",
    "device_name",
    "brand_name",
    "common_name",
    "size",
    "serial_number",
    "manufacturing_date",
    "batch_number",
    "expiry_date",
    "manufacturer",
    "source",
    "supplier",
    "status",
    "duration",
    "duration_other",
  ],
  2: [
    "incident_date",
    "devices_involved",
    "incident_type",
    "incident_type_other",
    "incident_narrative",
  ],
  3: ["event_date", "users_involved", "event_type", "event_type_other", "event_narrative"],
  4: [
    "operator",
    "operator_other",
    "measures_taken",
    "measures_outcome",
    "informed_supplier",
    "informed_date",
  ],
  5: [
    "reporter_name",
    "reporter_type",
    "facility_address",
    "location",
    "email",
    "phone",
    "report_date",
    "device_location",
  ],
};

/** A field that only matters once another answer has been given. */
export type Dependency = {
  /** The controlling field, e.g. `informed_supplier`. */
  on: string;
  /** The values of the controlling field that switch this field on. */
  values: readonly string[];
  /**
   * Whether `pruneDependents` should erase the answer once this dependency stops holding.
   *
   * Defaults to true, which is right for a stray explanation left behind by a since-changed
   * checkbox. It is wrong for a whole section's worth of narrative gated on `report_type`: the
   * fields it gates (`incident_type`, `event_type`, ...) are themselves the `on` field for other
   * dependencies (`incident_type_other`), and `pruneDependents` mutates its answers as it goes, so
   * erasing `incident_type` before its own dependents are checked would cascade into erasing them
   * too, even when nothing about their own condition changed. Report-type gating is enforced by
   * `validateStep` and `SubmissionSchema` instead, which is where it belongs — it decides what is
   * mandatory, not what survives on the page.
   */
  prune?: boolean;
};

export type Rule = {
  field: string;
  /** Label to name the field by when telling the reporter it is missing. */
  labelKey: MessageKey;
  /** `list` fields come from checkbox groups and need at least one tick. */
  kind: "text" | "list" | "phone";
  /** Absent means always required. Present means required only while the dependency holds. */
  requiredWhen?: Dependency;
};

/**
 * Mandatory fields per step.
 *
 * These mirror the red asterisks on the paper form, plus the one answer that gates a dependent
 * field: a blank "Have you informed the supplier?" leaves `informed_date` undefined rather than
 * optional, which is not a state a vigilance record should be able to reach.
 */
/** The two kinds of situation the orange form can carry, as the reporter names one. */
export const REPORT_TYPES = ["incident", "adverse_event"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

/** Whichever report type selects "Incident details" as applicable. */
export const INCIDENT_DEPENDENCY: Dependency = {
  on: "report_type",
  values: ["incident"],
  prune: false,
};
/** Whichever report type selects "Event details" as applicable. */
export const ADVERSE_EVENT_DEPENDENCY: Dependency = {
  on: "report_type",
  values: ["adverse_event"],
  prune: false,
};

export const RULES: Record<Step, readonly Rule[]> = {
  1: [
    { field: "report_type", labelKey: "f.report_type", kind: "text" },
    { field: "device_name", labelKey: "f.device_name", kind: "text" },
    {
      field: "duration_other",
      labelKey: "f.duration_other",
      kind: "text",
      requiredWhen: { on: "duration", values: ["Others"] },
    },
  ],
  2: [
    {
      field: "incident_date",
      labelKey: "f.incident_date",
      kind: "text",
      requiredWhen: INCIDENT_DEPENDENCY,
    },
    {
      field: "incident_type",
      labelKey: "f.incident_type",
      kind: "list",
      requiredWhen: INCIDENT_DEPENDENCY,
    },
    {
      field: "incident_type_other",
      labelKey: "f.incident_type_other",
      kind: "text",
      requiredWhen: { on: "incident_type", values: ["Other"] },
    },
    {
      field: "incident_narrative",
      labelKey: "f.incident_narrative",
      kind: "text",
      requiredWhen: INCIDENT_DEPENDENCY,
    },
  ],
  3: [
    {
      field: "event_type",
      labelKey: "f.event_type",
      kind: "list",
      requiredWhen: ADVERSE_EVENT_DEPENDENCY,
    },
    {
      field: "event_type_other",
      labelKey: "f.event_type_other",
      kind: "text",
      requiredWhen: { on: "event_type", values: ["Other"] },
    },
    {
      field: "event_narrative",
      labelKey: "f.event_narrative",
      kind: "text",
      requiredWhen: ADVERSE_EVENT_DEPENDENCY,
    },
  ],
  4: [
    {
      field: "operator_other",
      labelKey: "f.operator_other",
      kind: "text",
      requiredWhen: { on: "operator", values: ["Other"] },
    },
    { field: "measures_taken", labelKey: "f.measures_taken", kind: "text" },
    { field: "informed_supplier", labelKey: "f.informed_supplier", kind: "text" },
    {
      field: "informed_date",
      labelKey: "f.informed_date",
      kind: "text",
      requiredWhen: { on: "informed_supplier", values: ["Yes"] },
    },
  ],
  5: [
    { field: "reporter_name", labelKey: "f.reporter_name", kind: "text" },
    { field: "facility_address", labelKey: "f.facility_address", kind: "text" },
    { field: "location", labelKey: "f.location", kind: "text" },
    { field: "phone", labelKey: "f.phone", kind: "phone" },
    { field: "report_date", labelKey: "f.report_date", kind: "text" },
    { field: "device_location", labelKey: "f.device_location", kind: "text" },
  ],
};

/**
 * Every dependent field on the form, flattened.
 *
 * The view reads this to stamp `data-requires-*` attributes onto the markup, which is what lets
 * the client script grey out an input without knowing a single rule of its own.
 */
export const DEPENDENCIES: Readonly<Record<string, Dependency>> = Object.fromEntries(
  STEPS.flatMap((step) =>
    RULES[step]
      .filter(
        (rule): rule is Rule & { requiredWhen: Dependency } => rule.requiredWhen !== undefined,
      )
      .map((rule) => [rule.field, rule.requiredWhen]),
  ),
);

// ---- Reading answers ---------------------------------------------------------

/** The single value of a field, or "" when the reporter has not filled it in yet. */
export function value(answers: Answers, field: string): string {
  const raw = answers[field];
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return raw[0] ?? "";
  return "";
}

/** Every ticked value of a checkbox group. */
export function list(answers: Answers, field: string): string[] {
  const raw = answers[field];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string" && raw !== "") return [raw];
  return [];
}

/** Whether a dependent field is currently switched on by its controlling answer. */
export function dependencyMet(answers: Answers, dep: Dependency): boolean {
  const current = list(answers, dep.on);
  return dep.values.some((wanted) => current.includes(wanted));
}

/**
 * The device's full name, as the paper form prints it — built from what a reporter actually
 * types, never typed directly.
 *
 * Brand and common name are collected separately because they are separate facts; the full name
 * is what you get from reading both together, so it is computed here instead of being a third
 * thing the reporter could make disagree with the other two. Either half missing still yields a
 * usable name rather than a stray separator with nothing on one side of it.
 */
export function deriveDeviceFullName(brand: string, common: string): string {
  return [brand.trim(), common.trim()].filter((part) => part !== "").join(" — ");
}

// ---- Validation --------------------------------------------------------------

export type Issue = {
  field: string;
  labelKey: MessageKey;
  /** `required` — nothing entered. `phone` — entered, but not a Tanzanian mobile. */
  kind: "required" | "phone";
};

/** Everything wrong with one step, in the order the fields appear on screen. */
export function validateStep(step: Step, answers: Answers): Issue[] {
  const issues: Issue[] = [];

  for (const rule of RULES[step]) {
    if (rule.requiredWhen && !dependencyMet(answers, rule.requiredWhen)) continue;

    if (rule.kind === "list") {
      if (list(answers, rule.field).length === 0) {
        issues.push({ field: rule.field, labelKey: rule.labelKey, kind: "required" });
      }
      continue;
    }

    const entered = value(answers, rule.field).trim();

    if (entered === "") {
      issues.push({ field: rule.field, labelKey: rule.labelKey, kind: "required" });
      continue;
    }

    if (rule.kind === "phone" && !isValidPhone(entered)) {
      issues.push({ field: rule.field, labelKey: rule.labelKey, kind: "phone" });
    }
  }

  return issues;
}

/** The first step that is not complete, or null when everything up to `upTo` is ready. */
export function firstIncompleteStep(answers: Answers, upTo: Step = LAST_STEP): Step | null {
  for (const step of STEPS) {
    if (step > upTo) break;
    if (validateStep(step, answers).length > 0) return step;
  }
  return null;
}

/**
 * Drop answers whose controlling question no longer selects them.
 *
 * Without this a reporter who ticks "Other", types an explanation, then switches back to
 * "Malfunction" would file a report carrying an explanation for an option they did not choose.
 * The client greys the input out; this is what makes it true.
 */
export function pruneDependents(answers: Answers): Answers {
  const pruned: Answers = { ...answers };

  for (const [field, dep] of Object.entries(DEPENDENCIES)) {
    if (dep.prune === false) continue;
    if (!dependencyMet(pruned, dep)) delete pruned[field];
  }

  return pruned;
}

export function parseStep(raw: unknown): Step {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < FIRST_STEP || parsed > LAST_STEP) return FIRST_STEP;
  return parsed as Step;
}

export function shiftStep(step: Step, by: 1 | -1): Step {
  return Math.min(LAST_STEP, Math.max(FIRST_STEP, step + by)) as Step;
}
