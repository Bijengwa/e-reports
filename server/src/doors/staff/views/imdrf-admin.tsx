/**
 * The IMDRF terminology admin area: release tabs, one release's detail, and the upload workflow.
 *
 * Kept to the three pages the workflow actually has — list/detail, preview, and the temp-password
 * page's sibling for nothing secret — rather than a CMS. Upload never writes; only a POST to
 * `/imdrf/import` on the preview page does, and only when the preview itself reported no errors.
 */

import type { ImportPreview } from "../../../domain/imdrf/import-service.js";
import type { ReleaseSummary } from "../../../domain/imdrf/query-service.js";
import type { AnnexSummary } from "../../../domain/imdrf/types.js";
import { StaffShell } from "./shell.js";

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
      title="Manage IMDRF Terminology — AE Reports"
      pageTitle="Manage IMDRF Terminology"
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
            {releases.length} release{releases.length === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      <nav class="rail-nav" aria-label="IMDRF releases" style="flex-direction: row; gap: 8px;">
        {releases.map((release) => (
          <a
            href={`/imdrf/manage?release=${release.id}`}
            class={selected?.id === release.id ? "btn" : "btn ghost"}
          >
            {release.releaseYear}
            {release.status === "draft" && <span class="tag warn">Draft</span>}
          </a>
        ))}
      </nav>

      {selected && (
        <div class="card card-b">
          <div class="staff-head">
            <div class="sp">
              <p class="eyebrow">Release {selected.releaseYear}</p>
              <h2 safe>{selected.title ?? "IMDRF Adverse Event Terminology"}</h2>
              <p class="hint">
                Status:{" "}
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
      )}

      <div class="card card-b staff-narrow">
        <h2>Upload new release</h2>
        <p class="hint">
          Uploading a year that already has a <b>draft</b> release replaces that draft's terms.
          Uploading a year that is already <b>published</b> is refused — publish a new year instead.
        </p>
        <form method="POST" action="/imdrf/manage/upload" enctype="multipart/form-data">
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
            <label for="workbook">
              Workbook (.xlsx) <i>*</i>
            </label>
            <input type="file" id="workbook" name="workbook" accept=".xlsx" required />
          </div>
          <div class="bar">
            <button type="submit" class="btn">
              Validate &amp; preview
            </button>
          </div>
        </form>
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
      pageTitle="Preview IMDRF import"
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

            <form method="POST" action="/imdrf/manage/import">
              <input type="hidden" name="token" value={preview.token} />
              <div class="bar">
                <button type="submit" class="btn">
                  Confirm import
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
              This workbook cannot be imported. Fix the issues below and upload again.
            </div>
            <div class="tscroll">
              <table class="utable">
                <thead>
                  <tr>
                    <th>Sheet</th>
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
