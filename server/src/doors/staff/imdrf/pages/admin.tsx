/**
 * The IMDRF terminology admin area: release tabs, one release's detail, and the paste workflow.
 *
 * Kept to the three pages the workflow actually has — list/detail, preview, and the temp-password
 * page's sibling for nothing secret — rather than a CMS. Validating never writes; only a POST to
 * `/imdrf/manage/import` on the preview page does, and only when validation itself reported no
 * errors ("VALIDATION PASSED" / "READY TO IMPORT"). A failed validation renders "IMPORT BLOCKED"
 * with the itemized errors instead — nothing is ever partially imported.
 *
 * Layout matches the rest of the door: the title bar carries the page name alone, `.staff-head`
 * carries the count, year switching is the same tab bar Workload already uses, and the selected
 * release sits beside the paste form rather than stacked under a second copy of the rail. No
 * inline styles — `style-src 'self'` would drop them.
 */

import type { ImportPreview } from "../../../../domain/imdrf/import-service.js";
import type { ReleaseSummary } from "../../../../domain/imdrf/query-service.js";
import type { AnnexSummary } from "../../../../domain/imdrf/types.js";
import { StaffShell } from "../../shared/shell.js";

/** IMDRF's own fixed annex titles — presentation copy, not stored: the two tables hold exactly
 *  what the spec asks for, and an annex's title does not vary release to release. */
const ANNEX_TITLES: Record<string, string> = {
  A: "Medical Device Problem",
  B: "Type of Investigation",
  C: "Investigation Findings",
  D: "Investigation Conclusion",
  E: "Clinical Signs, Symptoms or Conditions",
  F: "Health Impact",
  G: "Medical Device Component",
};

function day(value: Date | null): string {
  return value ? new Date(value).toISOString().slice(0, 10) : "—";
}

export type ImdrfAdminPageProps = {
  releases: ReleaseSummary[];
  selected: ReleaseSummary | null;
  summary: AnnexSummary[];
  error?: string;
  viewerRole: string;
  viewerName: string;
};

export function ImdrfAdminPage({
  releases,
  selected,
  summary,
  error,
  viewerRole,
  viewerName,
}: ImdrfAdminPageProps): JSX.Element {
  const total = summary.reduce((sum, row) => sum + row.count, 0);

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
            {releases.length} release{releases.length === 1 ? "" : "s"}. Upload a yearly workbook,
            preview it, then publish. Officers read published releases at IMDRF.
          </p>
        </div>
      </div>

      {releases.length > 0 && (
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
      )}

      <div class="imdrf-admin">
        {selected ? (
          <div class="card card-b">
            <div class="imdrf-release-head">
              <div class="sp">
                <p class="eyebrow">Release {selected.releaseYear}</p>
                <h2 safe>{selected.title ?? "IMDRF Adverse Event Terminology"}</h2>
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
                  Source file: <span safe>{selected.sourceFileName}</span> · Imported{" "}
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
                    <th>Title</th>
                    <th>Terms</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map((row) => (
                    <tr>
                      <td safe>{row.annex}</td>
                      <td safe>{ANNEX_TITLES[row.annex] ?? ""}</td>
                      <td>{row.count}</td>
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
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p class="hint">No releases yet. Upload a workbook to create the first draft.</p>
        )}

        <div class="card card-b">
          <h2>Paste new release</h2>
          <p class="hint">
            Pasting a year that already has a <b>draft</b> release replaces that draft's terms.
            Pasting a year that is already <b>published</b> is refused — publish a new year
            instead.
          </p>
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
                placeholder="IMDRF/AE WG/N43"
              />
            </div>
            <div class="f">
              <label for="title">Title</label>
              <input
                type="text"
                id="title"
                name="title"
                maxlength={200}
                placeholder="IMDRF Adverse Event Terminology"
              />
            </div>
            <div class="f">
              <label for="payload">
                IMDRF JSON payload <i>*</i>
              </label>
              <p class="hint">
                Do not edit the JSON. Paste the official IMDRF payload exactly as provided.
              </p>
              <textarea
                id="payload"
                name="payload"
                required
                rows="16"
                spellcheck="false"
                class="code-paste"
                placeholder={
                  '{\n  "releaseYear": 2026,\n  "documentCode": "IMDRF/AE WG/N43",\n  "title": "IMDRF Adverse Event Terminology",\n  "annexes": { "A": [ ... ], "B": [ ... ], "...": [] }\n}'
                }
              />
            </div>
            <div class="bar">
              <button type="submit" class="btn">
                Validate
              </button>
            </div>
          </form>
        </div>
      </div>
    </StaffShell>
  );
}

export type ImdrfImportPreviewPageProps = {
  preview: ImportPreview;
  viewerRole: string;
  viewerName: string;
};

export function ImdrfImportPreviewPage({
  preview,
  viewerRole,
  viewerName,
}: ImdrfImportPreviewPageProps): JSX.Element {
  return (
    <StaffShell
      title="Preview import — AE Reports"
      pageTitle="Preview import"
      role={viewerRole}
      fullName={viewerName}
      active="imdrf-manage"
    >
      <div class="staff-narrow">
        <div class="staff-head">
          <div class="sp">
            <p class="eyebrow">Release {preview.releaseYear}</p>
            <h2 safe>{preview.sourceFileName}</h2>
          </div>
        </div>

        {preview.ok ? (
          <>
            <div class="alert alert-ok">
              <b>VALIDATION PASSED</b> — {preview.total} term{preview.total === 1 ? "" : "s"}{" "}
              across {preview.summary.filter((row) => row.count > 0).length} annex
              {preview.summary.filter((row) => row.count > 0).length === 1 ? "" : "es"}, hierarchy
              depth {preview.maxLevel}. <b>READY TO IMPORT.</b>
            </div>
            <div class="tscroll">
              <table class="utable">
                <thead>
                  <tr>
                    <th>Annex</th>
                    <th>Terms</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.summary.map((row) => (
                    <tr>
                      <td safe>{row.annex}</td>
                      <td>{row.count}</td>
                    </tr>
                  ))}
                  <tr>
                    <td>
                      <b>Total</b>
                    </td>
                    <td>
                      <b>{preview.total}</b>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <details>
              <summary>Preview terms ({preview.sample.length} of {preview.total} shown)</summary>
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
                {preview.issues.filter((issue) => issue.severity === "error").length === 1
                  ? ""
                  : "s"}
              </b>
              . Fix the issues below in the source payload and paste it again — nothing was
              imported.
            </div>
            <div class="tscroll">
              <table class="utable">
                <thead>
                  <tr>
                    <th>Annex</th>
                    <th>Row</th>
                    <th>Field</th>
                    <th>Problem</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.issues
                    .filter((issue) => issue.severity === "error")
                    .map((issue) => (
                      <tr>
                        <td safe>{issue.sheet}</td>
                        <td>{issue.row ?? "—"}</td>
                        <td safe>{issue.field ?? "—"}</td>
                        <td safe>{issue.message}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <div class="bar">
              <a href="/imdrf/manage" class="btn ghost">
                Back
              </a>
            </div>
          </>
        )}
      </div>
    </StaffShell>
  );
}





