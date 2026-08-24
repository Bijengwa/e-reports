/**
 * The Final Document: the Orange Report's assessment, as one resolved answer per question.
 *
 * Three things exist and they are not the same document. The Orange Report is what a reporter
 * filed and never changes. The assessments — A1, A2, A3, … An — are the internal working record of
 * how the office argued its way to a position. The Final Document is the position: one answer per
 * question, with no trace of the argument, snapshotted at the moment a manager approves it.
 *
 * This module is only the middle step — turning a chain of assessments into that one set of
 * answers. It reads nothing and writes nothing; the caller supplies the chain and stores what
 * comes back. That is deliberate: the resolution is the part that has to be right, and it is
 * testable as a pure function over payloads that a database round-trip would only obscure.
 *
 * The output is keyed by the FIRST assessor's own field names — `seriousness`, `c2_6`,
 * `conclusion` — and not by review-item keys. A final document in the shape of an F004 payload is
 * one the existing F004 renderer can already print, and one a later PDF can consume without
 * learning a second vocabulary.
 */

import {
  type A2Degree,
  type A2ReviewItem,
  type A2Value,
  type F004Answers,
  SECONDARY_REVIEW_ITEMS,
  type SecondaryReviewPayload,
} from "./f004.js";

/** Stamped on every snapshot, so a document written under an older resolution stays readable. */
export const FINAL_DOCUMENT_KIND = "final_document_v1";

/**
 * Which assessment settled one answer, and how.
 *
 * Not the history — that stays in `assessments` and `report_decisions`, in full, forever. This is
 * the single line of attribution a reader of the final document is owed: this answer is A1's own,
 * or A3 replaced it, or A2 clarified it. A manager asked "why does 2.6 say this?" can point at it
 * without the document itself having to argue.
 *
 * `degree` is `"original"` for an answer no later assessor touched. The four A2 degrees mean what
 * they mean in `f004.ts`; nothing here re-decides them.
 */
export type FinalProvenance = {
  ordinal: number;
  degree: A2Degree | "original";
  /**
   * The words the deciding assessor supplied, where the F004 has nowhere to put them.
   *
   * Most items either carry a comment box or ARE prose, and a statement lands in the answers
   * themselves. The rest — 1.3, 1.19, 4.2, the IMDRF rows — are a bare choice on the paper, so a
   * clarification about one of them would otherwise be dropped on the floor. Kept here instead:
   * the resolved answer is still the answer, and the note is readable beside it.
   */
  note?: string;
};

export type FinalDocument = {
  kind: typeof FINAL_DOCUMENT_KIND;
  /** The resolved answers, in the first assessor's own field vocabulary. */
  answers: F004Answers;
  /** One entry per review item, keyed by the item's own key — "2.6", "7.1_conclusion". */
  provenance: Record<string, FinalProvenance>;
};

/** One submitted assessment in the chain, as the resolver needs to read it. */
export type ChainEntry = {
  ordinal: number;
  review: SecondaryReviewPayload;
};

/**
 * Where a clarification's or a disagreement's words go for this item, if anywhere.
 *
 * The comment box the paper prints beside the answer, when there is one; the answer itself when
 * the answer is prose; and nothing at all for a bare choice. This is the whole of "the resolution
 * must respect the field type" on the statement half — see `prose` in `f004.ts` for why the two
 * cases cannot be collapsed into `valueKind === "text"`.
 */
export function statementFieldOf(item: A2ReviewItem): string | undefined {
  if (item.commentField !== undefined) return item.commentField;
  if (item.prose === true) return item.a1Fields[0];
  return undefined;
}

/**
 * Write one replacement answer into the resolved payload, in the shape the item takes.
 *
 * Four kinds, four shapes, and the `fields` case pairs `item.fields[i]` with `item.a1Fields[i]` on
 * the same guarantee `a1ValueOf` in `f004.ts` relies on: both lists are built in one expression
 * from one row of the form, in one order.
 *
 * A blank part of a `fields` value still overwrites. A disagreeing assessor who cleared a coding
 * box meant to clear it, and carrying the previous assessor's code forward under the new
 * terminology would be this function inventing a hybrid answer nobody wrote.
 */
function writeAnswer(answers: F004Answers, item: A2ReviewItem, replacement: A2Value): void {
  const field = item.a1Fields[0];

  if (item.valueKind === "multi") {
    answers[field ?? item.key] = Array.isArray(replacement)
      ? replacement.filter((entry) => entry.trim() !== "")
      : [];
    return;
  }

  if (item.valueKind === "fields") {
    const parts =
      typeof replacement === "object" && replacement !== null && !Array.isArray(replacement)
        ? replacement
        : {};

    (item.fields ?? []).forEach((box, index) => {
      const target = item.a1Fields[index];
      if (target === undefined) return;
      answers[target] = (parts[box.key] ?? "").trim();
    });
    return;
  }

  if (field === undefined) return;
  answers[field] = typeof replacement === "string" ? replacement.trim() : "";
}

/**
 * The Orange Report's assessment, resolved to one answer per question.
 *
 * The fold is the whole rule, and it is applied per item rather than per payload. A "latest
 * payload wins" resolution would be wrong in three separate ways: it would lose every answer the
 * latest assessor agreed with, it would let a clarification silently overwrite a radio button, and
 * it would let an item nobody touched fall back to nothing.
 *
 * Starting from A1's answers and letting each later assessment amend only what it actually
 * disturbed is what makes agreement free — an assessor who agrees changes nothing, so there is
 * nothing to write down — and what keeps a clarification's blast radius to the words it clarified.
 *
 * Ordinal order, ascending, not payload order. A2's disagreement is superseded by A3's, and the
 * last resolved assessor's answer is the one the manager approved. Anything not submitted is not
 * part of the chain: a draft is one Officer's unfinished work and has never been a finding.
 *
 * Fields the F004 carries but no review item is a position on — section 1's requirement comments,
 * the assessor's signature, the assessed date — pass through from A1 untouched. They are A1's
 * record of the report and there is nothing for a second opinion to be about; A1's own signature
 * staying A1's is the correct outcome, not an oversight.
 */
export function resolveFinalDocument(
  a1Answers: F004Answers,
  chain: readonly ChainEntry[],
): FinalDocument {
  const answers: F004Answers = { ...a1Answers };
  const provenance: Record<string, FinalProvenance> = {};

  for (const item of SECONDARY_REVIEW_ITEMS) {
    provenance[item.key] = { ordinal: 1, degree: "original" };
  }

  const ordered = [...chain].sort((a, b) => a.ordinal - b.ordinal);

  for (const entry of ordered) {
    for (const item of SECONDARY_REVIEW_ITEMS) {
      const response = entry.review.responses[item.key];
      if (response === undefined) continue;

      const statementField = statementFieldOf(item);
      const statement = (response.statement ?? "").trim();

      // Agree: the standing answer stands, and so does whoever it belongs to. There is nothing to
      // write, which is exactly what agreeing means — the value is already right.
      if (response.degree === "agree") continue;

      if (response.degree === "clarification") {
        // The one degree that must not touch the answer. The radio, the checkboxes and the IMDRF
        // coding stay as the previous assessment left them; only the words change. An item with
        // nowhere to put words keeps them as a note rather than losing them.
        if (statement === "") continue;

        provenance[item.key] =
          statementField === undefined
            ? { ordinal: entry.ordinal, degree: "clarification", note: statement }
            : { ordinal: entry.ordinal, degree: "clarification" };

        if (statementField !== undefined) answers[statementField] = statement;
        continue;
      }

      // Disagree and supplied both carry a replacement answer, and are told apart only by whether
      // there was an answer there to replace. Both write it; the provenance keeps them distinct so
      // the record never claims an assessor found fault with something A1 never said.
      if (response.degree === "disagree" || response.degree === "supplied") {
        if (response.value !== undefined) writeAnswer(answers, item, response.value);

        // A disagreement replaces the answer, so the words justifying the answer it replaced can
        // no longer stand beside it. `supplied` never carries a statement — the page offers none.
        if (statement !== "" && statementField !== undefined) {
          answers[statementField] = statement;
        }

        provenance[item.key] = {
          ordinal: entry.ordinal,
          degree: response.degree,
          ...(statement !== "" && statementField === undefined ? { note: statement } : {}),
        };
      }
    }
  }

  return { kind: FINAL_DOCUMENT_KIND, answers, provenance };
}

/**
 * A stored snapshot, read as the document it claims to be — or as an empty one.
 *
 * The same discipline `normalizeSecondaryReview` applies to an assessment payload, and for the
 * same reason: a jsonb column holds whatever was put in it, including a document written under an
 * older shape of this module. Read through the current item table rather than trusted.
 *
 * Answers pass through as they were stored, string or list, because the F004's own field set is a
 * property of the form version stamped beside them and not of this reader. Provenance is filtered
 * to items the form still has, so a key the form dropped cannot reach the page.
 */
export function normalizeFinalDocument(payload: unknown): FinalDocument {
  const raw = (payload ?? {}) as {
    kind?: unknown;
    answers?: unknown;
    provenance?: Record<string, { ordinal?: unknown; degree?: unknown; note?: unknown }>;
  };

  if (raw.kind !== FINAL_DOCUMENT_KIND) {
    return { kind: FINAL_DOCUMENT_KIND, answers: {}, provenance: {} };
  }

  const answers: F004Answers = {};
  const source = (
    typeof raw.answers === "object" && raw.answers !== null ? raw.answers : {}
  ) as Record<string, unknown>;

  for (const [key, entry] of Object.entries(source)) {
    if (typeof entry === "string") answers[key] = entry;
    else if (Array.isArray(entry)) {
      answers[key] = entry.filter((one): one is string => typeof one === "string");
    }
  }

  const provenance: Record<string, FinalProvenance> = {};
  const stored =
    typeof raw.provenance === "object" && raw.provenance !== null ? raw.provenance : {};

  for (const item of SECONDARY_REVIEW_ITEMS) {
    const entry = stored[item.key];
    if (entry === undefined) continue;

    const ordinal = typeof entry.ordinal === "number" ? entry.ordinal : 1;
    const degree = String(entry.degree ?? "original") as FinalProvenance["degree"];
    const note =
      typeof entry.note === "string" && entry.note.trim() !== "" ? entry.note : undefined;

    provenance[item.key] = { ordinal, degree, ...(note === undefined ? {} : { note }) };
  }

  return { kind: FINAL_DOCUMENT_KIND, answers, provenance };
}
