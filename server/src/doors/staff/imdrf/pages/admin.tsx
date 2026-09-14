/**
 * The IMDRF terminology admin area: a full-width release library, a dedicated import page, and
 * the preview page between validate and confirm.
 *
 * Three pages, not one cramped two-column form: `/imdrf/manage` lists releases and their annex
 * coverage and links to `/imdrf/manage/import`, which carries nothing but the paste form. Both are
 * full width — a two-column 1.35fr/1fr grid squeezed a multi-thousand-line JSON textarea into
 * ~40% of the viewport, which is why the import form moved to its own page instead of living
 * beside the release list.
 *
 * Validating never writes; only a POST to `/imdrf/manage/import` on the preview page does, and
 * only when validation itself reported no errors ("VALIDATION PASSED" / "READY TO IMPORT"). A
 * failed validation renders "IMPORT BLOCKED" with the itemized errors instead — nothing is ever
 * partially imported.
 */

import type { ImportPreview } from "../../../../domain/imdrf/import-service.js";
import type { ValidationIssue } from "../../../../domain/imdrf/validate.js";
import type { ReleaseSummary } from "../../../../domain/imdrf/query-service.js";
import { ANNEX_DESCRIPTIONS, ANNEXES, type Annex, type AnnexSummary } from "../../../../domain/imdrf/types.js";
import { StaffShell } from "../../shared/shell.js";

const DEFAULT_DOCUMENT_CODE = "IMDRF/AE WG/N43";
const DEFAULT_TITLE = "IMDRF Adverse Event Terminology";

function day(value: Date | null): string {
  return value ? new Date(value).toISOString().slice(0, 10) : "—";
}

/* ───────────────────────────── Library page ───────────────────────────── */

export type ImdrfLibraryPageProps = {
  releases: ReleaseSummary[];
  selected: ReleaseSummary | null;
  summary: AnnexSummary[];
  error?: string;
  viewerRole: string;
  viewerName: string;
};

export function ImdrfLibraryPage({
  releases,
  selected,
  summary,
  error,
  viewerRole,
  viewerName,
}: ImdrfLibraryPageProps): JSX.Element {
  const total = summary.reduce((sum, row) => sum + row.count, 0);
  const presentAnnexes = new Set(summary.filter((row) => row.count > 0).map((row) => row.annex));

  return (
    <StaffShell
      title="Manage IMDRF — AE Reports"
      pageTitle="Manage IMDRF"
      role={viewerRole}
      fullName={viewerName}
      active="imdrf-manage"
    >
      {error && (
        <div class="alert alert-error" safe>
          {error}
        </div>
      )}

      <div class="staff-head">
        <div class="sp">
          <p class="hint">
            {releases.length} release{releases.length === 1 ? "" : "s"}. Paste the official IMDRF
            JSON, preview it, then publish. Officers read published releases at IMDRF.
          </p>
        </div>
        <a href="/imdrf/manage/import" class="btn">
          + Import New Release
        </a>
      </div>

      {releases.length > 0 ? (
        <>
          <nav class="wl-tabs" aria-label="IMDRF releases">
            {releases.map((release) => {
              const on = selected?.id === release.id;
              return (
                <a
                  href={`/imdrf/manage?release=${release.id}`}
                  class={on ? "on" : ""}
                  aria-current={on ? "true" : undefined}
                >
                  {release.releaseYear}
                  {release.status === "draft" && <span class="wl-count">draft</span>}
                </a>
              );
            })}
          </nav>

          {selected && (
            <div class="card card-b">
              <div class="imdrf-release-head">
                <div class="sp">
                  <p class="eyebrow">Release {selected.releaseYear}</p>
                  <h2 safe>{selected.title ?? DEFAULT_TITLE}</h2>
                  <p class="hint">
                    {selected.status === "published" ? (
                      <span class="tag">Published</span>
                    ) : (
                      <span class="tag muted">Draft</span>
                    )}
                    {selected.documentCode && (
                      <>
                        {" · "}
                        <span safe>{selected.documentCode}</span>
                      </>
                    )}
                  </p>
                  <p class="hint">
                    Source: <span safe>{selected.sourceFileName}</span> · Imported{" "}
                    {day(selected.createdAt)}
                    {selected.publishedAt && <> · Published {day(selected.publishedAt)}</>}
                  </p>
                </div>
                {selected.status === "draft" && (
                  <form method="POST" action={`/imdrf/manage/${selected.id}/publish`}>
                    <button type="submit" class="btn">
                      Publish
                    </button>
                  </form>
                )}
              </div>

              <div class="tscroll">
                <table class="utable">
                  <thead>
                    <tr>
                      <th>Annex</th>
                      <th>Description</th>
                      <th>Terms</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.map((row) => (
                      <tr>
                        <td safe>{row.annex}</td>
                        <td safe>{ANNEX_DESCRIPTIONS[row.annex]}</td>
                        <td>{row.count}</td>
                        <td>{presentAnnexes.has(row.annex) ? "Present" : "—"}</td>
                      </tr>
                    ))}
                    <tr>
                      <td>
                        <b>Total</b>
                      </td>
                      <td />
                      <td>
                        <b>{total}</b>
                      </td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      ) : (
        <p class="hint">
          No releases yet. <a href="/imdrf/manage/import">Import the first release</a>.
        </p>
      )}
    </StaffShell>
  );
}

/* ───────────────────────────── Import page ────────────────────────────── */

export type ImdrfImportPageProps = {
  error?: string;
  viewerRole: string;
  viewerName: string;
};

export function ImdrfImportPage({ error, viewerRole, viewerName }: ImdrfImportPageProps): JSX.Element {
  return (
    <StaffShell
      title="Import IMDRF release — AE Reports"
      pageTitle="Import IMDRF release"
      role={viewerRole}
      fullName={viewerName}
      active="imdrf-manage"
    >
      {error && (
        <div class="alert alert-error" safe>
          {error}
        </div>
      )}

      <div class="staff-head">
        <div class="sp">
          <p class="hint">
            Pasting a year that already has a <b>draft</b> release replaces that draft's terms.
            Pasting a year that is already <b>published</b> is refused — publish a new year instead.
          </p>
        </div>
        <a href="/imdrf/manage" class="btn ghost">
          ← Back to releases
        </a>
      </div>

      <div class="card card-b">
        <form method="POST" action="/imdrf/manage/validate">
          <div class="f">
            <label for="release_year">
              Release year <i>*</i>
            </label>
            <input
              type="number"
              id="release_year"
              name="release_year"
              required
              min="2000"
              max="2100"
              placeholder="2026"
            />
          </div>
          <div class="f">
            <label for="document_code">Document code</label>
            <input
              type="text"
              id="document_code"
              name="document_code"
              maxlength={200}
              value={DEFAULT_DOCUMENT_CODE}
            />
          </div>
          <div class="f">
            <label for="title">Title</label>
            <input type="text" id="title" name="title" maxlength={200} value={DEFAULT_TITLE} />
          </div>
          <div class="f">
            <label for="payload">
              IMDRF JSON payload <i>*</i>
            </label>
            <p class="hint">Paste the official IMDRF JSON exactly as provided. Do not edit the payload.</p>
            <textarea
              id="payload"
              name="payload"
              required
              rows="20"
              spellcheck="false"
              class="code-paste"
              data-paste-only
            />
            <div class="bar">
              <button type="button" class="btn ghost" data-paste-clear="payload">
                Clear
              </button>
            </div>
          </div>
          <div class="bar">
            <button type="submit" class="btn">
              Validate
            </button>
          </div>
        </form>
      </div>

      <script src="/assets/imdrf-paste.js" defer></script>
    </StaffShell>
  );
}

/* ───────────────────────────── Preview page ───────────────────────────── */

export type ImdrfImportPreviewPageProps = {
  preview: ImportPreview;
  viewerRole: string;
  viewerName: string;
};

function issuesByAnnex(issues: ValidationIssue[]): { annex: Annex | null; issues: ValidationIssue[] }[] {
  const groups = new Map<Annex | null, ValidationIssue[]>();
  for (const issue of issues) {
    const key = issue.annex;
    const list = groups.get(key) ?? [];
    list.push(issue);
    groups.set(key, list);
  }
  const ordered: { annex: Annex | null; issues: ValidationIssue[] }[] = [];
  if (groups.has(null)) ordered.push({ annex: null, issues: groups.get(null) as ValidationIssue[] });
  for (const annex of ANNEXES) {
    if (groups.has(annex)) ordered.push({ annex, issues: groups.get(annex) as ValidationIssue[] });
  }
  return ordered;
}

export function ImdrfImportPreviewPage({
  preview,
  viewerRole,
  viewerName,
}: ImdrfImportPreviewPageProps): JSX.Element {
  const presentAnnexes = preview.summary.filter((row) => row.count > 0);

  return (
    <StaffShell
      title="Preview import — AE Reports"
      pageTitle="Preview import"
      role={viewerRole}
      fullName={viewerName}
      active="imdrf-manage"
    >
      <div class="staff-head">
        <div class="sp">
          <p class="eyebrow">Release {preview.releaseYear}</p>
          <h2 safe>{preview.payloadSource}</h2>
        </div>
      </div>

      {preview.ok ? (
        <>
          <div class="alert alert-ok">
            <b>VALIDATION PASSED</b> — {preview.total} term{preview.total === 1 ? "" : "s"} across{" "}
            {presentAnnexes.length} annex{presentAnnexes.length === 1 ? "" : "es"}, hierarchy depth{" "}
            {preview.maxLevel}. <b>READY TO IMPORT.</b>
          </div>
          <div class="tscroll">
            <table class="utable">
              <thead>
                <tr>
                  <th>Annex</th>
                  <th>Description</th>
                  <th>Terms</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.summary.map((row) => (
                  <tr>
                    <td safe>{row.annex}</td>
                    <td safe>{ANNEX_DESCRIPTIONS[row.annex]}</td>
                    <td>{row.count}</td>
                    <td>{row.count > 0 ? "Present" : "—"}</td>
                  </tr>
                ))}
                <tr>
                  <td>
                    <b>Total</b>
                  </td>
                  <td />
                  <td>
                    <b>{preview.total}</b>
                  </td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>

          <details>
            <summary>
              Preview terms ({preview.sample.length} of {preview.total} shown)
            </summary>
            <div class="tscroll">
              <table class="utable">
                <thead>
                  <tr>
                    <th>Annex</th>
                    <th>Code</th>
                    <th>Term</th>
                    <th>Level</th>
                    <th>CodeHierarchy</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.sample.map((term) => (
                    <tr>
                      <td safe>{term.annex}</td>
                      <td safe>{term.code}</td>
                      <td safe>{term.term}</td>
                      <td>{term.level}</td>
                      <td safe>{term.codeHierarchy}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          <form method="POST" action="/imdrf/manage/import">
            <input type="hidden" name="token" value={preview.token} />
            <div class="bar">
              <button type="submit" class="btn">
                Import release
              </button>
              <a href="/imdrf/manage" class="btn ghost">
                Cancel
              </a>
            </div>
          </form>
        </>
      ) : (
        <>
          <div class="alert alert-error">
            <b>
              IMPORT BLOCKED — {preview.issues.filter((issue) => issue.severity === "error").length}{" "}
              error
              {preview.issues.filter((issue) => issue.severity === "error").length === 1 ? "" : "s"}
            </b>
            . Fix the issues below in the source JSON payload and paste it again — nothing was
            imported.
          </div>

          {issuesByAnnex(preview.issues).map((group) => {
            const errorCount = group.issues.filter((i) => i.severity === "error").length;
            return (
              <div class="card card-b">
                <h2 safe>
                  {group.annex ? `Annex ${group.annex} — ${ANNEX_DESCRIPTIONS[group.annex]}` : "Payload"}
                </h2>
                <p class="hint">
                  {errorCount} error{errorCount === 1 ? "" : "s"}
                </p>
                <div class="tscroll">
                  <table class="utable">
                    <thead>
                      <tr>
                        <th>Severity</th>
                        <th>Index</th>
                        <th>Field</th>
                        <th>Message</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.issues.map((issue) => (
                        <tr>
                          <td safe>{issue.severity}</td>
                          <td>{issue.index ?? "—"}</td>
                          <td safe>{issue.field ?? "—"}</td>
                          <td safe>{issue.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}

          <div class="bar">
            <a href="/imdrf/manage/import" class="btn ghost">
              Back
            </a>
          </div>
        </>
      )}
    </StaffShell>
  );
}
