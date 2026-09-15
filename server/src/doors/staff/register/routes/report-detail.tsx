import { sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { FIRST_ASSESSMENT, prefillDeviceRows, prefillEventRows } from "../../../../domain/f004.js";
import { type AssessorOption, loadReport } from "../../../../domain/report-detail.js";
import { currentSession } from "../../session-guard.js";
import type { SectionComment } from "../../shared/components/f004.js";
import { ForbiddenPage } from "../../shared/forbidden.js";
import { CaseDetailPage } from "../pages/report-detail.js";

const ReportId = z.uuid();

/**
 * Every active Officer, with how much of `assessments` is currently theirs to act on — the figure
 * a Manager weighs before naming one of them.
 *
 * `excludeAssessorsOnReportId`, when given, drops whoever already holds an assessment on that one
 * report.
 */
async function officerWorkloadOptions(
  app: FastifyInstance,
  excludeAssessorsOnReportId?: string,
): Promise<AssessorOption[]> {
  const rows = await app.db.execute(sql`
    SELECT u.id, u.full_name,
           count(a.id) FILTER (WHERE a.submitted_at IS NULL) AS active,
           count(a.id) FILTER (WHERE a.submitted_at IS NULL AND a.due_at < now()) AS overdue
      FROM users u
      LEFT JOIN assessments a ON a.assessor_id = u.id
     WHERE u.role = 'assessor'
       AND u.is_active
       ${
         excludeAssessorsOnReportId === undefined
           ? sql``
           : sql`AND u.id NOT IN (
                   SELECT assessor_id FROM assessments WHERE report_id = ${excludeAssessorsOnReportId}
                 )`
}
     GROUP BY u.id, u.full_name
     ORDER BY u.full_name
  `);

  return rows.map((r) => {
    const row = r as { id: string; full_name: string; active: string; overdue: string };
    return {
      id: row.id,
      fullName: row.full_name,
      workload: { active: Number(row.active), overdue: Number(row.overdue) },
    };
  });
}

/**
 * Whether this Officer has any standing to open this case's page at all.
 *
 * Three ways in, and they are the three ways an Officer is a party to a report rather than a
 * reader of the register: they hold the first assessment, they hold a secondary one at any
 * ordinal, or they keyed the report in and were sent straight to it.
 */
async function officerIsPartyTo(
  app: FastifyInstance,
  reportId: string,
  officerId: string,
): Promise<boolean> {
  const rows = await app.db.execute(sql`
    SELECT 1
      FROM reports r
     WHERE r.id = ${reportId}
       AND (
         r.assessor1_user_id = ${officerId}
         OR r.entered_by_user_id = ${officerId}
         OR EXISTS (
           SELECT 1 FROM assessments a
            WHERE a.report_id = r.id AND a.assessor_id = ${officerId}
         )
       )
  `);

  return rows.length > 0;
}

/**
 * One case's page, with an optional refusal over it.
 *
 * Exported because the manager's review and the manager's decisions each post to a route of their
 * own, and a refused submission belongs back on the case page it was refused on.
 */
export async function renderCaseDetail(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  id: string,
  status: 200 | 422 = 200,
  error?: string,
): Promise<void> {
  const session = currentSession(request);

  const found = await loadReport(app, id);
  if (found === null) return reply.redirect("/register", 302);

  const isManager = session.role === "manager";

  // The one status at which the manager's review of the first assessment is still a live piece of
  // work. That review is written FOR the next assessor, so it is actionable in the window between
  // A1 arriving and the manager naming who reads it next, and in no other.
  const reviewIsActionable = found.report.status === "awaiting_second_assessor";

  const sectionComments: Record<string, SectionComment[]> = {};

  if (isManager && found.assessment1 !== null) {
    const rows = await app.db.execute(sql`
      SELECT c.section, c.body, c.created_at, u.full_name AS author
        FROM assessment_comments c
        JOIN assessments a ON a.id = c.assessment_id
        JOIN users u ON u.id = c.author_user_id
       WHERE a.report_id = ${found.report.id}
         AND a.ordinal = ${FIRST_ASSESSMENT}
       ORDER BY c.section, c.created_at
    `);

    for (const raw of rows) {
      const note = raw as { section: string; body: string; created_at: Date; author: string };
      const bucket = sectionComments[note.section] ?? [];
      bucket.push({
        author: note.author,
        body: note.body,
        at: new Date(note.created_at).toISOString().slice(0, 16).replace("T", " "),
      });
      sectionComments[note.section] = bucket;
    }
  }

  const assessment1Review =
    isManager && found.assessment1 !== null
      ? {
          ...found.assessment1,
          device: prefillDeviceRows(found.report.payload, found.report),
          event: prefillEventRows(found.report.payload),
          sectionComments,
          commentAction: reviewIsActionable
            ? (section: string) =>
                `/reports/${found.report.id}/assessment-1/sections/${section}/comments`
            : undefined,
        }
      : undefined;

  const canAssignFirst =
    isManager && found.report.status === "received" && found.assessor1UserId === null;

  const firstAssessorPicker: AssessorOption[] | undefined = canAssignFirst
    ? await officerWorkloadOptions(app)
    : undefined;

  const canAssignNext =
    isManager &&
    (found.report.status === "awaiting_second_assessor" ||
      found.report.status === "awaiting_decision") &&
    found.assessment1 !== null;

  const nextAssessorPicker: AssessorOption[] | undefined = canAssignNext
    ? await officerWorkloadOptions(app, found.report.id)
    : undefined;

  const canAssignWork =
    isManager &&
    found.report.status === "awaiting_decision" &&
    found.secondaryAssessments.some((a) => a.submitted) &&
    !found.secondaryAssessments.some((a) => !a.submitted);

  const workOfficerPicker: AssessorOption[] | undefined = canAssignWork
    ? (
        await app.db.execute(
          sql`SELECT id, full_name FROM users WHERE role = 'assessor' AND is_active ORDER BY full_name`,
        )
      ).map((r) => {
        const u = r as { id: string; full_name: string };
        return { id: u.id, fullName: u.full_name };
      })
    : undefined;

  const finalDocument = await app.db.execute(sql`
    SELECT 1 FROM report_final_documents WHERE report_id = ${found.report.id}
  `);

  return reply
    .status(status)
    .html(
      <CaseDetailPage
        report={found.report}
        viewerRole={session.role}
        viewerName={session.fullName}
        error={error}
        canAssess={session.role === "assessor" && found.assessor1UserId === session.userId}
        mySecondaryOrdinal={
          session.role === "assessor"
            ? (found.secondaryAssessments.find((a) => a.assessorId === session.userId)?.ordinal ??
              (found.legacyAssessor2UserId === session.userId &&
              found.report.status === "second_assessment"
                ? 2
                : null))
            : null
        }
        assessor1Name={found.assessor1Name}
        assessor1DueAt={found.assessor1DueAt}
        assessor1Submitted={found.assessment1 !== null}
        assessment1Review={assessment1Review}
        secondaryAssessments={found.secondaryAssessments}
        firstAssessorPicker={firstAssessorPicker}
        nextAssessorPicker={nextAssessorPicker}
        workOfficerPicker={workOfficerPicker}
        decisions={found.decisions}
        hasFinalDocument={finalDocument.length > 0}
        canComment={isManager && found.assessment1 !== null && reviewIsActionable}
      />,
    );
}

/**
 * The Register's one case page.
 *
 * Registered alongside `registerRoutes` in the same `["manager", "assessor"]` scope: the Register
 * is the case's home, and access to one case follows access to the register it belongs to. An
 * Officer's own extra restriction — must be a party to the case, and the case must not already be
 * over — is a fact about the row, so it is asked here rather than expressed as a scope.
 */
export async function caseDetailRoutes(app: FastifyInstance): Promise<void> {
  const forbid = (reply: FastifyReply, role: string) =>
    reply.status(403).html(ForbiddenPage({ role }));

  app.get("/register/:id", async (request, reply) => {
    const session = currentSession(request);

    const target = ReportId.safeParse((request.params as { id: string }).id);
    if (!target.success) return reply.redirect("/register", 302);

    if (session.role === "assessor") {
      if (!(await officerIsPartyTo(app, target.data, session.userId))) {
        return forbid(reply, session.role);
      }

      const rows = await app.db.execute(sql`
        SELECT status::text AS status FROM reports WHERE id = ${target.data}
      `);
      const status = (rows[0] as { status: string } | undefined)?.status;
      if (status === "assigned_for_work") return forbid(reply, session.role);
    }

    return renderCaseDetail(app, request, reply, target.data);
  });
}
