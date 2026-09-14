/**
 * Phase 3 — connecting the IMDRF terminology repository to F004 Section 3.
 *
 * Everything a route needs to: resolve one posted `imdrf_terms.id` against the repository for one
 * F004 item, refuse it if it is not what that item is allowed to hold, and — on success — compute
 * the authoritative "preferred terminology level 1/2/3" + coding text that item's existing display
 * fields (`imdrf_<key>_l1`/`_l2`/`_l3`/`_code`) are stored under. Those four fields are never
 * trusted from the client: whatever the route posted for them is replaced by what this module
 * derives from the term id and the release, which is what makes a free-typed or hand-edited value
 * for them impossible to submit, not merely discouraged by the page.
 *
 * `code` alone is deliberately never the identity carried through this module. The same code can
 * recur at more than one hierarchy position within a release (`docs/imdrf-terminology.md`, "Why
 * `code` alone is not unique"), so every function below is keyed on `imdrf_terms.id`.
 *
 * Nothing here decides *when* to call it — `assessment.tsx`'s two POST handlers do, once for A1's
 * own answers and once for a secondary assessor's Disagree replacements — because only the route
 * knows whether this save is a draft (resolve best-effort, block nothing) or a submission (resolve
 * and refuse whatever does not check out).
 */

import type { Database } from "../../db/client.js";
import {
  type F004Answers,
  IMDRF_GROUPS,
  type ImdrfItem,
  imdrfItemForReviewKey,
  type Issue,
  type SecondaryReviewPayload,
  value,
} from "../f004.js";
import { getReleaseCached, getTermCached, getTermLineageCached } from "./cached-query-service.js";

export type ResolvedImdrfTerm = { l1: string; l2: string; l3: string; code: string };

/**
 * Resolves one posted `termId` against the repository for one F004 item: it must exist (and
 * `getTerm` already scopes that lookup to `releaseId`, which is what makes "a term from another
 * release" fail here rather than needing a second check), it must belong to the item's own annex,
 * and it must be a term an assessor may actually stop at — not an intermediate category IMDRF
 * itself marks "Not selectable", and not one with children of its own still to navigate into.
 *
 * Returns the authoritative display text on success: the chosen term's own code, and its ancestors'
 * names read off `getTermLineage`, skipping the annex's own root marker (a bare annex letter, e.g.
 * `"G"`) where the release carries one — so an annex imported with or without that marker row
 * fills the same three "preferred terminology level" boxes either way.
 */
export async function resolveImdrfTerm(
  db: Database,
  releaseId: string,
  item: ImdrfItem,
  termId: string,
): Promise<{ ok: true; resolved: ResolvedImdrfTerm } | { ok: false; message: string }> {
  const label = item.title.replace(/\s*\(If applicable\)\s*$/, "");
  const term = await getTermCached(db, releaseId, termId);
  if (term === null) {
    return { ok: false, message: `${label}: the selected term does not exist in the selected IMDRF release.` };
  }

  if (term.annex !== item.annexLetter) {
    return {
      ok: false,
      message: `${label}: the selected term must come from IMDRF Annex ${item.annexLetter}, not Annex ${term.annex}.`,
    };
  }

  const notSelectable = (term.status ?? "").toLowerCase().includes("not selectable");
  if (term.hasChildren || notSelectable) {
    return {
      ok: false,
      message: `${label}: choose the most specific term in the hierarchy, not a category heading.`,
    };
  }

  const lineage = await getTermLineageCached(db, releaseId, term.id);
  const named = lineage.filter((step) => step.code !== item.annexLetter);
  const l1 = named[0]?.term ?? "";
  const l2 = named[1]?.term ?? "";
  const l3 = named[2]?.term ?? "";

  return { ok: true, resolved: { l1, l2, l3, code: term.code } };
}

async function requirePublishedRelease(db: Database, releaseId: string): Promise<boolean> {
  if (releaseId === "") return false;
  const release = await getReleaseCached(db, releaseId);
  return release?.status === "published";
}

/** Every IMDRF item, keyed by its own field key ("component", "device_problem", …). */
const ITEM_BY_FIELD_KEY = new Map<string, ImdrfItem>(
  IMDRF_GROUPS.flatMap((group) => group.items.map((item) => [item.key, item])),
);

export function imdrfItemByFieldKey(key: string): ImdrfItem | undefined {
  return ITEM_BY_FIELD_KEY.get(key);
}

function itemTouched(answers: F004Answers, item: ImdrfItem): boolean {
  return (
    value(answers, `imdrf_${item.key}_term_id`).trim() !== "" ||
    value(answers, `imdrf_${item.key}_l1`).trim() !== "" ||
    value(answers, `imdrf_${item.key}_code`).trim() !== ""
  );
}

function clearDisplay(answers: F004Answers, item: ImdrfItem): void {
  answers[`imdrf_${item.key}_l1`] = "";
  answers[`imdrf_${item.key}_l2`] = "";
  answers[`imdrf_${item.key}_l3`] = "";
  answers[`imdrf_${item.key}_code`] = "";
}

async function resolveOneA1Item(
  db: Database,
  answers: F004Answers,
  item: ImdrfItem,
  releaseId: string,
  releasePublished: boolean,
  strict: boolean,
  issues: Issue[],
): Promise<void> {
  const termIdField = `imdrf_${item.key}_term_id`;
  const termId = value(answers, termIdField).trim();
  const label = item.title.replace(/\s*\(If applicable\)\s*$/, "");

  if (termId === "") {
    // No controlled reference behind whatever (if anything) is in the display fields. A client
    // that hand-typed free text with no term id is exactly the case Section "TERM SELECTION UI"
    // forbids, so on submit it is refused rather than silently accepted or silently dropped.
    if (strict && itemTouched(answers, item)) {
      issues.push({
        field: termIdField,
        message: `${label}: choose the terminology from the IMDRF repository — free text is not accepted.`,
      });
    } else {
      clearDisplay(answers, item);
    }
    return;
  }

  if (!releasePublished) {
    // Nothing to resolve against. On a draft this is simply not-yet-ready; on a submission the
    // missing/unpublished-release issue raised in `resolveA1Imdrf` already explains why, so this
    // item's own issue would only repeat it under a different field.
    if (!strict) clearDisplay(answers, item);
    return;
  }

  const resolved = await resolveImdrfTerm(db, releaseId, item, termId);
  if (!resolved.ok) {
    if (strict) issues.push({ field: termIdField, message: resolved.message });
    clearDisplay(answers, item);
    return;
  }

  answers[`imdrf_${item.key}_l1`] = resolved.resolved.l1;
  answers[`imdrf_${item.key}_l2`] = resolved.resolved.l2;
  answers[`imdrf_${item.key}_l3`] = resolved.resolved.l3;
  answers[`imdrf_${item.key}_code`] = resolved.resolved.code;
}

/**
 * Resolves and validates every IMDRF item on A1's own answers, in place: any item carrying a
 * `imdrf_<key>_term_id` has its `_l1`/`_l2`/`_l3`/`_code` fields overwritten with the authoritative
 * text `resolveImdrfTerm` derives from it, and any item with no term id has those four fields
 * cleared — a client cannot leave stale or hand-typed text behind by simply not posting a term id.
 *
 * `strict` distinguishes a submission from a draft. A draft resolves best-effort and reports
 * nothing: an assessor mid-work may have an item half chosen, and a draft is allowed to be as
 * incomplete as the paper allows. A submission additionally requires the release itself (published)
 * and, for every item that is "touched" at all, a term id that actually resolves.
 * `validateForSubmit` (`domain/f004.ts`) already requires *some* value for a non-optional item and
 * requires the level/coding pair to be complete or absent for a touched one; this is the one thing
 * that pure, DB-free function cannot check on its own, because only this module can ask the
 * repository whether a reference is real.
 */
export async function resolveA1Imdrf(
  db: Database,
  answers: F004Answers,
  strict: boolean,
): Promise<Issue[]> {
  const issues: Issue[] = [];
  const releaseId = value(answers, "imdrf_release_id").trim();

  const anyItemTouched = IMDRF_GROUPS.some((group) =>
    group.items.some((item) => itemTouched(answers, item)),
  );

  if (strict && anyItemTouched && releaseId === "") {
    issues.push({
      field: "imdrf_release_id",
      message: "Choose the published IMDRF release this assessment's terminology comes from.",
    });
  }

  const releasePublished = releaseId !== "" ? await requirePublishedRelease(db, releaseId) : false;

  if (strict && releaseId !== "" && !releasePublished) {
    issues.push({
      field: "imdrf_release_id",
      message: "The selected IMDRF release is not published.",
    });
  }

  for (const group of IMDRF_GROUPS) {
    for (const item of group.items) {
      await resolveOneA1Item(db, answers, item, releaseId, releasePublished, strict, issues);
    }
  }

  return issues;
}

/**
 * Resolves and validates a secondary assessor's Disagree replacements for the IMDRF items, in
 * place on `review`: `review.second["a2_imdrf_term_<reviewKey>"]` (see `F004_SECONDARY_FIELDS` in
 * `domain/f004.ts`) is the posted term id, and on success `review.responses[reviewKey].value`'s
 * existing `l1`/`l2`/`l3`/`code` fields are overwritten with the authoritative text — the same
 * relationship `resolveA1Imdrf` has to A1's own answers.
 *
 * `releaseId` is always the report's own established release — A1's `imdrf_release_id` — never a
 * value this assessor chooses: "RELEASE CONSISTENCY" requires every secondary assessment to stay on
 * the release A1 was coded against, and reading it from anywhere else would let a later ordinal
 * drift onto a different year's terminology.
 */
export async function resolveSecondaryImdrfReplacements(
  db: Database,
  releaseId: string,
  review: SecondaryReviewPayload,
  strict: boolean,
): Promise<Issue[]> {
  const issues: Issue[] = [];
  const releasePublished = releaseId !== "" ? await requirePublishedRelease(db, releaseId) : false;

  for (const [reviewKey, response] of Object.entries(review.responses)) {
    if (response.degree !== "disagree") continue;

    const item = imdrfItemForReviewKey(reviewKey);
    if (item === undefined) continue; // not one of the seven IMDRF review items

    const val = response.value;
    if (typeof val !== "object" || val === null || Array.isArray(val)) continue;
    const fields = val as Record<string, string>;
    const label = item.title.replace(/\s*\(If applicable\)\s*$/, "");

    const termIdField = `a2_imdrf_term_${reviewKey}`;
    const termId = ((review.second?.[termIdField] as string | undefined) ?? "").trim();
    const anythingPosted = Object.values(fields).some((entry) => entry.trim() !== "");

    if (termId === "") {
      if (strict && anythingPosted) {
        issues.push({
          field: termIdField,
          message: `${label}: choose the replacement terminology from the IMDRF repository — free text is not accepted.`,
        });
      } else {
        fields.l1 = "";
        fields.l2 = "";
        fields.l3 = "";
        fields.code = "";
      }
      continue;
    }

    if (!releasePublished) {
      if (strict) {
        issues.push({
          field: termIdField,
          message:
            "The first assessment's IMDRF release is missing or unpublished, so a replacement term cannot be validated.",
        });
      }
      continue;
    }

    const resolved = await resolveImdrfTerm(db, releaseId, item, termId);
    if (!resolved.ok) {
      if (strict) issues.push({ field: termIdField, message: resolved.message });
      continue;
    }

    fields.l1 = resolved.resolved.l1;
    fields.l2 = resolved.resolved.l2;
    fields.l3 = resolved.resolved.l3;
    fields.code = resolved.resolved.code;
  }

  return issues;
}
