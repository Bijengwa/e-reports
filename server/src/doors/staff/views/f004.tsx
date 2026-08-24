import type { Children } from "@kitajs/html";
import {
  A2_DEGREE_LABELS,
  A2_DEGREES,
  type A2ReviewItem,
  type A2Value,
  ACTIONS,
  ASSESSED_DEVICE_KEYS,
  CAUSALITY_DISCUSSION_NOTE,
  CAUSALITY_OPTIONS,
  DEVICE_ROWS,
  DEVICE_TYPE_OPTIONS,
  type DeviceRow,
  EVENT_ROWS,
  EXPECTEDNESS_NOTE,
  EXPECTEDNESS_OPTIONS,
  F004_VERSION,
  type F004Answers,
  IMDRF_GROUPS,
  IMDRF_NOTE,
  type Issue,
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
} from "../../../domain/f004.js";

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
  /** The manager's notes per section, keyed "1"…"8". Absent on the Officer's live form. */
  sectionComments?: Record<string, SectionComment[]>;
  /** Where a note on a given section is posted. Absent means the form draws no comment UI. */
  commentAction?: (section: string) => string;
  /**
   * Leave 7.2 and the second signature out of the document entirely.
   *
   * For the one page that renders this form above a live section 7.2 — the second assessor's own.
   * There the placeholder block would be a second, disabled copy of the box they are being asked
   * to fill in, immediately above the real one, and a form that shows a field twice is a form
   * whose reader has to work out which of the two counts.
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
  reportId,
  action,
  children,
}: {
  locked: boolean;
  reportId: string;
  action?: string;
  children?: Children;
}): JSX.Element {
  if (locked) return <div class="f4">{children}</div>;

  return (
    <form method="POST" action={action ?? `/reports/${reportId}/assessment-1`} class="f4">
      {children}
    </form>
  );
}

/**
 * Section 7.2 and the second signature: the same eleven actions and the same conclusion box as
 * 7.1, laid out the way the paper lays them out, under names of their own.
 *
 * Here rather than beside either page that draws it, because both do: the second assessor writes
 * it, and the manager reads it back once it is in. One copy of the markup is what keeps the record
 * the manager reads identical to the form the Officer filled.
 *
 * `locked` renders the submitted record — every control disabled, which is what stops a closed
 * assessment being edited by replaying the form, exactly as the document above it does.
 */
export function F004Second({
  answers,
  signedOn,
  locked,
}: {
  answers: F004Answers;
  signedOn: string;
  locked?: boolean;
}): JSX.Element {
  const chosen = list(answers, "actions_2");

  return (
    <div class="f4-section">
      <div class="f4-block">
        <p class="f4-note">Possible risk mitigation action(s):</p>
        <div class="f4-ticks f4-11">
          {ACTIONS.map((action) => (
            <label class={chosen.includes(action.value) ? "f4-tick on" : "f4-tick"}>
              <input
                type="checkbox"
                name="actions_2"
                value={action.value}
                checked={chosen.includes(action.value)}
                disabled={locked}
              />
              <span>
                <span class="f4-no" safe>
                  {action.no}
                </span>{" "}
                <span safe>{action.label}</span>
              </span>
            </label>
          ))}
        </div>

        <div class="f4-comment">
          <label class="vh" for="conclusion_2">
            Concluding remarks
          </label>
          <textarea
            id="conclusion_2"
            name="conclusion_2"
            rows="6"
            placeholder="Concluding remarks"
            disabled={locked}
            safe
          >
            {value(answers, "conclusion_2")}
          </textarea>
        </div>
      </div>

      <div class="f4-block">
        <div class="f4-sign">
          <div class="f4-field">
            <label for="signature_2">Secondary assessor — type your name to sign</label>
            <input
              id="signature_2"
              name="signature_2"
              value={value(answers, "signature_2")}
              autocomplete="off"
              disabled={locked}
            />
            <p class="f4-note">
              Typed, not uploaded. It must match the name above, which is the account you are signed
              in as.
            </p>
          </div>
          <div class="f4-field f4-muted">
            <label for="assessed-on-2">Date</label>
            <input id="assessed-on-2" value={signedOn} disabled />
          </div>
        </div>
      </div>
    </div>
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
 * Rendered only where `action` is given — the manager's read of a submitted assessment. On the
 * Officer's own live form there is no action and this draws nothing at all, so the form they fill
 * in is unchanged.
 */
function SectionComments({
  no,
  comments,
  action,
}: {
  no: string;
  comments: readonly SectionComment[];
  action: string;
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
      <form method="POST" action={action} class="f4-note-write">
        <label class="vh" for={`note-${no}`}>
          Comment on section {no}
        </label>
        <textarea id={`note-${no}`} name="body" rows="2" placeholder="Write a comment…"></textarea>
        <button type="submit" class="btn btn-sm">
          Send
        </button>
      </form>
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
      {action !== undefined && (
        <SectionComments no={no} comments={comments ?? []} action={action} />
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
}: {
  itemKey: string;
  optionValue: string;
  label: string;
  checked: boolean;
  locked: boolean;
  multi?: boolean;
}): JSX.Element {
  return (
    <label class="a2-opt">
      <span class="a2-opt-k">A2</span>
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

/** The second assessor's context for a choice field: which item, whose review, and whether it is locked. */
type A2Choice = { key: string; review?: SecondaryReviewPayload; locked: boolean };

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
function a2FillInOptions(item: A2ReviewItem): readonly { value: string; label: string }[] {
  if (item.key === "1.3") return DEVICE_TYPE_OPTIONS;
  if (item.key === "1.19") return REPORT_STAGE_OPTIONS;
  if (item.key === "2.5") return SOURCE_OPTIONS;
  if (item.key === "2.6") return SERIOUSNESS_OPTIONS;
  if (item.key === "2.7") return YES_NO;
  if (item.key === "4.1") return EXPECTEDNESS_OPTIONS;
  if (item.key === "4.2") return CAUSALITY_OPTIONS;
  if (item.key === "5") return SIGNAL_OPTIONS;
  if (item.key === "6") return RISK_OPTIONS;
  if (item.key === "7.1_actions") return ACTIONS;
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
}: {
  item: A2ReviewItem;
  response?: SecondaryReviewResponse;
  locked: boolean;
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

      {item.valueKind === "fields" && (
        <div class="a2-value-grid">
          {(item.fields ?? []).map((field) => (
            <div class="a2-value-cell">
              <label for={`a2-value-${item.key}-${field.key}`} safe>
                {field.label}
              </label>
              <input
                id={`a2-value-${item.key}-${field.key}`}
                name={`a2_value_${item.key}_${field.key}`}
                value={storedFields[field.key] ?? ""}
                disabled={locked}
              />
            </div>
          ))}
        </div>
      )}
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
}: {
  itemKey: string;
  answers: F004Answers;
  review?: SecondaryReviewPayload;
  locked: boolean;
  priorReviews?: readonly PriorSecondaryReview[];
}): JSX.Element {
  const item = SECONDARY_REVIEW_ITEMS.find((candidate) => candidate.key === itemKey);
  if (item === undefined) return <span hidden />;

  const history = <PriorReviewHistory itemKey={itemKey} priorReviews={priorReviews} />;

  if (review === undefined) {
    // The manager's page, or any reader with nothing of their own to write: still show the
    // accumulated history even though there is no active review to annotate it with.
    return history;
  }

  const response = review.responses[item.key];

  if (isA1Blank(item, answers)) {
    return (
      <>
        {history}
        <A2FillIn item={item} response={response} locked={locked} />
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

  return (
    <>
      {history}
      <div class="a2-inline">
        <div class="a2-inline-head">
          <span class="a2-inline-k">Secondary assessment</span>
          <span safe>{`${item.no} ${item.title}`}</span>
        </div>

        <div class="a2-degrees">
          {A2_DEGREES.map((degree) => (
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

            {item.valueKind === "fields" && (
              <div class="a2-value-grid">
                {(item.fields ?? []).map((field) => (
                  <div class="a2-value-cell">
                    <label for={`a2-value-${item.key}-${field.key}`} safe>
                      {field.label}
                    </label>
                    <input
                      id={`a2-value-${item.key}-${field.key}`}
                      name={`a2_value_${item.key}_${field.key}`}
                      value={storedFields[field.key] ?? ""}
                      disabled={locked}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Need Clarification and Disagree. Two labels, one shown, so the box says what it is for
          without a line of script — and the wrong one is display:none, so it is not read out.
          Switching back to Agree hides this the same way it hides `.a2-change` above: neither is
          a child of the radio that used to be checked, both are reached by `:has()` on the box
          that holds all three, so there is nothing left over to fully un-hide again. */}
        <div class="a2-say">
          <label class="a2-say-l for-clarification" for={`a2-statement-${item.key}`}>
            What needs clarifying, and from whom? Required.
          </label>
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
 * One of the four section-1 rows the orange form never answers — `ASSESSED_DEVICE_KEYS` — drawn
 * as a finding rather than a fact: a choice or a line of text, required of A1, and reviewable by
 * A2 exactly as 2.5 onward is. `row.no` is the row's own number, which is also its A2 item key.
 */
function AssessedDeviceField({
  row,
  answers,
  locked,
  a2Review,
  priorReviews,
}: {
  row: DeviceRow;
  answers: F004Answers;
  locked: boolean;
  a2Review?: { review: SecondaryReviewPayload; submitted: boolean };
  priorReviews?: readonly PriorSecondaryReview[];
}): JSX.Element {
  const a2Locked = a2Review?.submitted ?? true;
  const a2: A2Choice | undefined = a2Review && {
    key: row.no,
    review: a2Review.review,
    locked: a2Locked,
  };

  return (
    <div class="f4-block">
      <div class="f4-blocktitle">
        <span class="f4-no" safe>
          {row.no}
        </span>{" "}
        <span safe>{row.label}</span>
      </div>

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
        <div class="f4-field">
          <label for={row.key} safe>
            {row.label}
          </label>
          <input id={row.key} name={row.key} value={value(answers, row.key)} disabled={locked} />
        </div>
      )}

      <A2InlineDecision
        itemKey={row.no}
        answers={answers}
        review={a2Review?.review}
        locked={a2Locked}
        priorReviews={priorReviews}
      />
    </div>
  );
}

export function F004Form({
  reportId,
  answers,
  device,
  event,
  assessorName,
  assessedOn,
  submitted,
  readOnly,
  sectionComments,
  commentAction,
  omitSecond,
  a2Review,
  priorReviews,
  issues,
}: F004FormProps): JSX.Element {
  const causality = value(answers, "causality");
  const risk = value(answers, "risk_level");
  // Card-style and tick-style choices pair A2's option in beside A1's own rather than through
  // `Radios`, so each reads its item's replacement value straight from the review here.
  const causalityA2Values = a2ChosenValues(a2Review?.review, "4.2");
  const riskA2Values = a2ChosenValues(a2Review?.review, "6");
  const actionsA2Values = a2ChosenValues(a2Review?.review, "7.1_actions");
  // Submitted is one way to be closed and not being its author is the other, and the document is
  // rendered the same for both.
  const locked = submitted || readOnly === true;
  const writingA2 = a2Review !== undefined && !a2Review.submitted;
  const sheetLocked = locked && !writingA2;

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
            <h2 class="f4-title">
              Adverse events / incidents of medical devices / in vitro diagnostics assessment
              template
            </h2>
          </div>
          <div class="f4-stamp">
            <div safe>{F004_VERSION}</div>
            <div>Effective date: 31/07/2026</div>
          </div>
        </div>

        {/* The assessor strip. The name is the signed-in Officer and the date is the system's: an
            assessment signed in somebody else's name would be worth nothing. */}
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

      <Sheet locked={sheetLocked} reportId={reportId} action={a2Review?.action}>
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
                a2={a2Review && { key: "2.5", review: a2Review.review, locked: a2Review.submitted }}
              />
              <Comment name="c2_5" answers={answers} locked={locked} />
              <A2InlineDecision
                itemKey="2.5"
                answers={answers}
                review={a2Review?.review}
                locked={a2Review?.submitted ?? true}
                priorReviews={priorReviews}
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
                a2={a2Review && { key: "2.6", review: a2Review.review, locked: a2Review.submitted }}
              />
              <Comment name="c2_6" answers={answers} locked={locked} />
              <A2InlineDecision
                itemKey="2.6"
                answers={answers}
                review={a2Review?.review}
                locked={a2Review?.submitted ?? true}
                priorReviews={priorReviews}
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
                a2={a2Review && { key: "2.7", review: a2Review.review, locked: a2Review.submitted }}
              />
              <Comment name="c2_7" answers={answers} locked={locked} />
              <A2InlineDecision
                itemKey="2.7"
                answers={answers}
                review={a2Review?.review}
                locked={a2Review?.submitted ?? true}
                priorReviews={priorReviews}
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
            {IMDRF_GROUPS.map((group) => (
              <div class="f4-block">
                <div class="f4-blocktitle">
                  <span class="f4-no" safe>
                    {group.no}
                  </span>{" "}
                  <span safe>{group.title}</span>
                </div>

                {group.items.map((item) => (
                  <div class="f4-imdrf-item">
                    <div class="f4-imdrf-h">
                      <span class="f4-letter" safe>{`${group.no}.${item.letter}`}</span>{" "}
                      <span safe>{item.title}</span>
                    </div>
                    <p class="f4-note" safe>
                      {item.annex}
                    </p>
                    <div class="f4-grid">
                      {[1, 2, 3]
                        .filter((level) => level <= item.levels)
                        .map((level) => (
                          <div class="f4-field">
                            <label for={`imdrf_${item.key}_l${level}`}>
                              Preferred terminology level {String(level)}
                            </label>
                            <input
                              id={`imdrf_${item.key}_l${level}`}
                              name={`imdrf_${item.key}_l${level}`}
                              value={value(answers, `imdrf_${item.key}_l${level}`)}
                              disabled={locked}
                            />
                          </div>
                        ))}
                      <div class="f4-field">
                        <label for={`imdrf_${item.key}_code`}>Coding</label>
                        <input
                          id={`imdrf_${item.key}_code`}
                          name={`imdrf_${item.key}_code`}
                          value={value(answers, `imdrf_${item.key}_code`)}
                          disabled={locked}
                        />
                      </div>
                    </div>
                    <A2InlineDecision
                      itemKey={`${group.no}.${item.letter}`}
                      answers={answers}
                      review={a2Review?.review}
                      locked={a2Review?.submitted ?? true}
                      priorReviews={priorReviews}
                    />
                  </div>
                ))}
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
                a2={a2Review && { key: "4.1", review: a2Review.review, locked: a2Review.submitted }}
              />
              <Comment name="c4_1" answers={answers} locked={locked} />
              <A2InlineDecision
                itemKey="4.1"
                answers={answers}
                review={a2Review?.review}
                locked={a2Review?.submitted ?? true}
                priorReviews={priorReviews}
              />
            </div>

            <div class="f4-block">
              <div class="f4-blocktitle">
                <span class="f4-no">4.2</span> Establish whether there is a link between the device
                and the event
              </div>
              <div class="f4-cards">
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
                a2={a2Review && { key: "5", review: a2Review.review, locked: a2Review.submitted }}
              />
              <Comment name="c5" answers={answers} rows={6} locked={locked} />
              <A2InlineDecision
                itemKey="5"
                answers={answers}
                review={a2Review?.review}
                locked={a2Review?.submitted ?? true}
                priorReviews={priorReviews}
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
                <span class="f4-no">7.1</span> First assessor's recommendations and conclusion,
                including proposed regulatory action(s)
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
              />
              <A2InlineDecision
                itemKey="7.1_conclusion"
                answers={answers}
                review={a2Review?.review}
                locked={a2Review?.submitted ?? true}
                priorReviews={priorReviews}
              />
            </div>

            {/* 7.2 belongs to the second assessor. Shown so the document is recognisably the whole
              form — the same eleven actions and a conclusion box, laid out exactly as 7.1 is — but
              disabled and empty, and every control here carries no `name`. A disabled field is
              not submitted regardless, but omitting the name too means there is no field in this
              block the request body could ever carry a value under, whatever reaches the server. */}
            {!omitSecond && (
              <div class="f4-block f4-locked">
                <div class="f4-blocktitle">
                  <span class="f4-no">7.2</span> Second assessor concluding remarks
                </div>
                <p class="f4-pending">Pending second assessor review</p>
                <div class="f4-ticks f4-11">
                  {ACTIONS.map((action) => (
                    <label class="f4-tick f4-tick-locked">
                      <input type="checkbox" disabled />
                      <span>
                        <span class="f4-no" safe>
                          {action.no}
                        </span>{" "}
                        <span safe>{action.label}</span>
                      </span>
                    </label>
                  ))}
                </div>
                <div class="f4-field">
                  <textarea
                    rows="3"
                    disabled
                    placeholder="(To be completed by the second assessor upon review)"
                  />
                </div>
              </div>
            )}
          </section>

          <section class="f4-section" id="section-8">
            <Bar
              no="8"
              title="Signature"
              comments={sectionComments?.["8"]}
              action={commentAction?.("8")}
            />
            <div class="f4-sign">
              <div class="f4-field">
                <label for="signature">1st Assessor — type your name to sign</label>
                <input
                  id="signature"
                  name="signature"
                  value={value(answers, "signature")}
                  placeholder={assessorName}
                  autocomplete="off"
                  disabled={locked}
                />
                <p class="f4-note">
                  Typed, not uploaded. It must match the name above, which is the account you are
                  signed in as.
                </p>
              </div>
              {!omitSecond && (
                <div class="f4-field f4-muted">
                  <label for="signature-2">Secondary assessor</label>
                  <input id="signature-2" value="" disabled placeholder="Not yet assessed" />
                </div>
              )}
            </div>
          </section>
        </fieldset>

        {a2Review?.submitted === true ? (
          <p class="hint">
            This secondary assessment has been submitted and is now read-only. The report is with
            the manager for a decision.
          </p>
        ) : writingA2 ? (
          <div class="bar f4-buttons">
            <button type="submit" name="intent" value="save" class="btn ghost">
              Save draft
            </button>
            <div class="sp"></div>
            <button type="submit" name="intent" value="submit" class="btn">
              Submit assessment
            </button>
          </div>
        ) : submitted ? (
          <p class="hint">
            This assessment has been submitted and is now read-only. The report is with the manager,
            who decides whether another assessor reviews it.
          </p>
        ) : (
          // Only ever reached on the live path, where `Sheet` is a real form for these to submit.
          !locked && (
            <div class="bar f4-buttons">
              <button type="submit" name="intent" value="save" class="btn ghost">
                Save draft
              </button>
              <div class="sp"></div>
              <button type="submit" name="intent" value="submit" class="btn">
                Submit assessment
              </button>
            </div>
          )
        )}
      </Sheet>
    </>
  );
}
