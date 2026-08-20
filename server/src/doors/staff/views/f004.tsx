import type { Children } from "@kitajs/html";
import {
  ACTIONS,
  CAUSALITY_DISCUSSION_NOTE,
  CAUSALITY_OPTIONS,
  DEVICE_ROWS,
  EVENT_ROWS,
  EXPECTEDNESS_NOTE,
  EXPECTEDNESS_OPTIONS,
  F004_VERSION,
  type F004Answers,
  IMDRF_GROUPS,
  IMDRF_NOTE,
  type Issue,
  list,
  PUBLIC_HEALTH_QUESTION,
  RISK_IVD_NOTE,
  RISK_NOTE,
  RISK_OPTIONS,
  SERIOUS_CRITERIA,
  SERIOUSNESS_OPTIONS,
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
  issues: readonly Issue[];
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
  children,
}: {
  locked: boolean;
  reportId: string;
  children?: Children;
}): JSX.Element {
  if (locked) return <div class="f4">{children}</div>;

  return (
    <form method="POST" action={`/reports/${reportId}/assessment-1`} class="f4">
      {children}
    </form>
  );
}

function Bar({ no, title }: { no: string; title: string }): JSX.Element {
  return (
    <div class="f4-bar">
      <span class="f4-bar-no" safe>
        {no}
      </span>
      <span safe>{title}</span>
    </div>
  );
}

/** A read-only requirement and the assessor's comment on it: the paper's two columns. */
function RequirementRow({
  no,
  label,
  name,
  filled,
  answers,
  rows,
}: {
  no: string;
  label: string;
  name: string;
  filled: string;
  answers: F004Answers;
  rows?: number;
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
            <div class="f4-filled" safe>
              {filled}
            </div>
          )}
        </div>
      </div>
      <div class="f4-comment">
        <textarea name={name} rows={String(rows ?? 2)} placeholder="Comment" safe>
          {value(answers, name)}
        </textarea>
      </div>
    </div>
  );
}

/**
 * Section 1 as the paper reads: the number, what is required, and what was filed.
 *
 * A comment box on all nineteen rows turned the administrative section into a wall of empty
 * textareas an assessor scrolled past. The value is the point of these rows; a note is the
 * exception, so it is one line and says it is optional.
 */
function FactRow({
  no,
  label,
  name,
  filled,
  answers,
}: {
  no: string;
  label: string;
  name: string;
  filled: string;
  answers: F004Answers;
}): JSX.Element {
  return (
    <>
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
          <span class="f4-value" safe>
            {filled}
          </span>
        )}
      </div>
      <div class="f4-note-line">
        <label for={name}>Assessor note (optional)</label>
        <input id={name} name={name} value={value(answers, name)} />
      </div>
    </>
  );
}

/**
 * A single-choice question, the way the paper puts one: a short vertical list of options, a radio
 * beside each, the chosen one told apart by the mark in the circle rather than by a coloured box
 * around the whole row. No pill, no card — those are for the two questions the form itself gives
 * pages of criteria to (causality, risk); this is for the ones it settles in one line.
 */
function Radios({
  name,
  options,
  answers,
}: {
  name: string;
  options: readonly { value: string; label: string; note?: string }[];
  answers: F004Answers;
}): JSX.Element {
  const chosen = value(answers, name);

  return (
    <div class="f4-radio-group">
      {options.map((option) => (
        <label class="f4-radio-row">
          <input type="radio" name={name} value={option.value} checked={chosen === option.value} />
          <span>
            <b safe>{option.label}</b>
            {option.note && <span class="f4-note" safe>{` — ${option.note}`}</span>}
          </span>
        </label>
      ))}
    </div>
  );
}

function Comment({
  name,
  answers,
  rows = 3,
  label = "Comment",
}: {
  name: string;
  answers: F004Answers;
  rows?: number;
  label?: string;
}): JSX.Element {
  return (
    <div class="f4-field">
      <label for={name} safe>
        {label}
      </label>
      <textarea id={name} name={name} rows={String(rows)} safe>
        {value(answers, name)}
      </textarea>
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
  issues,
}: F004FormProps): JSX.Element {
  const causality = value(answers, "causality");
  const risk = value(answers, "risk_level");
  // Submitted is one way to be closed and not being its author is the other, and the document is
  // rendered the same for both.
  const locked = submitted || readOnly === true;

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
          <div class="f4-muted">
            <span class="f4-k">2nd Assessor</span>
            <span class="f4-v">—</span>
          </div>
          <div class="f4-muted">
            <span class="f4-k">Date</span>
            <span class="f4-v">—</span>
          </div>
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

      <Sheet locked={locked} reportId={reportId}>
        {/* One disabled fieldset rather than a second, read-only rendering of the whole document.
            A disabled control is not submitted, so a closed assessment cannot be edited by
            replaying the form — and there is one copy of this markup to keep correct, not two. */}
        <fieldset disabled={locked}>
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
            <Bar no="1" title="Administrative information — device information" />
            {DEVICE_ROWS.map((row) => (
              <FactRow
                no={row.no}
                label={row.label}
                name={`c1_${row.key}`}
                filled={device[row.key] ?? ""}
                answers={answers}
              />
            ))}
          </section>

          <section class="f4-section" id="section-2">
            <Bar no="2" title="Event / incident assessment" />
            {EVENT_ROWS.map((row) => (
              <RequirementRow
                no={row.no}
                label={row.label}
                name={`c2_${row.key}`}
                filled={event[row.key] ?? ""}
                answers={answers}
                rows={row.key === "description" ? 4 : 2}
              />
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
              <Radios name="source_of_event" options={SOURCE_OPTIONS} answers={answers} />
              <Comment name="c2_5" answers={answers} />
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
              <Radios name="seriousness" options={SERIOUSNESS_OPTIONS} answers={answers} />
              <Comment name="c2_6" answers={answers} />
            </div>

            <div class="f4-block">
              <div class="f4-blocktitle">
                <span class="f4-no">2.7</span> <span safe>{PUBLIC_HEALTH_QUESTION}</span>
              </div>
              <Radios name="public_health" options={YES_NO} answers={answers} />
              <Comment name="c2_7" answers={answers} />
            </div>
          </section>

          <section class="f4-section" id="section-3">
            <Bar no="3" title="IMDRF category of the adverse incident / event" />
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
                      <span class="f4-letter" safe>{`(${item.letter})`}</span>{" "}
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
                            />
                          </div>
                        ))}
                      <div class="f4-field">
                        <label for={`imdrf_${item.key}_code`}>Coding</label>
                        <input
                          id={`imdrf_${item.key}_code`}
                          name={`imdrf_${item.key}_code`}
                          value={value(answers, `imdrf_${item.key}_code`)}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ))}
            <p class="f4-note" safe>
              {IMDRF_NOTE}
            </p>
          </section>

          <section class="f4-section" id="section-4">
            <Bar no="4" title="Relationship / causality assessment" />

            <div class="f4-block">
              <div class="f4-blocktitle">
                <span class="f4-no">4.1</span> Is the adverse event / incident expected or
                unexpected?
              </div>
              <p class="f4-note" safe>
                {EXPECTEDNESS_NOTE}
              </p>
              <Radios name="expectedness" options={EXPECTEDNESS_OPTIONS} answers={answers} />
              <Comment name="c4_1" answers={answers} />
            </div>

            <div class="f4-block">
              <div class="f4-blocktitle">
                <span class="f4-no">4.2</span> Establish whether there is a link between the device
                and the event
              </div>
              <div class="f4-cards">
                {CAUSALITY_OPTIONS.map((option) => (
                  <label class={causality === option.value ? "f4-card on" : "f4-card"}>
                    <div class="f4-card-h">
                      <input
                        type="radio"
                        name="causality"
                        value={option.value}
                        checked={causality === option.value}
                      />
                      <b safe>{option.label}</b>
                    </div>
                    <ul class="f4-card-c">
                      {option.criteria.map((line) => (
                        <li safe>{line}</li>
                      ))}
                    </ul>
                  </label>
                ))}
              </div>
            </div>

            <div class="f4-block">
              <div class="f4-blocktitle">
                <span class="f4-no">4.3</span> Discussion of causal relationship
              </div>
              <p class="f4-note" safe>
                {CAUSALITY_DISCUSSION_NOTE}
              </p>
              <Comment name="c4_3" answers={answers} rows={5} label="Discussion" />
            </div>
          </section>

          <section class="f4-section" id="section-5">
            <Bar no="5" title="Signal detection" />
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
              <Radios name="signal_status" options={SIGNAL_OPTIONS} answers={answers} />
              <Comment name="c5" answers={answers} rows={4} />
            </div>
          </section>

          <section class="f4-section" id="section-6">
            <Bar no="6" title="Risk assessment" />
            <p class="f4-note" safe>
              {RISK_NOTE}
            </p>
            <div class="f4-cards f4-risk">
              {RISK_OPTIONS.map((option) => (
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
                    />
                    <b safe>{option.label}</b>
                  </div>
                  <p class="f4-card-c" safe>
                    {option.note}
                  </p>
                </label>
              ))}
            </div>
            <p class="f4-note" safe>
              {RISK_IVD_NOTE}
            </p>
            <Comment name="c6" answers={answers} />
          </section>

          <section class="f4-section" id="section-7">
            <Bar no="7" title="Conclusion of assessment" />
            <div class="f4-block">
              <div class="f4-blocktitle">
                <span class="f4-no">7.1</span> First assessor's recommendations and conclusion,
                including proposed regulatory action(s)
              </div>
              <p class="f4-note">Possible risk mitigation action(s):</p>
              <div class="f4-ticks f4-11">
                {ACTIONS.map((action) => (
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
              <Comment name="conclusion" answers={answers} rows={6} label="Conclusion" />
            </div>

            {/* 7.2 belongs to the second assessor. Shown so the document is recognisably the whole
              form — the same eleven actions and a conclusion box, laid out exactly as 7.1 is — but
              disabled and empty, and every control here carries no `name`. A disabled field is
              not submitted regardless, but omitting the name too means there is no field in this
              block the request body could ever carry a value under, whatever reaches the server. */}
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
          </section>

          <section class="f4-section" id="section-8">
            <Bar no="8" title="Signature" />
            <div class="f4-sign">
              <div class="f4-field">
                <label for="signature">1st Assessor — type your name to sign</label>
                <input
                  id="signature"
                  name="signature"
                  value={value(answers, "signature")}
                  placeholder={assessorName}
                  autocomplete="off"
                />
                <p class="f4-note">
                  Typed, not uploaded. It must match the name above, which is the account you are
                  signed in as.
                </p>
              </div>
              <div class="f4-field f4-muted">
                <label for="signature-2">2nd Assessor</label>
                <input id="signature-2" value="" disabled placeholder="Not yet assessed" />
              </div>
            </div>
          </section>
        </fieldset>

        {submitted ? (
          <p class="hint">
            This assessment has been submitted and is now read-only. The report is with the second
            assessor.
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
