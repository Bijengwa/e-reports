import type { Children } from "@kitajs/html";
import {
  A2_DEGREE_LABELS,
  type A2ReviewItem,
  type A2Value,
  ACTIONS,
  ASSESSED_DEVICE_KEYS,
  allowedDegrees,
  CAUSALITY_DISCUSSION_NOTE,
  CAUSALITY_OPTIONS,
  DEVICE_ROWS,
  DEVICE_TYPE_OPTIONS,
  type DeviceRow,
  EVENT_ROWS,
  EXPECTEDNESS_NOTE,
  EXPECTEDNESS_OPTIONS,
  F004_TITLE,
  F004_VERSION,
  type F004Answers,
  IMDRF_GROUPS,
  IMDRF_NOTE,
  type Issue,
  imdrfItemForReviewKey,
  isA1Blank,
  list,
  PUBLIC_HEALTH_QUESTION,
  REPORT_STAGE_OPTIONS,
  RISK_IVD_NOTE,
  RISK_NOTE,
  RISK_OPTIONS,
  SECONDARY_REVIEW_ITEMS,
  SERIOUS_CRITERIA,
  SERIOUSNESS_OPTIONS,
  type SecondaryReviewPayload,
  type SecondaryReviewResponse,
  SIGNAL_CRITERIA,
  SIGNAL_NOTE,
  SIGNAL_OPTIONS,
  SOURCE_IVD_GUIDANCE,
  SOURCE_MD_GUIDANCE,
  SOURCE_NOTE,
  SOURCE_OPTIONS,
  value,
  YES_NO,
} from "../../../../domain/f004.js";

/** a, b, c, … — the paper's own sub-labels, for the IMDRF items and the signal criteria list. */
const LETTERS = "abcdefghij";

/**
 * TMDA/DMD/MDV/F/004 Rev 05, on the web.
 *
 * The paper is a numbered document with blue section bars and a Requirements/Comments column pair,
 * and an assessor works against the paper. So this renders that document rather than a stack of
 * browser defaults: the numbering, the order and the criteria are the form's own, read from
 * `domain/f004` so the page cannot drift from what is validated and stored.
 *
 * Every criterion an assessor must weigh is on screen. Causality and risk especially are cards
 * carrying the official definitions, because choosing "Probable" from a bare dropdown asks the
 * assessor to remember a regulatory standard instead of applying one.
 */

/**
 * Which of the two documents this rendering IS.
 *
 * `"assessment"` is the working F004 — an assessor's own, or a manager reading one back. It names
 * its assessors, carries 7.2 and ends in the assessors' signature block, because all of that is
 * what an assessment is.
 *
 * `"final"` is the concluded F004 a manager approved. The answers are the same answers, rendered by
 * the same components, and the paper is recognisably the same paper — but everything that belongs
 * to *how* the office reached them is gone: no assessor strip, no assessor dates, no 7.2, no
 * secondary-assessor slot, and a signature section naming the manager who approved it rather than
 * anybody who assessed it. The working record stays where it has always been, in `assessments`,
 * readable on the report page by the people entitled to read it.
 *
 * A mode over one renderer rather than a second component, for the reason `documentMode` gives one
 * level down: a final F004 that did not come out of the F004 renderer would be a second form to
 * keep in step with the first, and the moment the two drifted, the authoritative document would be
 * the one nobody was maintaining.
 */
export type F004Presentation = "assessment" | "final";

export type F004FormProps = {
  reportId: string;
  answers: F004Answers;
  /** Section 1, filled from the report. Read, not typed. */
  device: Record<string, string>;
  /** Section 2's first four rows, likewise. */
  event: Record<string, string>;
  assessorName: string;
  /** The date beside the first assessor's name: today, or the day it was submitted. */
  assessedOn: string;
  /**
   * Which document this is. Defaults to the working assessment, which is every caller but one.
   *
   * `"final"` suppresses the assessment-only material listed on `F004Presentation` and is the only
   * thing that does; the answers, the section bars and the numbering are untouched by it.
   */
  presentation?: F004Presentation;
  /**
   * Who approved this document and when — section 8's whole content in `"final"` presentation.
   *
   * The manager, always. They are the only signature a concluded F004 carries: the assessors wrote
   * the assessment, the manager approved the result, and it is the approval that makes this the
   * office's position rather than one officer's opinion.
   */
  approval?: { byName: string; on: string };
  /** Once submitted the document is closed: everything disabled, and the buttons gone. */
  submitted: boolean;
  /**
   * Rendered as a record to be read, never as a form to be filled in.
   *
   * A submitted assessment is already this, so `submitted` implies it. The flag exists for the
   * reader who is not its author and never could be — the manager reviewing a finished F004 on
   * `/reports/:id` — where "closed because it is finished" and "closed because it is not yours"
   * are different reasons for the same rendering.
   */
  readOnly?: boolean;
  /**
   * Render as a finished document rather than as a filled-in form.
   *
   * `readOnly` already closes every control; this is the further step of not drawing them as
   * controls at all. A form shows a reader the whole question — every option, with a mark against
   * the chosen one — because the reader might change the answer. A document shows the answer. Four
   * unticked risk cards under one ticked one are the working form saying "these were the choices";
   * on the approved F004 they are noise, and on the PDF that comes out of it they would be wrong.
   *
   * Implemented as a scope class over the existing markup rather than as a second set of
   * components: every choice on this form — radio row, criteria card, action tick — is a
   * `.f4-choice-pair` around a real input whose `checked` is the stored answer, so what to keep is
   * already in the DOM and what to drop is `:not(:has(input:checked))`. A parallel renderer would
   * be a second F004 to keep in step with the first.
   *
   * Blank stays blank and keeps its space: an unanswered question on a finished document is a fact
   * about the assessment, and filling it with "—" would be this page inventing an answer.
   */
  documentMode?: boolean;
  /**
   * Resolved clarification statements, keyed by review-item key — "1.3", "4.2", "3.1.1".
   *
   * Only for the approved final document, and only for the items the F004 gives no comment box
   * of its own. Everything else a clarification touches is already in `answers`, because the
   * resolver wrote it into the field the form reads.
   */
  resolvedNotes?: Record<string, string>;
  /** The manager's notes per section, keyed "1"…"8". Absent on the Officer's live form. */
  sectionComments?: Record<string, SectionComment[]>;
  /** Where a note on a given section is posted. Absent means the form draws no comment UI. */
  commentAction?: (section: string) => string;
  /**
   * Leave every trace of a secondary assessment out of the document: the masthead's own
   * secondary-assessor cells, and Section 8's secondary-assessor signature row.
   *
   * For A1's own live page, which has no secondary assessment yet and never writes one — a
   * placeholder row there would imply a second assessor the report may never have, on a form the
   * first assessor is trying to fill in.
   */
  omitSecond?: boolean;
  /**
   * The secondary assessment actively relevant to this page — the officer's own open or
   * just-submitted row. Undefined on the manager's page, which reads every secondary review but
   * never writes one; there every submitted review arrives through `priorReviews` instead.
   */
  a2Review?: {
    action: string;
    review: SecondaryReviewPayload;
    submitted: boolean;
    /**
     * Which assessment in the chain this one is — 2, 3, 4, …
     *
     * Carried rather than assumed, because the badge drawn beside every replacement control names
     * it. Hardcoding "A2" was true only while a report could have exactly one secondary assessor;
     * on an A3's page it labelled all thirty-nine of that officer's own controls as somebody
     * else's. Defaults to 2 where a caller has no ordinal to hand.
     */
    ordinal?: number;
    /** The reviewer's name and the day they signed, once submitted — for the header strip. */
    assessorName?: string;
    assessedOn?: string;
  };
  /**
   * Every other submitted secondary review (A2..An, excluding whichever one `a2Review` already
   * represents), for the collapsed per-item "Previous assessments" history.
   *
   * A separate list rather than folded into `a2Review` because the two answer different
   * questions: `a2Review` is what this page is actively about, `priorReviews` is context read on
   * demand. Kept apart so a page that has no active review of its own — the manager's — can still
   * carry the whole accumulated picture without inventing a fake "current" one.
   */
  priorReviews?: readonly PriorSecondaryReview[];
  issues: readonly Issue[];
  /**
   * The release every IMDRF picker on this form is scoped to — resolved server-side
   * (`domain/imdrf/f004-integration.ts`), never a value the assessor chooses. There is no control
   * anywhere on this form for it; every picker reads it straight off `answers.imdrf_release_id`,
   * which the route stamps before rendering. This prop is purely the passive display label
   * ("IMDRF/AE WG/N43 · 2026") shown beside "IMDRF release".
   */
  imdrfReleaseLabel?: string;
};

/** One earlier secondary assessor's finished work, as the per-item history reads it. */
export type PriorSecondaryReview = {
  ordinal: number;
  assessorName: string;
  submittedOn: string;
  review: SecondaryReviewPayload;
};

/**
 * The document's outer element: a real form only when there is something to post.
 *
 * A disabled fieldset already submits nothing, but a `<form>` that can never be used is still a
 * POST target advertised on the page, and on the manager's report it advertised a route that
 * answers 403. Read-only means no form element at all, so what the page offers and what the
 * reader may do are the same list.
 */
function Sheet({
  locked,
  documentMode,
  reportId,
  action,
  children,
}: {
  locked: boolean;
  documentMode?: boolean;
  reportId: string;
  action?: string;
  children?: Children;
}): JSX.Element {
  if (locked) {
    return <div class={documentMode === true ? "f4 f4-document" : "f4"}>{children}</div>;
  }

  return (
    <form method="POST" action={action ?? `/reports/${reportId}/assessment-1`} class="f4">
      {children}
    </form>
  );
}

/** One manager note against one section, as the thread prints it. */
export type SectionComment = {
  author: string;
  body: string;
  /** Already formatted for reading — the view does no date arithmetic. */
  at: string;
};

/** The speech-bubble, drawn to the same contract as the rail's icons and the tab bars'. */
function IconComment(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M21 12a8 8 0 0 1-8 8H7l-4 3v-4.6A8 8 0 0 1 11 4h2a8 8 0 0 1 8 8z" />
    </svg>
  );
}

/**
 * The comments on one section, folded away until asked for.
 *
 * A `<details>` rather than a script: this door renders on the server and the drawer on the
 * assessment page is already a checkbox, so a panel that opens without JavaScript is the house
 * pattern rather than a compromise. It also keeps the count readable while the panel is shut,
 * which is what a manager scanning eight sections actually wants.
 *
 * Drawn when there is something to say or somewhere to say it. On the Officer's own live form
 * there is neither, so this renders nothing at all and the form they fill in is unchanged.
 *
 * `action` absent with comments present is the third case, and the one this exists for: the notes
 * a manager wrote at a stage the report has since moved past. They stay readable — they are part
 * of how the decision was reached — but the box to add to them is gone, because that stage is
 * over and a control that writes into a finished stage is a control that lies about it.
 */
function SectionComments({
  no,
  comments,
  action,
}: {
  no: string;
  comments: readonly SectionComment[];
  action?: string;
}): JSX.Element {
  return (
    <details class="f4-notes">
      <summary>
        <IconComment />
        <span>
          {comments.length} {comments.length === 1 ? "comment" : "comments"}
        </span>
      </summary>

      {comments.length > 0 && (
        <ol class="f4-note-list">
          {comments.map((comment) => (
            <li>
              <div class="f4-note-who">
                <b safe>{comment.author}</b>
                <span class="hint" safe>
                  {comment.at}
                </span>
              </div>
              <p safe>{comment.body}</p>
            </li>
          ))}
        </ol>
      )}

      {/* Outside the F004's own form — a form cannot nest — and posting to its own address, so a
          comment on section 3 can only ever be a comment on section 3. */}
      {action === undefined ? (
        <></>
      ) : (
        <form method="POST" action={action} class="f4-note-write">
          <label class="vh" for={`note-${no}`}>
            Comment on section {no}
          </label>
          <textarea
            id={`note-${no}`}
            name="body"
            rows="2"
            placeholder="Write a comment…"
          ></textarea>
          <button type="submit" class="btn btn-sm">
            Send
          </button>
        </form>
      )}
    </details>
  );
}

function Bar({
  no,
  title,
  comments,
  action,
}: {
  no: string;
  title: string;
  comments?: readonly SectionComment[];
  action?: string;
}): JSX.Element {
  return (
    <>
      <div class="f4-bar">
        <span class="f4-bar-no" safe>
          {no}
        </span>
        <span safe>{title}</span>
      </div>
      {/* Either there is somewhere to write, or there is something already written. A section
          with neither draws nothing — which is every section of an Officer's own live form. */}
      {action !== undefined || (comments?.length ?? 0) > 0 ? (
        <SectionComments no={no} comments={comments ?? []} action={action} />
      ) : (
        <></>
      )}
    </>
  );
}

/**
 * A requirement filed on the reporter's own form, in the reporter's own words.
 *
 * Read-only and unannotated: this is the record as filed, not a thing for the assessor to add a
 * note beside. Section 2.1-2.4 wears the same orange surface section 1's facts do, and for the
 * same reason — the value came off the paper, not out of the assessor's head.
 */
function RequirementRow({
  no,
  label,
  filled,
}: {
  no: string;
  label: string;
  filled: string;
}): JSX.Element {
  return (
    <div class="f4-row">
      <div class="f4-req">
        <span class="f4-no" safe>
          {no}
        </span>
        <div>
          <div class="f4-label" safe>
            {label}
          </div>
          {filled === "" ? (
            <div class="f4-blank">Not supplied by the reporter</div>
          ) : (
            <input class="f4-filled" value={filled} readonly tabindex={-1} />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Section 1 as the paper reads: the number, what is required, and what was filed.
 *
 * Read-only, and nothing beside it: every one of these is a fact off the orange form, not a
 * finding, so there is nothing here for an assessor to add a note to. The four rows the orange
 * form never asks — 1.3, 1.10, 1.11, 1.19 — are not `FactRow`s at all; see `AssessedDeviceField`.
 */
function FactRow({
  no,
  label,
  filled,
}: {
  no: string;
  label: string;
  filled: string;
}): JSX.Element {
  return (
    <div class="f4-fact">
      <span class="f4-no" safe>
        {no}
      </span>
      <span class="f4-label" safe>
        {label}
      </span>
      {filled === "" ? (
        <span class="f4-blank">Not supplied by the reporter</span>
      ) : (
        <input class="f4-value" value={filled} readonly tabindex={-1} />
      )}
    </div>
  );
}

/**
 * A single-choice question, the way the paper puts one: a short vertical list of options, a radio
 * beside each, the chosen one told apart by the mark in the circle rather than by a coloured box
 * around the whole row. No pill, no card — those are for the two questions the form itself gives
 * pages of criteria to (causality, risk); this is for the ones it settles in one line.
 */
/** What A2 has chosen to replace an item's value with, whatever shape that item's value is. */
function a2ChosenValues(review: SecondaryReviewPayload | undefined, itemKey: string): string[] {
  const stored = review?.responses[itemKey]?.value;
  if (Array.isArray(stored)) return stored;
  if (typeof stored === "string") return stored === "" ? [] : [stored];
  return [];
}

/**
 * A2's own control for one of A1's options, paired beside it rather than redrawn in a list of its
 * own — Yes under Yes, No under No. Hidden by CSS until Disagree is checked, scoped to the
 * enclosing `.f4-block` so it can reach a sibling A1 was never nested under.
 */
function A2InlineOption({
  itemKey,
  optionValue,
  label,
  checked,
  locked,
  multi,
  ordinal,
  a1Chose,
}: {
  itemKey: string;
  optionValue: string;
  label: string;
  checked: boolean;
  locked: boolean;
  multi?: boolean;
  /** 2, 3, 4, … — whose control this is. Printed, so it must be this reader's own ordinal. */
  ordinal: number;
  /**
   * Whether this is the option the first assessor chose — the one thing Disagree cannot say.
   *
   * Disagree means "that answer is wrong, here is the right one", so offering the answer being
   * disagreed with is offering a contradiction. Not drawn at all rather than drawn disabled: a
   * greyed control invites the reader to work out why it is refused, and there is nothing to work
   * out — that option is simply not one of the replacements.
   *
   * Only for a single choice. Seven-eighths of 7.1's eleven ticks may legitimately match A1's,
   * because what is being replaced there is the whole list; whether the list came back identical
   * is a question about the set, and `validateSecondaryReviewForSubmit` is where it is asked.
   *
   * Ignored once the review is locked, so a record written before this rule existed still reads
   * back exactly as it was stored. The rule governs what may be written, not what may be shown.
   */
  a1Chose?: boolean;
}): JSX.Element {
  if (a1Chose === true && multi !== true && !locked) return <span hidden />;

  return (
    <label class="a2-opt">
      <span class="a2-opt-k" safe>{`A${String(ordinal)}`}</span>
      <input
        type={multi ? "checkbox" : "radio"}
        name={`a2_value_${itemKey}`}
        value={optionValue}
        checked={checked}
        disabled={locked}
      />
      <span safe>{label}</span>
    </label>
  );
}

/**
 * A secondary assessor's context for a choice field: which item, whose review, whether it is
 * locked, and which assessment in the chain it is — the last so the badge can name itself.
 */
type A2Choice = {
  key: string;
  review?: SecondaryReviewPayload;
  locked: boolean;
  ordinal: number;
};

function Radios({
  name,
  options,
  answers,
  locked,
  a2,
}: {
  name: string;
  options: readonly { value: string; label: string; note?: string }[];
  answers: F004Answers;
  locked: boolean;
  a2?: A2Choice;
}): JSX.Element {
  const chosen = value(answers, name);
  const a2Values = a2 ? a2ChosenValues(a2.review, a2.key) : [];

  return (
    <div class="f4-radio-group">
      {options.map((option) => (
        <div class="f4-choice-pair">
          <label class="f4-radio-row">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={chosen === option.value}
              disabled={locked}
            />
            <span>
              <b safe>{option.label}</b>
              {option.note && <span class="f4-note" safe>{` — ${option.note}`}</span>}
            </span>
          </label>
          {a2 && (
            <A2InlineOption
              itemKey={a2.key}
              optionValue={option.value}
              label={option.label}
              checked={a2Values.includes(option.value)}
              locked={a2.locked}
              ordinal={a2.ordinal}
              a1Chose={chosen === option.value}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function Comment({
  name,
  answers,
  rows = 5,
  label = "Comment",
  locked,
}: {
  name: string;
  answers: F004Answers;
  rows?: number;
  label?: string;
  locked: boolean;
}): JSX.Element {
  return (
    <div class="f4-field">
      <label for={name} safe>
        {label}
      </label>
      <textarea id={name} name={name} rows={String(rows)} disabled={locked} safe>
        {value(answers, name)}
      </textarea>
    </div>
  );
}

/**
 * The second assessor's position on one of the first assessor's answers, drawn beside that answer.
 *
 * Inline rather than gathered into a list of its own, because the question it asks is "is this
 * right?" and the only way to answer it is to be looking at the thing. A separate panel would ask
 * the assessor to hold 2.6's radio buttons in their head while ticking a box somewhere else.
 *
 * Which follow-up appears is decided by CSS on the radio that is checked, not by script: the
 * replacement value belongs to Disagree alone, and the statement to Disagree and Need
 * Clarification. `collectSecondReview` enforces the same rule on the way in, so the branch that is
 * hidden is also the branch that cannot be stored — the page and the payload agree by construction
 * rather than by both being careful.
 */
/** The options a "single"/"multi" item's fill-in box offers, when A1 left it blank to fill. */
/**
 * The option list one review item's answer is drawn from, or an empty list for a free-text one.
 *
 * Exported because the Final Document has to print the same words this form does. A resolved
 * answer stored as `"non_serious"` is a code, and a document that showed the reader the code
 * rather than "Non-serious" would be a different document from the one they assessed.
 */
export function a2FillInOptions(item: A2ReviewItem): readonly { value: string; label: string }[] {
  if (item.key === "1.3") return DEVICE_TYPE_OPTIONS;
  if (item.key === "1.19") return REPORT_STAGE_OPTIONS;
  if (item.key === "2.5") return SOURCE_OPTIONS;
  if (item.key === "2.6") return SERIOUSNESS_OPTIONS;
  if (item.key === "2.7") return YES_NO;
  if (item.key === "4.1") return EXPECTEDNESS_OPTIONS;
  if (item.key === "4.2") return CAUSALITY_OPTIONS;
  if (item.key === "5") return SIGNAL_OPTIONS;
  if (item.key === "6") return RISK_OPTIONS;
  return [];
}

/**
 * An item A1 left blank — one of the "(If applicable)" rows. There is no A1 position to agree,
 * clarify or disagree with, so this offers none of the three: a single optional control, stored
 * under `supplied` if it is filled in and not stored at all if it is not. Always visible, unlike
 * `.a2-inline`'s own follow-ups, because there is no degree radio here to gate it behind.
 */
function A2FillIn({
  item,
  response,
  locked,
  releaseId,
}: {
  item: A2ReviewItem;
  response?: SecondaryReviewResponse;
  locked: boolean;
  /** A1's own established IMDRF release — see `ImdrfPicker`. Only meaningful for `"fields"`. */
  releaseId?: string;
}): JSX.Element {
  const stored = response?.value;
  const chosenValues = Array.isArray(stored) ? stored : typeof stored === "string" ? [stored] : [];
  const storedText = typeof stored === "string" ? stored : "";
  const storedFields =
    typeof stored === "object" && stored !== null && !Array.isArray(stored)
      ? (stored as Record<string, string>)
      : {};
  const options = a2FillInOptions(item);

  const hasValue =
    item.valueKind === "text"
      ? storedText.trim() !== ""
      : item.valueKind === "fields"
        ? Object.values(storedFields).some((entry) => entry.trim() !== "")
        : chosenValues.length > 0;

  // Read-only and never filled in: an empty optional box left over from a submission where A2
  // chose not to add anything is noise, not a finding, so it prints nothing rather than a box with
  // nothing in it. Still drawn empty while the form is live — A2 needs somewhere to type into.
  if (locked && !hasValue) return <span hidden />;

  return (
    <div class="a2-fillin">
      <div class="a2-inline-head">
        <span class="a2-inline-k">Secondary assessment</span>
        <span safe>{`${item.no} ${item.title}`}</span>
        <span class="a2-fillin-opt">(If applicable — optional)</span>
      </div>

      {item.valueKind === "single" && (
        <div class="a2-value-options">
          {options.map((option) => (
            <label class="a2-value-choice">
              <input
                type="radio"
                name={`a2_value_${item.key}`}
                value={option.value}
                checked={chosenValues.includes(option.value)}
                disabled={locked}
              />
              <span safe>{option.label}</span>
            </label>
          ))}
        </div>
      )}

      {item.valueKind === "multi" && (
        <div class="a2-value-options">
          {options.map((option) => (
            <label class="a2-value-choice">
              <input
                type="checkbox"
                name={`a2_value_${item.key}`}
                value={option.value}
                checked={chosenValues.includes(option.value)}
                disabled={locked}
              />
              <span safe>{option.label}</span>
            </label>
          ))}
        </div>
      )}

      {item.valueKind === "text" && (
        <textarea name={`a2_value_${item.key}`} rows="4" disabled={locked} safe>
          {storedText}
        </textarea>
      )}

      {item.valueKind === "fields" &&
        (() => {
          const imdrfItem = imdrfItemForReviewKey(item.key);
          if (imdrfItem === undefined) return <></>;
          const levelNames = (item.fields ?? [])
            .filter((field) => field.key !== "code")
            .map((field) => `a2_value_${item.key}_${field.key}`);

          return (
            <ImdrfPicker
              idBase={`a2-supply-${item.key}`}
              levelFieldNames={levelNames}
              codeFieldName={`a2_value_${item.key}_code`}
              termIdName={`a2_imdrf_term_${item.key}`}
              values={storedFields}
              termId={""}
              annex={imdrfItem.annexLetter}
              releaseId={releaseId}
              locked={locked}
            />
          );
        })()}
    </div>
  );
}

/** The value half of one item's response, resolved to the label a reader recognises. */
function describeReviewValue(item: A2ReviewItem, val: A2Value | undefined): string {
  if (val === undefined) return "";
  if (item.valueKind === "text") return typeof val === "string" ? val : "";
  if (item.valueKind === "fields") {
    const rec =
      typeof val === "object" && val !== null && !Array.isArray(val)
        ? (val as Record<string, string>)
        : {};
    return (item.fields ?? [])
      .map((field) => (rec[field.key] ? `${field.label}: ${rec[field.key]}` : ""))
      .filter(Boolean)
      .join("; ");
  }
  const chosen = Array.isArray(val) ? val : typeof val === "string" && val !== "" ? [val] : [];
  const options = a2FillInOptions(item);
  return chosen.map((v) => options.find((o) => o.value === v)?.label ?? v).join(", ");
}

/**
 * Every earlier secondary assessor's finished position on one item, collapsed until asked for.
 *
 * A `<details>`, on the same argument `SectionComments` above already makes for its own: this
 * door renders on the server, so a panel that opens without JavaScript is the house pattern. Kept
 * collapsed and per-item rather than a running history at the top of the page, because the reader
 * working through the F004 needs the field in front of them, not everyone who has ever touched it
 * — the same document must stay usable whether two people have reviewed it or ten.
 */
function PriorReviewHistory({
  itemKey,
  priorReviews,
}: {
  itemKey: string;
  priorReviews?: readonly PriorSecondaryReview[];
}): JSX.Element {
  if (priorReviews === undefined || priorReviews.length === 0) return <span hidden />;

  const item = SECONDARY_REVIEW_ITEMS.find((candidate) => candidate.key === itemKey);
  if (item === undefined) return <span hidden />;

  const entries = priorReviews
    .map((prior) => ({ prior, response: prior.review.responses[itemKey] }))
    .filter(
      (entry): entry is { prior: PriorSecondaryReview; response: SecondaryReviewResponse } =>
        entry.response !== undefined,
    );

  if (entries.length === 0) return <span hidden />;

  return (
    <details class="a2-history">
      <summary>{`Previous assessments (${entries.length})`}</summary>
      <ul class="a2-history-list">
        {entries.map(({ prior, response }) => (
          <li>
            <div class="a2-history-who">
              <b safe>{`A${prior.ordinal} — ${prior.assessorName}`}</b>
              <span class="hint" safe>
                {prior.submittedOn}
              </span>
            </div>
            {response.degree !== undefined && (
              <div class={`a2-history-degree a2-${response.degree}`} safe>
                {A2_DEGREE_LABELS[response.degree]}
              </div>
            )}
            {describeReviewValue(item, response.value) !== "" && (
              <p
                class="a2-history-value"
                safe
              >{`Value: ${describeReviewValue(item, response.value)}`}</p>
            )}
            {response.statement && (
              <p class="a2-history-statement" safe>
                {response.statement}
              </p>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

function A2InlineDecision({
  itemKey,
  answers,
  review,
  locked,
  priorReviews,
  notes,
}: {
  itemKey: string;
  answers: F004Answers;
  review?: SecondaryReviewPayload;
  locked: boolean;
  priorReviews?: readonly PriorSecondaryReview[];
  notes?: Record<string, string>;
}): JSX.Element {
  const item = SECONDARY_REVIEW_ITEMS.find((candidate) => candidate.key === itemKey);
  if (item === undefined) return <span hidden />;

  const history = <PriorReviewHistory itemKey={itemKey} priorReviews={priorReviews} />;

  /*
   * A clarification that the F004 has nowhere else to print.
   *
   * Eight of the twenty-one review items carry a comment box on the paper, and a clarification
   * against one of those lands in it — 2.6's words go to `c2_6`, and the final document shows them
   * without help. The other thirteen are a bare choice or a coded grid: 1.3, 4.2, the IMDRF rows.
   * The resolver keeps their statements rather than dropping them, but there is no F004 field to
   * put them in, so before this they were held in provenance and shown to nobody — which is the
   * "empty area" a reader met under an item somebody had explicitly clarified.
   *
   * Printed in the form's own comment style, under the answer it is about, so it reads as the
   * statement beside that answer and not as a second mechanism. Only the resolved one: the
   * argument that produced it stays in `assessments`.
   */
  const note = notes?.[itemKey];
  const resolved =
    note === undefined || note.trim() === "" ? (
      <span hidden />
    ) : (
      <div class="f4-comment f4-resolved-note">
        <p class="f4-k">Statement</p>
        <p safe>{note}</p>
      </div>
    );

  if (review === undefined) {
    // The manager's page, the approved final document, or any reader with nothing of their own to
    // write: the accumulated history, and the resolved statement where there is one.
    return (
      <>
        {history}
        {resolved}
      </>
    );
  }

  const response = review.responses[item.key];

  if (isA1Blank(item, answers)) {
    return (
      <>
        {history}
        <A2FillIn
          item={item}
          response={response}
          locked={locked}
          releaseId={value(answers, "imdrf_release_id")}
        />
      </>
    );
  }

  const chosen = response?.degree;
  const stored = response?.value;

  // One stored shape per item kind, unpacked once so each branch below reads only its own.
  // "single" and "multi" are unpacked in `Radios` and the card/tick loops instead, from the same
  // `review`, which is why neither shape appears here.
  const storedText = typeof stored === "string" ? stored : "";
  const storedFields =
    typeof stored === "object" && stored !== null && !Array.isArray(stored)
      ? (stored as Record<string, string>)
      : {};

  const degrees = allowedDegrees(item);

  return (
    <>
      {history}
      <div class="a2-inline">
        <div class="a2-inline-head">
          <span class="a2-inline-k">Secondary assessment</span>
          <span safe>{`${item.no} ${item.title}`}</span>
        </div>

        <div class={degrees.length === 2 ? "a2-degrees a2-degrees-2" : "a2-degrees"}>
          {degrees.map((degree) => (
            <label class={`a2-degree a2-${degree}`}>
              <input
                type="radio"
                name={`a2_degree_${item.key}`}
                value={degree}
                checked={chosen === degree}
                disabled={locked}
              />
              <span safe>{A2_DEGREE_LABELS[degree]}</span>
            </label>
          ))}
        </div>

        {/* Disagree only, and only for a text answer or an IMDRF grid: a "single"/"multi" item's
          replacement options are paired inline beside A1's own, in `Radios` and the card/tick
          loops, so there is nothing left for this block to redraw for those two kinds. */}
        {(item.valueKind === "text" || item.valueKind === "fields") && (
          <div class="a2-change">
            <p class="a2-change-l" safe>
              {item.valueLabel}
            </p>

            {item.valueKind === "text" && (
              <div class="a2-value-text">
                <label class="vh" for={`a2-value-${item.key}`} safe>
                  {item.valueLabel}
                </label>
                <textarea
                  id={`a2-value-${item.key}`}
                  name={`a2_value_${item.key}`}
                  rows="6"
                  disabled={locked}
                  safe
                >
                  {storedText}
                </textarea>
              </div>
            )}

            {item.valueKind === "fields" &&
              (() => {
                const imdrfItem = imdrfItemForReviewKey(item.key);
                if (imdrfItem === undefined) return <></>;
                const levelNames = (item.fields ?? [])
                  .filter((field) => field.key !== "code")
                  .map((field) => `a2_value_${item.key}_${field.key}`);

                return (
                  <ImdrfPicker
                    idBase={`a2-disagree-${item.key}`}
                    levelFieldNames={levelNames}
                    codeFieldName={`a2_value_${item.key}_code`}
                    termIdName={`a2_imdrf_term_${item.key}`}
                    values={storedFields}
                    termId={""}
                    annex={imdrfItem.annexLetter}
                    releaseId={value(answers, "imdrf_release_id")}
                    locked={locked}
                  />
                );
              })()}
          </div>
        )}

        {/* Required clarification and Disagree. Two labels, one shown, so the box says what it is for
          without a line of script — and the wrong one is display:none, so it is not read out.
          Switching back to Agree hides this the same way it hides `.a2-change` above: neither is
          a child of the radio that used to be checked, both are reached by `:has()` on the box
          that holds all three, so there is nothing left over to fully un-hide again. */}
        <div class="a2-say">
          {degrees.includes("clarification") && (
            <label class="a2-say-l for-clarification" for={`a2-statement-${item.key}`}>
              The corrected wording to be used. It replaces the statement beside their answer; the
              answer itself stands. Required.
            </label>
          )}
          <label class="a2-say-l for-disagree" for={`a2-statement-${item.key}`}>
            Why the first assessor's answer is wrong. Required.
          </label>
          <textarea
            id={`a2-statement-${item.key}`}
            name={`a2_statement_${item.key}`}
            rows="5"
            disabled={locked}
            safe
          >
            {response?.statement ?? ""}
          </textarea>
        </div>
      </div>
    </>
  );
}

/**
 * One of the four section-1 rows the orange form never answers — `ASSESSED_DEVICE_KEYS`.
 *
 * Drawn as a row of section 1, not as a block of its own. It used to be a `.f4-block` with its own
 * heading, which meant section 1 read as fifteen numbered lines with four headed panels wedged
 * between them: 1.3 arrived as a titled card, 1.10 and 1.11 as a differently-shaped one, and the
 * document's own numbering — the thing an assessor reads down — broke four times on the way to
 * 1.19. The answer is a finding rather than a transcription, and that is already said by the
 * control being a live one on the staff page's own surface, where a reporter's line wears the
 * orange form's (`.f4-value`). It does not also need a heading repeating the label beside it.
 *
 * `row.no` is the row's own number, which is also its A2 item key, so the review block below the
 * row is the same `A2InlineDecision` every other reviewable item gets.
 */
function AssessedDeviceField({
  row,
  answers,
  locked,
  a2Review,
  priorReviews,
  resolvedNotes,
}: {
  row: DeviceRow;
  answers: F004Answers;
  locked: boolean;
  a2Review?: { review: SecondaryReviewPayload; submitted: boolean; ordinal?: number };
  priorReviews?: readonly PriorSecondaryReview[];
  resolvedNotes?: Record<string, string>;
}): JSX.Element {
  const a2Locked = a2Review?.submitted ?? true;
  const a2: A2Choice | undefined = a2Review && {
    key: row.no,
    review: a2Review.review,
    locked: a2Locked,
    ordinal: a2Review.ordinal ?? 2,
  };

  return (
    <div class="f4-assessed">
      <div class="f4-fact">
        <span class="f4-no" safe>
          {row.no}
        </span>
        <span class="f4-label" safe>
          {row.label}
        </span>
        <div class="f4-answer">
          {row.key === "device_type" && (
            <Radios
              name="device_type"
              options={DEVICE_TYPE_OPTIONS}
              answers={answers}
              locked={locked}
              a2={a2}
            />
          )}

          {row.key === "report_stage" && (
            <Radios
              name="report_stage"
              options={REPORT_STAGE_OPTIONS}
              answers={answers}
              locked={locked}
              a2={a2}
            />
          )}

          {(row.key === "registration_number" || row.key === "device_class") && (
            <>
              <label class="vh" for={row.key} safe>
                {row.label}
              </label>
              <input
                id={row.key}
                name={row.key}
                value={value(answers, row.key)}
                disabled={locked}
              />
            </>
          )}
        </div>
      </div>

      <A2InlineDecision
        itemKey={row.no}
        answers={answers}
        review={a2Review?.review}
        locked={a2Locked}
        priorReviews={priorReviews}
        notes={resolvedNotes}
      />
    </div>
  );
}

/**
 * The controlled-terminology replacement for a free-text level/coding grid: read-only display
 * boxes, filled from whichever `imdrf_terms` row `termIdName` names, and a "Choose term…" control
 * that reaches the repository through the same server-side search/hierarchy routes the read-only
 * IMDRF handbook (`imdrf-browser.js`) already uses — never the whole release loaded into the page.
 *
 * `termIdName`'s value is what the route actually trusts (`domain/imdrf/f004-integration.ts`
 * resolves it and overwrites the display boxes on every save); the boxes below are shown so the
 * assessor can see what they chose, not because their contents are read back as the answer. They
 * are `readonly`, not `disabled`, so they still post — a `disabled` input is never submitted at
 * all, which would silently drop the resolved text on a browser with JavaScript turned off.
 *
 * `releaseId` is always a release already resolved server-side (`resolveAssessmentRelease`) — there
 * is no control anywhere on this form for an assessor to choose one, on A1's own page or any other.
 */
function ImdrfPicker({
  idBase,
  levelFieldNames,
  codeFieldName,
  termIdName,
  values,
  termId,
  annex,
  releaseId,
  locked,
}: {
  idBase: string;
  levelFieldNames: readonly string[];
  codeFieldName: string;
  termIdName: string;
  values: Record<string, string>;
  termId: string;
  annex: string;
  releaseId?: string;
  locked: boolean;
}): JSX.Element {
  return (
    <div
      class="f4-grid"
      data-imdrf-picker
      data-annex={annex}
      data-release-id={releaseId}
      data-term-id-input={`#${idBase}-term-id`}
    >
      {levelFieldNames.map((name, index) => (
        <div class="f4-field">
          <label for={`${idBase}-l${String(index + 1)}`}>
            Preferred terminology level {String(index + 1)}
          </label>
          <input
            id={`${idBase}-l${String(index + 1)}`}
            name={name}
            value={values[`l${String(index + 1)}`] ?? ""}
            readonly
            disabled={locked}
            data-imdrf-level={String(index + 1)}
          />
        </div>
      ))}
      <div class="f4-field">
        <label for={`${idBase}-code`}>Coding</label>
        <input
          id={`${idBase}-code`}
          name={codeFieldName}
          value={values.code ?? ""}
          readonly
          disabled={locked}
          data-imdrf-code
        />
      </div>
      <input type="hidden" id={`${idBase}-term-id`} name={termIdName} value={termId} />
      {!locked && (
        <div class="f4-field f4-imdrf-pick">
          <button type="button" class="btn btn-sm" data-imdrf-pick-open>
            Choose term…
          </button>
          <div class="imdrf-pick-panel" data-imdrf-pick-panel hidden>
            <label for={`${idBase}-search`} class="vh">
              Search IMDRF code or term
            </label>
            <input
              type="search"
              id={`${idBase}-search`}
              class="imdrf-pick-search"
              placeholder="Search IMDRF code or term, e.g. G02, G02002, Battery"
              data-imdrf-pick-search
              autocomplete="off"
            />
            <div class="imdrf-pick-results" data-imdrf-pick-results></div>
          </div>
        </div>
      )}
    </div>
  );
}

/** `{l1, l2, l3, code}` read off `answers`/a review value for one IMDRF item's own field prefix. */
function imdrfFieldValues(
  source: F004Answers | Record<string, string>,
  prefix: string,
): Record<string, string> {
  const read = (key: string): string => {
    const raw = (source as Record<string, unknown>)[key];
    return typeof raw === "string" ? raw : "";
  };
  return {
    l1: read(`${prefix}_l1`),
    l2: read(`${prefix}_l2`),
    l3: read(`${prefix}_l3`),
    code: read(`${prefix}_code`),
  };
}

export function F004Form({
  reportId,
  answers,
  device,
  event,
  assessorName,
  assessedOn,
  presentation,
  approval,
  submitted,
  readOnly,
  documentMode,
  resolvedNotes,
  sectionComments,
  commentAction,
  omitSecond,
  a2Review,
  priorReviews,
  issues,
  imdrfReleaseLabel,
}: F004FormProps): JSX.Element {
  // The concluded document rather than the working one. See `F004Presentation` for what it drops
  // and, more to the point, for what it deliberately does not: every answer on the paper.
  const isFinal = presentation === "final";
  const causality = value(answers, "causality");
  const risk = value(answers, "risk_level");
  // Card-style and tick-style choices pair A2's option in beside A1's own rather than through
  // `Radios`, so each reads its item's replacement value straight from the review here.
  const causalityA2Values = a2ChosenValues(a2Review?.review, "4.2");
  const riskA2Values = a2ChosenValues(a2Review?.review, "6");
  const actionsA2Values = a2ChosenValues(a2Review?.review, "7.1_actions");
  // Whose controls the inline replacement badges belong to. 2 when the caller did not say, which
  // is the ordinal every secondary assessment had back when there could only be one of them.
  const a2Ordinal = a2Review?.ordinal ?? 2;
  // Submitted is one way to be closed and not being its author is the other, and the document is
  // rendered the same for both.
  const locked = submitted || readOnly === true;
  const writingA2 = a2Review !== undefined && !a2Review.submitted;
  const sheetLocked = locked && !writingA2;
  // A1's own live, unsubmitted page: the one rendering with nobody's secondary assessment active
  // and nothing of this assessor's own yet closed. Used only by Section 8's own signature button.
  const writingA1 = a2Review === undefined && !locked;

  return (
    <>
      {/*
       * The masthead sits outside the <form> below, and deliberately.
       *
       * It carries the find box, and a text input inside the real form would make Enter press the
       * first submit button — which is Save draft. Nothing in this block is a field of the
       * assessment: it is the document's letterhead, who is assessing it, and the way around the
       * page. Moving it out costs the form nothing and buys a search box that cannot file
       * anything.
       */}
      <div class="f4-doc-head">
        <div class="f4-head">
          <div>
            <div class="f4-authority">The United Republic of Tanzania · Ministry of Health</div>
            <div class="f4-authority">Tanzania Medicines and Medical Devices Authority</div>
            <h2 class="f4-title" safe>
              {F004_TITLE}
            </h2>
          </div>
          <div class="f4-stamp">
            <div safe>{F004_VERSION}</div>
            <div>Effective date: 31/07/2026</div>
          </div>
        </div>

        {/* The assessor strip. The name is the signed-in Officer and the date is the system's: an
            assessment signed in somebody else's name would be worth nothing.

            Dropped whole in `"final"` presentation. Who assessed the report is a fact about the
            assessment, not about the concluded document — the office's position is the office's,
            and printing three officers' names across the top of it would put the argument back on
            the face of the thing that exists precisely to have settled it. */}
        {isFinal ? (
          <></>
        ) : (
          <div class="f4-assessors">
            <div>
              <span class="f4-k">1st Assessor</span>
              <span class="f4-v" safe>
                {assessorName}
              </span>
            </div>
            <div>
              <span class="f4-k">Date</span>
              <span class="f4-v" safe>
                {assessedOn}
              </span>
            </div>
            {/* Dropped entirely by `omitSecond`, on the same argument that drops 7.2 and the second
              signature: a page with no secondary assessment must not print a secondary assessor's
              slot. On the first assessor's own workspace those two cells were a permanent "—"
              beside their name, implying a second assessor the report may never have and asking a
              question the page has no way to answer. */}
            {omitSecond === true ? (
              <></>
            ) : (
              <>
                <div class={a2Review?.submitted === true ? undefined : "f4-muted"}>
                  <span class="f4-k">Secondary assessor</span>
                  <span class="f4-v" safe>
                    {a2Review?.submitted === true ? (a2Review.assessorName ?? "—") : "—"}
                  </span>
                </div>
                <div class={a2Review?.submitted === true ? undefined : "f4-muted"}>
                  <span class="f4-k">Date</span>
                  <span class="f4-v" safe>
                    {a2Review?.submitted === true ? (a2Review.assessedOn ?? "—") : "—"}
                  </span>
                </div>
              </>
            )}
            {/* A running count rather than a name-per-ordinal strip: the masthead has room for one
              more fact, not for a row that grows with every secondary assessment a report ends up
              with. `Assessment history` on the report page is where each one is named. */}
            {priorReviews !== undefined && priorReviews.length > 0 && (
              <div>
                <span class="f4-k">Earlier secondary assessments</span>
                <span class="f4-v" safe>
                  {String(priorReviews.length)}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/*
       * A sibling of the masthead rather than a row inside it, because it sticks.
       *
       * `position: sticky` only travels within its own parent, and the masthead is a short card —
       * a sticky row inside it would unstick the moment that card scrolled away, which is exactly
       * what it did. Out here its parent is the page, so it stays under the staff header for the
       * whole length of the form, which is the point of it on a document this long.
       */}
      <div class="f4-jump">
        <nav class="f4-jump-links" aria-label="Jump to a section of the F004">
          <a href="#section-1">1 Admin</a>
          <a href="#section-2">2 Event</a>
          <a href="#section-3">3 IMDRF</a>
          <a href="#section-4">4 Causality</a>
          <a href="#section-5">5 Signal</a>
          <a href="#section-6">6 Risk</a>
          <a href="#section-7">7 Conclusion</a>
          <a href="#section-8">8 Signature</a>
        </nav>

        {/* type="button" on both steppers as well as living outside the form: two reasons a click
            here can never submit, rather than one. */}
        <div class="f4-find-wrap">
          <input
            type="search"
            class="f4-find"
            placeholder="Find in this F004…"
            aria-label="Find in this F004"
            autocomplete="off"
            data-f4-find
          />
          <span class="f4-find-count" data-f4-find-count aria-live="polite"></span>
          <button type="button" class="f4-find-step" data-f4-find-prev aria-label="Previous match">
            ↑
          </button>
          <button type="button" class="f4-find-step" data-f4-find-next aria-label="Next match">
            ↓
          </button>
        </div>
      </div>

      <Sheet
        locked={sheetLocked}
        documentMode={documentMode}
        reportId={reportId}
        action={a2Review?.action}
      >
        {/* One fieldset keeps the document grouped, but the lock is applied to the assessment
            controls themselves. Section comments are live manager controls and must not inherit a
            disabled ancestor. */}
        <fieldset>
          {issues.length > 0 && (
            <div class="alert alert-error" role="alert">
              <strong>This assessment cannot be submitted yet.</strong>
              <ul>
                {issues.map((issue) => (
                  <li safe>{issue.message}</li>
                ))}
              </ul>
            </div>
          )}

          <section class="f4-section" id="section-1">
            <Bar
              no="1"
              title="Administrative information — device information"
              comments={sectionComments?.["1"]}
              action={commentAction?.("1")}
            />
            {DEVICE_ROWS.map((row) =>
              ASSESSED_DEVICE_KEYS.includes(row.key) ? (
                <AssessedDeviceField
                  row={row}
                  answers={answers}
                  locked={locked}
                  a2Review={a2Review}
                  priorReviews={priorReviews}
                  resolvedNotes={resolvedNotes}
                />
              ) : (
                <FactRow no={row.no} label={row.label} filled={device[row.key] ?? ""} />
              ),
            )}
          </section>

          <section class="f4-section" id="section-2">
            <Bar
              no="2"
              title="Event / incident assessment"
              comments={sectionComments?.["2"]}
              action={commentAction?.("2")}
            />
            {EVENT_ROWS.map((row) => (
              <RequirementRow no={row.no} label={row.label} filled={event[row.key] ?? ""} />
            ))}

            <div class="f4-block">
              <div class="f4-blocktitle">
                <span class="f4-no">2.5</span> Determine the source of event / incident which has
                occurred
              </div>
              <div class="f4-guide">
                <p class="f4-guide-h">For a medical device</p>
                <ul>
                  {SOURCE_MD_GUIDANCE.map((line) => (
                    <li safe>{line}</li>
                  ))}
                </ul>
                <p class="f4-guide-h">For In Vitro Diagnostics (IVDs)</p>
                <ul>
                  {SOURCE_IVD_GUIDANCE.map((line) => (
                    <li safe>{line}</li>
                  ))}
                </ul>
                <p class="f4-note" safe>
                  {SOURCE_NOTE}
                </p>
              </div>
              {/* One category, not several: the form asks the assessor to select the source that
                best describes the event, not to tick every one that might apply. */}
              <Radios
                name="source_of_event"
                options={SOURCE_OPTIONS}
                answers={answers}
                locked={locked}
                a2={
                  a2Review && {
                    key: "2.5",
                    review: a2Review.review,
                    locked: a2Review.submitted,
                    ordinal: a2Ordinal,
                  }
                }
              />
              <Comment name="c2_5" answers={answers} locked={locked} />
              <A2InlineDecision
                itemKey="2.5"
                answers={answers}
                review={a2Review?.review}
                locked={a2Review?.submitted ?? true}
                priorReviews={priorReviews}
                notes={resolvedNotes}
              />
            </div>

            <div class="f4-block">
              <div class="f4-blocktitle">
                <span class="f4-no">2.6</span> Categorization of event / incident
              </div>
              <div class="f4-guide">
                <p>A serious adverse event/incident is an event/incident that:</p>
                <ul>
                  {SERIOUS_CRITERIA.map((line) => (
                    <li safe>{line}</li>
                  ))}
                </ul>
              </div>
              <Radios
                name="seriousness"
                options={SERIOUSNESS_OPTIONS}
                answers={answers}
                locked={locked}
                a2={
                  a2Review && {
                    key: "2.6",
                    review: a2Review.review,
                    locked: a2Review.submitted,
                    ordinal: a2Ordinal,
                  }
                }
              />
              <Comment name="c2_6" answers={answers} locked={locked} />
              <A2InlineDecision
                itemKey="2.6"
                answers={answers}
                review={a2Review?.review}
                locked={a2Review?.submitted ?? true}
                priorReviews={priorReviews}
                notes={resolvedNotes}
              />
            </div>

            <div class="f4-block">
              <div class="f4-blocktitle">
                <span class="f4-no">2.7</span> <span safe>{PUBLIC_HEALTH_QUESTION}</span>
              </div>
              <Radios
                name="public_health"
                options={YES_NO}
                answers={answers}
                locked={locked}
                a2={
                  a2Review && {
                    key: "2.7",
                    review: a2Review.review,
                    locked: a2Review.submitted,
                    ordinal: a2Ordinal,
                  }
                }
              />
              <Comment name="c2_7" answers={answers} locked={locked} />
              <A2InlineDecision
                itemKey="2.7"
                answers={answers}
                review={a2Review?.review}
                locked={a2Review?.submitted ?? true}
                priorReviews={priorReviews}
                notes={resolvedNotes}
              />
            </div>
          </section>

          <section class="f4-section" id="section-3">
            <Bar
              no="3"
              title="IMDRF category of the adverse incident / event"
              comments={sectionComments?.["3"]}
              action={commentAction?.("3")}
            />

            <div class="f4-block">
              <div class="f4-blocktitle">IMDRF release</div>
              {/* Never a control: which release this report's coding comes from is resolved
                  server-side (`domain/imdrf/f004-integration.ts`'s `resolveAssessmentRelease`) —
                  the newest published release for a brand-new assessment, and thereafter the same
                  release this report has always used. Shown here so the assessor knows what they
                  are searching, nothing more. */}
              <p class="f4-note" safe>
                {imdrfReleaseLabel ?? "No published IMDRF release is available yet."}
              </p>
            </div>

            {IMDRF_GROUPS.map((group) => (
              <div class="f4-block">
                <div class="f4-blocktitle">
                  <span class="f4-no" safe>
                    {group.no}
                  </span>{" "}
                  <span safe>{group.title}</span>
                </div>

                {group.items.map((item) => {
                  const levelNames = [1, 2, 3]
                    .filter((level) => level <= item.levels)
                    .map((level) => `imdrf_${item.key}_l${level}`);

                  return (
                    <div class="f4-imdrf-item">
                      <div class="f4-imdrf-h">
                        <span class="f4-letter" safe>{`${group.no}.${item.letter}`}</span>{" "}
                        <span safe>{item.title}</span>
                      </div>
                      <p class="f4-note" safe>
                        {item.annex}
                      </p>
                      <ImdrfPicker
                        idBase={`imdrf-${item.key}`}
                        levelFieldNames={levelNames}
                        codeFieldName={`imdrf_${item.key}_code`}
                        termIdName={`imdrf_${item.key}_term_id`}
                        values={imdrfFieldValues(answers, `imdrf_${item.key}`)}
                        termId={value(answers, `imdrf_${item.key}_term_id`)}
                        annex={item.annexLetter}
                        releaseId={value(answers, "imdrf_release_id")}
                        locked={locked}
                      />
                      <A2InlineDecision
                        itemKey={`${group.no}.${item.letter}`}
                        answers={answers}
                        review={a2Review?.review}
                        locked={a2Review?.submitted ?? true}
                        priorReviews={priorReviews}
                        notes={resolvedNotes}
                      />
                    </div>
                  );
                })}
              </div>
            ))}
            <p class="f4-note" safe>
              {IMDRF_NOTE}
            </p>
          </section>

          <section class="f4-section" id="section-4">
            <Bar
              no="4"
              title="Relationship / causality assessment"
              comments={sectionComments?.["4"]}
              action={commentAction?.("4")}
            />

            <div class="f4-block">
              <div class="f4-blocktitle">
                <span class="f4-no">4.1</span> Is the adverse event / incident expected or
                unexpected?
              </div>
              <p class="f4-note" safe>
                {EXPECTEDNESS_NOTE}
              </p>
              <Radios
                name="expectedness"
                options={EXPECTEDNESS_OPTIONS}
                answers={answers}
                locked={locked}
                a2={
                  a2Review && {
                    key: "4.1",
                    review: a2Review.review,
                    locked: a2Review.submitted,
                    ordinal: a2Ordinal,
                  }
                }
              />
              <Comment name="c4_1" answers={answers} locked={locked} />
              <A2InlineDecision
                itemKey="4.1"
                answers={answers}
                review={a2Review?.review}
                locked={a2Review?.submitted ?? true}
                priorReviews={priorReviews}
                notes={resolvedNotes}
              />
            </div>

            <div class="f4-block">
              <div class="f4-blocktitle">
                <span class="f4-no">4.2</span> Establish whether there is a link between the device
                and the event
              </div>
              <div class="f4-cards f4-causality">
                {CAUSALITY_OPTIONS.map((option) => (
                  <div class="f4-choice-pair">
                    <label class={causality === option.value ? "f4-card on" : "f4-card"}>
                      <div class="f4-card-h">
                        <input
                          type="radio"
                          name="causality"
                          value={option.value}
                          checked={causality === option.value}
                          disabled={locked}
                        />
                        <b safe>{option.label}</b>
                      </div>
                      <ul class="f4-card-c">
                        {option.criteria.map((line) => (
                          <li safe>{line}</li>
                        ))}
                      </ul>
                    </label>
                    {a2Review && (
                      <A2InlineOption
                        itemKey="4.2"
                        optionValue={option.value}
                        label={option.label}
                        checked={causalityA2Values.includes(option.value)}
                        locked={a2Review.submitted}
                        ordinal={a2Ordinal}
                        a1Chose={causality === option.value}
                      />
                    )}
                  </div>
                ))}
              </div>
              <A2InlineDecision
                itemKey="4.2"
                answers={answers}
                review={a2Review?.review}
                locked={a2Review?.submitted ?? true}
                priorReviews={priorReviews}
                notes={resolvedNotes}
              />
            </div>

            <div class="f4-block">
              <div class="f4-blocktitle">
                <span class="f4-no">4.3</span> Discussion of causal relationship
              </div>
              <p class="f4-note" safe>
                {CAUSALITY_DISCUSSION_NOTE}
              </p>
              <Comment name="c4_3" answers={answers} rows={8} label="Discussion" locked={locked} />
              <A2InlineDecision
                itemKey="4.3"
                answers={answers}
                review={a2Review?.review}
                locked={a2Review?.submitted ?? true}
                priorReviews={priorReviews}
                notes={resolvedNotes}
              />
            </div>
          </section>

          <section class="f4-section" id="section-5">
            <Bar
              no="5"
              title="Signal detection"
              comments={sectionComments?.["5"]}
              action={commentAction?.("5")}
            />
            <div class="f4-block">
              <div class="f4-guide">
                <p>
                  Assess whether the reported adverse event/incident represents a potential safety
                  signal by considering the following criteria:
                </p>
                <ul>
                  {SIGNAL_CRITERIA.map((line, index) => (
                    <li>
                      <strong>({LETTERS[index]})</strong> <span safe>{line}</span>
                    </li>
                  ))}
                </ul>
                <p class="f4-note" safe>
                  {SIGNAL_NOTE}
                </p>
              </div>
              <Radios
                name="signal_status"
                options={SIGNAL_OPTIONS}
                answers={answers}
                locked={locked}
                a2={
                  a2Review && {
                    key: "5",
                    review: a2Review.review,
                    locked: a2Review.submitted,
                    ordinal: a2Ordinal,
                  }
                }
              />
              <Comment name="c5" answers={answers} rows={6} locked={locked} />
              <A2InlineDecision
                itemKey="5"
                answers={answers}
                review={a2Review?.review}
                locked={a2Review?.submitted ?? true}
                priorReviews={priorReviews}
                notes={resolvedNotes}
              />
            </div>
          </section>

          <section class="f4-section" id="section-6">
            <Bar
              no="6"
              title="Risk assessment"
              comments={sectionComments?.["6"]}
              action={commentAction?.("6")}
            />
            <div class="f4-block">
              <p class="f4-note" safe>
                {RISK_NOTE}
              </p>
              <div class="f4-cards f4-risk">
                {RISK_OPTIONS.map((option) => (
                  <div class="f4-choice-pair">
                    <label
                      class={
                        risk === option.value
                          ? `f4-card r-${option.value} on`
                          : `f4-card r-${option.value}`
                      }
                    >
                      <div class="f4-card-h">
                        <input
                          type="radio"
                          name="risk_level"
                          value={option.value}
                          checked={risk === option.value}
                          disabled={locked}
                        />
                        <b safe>{option.label}</b>
                      </div>
                      <p class="f4-card-c" safe>
                        {option.note}
                      </p>
                    </label>
                    {a2Review && (
                      <A2InlineOption
                        itemKey="6"
                        optionValue={option.value}
                        label={option.label}
                        checked={riskA2Values.includes(option.value)}
                        locked={a2Review.submitted}
                        ordinal={a2Ordinal}
                        a1Chose={risk === option.value}
                      />
                    )}
                  </div>
                ))}
              </div>
              <p class="f4-note" safe>
                {RISK_IVD_NOTE}
              </p>
              <Comment name="c6" answers={answers} locked={locked} />
              <A2InlineDecision
                itemKey="6"
                answers={answers}
                review={a2Review?.review}
                locked={a2Review?.submitted ?? true}
                priorReviews={priorReviews}
                notes={resolvedNotes}
              />
            </div>
          </section>

          <section class="f4-section" id="section-7">
            <Bar
              no="7"
              title="Conclusion of assessment"
              comments={sectionComments?.["7"]}
              action={commentAction?.("7")}
            />

            <div class="f4-block">
              <div class="f4-blocktitle">
                <span class="f4-no">7.1</span> Assessor's recommendations and conclusion, including
                proposed regulatory action(s)
              </div>
              <p class="f4-note">Possible risk mitigation action(s):</p>
              <div class="f4-ticks f4-11">
                {ACTIONS.map((action) => (
                  <div class="f4-choice-pair">
                    <label
                      class={
                        list(answers, "actions").includes(action.value) ? "f4-tick on" : "f4-tick"
                      }
                    >
                      <input
                        type="checkbox"
                        name="actions"
                        value={action.value}
                        checked={list(answers, "actions").includes(action.value)}
                        disabled={locked}
                      />
                      <span>
                        <span class="f4-no" safe>
                          {action.no}
                        </span>{" "}
                        <span safe>{action.label}</span>
                      </span>
                    </label>
                    {a2Review && (
                      <A2InlineOption
                        itemKey="7.1_actions"
                        optionValue={action.value}
                        label={action.label}
                        checked={actionsA2Values.includes(action.value)}
                        locked={a2Review.submitted}
                        multi
                        ordinal={a2Ordinal}
                      />
                    )}
                  </div>
                ))}
              </div>
              <Comment
                name="conclusion"
                answers={answers}
                rows={8}
                label="Conclusion"
                locked={locked}
              />
              <A2InlineDecision
                itemKey="7.1_actions"
                answers={answers}
                review={a2Review?.review}
                locked={a2Review?.submitted ?? true}
                priorReviews={priorReviews}
                notes={resolvedNotes}
              />
            </div>
          </section>

          <section class="f4-section" id="section-8">
            <Bar
              no="8"
              title="Signature"
              comments={sectionComments?.["8"]}
              action={commentAction?.("8")}
            />
            {/*
              Section 8 is a signature block either way; whose signature differs.

              On a working assessment it is the assessors' own — typed, matching the account they
              are signed in as. On the concluded document it is the manager's approval, and only
              theirs: the assessors signed their assessments, and those signatures sit on those
              assessments. Reprinting one here would put an assessor's name under a document they
              did not settle and, in the `documentMode` rendering, under answers a later assessor
              may have replaced.
            */}
            {isFinal ? (
              <div class="f4-sign f4-approved">
                <div class="f4-field">
                  <span class="f4-k">Approved by</span>
                  <span class="f4-v" safe>
                    {approval?.byName ?? ""}
                  </span>
                </div>
                <div class="f4-field">
                  <span class="f4-k">Date of approval</span>
                  <span class="f4-v" safe>
                    {approval?.on ?? ""}
                  </span>
                </div>
              </div>
            ) : (
              <div class="f4-sign">
                {/* A1's row: read-only once submitted, wherever this document is read — their
                    own live page revisited, the secondary assessor's page, or the manager's. */}
                {submitted && (
                  <>
                    <div class="f4-field">
                      <span class="f4-k">Assessor (A1)</span>
                      <span class="f4-v" safe>
                        {assessorName}
                      </span>
                      <span class="f4-signed">Signed ✓</span>
                    </div>
                    <div class="f4-field">
                      <span class="f4-k">Date</span>
                      <span class="f4-v" safe>
                        {assessedOn}
                      </span>
                    </div>
                  </>
                )}

                {/* A1's own live, unsubmitted page: nobody has typed a name here since Rev 05 —
                    the button opens the password modal below, and the authenticated account is
                    what ends up recorded once it confirms. See `resolveMine`/`assessmentRoutes`
                    for the identity this signature actually comes from. */}
                {writingA1 && (
                  <div class="f4-field">
                    <span class="f4-k">Assessor</span>
                    <button type="button" class="btn" data-f4-sign-open>
                      Sign assessment
                    </button>
                  </div>
                )}

                {/* The secondary assessor's own row — whichever ordinal this rendering's
                    secondary assessment actually is. Never drawn on A1's own page (`omitSecond`),
                    read-only once submitted, and the same sign button as A1's own otherwise. */}
                {!omitSecond &&
                  (a2Review?.submitted === true ? (
                    <>
                      <div class="f4-field">
                        <span class="f4-k" safe>{`Assessor (A${String(a2Ordinal)})`}</span>
                        <span class="f4-v" safe>
                          {a2Review.assessorName ?? "—"}
                        </span>
                        <span class="f4-signed">Signed ✓</span>
                      </div>
                      <div class="f4-field">
                        <span class="f4-k">Date</span>
                        <span class="f4-v" safe>
                          {a2Review.assessedOn ?? "—"}
                        </span>
                      </div>
                    </>
                  ) : writingA2 ? (
                    <div class="f4-field">
                      <span class="f4-k">Assessor</span>
                      <button type="button" class="btn" data-f4-sign-open>
                        Sign assessment
                      </button>
                    </div>
                  ) : (
                    <div class="f4-field f4-muted">
                      <span class="f4-k">Assessor</span>
                      <span class="f4-v">Pending secondary assessment</span>
                    </div>
                  ))}
              </div>
            )}

            {/* The signing modal itself: one password field, verified server-side against the
                authenticated account resolving this ordinal — never a typed name, and never the
                old 7.2 field. `showModal()` is what supplies the backdrop, the focus trap and
                Escape-to-close; see `f4-find.js`. Its own submit button is the form's real
                `intent=submit` control — "Sign assessment" above only opens this. */}
            {(writingA1 || writingA2) && (
              <dialog class="modal" data-f4-sign-dialog aria-labelledby="f4-sign-title">
                <div class="modal-body">
                  <h2 id="f4-sign-title">Sign assessment</h2>
                  <p class="hint">Enter your password to confirm your identity.</p>
                  <div class="f4-field">
                    <label for="signing_password">Password</label>
                    <input
                      type="password"
                      id="signing_password"
                      name="signing_password"
                      autocomplete="current-password"
                    />
                  </div>
                  <div class="bar modal-actions">
                    <button type="button" class="btn ghost" data-f4-sign-cancel>
                      Cancel
                    </button>
                    <button type="submit" name="intent" value="submit" class="btn">
                      Confirm and sign
                    </button>
                  </div>
                </div>
              </dialog>
            )}
          </section>
        </fieldset>

        {/* The concluded document says nothing about itself here.

            All three sentences below describe an assessment's state — submitted, read-only, with
            the manager, awaiting a decision — and every one of them is false of a document the
            manager has already approved. The approval is stated where it belongs: in section 8
            above, and in the card over the form. */}
        {isFinal ? (
          <></>
        ) : a2Review?.submitted === true ? (
          <p class="hint">
            This secondary assessment has been submitted and is now read-only. The report is with
            the manager for a decision.
          </p>
        ) : writingA2 ? (
          <div class="bar f4-buttons">
            <button type="submit" name="intent" value="save" class="btn ghost">
              Save draft
            </button>
          </div>
        ) : submitted ? (
          <p class="hint">
            This assessment has been submitted and is now read-only. The report is with the manager,
            who decides whether another assessor reviews it.
          </p>
        ) : (
          // Only ever reached on the live path, where `Sheet` is a real form for this to submit.
          !locked && (
            <div class="bar f4-buttons">
              <button type="submit" name="intent" value="save" class="btn ghost">
                Save draft
              </button>
            </div>
          )
        )}
      </Sheet>
    </>
  );
}
