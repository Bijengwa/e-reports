import { describe, expect, it } from "vitest";
import {
  type AssessmentHistoryInput,
  buildAssessmentHistory,
} from "../src/domain/assessment-history.js";
import type { F004Answers, SecondaryReviewPayload } from "../src/domain/f004.js";
import { resolveFinalDocument } from "../src/domain/final-document.js";
import {
  FinalDocumentPage,
  type FinalDocumentPageProps,
  FinalDocumentPrintPage,
} from "../src/doors/staff/final-reports/pages/final-document.js";
import type { ReportDetail } from "../src/doors/staff/reports/pages/reports.js";

/**
 * The two final presentations of a concluded case, as functions.
 *
 * `final-document.test.ts` pins how the chain folds into one answer; the integration file pins the
 * addresses. This file pins the thing between them: that the record printed under a final document
 * is the record that exists, that the document above it is the same document either way, and that
 * neither of them says anything nobody wrote.
 *
 * Deliberately built from data rather than from HTTP. Every case below turns on an absence — an
 * assessment that was never made, a reason nobody recorded, a disagreement a later assessor
 * overturned — and an absence is much easier to assert on the structure than on a page.
 */

/** A1, answered. Narrow enough to read, wide enough that a review has something to disagree with. */
const A1: F004Answers = {
  device_type: "md",
  source_of_event: "malfunction",
  c2_5: "Reported by the facility as a device malfunction.",
  seriousness: "serious",
  c2_6: "Patient required admission.",
  expectedness: "unexpected",
  c4_1: "Not described in the manufacturer's IFU.",
  causality: "probable",
  signal_status: "signal",
  c5: "Second report against this lot within a month.",
  risk_level: "high",
  c6: "Serious outcome with an unresolved cause.",
  conclusion: "Recommend risk communication and enhanced monitoring.",
  signature: "Asha Mrema",
};

function review(responses: SecondaryReviewPayload["responses"]): SecondaryReviewPayload {
  return { kind: "a2_section_review", responses };
}

/**
 * A2, disagreeing with 4.2 causality and putting "possible" in its place.
 *
 * `value` is the replacement and `statement` the recorded words behind it — the payload's own
 * split, and the reason the history can print "what they did" and "why they said they did it" as
 * two facts rather than one blob.
 */
const A2_DISAGREES = review({
  "4.2": {
    degree: "disagree",
    value: "possible",
    statement: "The temporal link is weak and a second cause is documented.",
  },
});

/** A3, disagreeing in turn and restoring "probable". */
const A3_OVERTURNS = review({
  "4.2": {
    degree: "disagree",
    value: "probable",
    statement: "The second cause was excluded by the manufacturer's investigation.",
  },
});

function input(over: Partial<AssessmentHistoryInput> = {}): AssessmentHistoryInput {
  return {
    first: {
      assessorName: "Asha Mrema",
      answers: A1,
      submittedOn: "2026-08-04",
      managerComment: null,
    },
    secondary: [],
    decisions: [],
    ...over,
  };
}

const A1_AND_A2 = input({
  secondary: [
    {
      ordinal: 2,
      assessorName: "Juma Kileo",
      submittedOn: "2026-08-11",
      review: A2_DISAGREES,
      managerComment: null,
    },
  ],
  decisions: [
    {
      kind: "assign_next_assessor",
      comment: "A second opinion is needed on causality.",
      decidedByName: "Neema Shirima",
      decidedAt: "2026-08-06",
      nextAssessorName: "Juma Kileo",
      workOfficerName: null,
    },
    {
      kind: "assign_work_officer",
      comment: "Concluded as assessed.",
      decidedByName: "Neema Shirima",
      decidedAt: "2026-08-14",
      nextAssessorName: null,
      workOfficerName: "Rehema Salum",
    },
  ],
});

const A1_A2_AND_A3 = input({
  secondary: [
    ...A1_AND_A2.secondary,
    {
      ordinal: 3,
      assessorName: "Fatma Hamisi",
      submittedOn: "2026-08-20",
      review: A3_OVERTURNS,
      managerComment: null,
    },
  ],
  decisions: A1_AND_A2.decisions,
});

describe("the assessment history", () => {
  it("renders an A1 + A2 case as the two assessments that exist and no third", () => {
    const events = buildAssessmentHistory(A1_AND_A2);

    const assessments = events.filter(
      (event) => event.kind === "first_assessment" || event.kind === "secondary_assessment",
    );
    expect(assessments).toHaveLength(2);

    // The point of the case: nothing anywhere in the record mentions a third assessment, because
    // a third assessment was never made. Not an empty entry, not a heading, not a placeholder.
    const ordinals = events.map((event) => ("ordinal" in event ? event.ordinal : null));
    expect(ordinals).not.toContain(3);
  });

  it("renders all three assessments when a third one actually exists", () => {
    const events = buildAssessmentHistory(A1_A2_AND_A3);

    const secondary = events.filter((event) => event.kind === "secondary_assessment");
    expect(secondary.map((event) => event.ordinal)).toEqual([2, 3]);
    expect(secondary[1]?.assessorName).toBe("Fatma Hamisi");
  });

  it("shows only the first assessment when it is the only one", () => {
    const events = buildAssessmentHistory(input());

    expect(events.map((event) => event.kind)).toEqual(["first_assessment"]);
  });

  it("keeps A2's disagreement visible after A3 has overturned it", () => {
    const events = buildAssessmentHistory(A1_A2_AND_A3);
    const secondary = events.filter((event) => event.kind === "secondary_assessment");

    const a2 = secondary[0]?.actions.find((action) => action.itemNo === "4.2");
    const a3 = secondary[1]?.actions.find((action) => action.itemNo === "4.2");

    // A2 disagreed and replaced Probable with Possible. A3 disagreed in turn and put Probable
    // back. The final document says Probable — and the record still says A2 said otherwise, which
    // is the entire reason an audit trail exists.
    expect(a2?.degreeLabel).toBe("Disagree");
    expect(a2?.replacement).toBe("Possible");
    expect(a2?.reason).toBe("The temporal link is weak and a second cause is documented.");
    expect(a3?.degreeLabel).toBe("Disagree");
    expect(a3?.replacement).toBe("Probable");
  });

  it("prints the value each assessment was reading, not the value that finally survived", () => {
    const events = buildAssessmentHistory(A1_A2_AND_A3);
    const secondary = events.filter((event) => event.kind === "secondary_assessment");

    // A2 read A1's Probable. A3 read A2's Possible — the state of the case at the moment A3 was
    // asked to review it. A record that printed the final value in both rows would be describing
    // two disagreements neither assessor made.
    expect(secondary[0]?.actions.find((a) => a.itemNo === "4.2")?.asReviewed).toBe("Probable");
    expect(secondary[1]?.actions.find((a) => a.itemNo === "4.2")?.asReviewed).toBe("Possible");

    // And it agrees with the resolver, which is the other half of the claim: "as at ordinal 3" is
    // the same fold the final document uses, stopped one assessment earlier.
    const throughA2 = resolveFinalDocument(A1, [{ ordinal: 2, review: A2_DISAGREES }]);
    expect(throughA2.answers.causality).toBe("possible");
  });

  it("records an agreement as an action in its own right", () => {
    const events = buildAssessmentHistory(
      input({
        secondary: [
          {
            ordinal: 2,
            assessorName: "Juma Kileo",
            submittedOn: "2026-08-11",
            review: review({ "4.2": { degree: "agree" } }),
            managerComment: null,
          },
        ],
      }),
    );

    const action = events
      .filter((event) => event.kind === "secondary_assessment")[0]
      ?.actions.find((a) => a.itemNo === "4.2");

    // "A2 read causality and agreed" is a finding. Dropping it because no value changed would
    // leave a record in which A2 appears never to have looked at the item.
    expect(action?.degreeLabel).toBe("Agree");
    expect(action?.replacement).toBeUndefined();
    expect(action?.reason).toBeUndefined();
  });

  it("invents no narrative and no reason nobody recorded", () => {
    const events = buildAssessmentHistory(
      input({
        secondary: [
          {
            ordinal: 2,
            assessorName: "Juma Kileo",
            submittedOn: "2026-08-11",
            // A disagreement with a replacement and no recorded words. The office's own form
            // requires a basis on some items and not on others; where none was stored, none is
            // printed, and nothing here supplies one on the assessor's behalf.
            review: review({ "4.2": { degree: "disagree", value: "possible", statement: "" } }),
            managerComment: null,
          },
        ],
        decisions: [
          {
            kind: "assign_work_officer",
            // A manager who recorded no grounds. The record says they decided; it does not
            // explain why they decided.
            comment: null,
            decidedByName: "Neema Shirima",
            decidedAt: "2026-08-14",
            nextAssessorName: null,
            workOfficerName: "Rehema Salum",
          },
        ],
      }),
    );

    const action = events
      .filter((event) => event.kind === "secondary_assessment")[0]
      ?.actions.find((a) => a.itemNo === "4.2");
    expect(action?.reason).toBeUndefined();

    const decision = events.filter((event) => event.kind === "manager_decision")[0];
    expect(decision?.grounds).toBeUndefined();

    // No field anywhere in the record holds prose that was not typed by the person it is
    // attributed to. Every string below came out of the input above.
    const prose = JSON.stringify(events);
    expect(prose).not.toMatch(/because/i);
    expect(prose).not.toMatch(/evolved|appears to|suggests|likely due/i);
  });

  it("records the manager's review of each assessment and their final decision", () => {
    const events = buildAssessmentHistory(
      input({
        first: {
          assessorName: "Asha Mrema",
          answers: A1,
          submittedOn: "2026-08-04",
          managerComment: {
            text: "Causality needs a second look.",
            byName: "Neema Shirima",
            on: "2026-08-05",
          },
        },
        secondary: A1_AND_A2.secondary,
        decisions: A1_AND_A2.decisions,
      }),
    );

    // Chronological: the first assessment, the manager's reading of it, the referral, the second
    // assessment, then the conclusion.
    expect(events.map((event) => event.kind)).toEqual([
      "first_assessment",
      "manager_review",
      "manager_decision",
      "secondary_assessment",
      "manager_decision",
    ]);

    const reviews = events.filter((event) => event.kind === "manager_review");
    expect(reviews[0]).toMatchObject({
      ordinal: 1,
      reviewerName: "Neema Shirima",
      comment: "Causality needs a second look.",
    });

    const decisions = events.filter((event) => event.kind === "manager_decision");
    expect(decisions[0]).toMatchObject({
      decision: "Referred for a further assessment",
      handedTo: "Juma Kileo",
      grounds: "A second opinion is needed on causality.",
    });
    expect(decisions[1]).toMatchObject({
      decision: "Approved and assigned for work",
      handedTo: "Rehema Salum",
    });
  });
});

/**
 * The document, rendered.
 *
 * Both presentations come out of one component, so the assertions worth making are the ones about
 * what each mode does and does not contain — and, most of all, that Part A is the same in both.
 */

const REPORT: ReportDetail = {
  id: "11111111-1111-4111-8111-111111111111",
  number: "TMDA/AE/2026/0007",
  receivedAt: new Date("2026-08-01T08:00:00Z"),
  deviceName: "Infusion pump",
  severity: "serious",
  status: "closed",
  channel: "online",
  facility: "Muhimbili National Hospital",
  reporterName: "Dr Salma Ally",
  formVersion: "f001_v1",
  payload: {},
  filledBy: null,
};

function props(over: Partial<FinalDocumentPageProps> = {}): FinalDocumentPageProps {
  return {
    report: REPORT,
    viewerRole: "manager",
    viewerName: "Neema Shirima",
    active: "final-reports",
    document: resolveFinalDocument(A1, [{ ordinal: 2, review: A2_DISAGREES }]),
    device: {},
    event: {},
    approvedByName: "Neema Shirima",
    approvedOn: "14 Aug 2026",
    workOfficerName: "Rehema Salum",
    backHref: `/reports/${REPORT.id}`,
    backLabel: "Open Orange Report",
    mode: "clean",
    canReadHistory: true,
    ...over,
  };
}

/**
 * Part A out of a rendered page: the contents of `.fd-final`.
 *
 * Read off the wrapper the renderer puts round it rather than off the top of the response, because
 * the page's title bar and the browser's title legitimately differ between the two presentations —
 * a reader looking at the history version should be told that is what they are looking at. What
 * must not differ is the document, and this is the document.
 */
function partA(html: string): string {
  const after = html.split('<section class="fd-final"')[1];
  expect(after).toBeDefined();

  // Part A ends at the divider in the history presentation and at the end of the document in the
  // clean one. `</section>` cannot be the boundary on its own: the F004 is built out of nested
  // sections, one per numbered part of the form.
  const upToDivider = (after ?? "").split('<hr class="fd-divide"')[0] ?? "";
  const body = upToDivider.split("</section></div></main>")[0] ?? upToDivider;
  return body.replace(/<\/section>$/, "");
}

/**
 * The document, without the page it is shown on.
 *
 * The clean document's own title bar carries a link and a button whose labels name the history —
 * offering the other presentation is the point of them. What must contain no history is the
 * document, so the assertions that say "none of the argument" are made against this.
 */
function documentBody(html: string): string {
  const body = html.split('<div class="fd-doc"')[1];
  expect(body).toBeDefined();
  return (body ?? "").split("</div></main>")[0] ?? "";
}

describe("the final document's two presentations", () => {
  it("gives the clean document the final values and none of the argument", () => {
    const document = documentBody(String(FinalDocumentPage(props())));

    // The answer the chain settled on — A2's replacement — is on the document.
    expect(document).toContain("Possible");

    // And the argument is not. No history section, no agree/disagree machinery, no assessor named
    // on the document, and no record of who was overruled. The regulatory statement that came with
    // the replacement stays, because it is part of the answer rather than part of the debate.
    expect(document).not.toContain("Assessment history");
    expect(document).not.toContain("fd-history");
    expect(document).not.toContain("Disagree");
    expect(document).not.toContain("Agree");
    expect(document).not.toContain("Juma Kileo");
    expect(document).not.toContain("Asha Mrema");
  });

  it("gives the history presentation the same clean document as Part A", () => {
    const history = buildAssessmentHistory(A1_AND_A2);

    const clean = String(FinalDocumentPage(props()));
    const withHistory = String(FinalDocumentPage(props({ mode: "history", history })));

    // The claim this test exists for: one renderer, one Part A. A history document whose final
    // answers had drifted from the clean one would not be an audit trail, it would be a second
    // and contradictory final document.
    expect(partA(withHistory)).toBe(partA(clean));
  });

  it("prints the actual record under the divider", () => {
    const html = String(
      FinalDocumentPage(props({ mode: "history", history: buildAssessmentHistory(A1_AND_A2) })),
    );
    const below = html.split('<hr class="fd-divide"')[1] ?? "";

    expect(below).toContain("Assessment history");
    expect(below).toContain("First assessment");
    expect(below).toContain("Secondary assessment 2");
    expect(below).toContain("Asha Mrema");
    expect(below).toContain("Juma Kileo");
    expect(below).toContain("Disagree");
    expect(below).toContain("The temporal link is weak and a second cause is documented.");

    // No assessment 3 anywhere on the page, because the case had two.
    expect(html).not.toContain("Secondary assessment 3");
  });

  it("shows all three assessments on a case that had three", () => {
    const html = String(
      FinalDocumentPage(props({ mode: "history", history: buildAssessmentHistory(A1_A2_AND_A3) })),
    );

    expect(html).toContain("Secondary assessment 2");
    expect(html).toContain("Secondary assessment 3");
    expect(html).toContain("Fatma Hamisi");
    expect(html).not.toContain("Secondary assessment 4");
  });

  it("offers the history and its download only to a reader entitled to them", () => {
    const officer = String(
      FinalDocumentPage(
        props({ viewerRole: "assessor", active: "my-work", canReadHistory: false }),
      ),
    );

    // The clean document is theirs; the working record is not. The plain download stays, because
    // the document they may read is the document they may keep.
    expect(officer).toContain("Download Final F004 (PDF)");
    expect(officer).not.toContain("Download Final F004 with Assessment History (PDF)");
    expect(officer).not.toContain("final-document/history");

    const manager = String(FinalDocumentPage(props()));
    expect(manager).toContain("Download Final F004 with Assessment History (PDF)");
    expect(manager).toContain(`/reports/${REPORT.id}/final-document/history`);
  });

  it("prints the two PDF documents from the same template as the screen", () => {
    const history = buildAssessmentHistory(A1_AND_A2);

    const cleanPrint = String(FinalDocumentPrintPage(props()));
    const historyPrint = String(FinalDocumentPrintPage(props({ mode: "history", history })));

    // The clean PDF carries no record. The history PDF carries it. Asserted on the whole file in
    // both cases: a printable document has no title bar, so there is nothing on the page but the
    // document itself.
    expect(cleanPrint).not.toContain("Assessment history");
    expect(historyPrint).toContain("Assessment history");
    expect(historyPrint).toContain("The temporal link is weak and a second cause is documented.");

    // Part A is one document in all four renderings, screen and paper alike.
    expect(partA(historyPrint)).toBe(partA(cleanPrint));
    expect(partA(cleanPrint)).toContain("Possible");

    // And the printable document is the document alone: no rail, no title bar, and no navigation
    // out of a file somebody is going to archive.
    expect(cleanPrint).not.toContain('class="rail"');
    expect(cleanPrint).not.toContain("Open Orange Report");
    expect(cleanPrint).toContain("data-print-document");
  });
});
