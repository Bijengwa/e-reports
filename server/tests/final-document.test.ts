import { describe, expect, it } from "vitest";
import type { F004Answers, SecondaryReviewPayload } from "../src/domain/f004.js";
import { SECONDARY_REVIEW_ITEMS } from "../src/domain/f004.js";
import {
  FINAL_DOCUMENT_KIND,
  normalizeFinalDocument,
  resolveFinalDocument,
  statementFieldOf,
} from "../src/domain/final-document.js";

/**
 * The Final Document's resolution rules, as rules rather than as a route.
 *
 * The whole question this file answers is whether the resolution is field-aware. A "latest payload
 * wins" fold would pass a test that only ever disagreed; these cases are chosen so that a fold
 * which loses agreement, or lets a clarification touch a radio button, fails.
 */

/** A1, with every reviewable item answered — the base every case below amends. */
const A1: F004Answers = {
  device_type: "md",
  device_class: "B",
  report_stage: "initial",
  source_of_event: "malfunction",
  c2_5: "Reported by the facility as a device malfunction.",
  seriousness: "serious",
  c2_6: "Patient required admission.",
  public_health: "no",
  c2_7: "One device at one facility.",
  imdrf_component_l1: "Battery",
  imdrf_component_code: "E1204",
  imdrf_device_problem_l1: "Battery depletion",
  imdrf_device_problem_code: "A0501",
  imdrf_health_impact_l1: "No clinical signs",
  imdrf_health_impact_code: "E2301",
  imdrf_clinical_signs_l1: "None observed",
  imdrf_clinical_signs_code: "E0101",
  imdrf_investigation_type_l1: "Manufacturer investigation",
  imdrf_investigation_type_code: "A05",
  imdrf_investigation_findings_l1: "Cell fault confirmed",
  imdrf_investigation_findings_code: "A0702",
  imdrf_investigation_conclusion_l1: "Device to be replaced",
  imdrf_investigation_conclusion_code: "A0803",
  expectedness: "unexpected",
  c4_1: "Not described in the manufacturer's IFU.",
  causality: "probable",
  c4_3: "Temporal relationship with device use.",
  signal_status: "signal",
  c5: "Second report against this lot within a month.",
  risk_level: "high",
  c6: "Serious outcome with an unresolved cause.",
  actions: ["monitoring"],
  conclusion: "Recommend risk communication and enhanced monitoring.",
  signature: "Asha Mrema",
};

function review(responses: SecondaryReviewPayload["responses"]): SecondaryReviewPayload {
  return { kind: "a2_section_review", responses };
}

describe("rule 1 — agree", () => {
  it("keeps the previous value as the final value, writing nothing", () => {
    const final = resolveFinalDocument(A1, [
      { ordinal: 2, review: review({ "4.1": { degree: "agree" } }) },
    ]);

    expect(final.answers.expectedness).toBe("unexpected");
    expect(final.answers.c4_1).toBe("Not described in the manufacturer's IFU.");
    // Agreement is not authorship: the answer is still A1's.
    expect(final.provenance["4.1"]).toEqual({ ordinal: 1, degree: "original" });
  });

  it("does not undo an earlier assessor's disagreement", () => {
    const final = resolveFinalDocument(A1, [
      {
        ordinal: 2,
        review: review({
          "4.1": { degree: "disagree", value: "expected", statement: "Described in the IFU." },
        }),
      },
      { ordinal: 3, review: review({ "4.1": { degree: "agree" } }) },
    ]);

    expect(final.answers.expectedness).toBe("expected");
    expect(final.provenance["4.1"]).toEqual({ ordinal: 2, degree: "disagree" });
  });
});

describe("rule 2 — disagree", () => {
  it("replaces the previous value with the latest assessor's", () => {
    const final = resolveFinalDocument(A1, [
      {
        ordinal: 2,
        review: review({
          "4.1": { degree: "disagree", value: "expected", statement: "Listed in the IFU." },
        }),
      },
      {
        ordinal: 3,
        review: review({
          "4.1": {
            degree: "disagree",
            value: "unexpected",
            statement: "The IFU entry describes a different failure mode.",
          },
        }),
      },
    ]);

    // A3 is the last resolved assessor, so A3's value is the final one — not A1's and not A2's.
    expect(final.answers.expectedness).toBe("unexpected");
    expect(final.answers.c4_1).toBe("The IFU entry describes a different failure mode.");
    expect(final.provenance["4.1"]).toEqual({ ordinal: 3, degree: "disagree" });
  });

  it("never writes the word Disagree into the document", () => {
    const final = resolveFinalDocument(A1, [
      {
        ordinal: 2,
        review: review({
          "2.6": { degree: "disagree", value: "non_serious", statement: "Outpatient only." },
        }),
      },
    ]);

    const text = JSON.stringify(final.answers).toLowerCase();
    expect(text).not.toContain("disagree");
    expect(final.answers.seriousness).toBe("non_serious");
  });

  it("replaces a multi-choice answer wholesale rather than merging it", () => {
    const final = resolveFinalDocument(A1, [
      {
        ordinal: 2,
        review: review({
          "7.1_actions": {
            degree: "disagree",
            value: ["recall", "field_safety_notice"],
            statement: "Monitoring alone is not proportionate.",
          },
        }),
      },
    ]);

    expect(final.answers.actions).toEqual(["recall", "field_safety_notice"]);
  });

  it("replaces every box of a structured IMDRF row together", () => {
    const final = resolveFinalDocument(A1, [
      {
        ordinal: 2,
        review: review({
          "3.1.1": {
            degree: "disagree",
            value: { l1: "Power source", code: "E1210" },
            statement: "The component is the power supply, not the cell.",
          },
        }),
      },
    ]);

    expect(final.answers.imdrf_component_l1).toBe("Power source");
    expect(final.answers.imdrf_component_code).toBe("E1210");
  });
});

describe("rule 3 — required clarification", () => {
  it("replaces the statement and preserves the previous radio", () => {
    const final = resolveFinalDocument(A1, [
      {
        ordinal: 2,
        review: review({
          "2.6": {
            degree: "clarification",
            statement: "Patient required admission for monitoring following device failure.",
          },
        }),
      },
    ]);

    // The shape of the specification's own example: the radio survives, the statement does not.
    // (2.6 offers `serious`/`non_serious` rather than the example's "Hospitalization", which is a
    // section 2.2 event type on the orange form — the rule is the same either way.)
    expect(final.answers.seriousness).toBe("serious");
    expect(final.answers.c2_6).toBe(
      "Patient required admission for monitoring following device failure.",
    );
    expect(final.provenance["2.6"]).toEqual({ ordinal: 2, degree: "clarification" });
  });

  it("preserves a previous assessor's disagreed value, not A1's", () => {
    const final = resolveFinalDocument(A1, [
      {
        ordinal: 2,
        review: review({
          "2.6": { degree: "disagree", value: "non_serious", statement: "Outpatient only." },
        }),
      },
      {
        ordinal: 3,
        review: review({
          "2.6": {
            degree: "clarification",
            statement: "Outpatient review at 24 hours; no admission was required.",
          },
        }),
      },
    ]);

    // A3 clarified, so the structured answer is A[n-1]'s — A2's — and not A1's.
    expect(final.answers.seriousness).toBe("non_serious");
    expect(final.answers.c2_6).toBe("Outpatient review at 24 hours; no admission was required.");
  });

  it("replaces the text itself when the item's own answer is the prose", () => {
    const final = resolveFinalDocument(A1, [
      {
        ordinal: 2,
        review: review({
          "7.1_conclusion": {
            degree: "clarification",
            statement:
              "Add the manufacturer's investigation conclusion regarding the device failure.",
          },
        }),
      },
    ]);

    expect(final.answers.conclusion).toBe(
      "Add the manufacturer's investigation conclusion regarding the device failure.",
    );
  });

  it("keeps a clarification on a bare choice as a note rather than losing it", () => {
    // 4.2 is a radio with no comment box on the paper and is not prose. The answer must not move,
    // and the words must not vanish.
    const final = resolveFinalDocument(A1, [
      {
        ordinal: 2,
        review: review({
          "4.2": {
            degree: "clarification",
            statement: "State which Bradford Hill criteria apply.",
          },
        }),
      },
    ]);

    expect(final.answers.causality).toBe("probable");
    expect(final.provenance["4.2"]).toEqual({
      ordinal: 2,
      degree: "clarification",
      note: "State which Bradford Hill criteria apply.",
    });
  });

  it("does not touch a structured answer even where the item has no comment box", () => {
    const final = resolveFinalDocument(A1, [
      {
        ordinal: 2,
        review: review({
          "3.1.1": { degree: "clarification", statement: "Confirm the coding against Annex A." },
        }),
      },
    ]);

    expect(final.answers.imdrf_component_l1).toBe("Battery");
    expect(final.answers.imdrf_component_code).toBe("E1204");
  });
});

describe("rule 4 — the resolution is field-aware, not payload-aware", () => {
  it("keeps every item the latest assessor agreed with", () => {
    // The case a "latest payload wins" fold fails: A2 disagrees on one item and agrees on the
    // rest, so a fold that took A2's payload as the document would blank everything else.
    const final = resolveFinalDocument(A1, [
      {
        ordinal: 2,
        review: review({
          "2.6": { degree: "disagree", value: "non_serious", statement: "Outpatient only." },
          "4.1": { degree: "agree" },
          "4.2": { degree: "agree" },
          "6": { degree: "agree" },
        }),
      },
    ]);

    expect(final.answers.seriousness).toBe("non_serious");
    expect(final.answers.expectedness).toBe("unexpected");
    expect(final.answers.causality).toBe("probable");
    expect(final.answers.risk_level).toBe("high");
    expect(final.answers.conclusion).toBe(A1.conclusion);
  });

  it("carries A1's non-reviewable fields through untouched", () => {
    const final = resolveFinalDocument(A1, [
      { ordinal: 2, review: review({ "2.6": { degree: "agree" } }) },
    ]);

    // The signature is A1's record of their own finding; no review item is a position on it.
    expect(final.answers.signature).toBe("Asha Mrema");
  });

  it("fills a blank A1 answer from a supplied value", () => {
    const withBlank: F004Answers = { ...A1, device_class: "" };

    const final = resolveFinalDocument(withBlank, [
      { ordinal: 2, review: review({ "1.11": { degree: "supplied", value: "C" } }) },
    ]);

    expect(final.answers.device_class).toBe("C");
    expect(final.provenance["1.11"]).toEqual({ ordinal: 2, degree: "supplied" });
  });

  it("applies the chain in ordinal order whatever order it is given in", () => {
    const chain = [
      {
        ordinal: 3,
        review: review({
          "6": { degree: "disagree", value: "medium", statement: "Cause now identified." },
        }),
      },
      {
        ordinal: 2,
        review: review({
          "6": { degree: "disagree", value: "low", statement: "Isolated incident." },
        }),
      },
    ];

    expect(resolveFinalDocument(A1, chain).answers.risk_level).toBe("medium");
  });

  it("leaves A1 alone with no chain at all", () => {
    const final = resolveFinalDocument(A1, []);

    expect(final.answers).toEqual(A1);
    expect(final.kind).toBe(FINAL_DOCUMENT_KIND);
    for (const item of SECONDARY_REVIEW_ITEMS) {
      expect(final.provenance[item.key]).toEqual({ ordinal: 1, degree: "original" });
    }
  });

  it("does not mutate the first assessor's own answers", () => {
    const before = JSON.stringify(A1);

    resolveFinalDocument(A1, [
      {
        ordinal: 2,
        review: review({
          "2.6": { degree: "disagree", value: "non_serious", statement: "Outpatient only." },
          "7.1_actions": { degree: "disagree", value: ["recall"], statement: "Recall required." },
        }),
      },
    ]);

    expect(JSON.stringify(A1)).toBe(before);
  });
});

describe("statementFieldOf", () => {
  it("is the comment box where the paper prints one", () => {
    const item = SECONDARY_REVIEW_ITEMS.find((i) => i.key === "2.6");
    expect(item && statementFieldOf(item)).toBe("c2_6");
  });

  it("is the answer itself for a prose item", () => {
    const item = SECONDARY_REVIEW_ITEMS.find((i) => i.key === "7.1_conclusion");
    expect(item && statementFieldOf(item)).toBe("conclusion");
  });

  it("is nothing for short text that is not prose", () => {
    // 1.11 is a device class, not a paragraph. A clarification must never overwrite it.
    const item = SECONDARY_REVIEW_ITEMS.find((i) => i.key === "1.11");
    expect(item && statementFieldOf(item)).toBeUndefined();
  });
});

describe("normalizeFinalDocument", () => {
  it("round-trips a resolved document", () => {
    const final = resolveFinalDocument(A1, [
      {
        ordinal: 2,
        review: review({
          "2.6": { degree: "clarification", statement: "Admitted for monitoring." },
          "7.1_actions": { degree: "disagree", value: ["recall"], statement: "Recall required." },
        }),
      },
    ]);

    const back = normalizeFinalDocument(JSON.parse(JSON.stringify(final)));

    expect(back.answers).toEqual(final.answers);
    expect(back.provenance).toEqual(final.provenance);
  });

  it("reads a payload of the wrong kind as an empty document", () => {
    expect(normalizeFinalDocument({ kind: "a2_section_review", responses: {} })).toEqual({
      kind: FINAL_DOCUMENT_KIND,
      answers: {},
      provenance: {},
      // 7.2 with nothing in it, which is what a document of the wrong kind carries.
      second: {},
    });
    expect(normalizeFinalDocument(null).answers).toEqual({});
  });

  it("drops provenance for an item the form no longer has", () => {
    const back = normalizeFinalDocument({
      kind: FINAL_DOCUMENT_KIND,
      answers: { seriousness: "serious" },
      provenance: { "9.9": { ordinal: 2, degree: "disagree" } },
    });

    expect(back.answers.seriousness).toBe("serious");
    expect(back.provenance["9.9"]).toBeUndefined();
  });
});
