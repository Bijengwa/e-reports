import type { Children } from "@kitajs/html";
import {
  type Answers,
  DEPENDENCIES,
  type Dependency,
  FIRST_STEP,
  type Issue,
  LAST_STEP,
  list,
  STEP_FIELDS,
  STEPS,
  type Step,
  value,
} from "../domain/form-schema.js";
import { localPhoneDigits, PHONE_COUNTRY_CODE, PHONE_LOCAL_PATTERN } from "../domain/phone.js";
import { FORM_VERSION } from "../domain/reports.js";
import { type Locale, type MessageKey, type Translate, translatorFor } from "../i18n/index.js";
import { MAX_ATTACHMENTS } from "../storage/index.js";
import { BrandMark } from "../views/shared/brand-mark.js";
import { Layout } from "../views/shared/layout.js";

export type { Answers, Step };
export { FIRST_STEP, LAST_STEP, STEP_FIELDS };

/** An attachment already written to storage, carried between steps so a 422 does not lose it. */
export type CarriedAttachment = {
  objectKey: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
};

export const MAX_UPLOAD_MB = 10;

// ---- Small building blocks ---------------------------------------------------

type FieldProps = {
  t: Translate;
  answers: Answers;
  issues: readonly Issue[];
  name: string;
  labelKey: MessageKey;
  required?: boolean;
};

function issueFor(issues: readonly Issue[], name: string): Issue | undefined {
  return issues.find((issue) => issue.field === name);
}

function messageFor(t: Translate, issue: Issue): string {
  return issue.kind === "phone"
    ? t("error.phone", { label: t(issue.labelKey) })
    : t("error.required", { label: t(issue.labelKey) });
}

/** The message under a field the reporter has not filled in correctly. */
function FieldError({
  t,
  issues,
  name,
}: {
  t: Translate;
  issues: readonly Issue[];
  name: string;
}): JSX.Element {
  const issue = issueFor(issues, name);
  if (!issue) return <></>;

  return (
    <p class="field-error" id={`${name}-error`} safe>
      {messageFor(t, issue)}
    </p>
  );
}

function Req({ required }: { required?: boolean }): JSX.Element {
  return required ? <i aria-hidden="true">*</i> : <></>;
}

/**
 * Wraps a field whose relevance depends on another answer.
 *
 * The `data-requires-*` attributes are generated from the same table the server validates against,
 * so what the reporter sees greyed out and what the server enforces cannot drift apart. `is-off`
 * is rendered server-side too, so the field arrives dulled before the script runs — and stays
 * correct if the script never runs at all.
 */
function Dependent({
  dep,
  answers,
  children,
}: {
  dep: Dependency;
  answers: Answers;
  children?: Children;
}): JSX.Element {
  const current = list(answers, dep.on);
  const met = dep.values.some((wanted) => current.includes(wanted));

  return (
    <div
      class={met ? "dependent" : "dependent is-off"}
      data-requires-field={dep.on}
      data-requires-values={dep.values.join("|")}
    >
      {children}
    </div>
  );
}

function TextField(
  props: FieldProps & {
    type?: "text" | "date" | "number" | "email";
    placeholderKey?: MessageKey;
    min?: string;
    fallback?: string;
  },
): JSX.Element {
  const { t, answers, issues, name, labelKey, required, type = "text" } = props;
  const invalid = issueFor(issues, name) !== undefined;

  return (
    <div class="f">
      <label for={name}>
        {t(labelKey)} <Req required={required} />
      </label>
      <input
        type={type}
        id={name}
        name={name}
        required={required}
        min={props.min}
        aria-invalid={invalid ? "true" : undefined}
        aria-describedby={invalid ? `${name}-error` : undefined}
        value={value(answers, name) || props.fallback || ""}
        placeholder={props.placeholderKey ? t(props.placeholderKey) : undefined}
      />
      <FieldError t={t} issues={issues} name={name} />
    </div>
  );
}

function TextArea(
  props: FieldProps & { rows?: "short" | "tall"; placeholderKey?: MessageKey },
): JSX.Element {
  const { t, answers, issues, name, labelKey, required } = props;
  const invalid = issueFor(issues, name) !== undefined;

  return (
    <div class="f">
      <label for={name}>
        {t(labelKey)} <Req required={required} />
      </label>
      <textarea
        id={name}
        name={name}
        required={required}
        class={props.rows ?? ""}
        aria-invalid={invalid ? "true" : undefined}
        aria-describedby={invalid ? `${name}-error` : undefined}
        placeholder={props.placeholderKey ? t(props.placeholderKey) : undefined}
        safe
      >
        {value(answers, name)}
      </textarea>
      <FieldError t={t} issues={issues} name={name} />
    </div>
  );
}

type Option = { value: string; labelKey: MessageKey };

function Choices(
  props: FieldProps & { type: "radio" | "checkbox"; options: readonly Option[] },
): JSX.Element {
  const { t, answers, issues, name, labelKey, required, type, options } = props;
  const chosen = list(answers, name);

  return (
    <fieldset class="f">
      <legend>
        {t(labelKey)} <Req required={required} />
      </legend>
      <div class="checks">
        {options.map((option) => (
          <label class="chk">
            <input
              type={type}
              name={name}
              value={option.value}
              checked={chosen.includes(option.value)}
            />{" "}
            {t(option.labelKey)}
          </label>
        ))}
      </div>
      <FieldError t={t} issues={issues} name={name} />
    </fieldset>
  );
}

/** The "if other, please explain" box belonging to the choice group above it. */
function OtherBox(props: FieldProps): JSX.Element {
  const { t, answers, issues, name, labelKey } = props;
  const dep = DEPENDENCIES[name];
  if (!dep) return <></>;

  return (
    <Dependent dep={dep} answers={answers}>
      <input
        name={name}
        class="also"
        value={value(answers, name)}
        placeholder={t(labelKey)}
        aria-label={t(labelKey)}
      />
      <FieldError t={t} issues={issues} name={name} />
    </Dependent>
  );
}

/**
 * Answers belonging to every step except the one on screen, re-emitted so the browser posts them
 * back. Without this, moving between steps would quietly discard everything already typed.
 */
function CarriedAnswers({ answers, step }: { answers: Answers; step: Step }): JSX.Element {
  const onScreen = new Set(STEP_FIELDS[step]);
  const carried: JSX.Element[] = [];

  for (const [name, raw] of Object.entries(answers)) {
    if (onScreen.has(name)) continue;
    for (const single of Array.isArray(raw) ? raw : [raw]) {
      carried.push(<input type="hidden" name={name} value={single} />);
    }
  }

  return <>{carried}</>;
}

/** Files already in object storage, carried as metadata so a rejected step does not lose them. */
function CarriedAttachments({
  attachments,
}: {
  attachments: readonly CarriedAttachment[];
}): JSX.Element {
  return (
    <>
      {attachments.map((file) => (
        <input type="hidden" name="attachment_meta" value={JSON.stringify(file)} />
      ))}
    </>
  );
}

// ---- Page --------------------------------------------------------------------

export type OrangeFormProps = {
  step?: Step;
  answers?: Answers;
  issues?: readonly Issue[];
  /** Shown above the form — used to say why a submission did not go through. */
  notice?: string;
  locale?: Locale;
  attachments?: readonly CarriedAttachment[];
  /**
   * Where the wizard posts. Defaults to the public door's own address.
   *
   * This and the two below are the whole of what made this form the public door's. The five steps,
   * their fields, their rules and their dependencies come from `form-schema` and are the same form
   * whoever fills it in — so an Officer transcribing a report that arrived by email reads exactly
   * what the reporter read, which is the point of transcribing it.
   */
  action?: string;
  /**
   * Whether to offer EN/SW. The staff portal is English only, so it does not.
   *
   * A language bar there would be a control that changes nothing: the pages around it are not
   * translated, and the Officer is transcribing a document rather than filing their own. The
   * staff door passes `false` as well as `embedded` — the latter already hides the bar along with
   * the rest of the orange chrome, so this is belt and braces: un-embedding the form could not
   * quietly start offering Swahili on an English-only portal.
   */
  languages?: boolean;
  /**
   * Render as content inside another page's chrome, rather than as a page.
   *
   * The staff door already has a document, a title bar and a rail; what it needs from here is the
   * form, not a second header competing with the first. Embedding drops the orange top bar and
   * the full-viewport background, and keeps everything that makes this the orange form — the warm
   * paper, the banners, the step tabs, the field styling — because an Officer transcribing a
   * report should be reading the same document the reporter filled in.
   */
  embedded?: boolean;
};

export type OrangeFormPageProps = OrangeFormProps & {
  /** Shown only on success, and only on the public door: a staff filing redirects to the report. */
  reportNumber?: string;
};

function LanguageBar({ locale }: { locale: Locale }): JSX.Element {
  // Submit buttons rather than links: switching language mid-form must carry every answer with it,
  // and a plain <a> would start a fresh GET and throw the half-filled report away.
  return (
    <div class="lang">
      <button
        type="submit"
        name="action"
        value="lang:en"
        class={locale === "en" ? "on" : ""}
        formnovalidate
      >
        EN
      </button>
      <button
        type="submit"
        name="action"
        value="lang:sw"
        class={locale === "sw" ? "on" : ""}
        formnovalidate
      >
        SW
      </button>
    </div>
  );
}

/**
 * The wizard: one form, five steps, and nothing that belongs to a document.
 *
 * No `<html>`, no `<head>`, no title bar. Whoever renders this decides what surrounds it — the
 * public door wraps it in `OrangeFormPage` below, and the staff door drops it into `StaffShell`
 * beside the Officer's rail. That is the whole reason it is separate: a form that emitted its own
 * document could only ever be a page of its own.
 */
export function OrangeForm(props: OrangeFormProps): JSX.Element {
  const locale: Locale = props.locale ?? "en";
  const t = translatorFor(locale);
  const currentStep = props.step ?? FIRST_STEP;
  const answers = props.answers ?? {};
  const issues = props.issues ?? [];
  const attachments = props.attachments ?? [];

  // Only the final step carries files, so only it needs the heavier encoding.
  const enctype = currentStep === LAST_STEP ? "multipart/form-data" : undefined;

  return (
    <div class={props.embedded ? "orange-page is-embedded" : "orange-page"}>
      <form
        method="POST"
        action={props.action ?? "/orange-form"}
        enctype={enctype}
        data-orange-form
      >
        <input type="hidden" name="step" value={String(currentStep)} />
        <input type="hidden" name="locale" value={locale} />
        <CarriedAnswers answers={answers} step={currentStep} />
        <CarriedAttachments attachments={attachments} />

        {/* The orange bar is the public page's own chrome: its mark, its heading, its language
            switch. Embedded, the surrounding page has all three already, and a second header
            below the first would be the mistake this branch exists to avoid.

            It sits inside the form because the language buttons submit it — switching language
            mid-form has to carry every answer with it. */}
        {!props.embedded && (
          <header class="otop">
            {/* The same mark the staff door renders, in the orange page's palette. */}
            <BrandMark />
            <h1 safe>{t("app.heading")}</h1>
            <div class="sp"></div>
            {(props.languages ?? true) && <LanguageBar locale={locale} />}
          </header>
        )}

        <div class="obody">
          <div class="obanner" safe>
            {t("banner.official")}
          </div>

          {props.notice && (
            <div class="obanner notice" role="alert" safe>
              {props.notice}
            </div>
          )}

          {issues.length > 0 && (
            <div class="obanner notice" role="alert">
              <strong safe>{t("error.heading")}</strong>
              <ul>
                {issues.map((issue) => (
                  <li safe>{messageFor(t, issue)}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Step tabs. Buttons, not decoration: a reporter can jump straight back to a section
                to correct it, and `formnovalidate` keeps a half-filled field from trapping them.
                Jumping forward is still gated by the server. */}
          <ol class="steps" id="ostep">
            {STEPS.map((step) => (
              <li class={currentStep === step ? "on" : ""}>
                <button
                  type="submit"
                  name="action"
                  value={`goto:${step}`}
                  formnovalidate
                  aria-current={currentStep === step ? "step" : undefined}
                >
                  <span class="num">{String(step)}</span>{" "}
                  <span safe>{t(`step.${step}` as MessageKey)}</span>
                </button>
              </li>
            ))}
          </ol>

          <div class="card">
            <div class="card-b">
              {currentStep === 1 && (
                <div>
                  <TextField
                    t={t}
                    answers={answers}
                    issues={issues}
                    name="device_name"
                    labelKey="f.device_name"
                    placeholderKey="f.device_name.ph"
                    required
                  />

                  <div class="grid2">
                    <TextField
                      t={t}
                      answers={answers}
                      issues={issues}
                      name="brand_name"
                      labelKey="f.brand_name"
                    />
                    <TextField
                      t={t}
                      answers={answers}
                      issues={issues}
                      name="common_name"
                      labelKey="f.common_name"
                      placeholderKey="f.common_name.ph"
                    />
                    <TextField
                      t={t}
                      answers={answers}
                      issues={issues}
                      name="size"
                      labelKey="f.size"
                    />
                    <TextField
                      t={t}
                      answers={answers}
                      issues={issues}
                      name="serial_number"
                      labelKey="f.serial_number"
                    />
                    <TextField
                      t={t}
                      answers={answers}
                      issues={issues}
                      name="manufacturing_date"
                      labelKey="f.manufacturing_date"
                      type="date"
                    />
                    <TextField
                      t={t}
                      answers={answers}
                      issues={issues}
                      name="batch_number"
                      labelKey="f.batch_number"
                    />
                    <TextField
                      t={t}
                      answers={answers}
                      issues={issues}
                      name="expiry_date"
                      labelKey="f.expiry_date"
                      type="date"
                    />
                  </div>

                  <TextArea
                    t={t}
                    answers={answers}
                    issues={issues}
                    name="manufacturer"
                    labelKey="f.manufacturer"
                    rows="short"
                  />

                  <Choices
                    t={t}
                    answers={answers}
                    issues={issues}
                    name="source"
                    labelKey="f.source"
                    type="radio"
                    options={[
                      { value: "Hospital", labelKey: "o.source.hospital" },
                      { value: "Pharmacy", labelKey: "o.source.pharmacy" },
                      { value: "Diagnostic centre", labelKey: "o.source.diagnostic" },
                      { value: "Others", labelKey: "o.source.other" },
                    ]}
                  />

                  <TextArea
                    t={t}
                    answers={answers}
                    issues={issues}
                    name="supplier"
                    labelKey="f.supplier"
                    rows="short"
                  />

                  <Choices
                    t={t}
                    answers={answers}
                    issues={issues}
                    name="status"
                    labelKey="f.status"
                    type="radio"
                    options={[
                      { value: "New", labelKey: "o.status.new" },
                      { value: "Refurbished", labelKey: "o.status.refurbished" },
                    ]}
                  />

                  <Choices
                    t={t}
                    answers={answers}
                    issues={issues}
                    name="duration"
                    labelKey="f.duration"
                    type="radio"
                    options={[
                      { value: "<6 months", labelKey: "o.duration.6m" },
                      { value: "<1 year", labelKey: "o.duration.1y" },
                      { value: "1-5 years", labelKey: "o.duration.1to5" },
                      { value: "Others", labelKey: "o.duration.other" },
                    ]}
                  />
                  <OtherBox
                    t={t}
                    answers={answers}
                    issues={issues}
                    name="duration_other"
                    labelKey="f.duration_other"
                  />
                </div>
              )}

              {currentStep === 2 && (
                <div>
                  <p class="hint step-lead" safe>
                    {t("lead.incident")}
                  </p>

                  <div class="grid2">
                    <TextField
                      t={t}
                      answers={answers}
                      issues={issues}
                      name="incident_date"
                      labelKey="f.incident_date"
                      type="date"
                      required
                    />
                    <TextField
                      t={t}
                      answers={answers}
                      issues={issues}
                      name="devices_involved"
                      labelKey="f.devices_involved"
                      type="number"
                      min="1"
                      fallback="1"
                    />
                  </div>

                  <Choices
                    t={t}
                    answers={answers}
                    issues={issues}
                    name="incident_type"
                    labelKey="f.incident_type"
                    type="checkbox"
                    required
                    options={[
                      { value: "Inadequate design", labelKey: "o.incident.design" },
                      { value: "Inaccurate labeling", labelKey: "o.incident.labeling" },
                      { value: "Malfunction", labelKey: "o.incident.malfunction" },
                      { value: "Deterioration", labelKey: "o.incident.deterioration" },
                      { value: "Other", labelKey: "o.other" },
                    ]}
                  />
                  <OtherBox
                    t={t}
                    answers={answers}
                    issues={issues}
                    name="incident_type_other"
                    labelKey="f.incident_type_other"
                  />

                  <TextArea
                    t={t}
                    answers={answers}
                    issues={issues}
                    name="incident_narrative"
                    labelKey="f.incident_narrative"
                    placeholderKey="f.incident_narrative.ph"
                    rows="tall"
                    required
                  />
                </div>
              )}

              {currentStep === 3 && (
                <div>
                  <p class="hint step-lead" safe>
                    {t("lead.event")}
                  </p>

                  <div class="grid2">
                    <TextField
                      t={t}
                      answers={answers}
                      issues={issues}
                      name="event_date"
                      labelKey="f.event_date"
                      type="date"
                    />
                    <TextField
                      t={t}
                      answers={answers}
                      issues={issues}
                      name="users_involved"
                      labelKey="f.users_involved"
                      type="number"
                      min="0"
                      fallback="1"
                    />
                  </div>

                  <Choices
                    t={t}
                    answers={answers}
                    issues={issues}
                    name="event_type"
                    labelKey="f.event_type"
                    type="checkbox"
                    required
                    options={[
                      { value: "Death", labelKey: "o.event.death" },
                      { value: "Life threatening", labelKey: "o.event.lifeThreatening" },
                      { value: "Malfunction", labelKey: "o.event.malfunction" },
                      { value: "Persistent disability", labelKey: "o.event.disability" },
                      { value: "Hospitalization", labelKey: "o.event.hospitalization" },
                      { value: "Other", labelKey: "o.other" },
                    ]}
                  />
                  <OtherBox
                    t={t}
                    answers={answers}
                    issues={issues}
                    name="event_type_other"
                    labelKey="f.event_type_other"
                  />

                  <TextArea
                    t={t}
                    answers={answers}
                    issues={issues}
                    name="event_narrative"
                    labelKey="f.event_narrative"
                    rows="tall"
                    required
                  />
                </div>
              )}

              {currentStep === 4 && (
                <div>
                  <Choices
                    t={t}
                    answers={answers}
                    issues={issues}
                    name="operator"
                    labelKey="f.operator"
                    type="radio"
                    options={[
                      { value: "Healthcare Providers", labelKey: "o.operator.hcp" },
                      { value: "Maintenance Engineer", labelKey: "o.operator.engineer" },
                      { value: "Other", labelKey: "o.other" },
                    ]}
                  />
                  <OtherBox
                    t={t}
                    answers={answers}
                    issues={issues}
                    name="operator_other"
                    labelKey="f.operator_other"
                  />

                  <TextArea
                    t={t}
                    answers={answers}
                    issues={issues}
                    name="measures_taken"
                    labelKey="f.measures_taken"
                    placeholderKey="f.measures_taken.ph"
                    required
                  />

                  <TextArea
                    t={t}
                    answers={answers}
                    issues={issues}
                    name="measures_outcome"
                    labelKey="f.measures_outcome"
                  />

                  <Choices
                    t={t}
                    answers={answers}
                    issues={issues}
                    name="informed_supplier"
                    labelKey="f.informed_supplier"
                    type="radio"
                    required
                    options={[
                      { value: "Yes", labelKey: "o.yes" },
                      { value: "No", labelKey: "o.no" },
                    ]}
                  />

                  {DEPENDENCIES.informed_date && (
                    <Dependent dep={DEPENDENCIES.informed_date} answers={answers}>
                      <label for="informed_date" safe>
                        {t("f.informed_date")}
                      </label>
                      <input
                        type="date"
                        id="informed_date"
                        name="informed_date"
                        class="also"
                        value={value(answers, "informed_date")}
                      />
                      <div class="sub" safe>
                        {t("f.informed_date.hint")}
                      </div>
                      <FieldError t={t} issues={issues} name="informed_date" />
                    </Dependent>
                  )}
                </div>
              )}

              {currentStep === 5 && (
                <div>
                  <div class="grid2">
                    <TextField
                      t={t}
                      answers={answers}
                      issues={issues}
                      name="reporter_name"
                      labelKey="f.reporter_name"
                      required
                    />
                    <Choices
                      t={t}
                      answers={answers}
                      issues={issues}
                      name="reporter_type"
                      labelKey="f.reporter_type"
                      type="radio"
                      options={[
                        { value: "Medical practitioner", labelKey: "o.reporter.practitioner" },
                        { value: "Other", labelKey: "o.other" },
                      ]}
                    />
                  </div>

                  <TextField
                    t={t}
                    answers={answers}
                    issues={issues}
                    name="facility_address"
                    labelKey="f.facility_address"
                    required
                  />

                  <div class="grid2">
                    <TextField
                      t={t}
                      answers={answers}
                      issues={issues}
                      name="location"
                      labelKey="f.location"
                      required
                    />
                    <TextField
                      t={t}
                      answers={answers}
                      issues={issues}
                      name="email"
                      labelKey="f.email"
                      type="email"
                    />

                    {/* The +255 is fixed furniture beside the box, so the number cannot be
                          entered in five different shapes. */}
                    <div class="f">
                      <label for="phone">
                        {t("f.phone")} <Req required />
                      </label>
                      <div class="phone-row">
                        <span class="phone-cc" aria-hidden="true">
                          {PHONE_COUNTRY_CODE}
                        </span>
                        <input
                          id="phone"
                          name="phone"
                          required
                          inputmode="numeric"
                          autocomplete="tel-national"
                          maxlength="9"
                          pattern={PHONE_LOCAL_PATTERN}
                          placeholder="7XX XXX XXX"
                          aria-describedby="phone-hint"
                          aria-invalid={issueFor(issues, "phone") ? "true" : undefined}
                          value={localPhoneDigits(value(answers, "phone"))}
                        />
                      </div>
                      <div class="sub" id="phone-hint" safe>
                        {t("f.phone.hint")}
                      </div>
                      <div class="sub" safe>
                        {t("f.phone.sms")}
                      </div>
                      <FieldError t={t} issues={issues} name="phone" />
                    </div>

                    <TextField
                      t={t}
                      answers={answers}
                      issues={issues}
                      name="report_date"
                      labelKey="f.report_date"
                      type="date"
                      required
                    />
                  </div>

                  <TextField
                    t={t}
                    answers={answers}
                    issues={issues}
                    name="device_location"
                    labelKey="f.device_location"
                    placeholderKey="f.device_location.ph"
                    required
                  />

                  <div class="f">
                    <label for="attachments" safe>
                      {t("f.attachments")}
                    </label>
                    <input
                      type="file"
                      id="attachments"
                      name="attachments"
                      multiple
                      accept="image/jpeg,image/png,application/pdf"
                    />
                    <div class="sub" safe>
                      {t("f.attachments.hint")}
                    </div>
                    <div class="sub" safe>
                      {t("f.attachments.limits", {
                        count: MAX_ATTACHMENTS,
                        size: MAX_UPLOAD_MB,
                      })}
                    </div>

                    {attachments.length > 0 && (
                      <ul class="attached">
                        <li class="attached-head" safe>
                          {t("f.attachments.attached")}
                        </li>
                        {attachments.map((file) => (
                          <li safe>{file.filename}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div class="bar nav">
            {currentStep > FIRST_STEP && (
              // `formnovalidate` matters: going back must never be blocked by a required field
              // the reporter has not reached a decision on yet.
              <button type="submit" name="action" value="back" class="btn ghost" formnovalidate>
                ← <span safe>{t("nav.back")}</span>
              </button>
            )}
            <div class="sp"></div>
            {currentStep < LAST_STEP ? (
              <button type="submit" name="action" value="next" class="btn orange" safe>
                {t("nav.continue")}
              </button>
            ) : (
              <button type="submit" name="action" value="submit" class="btn orange" safe>
                {t("nav.submit")}
              </button>
            )}
          </div>

          {/* Document-control metadata: it matters to TMDA and to an auditor, not to the person
                filling the form in, so it sits at the foot of the page rather than in the lead. */}
          <footer class="ofoot">
            <p class="sub" safe>
              {t("footer.privacy")}
            </p>
            <p class="sub">
              <span safe>{t("footer.formVersion")}</span>: <span safe>{FORM_VERSION}</span>
            </p>
          </footer>
        </div>
      </form>
    </div>
  );
}

/**
 * The public door's whole page: the document, the orange chrome, and the form inside it.
 *
 * Kept here rather than in the public door's routes because the confirmation screen belongs to the
 * same form as the steps that lead to it. The staff door never renders this — it embeds `OrangeForm`
 * in its own shell and redirects to the report once one exists, so an Officer is never shown a
 * number to write down and never sees "file another".
 */
export function OrangeFormPage(props: OrangeFormPageProps): JSX.Element {
  const locale: Locale = props.locale ?? "en";
  const t = translatorFor(locale);

  if (props.reportNumber) {
    return (
      <Layout title={t("app.confirmTitle")} locale={locale}>
        <div class="orange-page">
          <header class="otop">
            {/* The same mark the staff door renders, in the orange page's palette. */}
            <BrandMark />
            <h1 safe>{t("app.heading")}</h1>
            <div class="sp"></div>
          </header>

          <div class="obody">
            <div class="card confirm">
              <div class="eyebrow" safe>
                {t("done.eyebrow")}
              </div>
              <div class="confirm-num" safe>
                {props.reportNumber}
              </div>
              <p class="confirm-lead" safe>
                {t("done.lead")}
              </p>
              <p class="hint" safe>
                {t("done.keep")}
              </p>
              <p class="hint" safe>
                {t("done.hint")}
              </p>
              <div class="confirm-act">
                <a href="/" class="btn orange" safe>
                  {t("done.another")}
                </a>
              </div>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title={t("app.formTitle")} locale={locale}>
      <OrangeForm {...props} />
    </Layout>
  );
}
