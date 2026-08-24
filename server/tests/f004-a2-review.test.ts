import { describe, expect, it } from "vitest";
import {
  collectSecondaryReview,
  type F004Answers,
  isA1Blank,
  normalizeSecondaryReview,
  SECONDARY_REVIEW_ITEMS,
  validateSecondaryReviewForSubmit,
} from "../src/domain/f004.js";

/**
 * A1's answers, with every reviewable field non-blank — so every item in `SECONDARY_REVIEW_ITEMS` is
 * reviewable, including the six IMDRF rows and the two section-1 rows that are optional and would
 * otherwise be `supplied`-only. Most tests in this file are about the reviewable path, which needs
 * a report where nothing was left blank to test it against.
 */
const FILLED_A1_ANSWERS: F004Answers = {
  device_type: "md",
  registration_number: "TMDA-REG-0001",
  device_class: "B",
  report_stage: "initial",
  source_of_event: "malfunction",
  seriousness: "serious",
  public_health: "no",
  imdrf_component_l1: "Battery",
  imdrf_device_problem_l1: "Battery depletion",
  imdrf_health_impact_l1: "No clinical signs",
  imdrf_clinical_signs_l1: "None observed",
  imdrf_investigation_type_l1: "Manufacturer investigation",
  imdrf_investigation_findings_l1: "Cell fault confirmed",
  imdrf_investigation_conclusion_l1: "Device to be replaced",
  expectedness: "unexpected",
  causality: "probable",
  c4_3: "Temporal relationship with device use; no other cause identified.",
  signal_status: "signal",
  risk_level: "high",
  actions: ["monitoring"],
  conclusion: "Recommend risk communication and enhanced monitoring.",
};

/** A body that agrees with every one of A1's answers — the shortest submittable review there is. */
function agreeWithEverything(
  overrides: Record<string, string | string[]> = {},
): Record<string, string | string[]> {
  const body: Record<string, string | string[]> = {};
  for (const item of SECONDARY_REVIEW_ITEMS) body[`a2_degree_${item.key}`] = "agree";
  return { ...body, ...overrides };
}

describe("the A2 review item table", () => {
  it("keys every item by the A1 answer it is a position on", () => {
    const keys = SECONDARY_REVIEW_ITEMS.map((item) => item.key);

    expect(keys).toContain("2.6");
    expect(keys).toContain("7.1_conclusion");
    // Derived from IMDRF_GROUPS, so the numbering is the form's own.
    expect(keys).toContain("3.1.1");
    expect(keys).toContain("3.3.3");
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("redraws exactly the boxes section 3 prints, and no more", () => {
    // 3.3.1 has one terminology level on the paper; 3.3.3 has two. Coding is always the last.
    const one = SECONDARY_REVIEW_ITEMS.find((item) => item.key === "3.3.1");
    const two = SECONDARY_REVIEW_ITEMS.find((item) => item.key === "3.3.3");

    expect(one?.fields?.map((field) => field.key)).toEqual(["l1", "code"]);
    expect(two?.fields?.map((field) => field.key)).toEqual(["l1", "l2", "code"]);
  });
});

describe("isA1Blank", () => {
  it("is blank when every one of an item's a1Fields is empty", () => {
    const item = SECONDARY_REVIEW_ITEMS.find((candidate) => candidate.key === "1.10");
    expect(item).toBeDefined();
    if (item === undefined) return;

    expect(isA1Blank(item, {})).toBe(true);
    expect(isA1Blank(item, { registration_number: "   " })).toBe(true);
    expect(isA1Blank(item, { registration_number: "TMDA-REG-0002" })).toBe(false);
  });

  it("is blank for an IMDRF item only when every one of its boxes is empty", () => {
    const item = SECONDARY_REVIEW_ITEMS.find((candidate) => candidate.key === "3.1.1");
    expect(item).toBeDefined();
    if (item === undefined) return;

    expect(isA1Blank(item, {})).toBe(true);
    expect(isA1Blank(item, { imdrf_component_code: "A0501" })).toBe(false);
  });

  it("is never blank for the fields required of every submission", () => {
    const item = SECONDARY_REVIEW_ITEMS.find((candidate) => candidate.key === "2.6");
    expect(item).toBeDefined();
    if (item === undefined) return;

    expect(isA1Blank(item, FILLED_A1_ANSWERS)).toBe(false);
  });
});

describe("collecting an A2 review from a posted body", () => {
  it("stores Agree as a degree and nothing else", () => {
    const review = collectSecondaryReview(
      {
        "a2_degree_2.6": "agree",
        "a2_value_2.6": "non_serious",
        "a2_statement_2.6": "Smuggled in by hand.",
      },
      FILLED_A1_ANSWERS,
    );

    expect(review.responses["2.6"]).toEqual({ degree: "agree" });
  });

  it("stores Need Clarification as a statement, never as a replacement value", () => {
    const review = collectSecondaryReview(
      {
        "a2_degree_2.6": "clarification",
        // A hand-edited body, or one replayed after switching away from Disagree.
        "a2_value_2.6": "non_serious",
        "a2_statement_2.6": "Which of the serious criteria was met?",
      },
      FILLED_A1_ANSWERS,
    );

    expect(review.responses["2.6"]).toEqual({
      degree: "clarification",
      statement: "Which of the serious criteria was met?",
    });
    expect(review.responses["2.6"]).not.toHaveProperty("value");
  });

  it("stores Disagree with both the corrected answer and the statement", () => {
    const review = collectSecondaryReview(
      {
        "a2_degree_2.6": "disagree",
        "a2_value_2.6": "non_serious",
        "a2_statement_2.6": "No hospitalisation followed.",
      },
      FILLED_A1_ANSWERS,
    );

    expect(review.responses["2.6"]).toEqual({
      degree: "disagree",
      value: "non_serious",
      statement: "No hospitalisation followed.",
    });
  });

  it("keeps a multi-value replacement as the list it is", () => {
    const review = collectSecondaryReview(
      {
        "a2_degree_7.1_actions": "disagree",
        "a2_value_7.1_actions": ["monitoring", "samples"],
        "a2_statement_7.1_actions": "Samples are needed before anything else.",
      },
      FILLED_A1_ANSWERS,
    );

    expect(review.responses["7.1_actions"]?.value).toEqual(["monitoring", "samples"]);
  });

  it("keeps an IMDRF replacement as one box per level, plus the coding", () => {
    const review = collectSecondaryReview(
      {
        "a2_degree_3.3.3": "disagree",
        "a2_value_3.3.3_l1": "Device failure",
        "a2_value_3.3.3_l2": "Battery depletion",
        "a2_value_3.3.3_code": "A0304",
        "a2_statement_3.3.3": "The conclusion does not follow from the findings.",
      },
      FILLED_A1_ANSWERS,
    );

    expect(review.responses["3.3.3"]?.value).toEqual({
      l1: "Device failure",
      l2: "Battery depletion",
      code: "A0304",
    });
  });

  it("ignores a key the form does not own and a degree it never offered", () => {
    const review = collectSecondaryReview(
      {
        a2_degree_9: "agree",
        "a2_degree_2.6": "maybe",
        conclusion: "The first assessor's own field.",
      },
      FILLED_A1_ANSWERS,
    );

    expect(review).toEqual({ kind: "a2_section_review", responses: {} });
  });

  it("reads no degree at all for an item A1 left blank, only a2_value", () => {
    // 1.10 is "(If applicable)" — left out here, unlike in FILLED_A1_ANSWERS.
    const a1Answers = { ...FILLED_A1_ANSWERS, registration_number: "" };
    const review = collectSecondaryReview(
      {
        "a2_degree_1.10": "disagree",
        "a2_statement_1.10": "Smuggled in by hand; there is no degree to smuggle it under.",
        "a2_value_1.10": "TMDA-REG-9999",
      },
      a1Answers,
    );

    expect(review.responses["1.10"]).toEqual({ degree: "supplied", value: "TMDA-REG-9999" });
  });

  it("stores nothing for a blank item A2 also left blank", () => {
    const a1Answers = { ...FILLED_A1_ANSWERS, registration_number: "" };
    const review = collectSecondaryReview({ "a2_value_1.10": "   " }, a1Answers);

    expect(review.responses).not.toHaveProperty("1.10");
  });
});

describe("reading a stored A2 review back", () => {
  it("survives a round trip through the column", () => {
    const written = collectSecondaryReview(
      {
        "a2_degree_2.6": "disagree",
        "a2_value_2.6": "non_serious",
        "a2_statement_2.6": "No hospitalisation followed.",
        a2_degree_5: "clarification",
        a2_statement_5: "Say whether the other two reports were checked.",
      },
      FILLED_A1_ANSWERS,
    );

    expect(normalizeSecondaryReview(JSON.parse(JSON.stringify(written)))).toEqual(written);
  });

  it("drops a value stored under Need Clarification by an older shape of this form", () => {
    const read = normalizeSecondaryReview({
      kind: "a2_section_review",
      responses: { "2.6": { degree: "clarification", value: "non_serious", statement: "Why?" } },
    });

    expect(read.responses["2.6"]).toEqual({ degree: "clarification", statement: "Why?" });
  });

  it("reads anything that is not a review as an empty one", () => {
    expect(normalizeSecondaryReview(null).responses).toEqual({});
    expect(normalizeSecondaryReview({ conclusion_2: "The old 7.2." }).responses).toEqual({});
  });
});

describe("what an A2 submission must carry", () => {
  it("accepts a position on every reviewable answer", () => {
    expect(
      validateSecondaryReviewForSubmit(
        collectSecondaryReview(agreeWithEverything(), FILLED_A1_ANSWERS),
        FILLED_A1_ANSWERS,
      ),
    ).toEqual([]);
  });

  it("refuses a review with any reviewable answer left undecided", () => {
    const body = agreeWithEverything();
    delete body["a2_degree_4.2"];

    const issues = validateSecondaryReviewForSubmit(
      collectSecondaryReview(body, FILLED_A1_ANSWERS),
      FILLED_A1_ANSWERS,
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.field).toBe("a2_degree_4.2");
  });

  it("requires a statement for Need Clarification, and asks for no value", () => {
    const issues = validateSecondaryReviewForSubmit(
      collectSecondaryReview(
        agreeWithEverything({ a2_degree_5: "clarification" }),
        FILLED_A1_ANSWERS,
      ),
      FILLED_A1_ANSWERS,
    );

    expect(issues.map((issue) => issue.field)).toEqual(["a2_statement_5"]);
  });

  it("requires both the corrected answer and a statement for Disagree", () => {
    const issues = validateSecondaryReviewForSubmit(
      collectSecondaryReview(agreeWithEverything({ a2_degree_6: "disagree" }), FILLED_A1_ANSWERS),
      FILLED_A1_ANSWERS,
    );

    expect(issues.map((issue) => issue.field)).toEqual(["a2_value_6", "a2_statement_6"]);
  });

  it("counts an IMDRF replacement of nothing but blanks as no answer at all", () => {
    const issues = validateSecondaryReviewForSubmit(
      collectSecondaryReview(
        agreeWithEverything({
          "a2_degree_3.1.1": "disagree",
          "a2_value_3.1.1_l1": "   ",
          "a2_value_3.1.1_code": "",
          "a2_statement_3.1.1": "The component named is not the one that failed.",
        }),
        FILLED_A1_ANSWERS,
      ),
      FILLED_A1_ANSWERS,
    );

    expect(issues.map((issue) => issue.field)).toEqual(["a2_value_3.1.1"]);
  });

  it("accepts an IMDRF replacement that fills any one of its boxes", () => {
    const issues = validateSecondaryReviewForSubmit(
      collectSecondaryReview(
        agreeWithEverything({
          "a2_degree_3.1.1": "disagree",
          "a2_value_3.1.1_code": "A0501",
          "a2_statement_3.1.1": "The component named is not the one that failed.",
        }),
        FILLED_A1_ANSWERS,
      ),
      FILLED_A1_ANSWERS,
    );

    expect(issues).toEqual([]);
  });

  it("refuses an empty list of mitigation actions under Disagree", () => {
    const issues = validateSecondaryReviewForSubmit(
      collectSecondaryReview(
        agreeWithEverything({
          "a2_degree_7.1_actions": "disagree",
          "a2_statement_7.1_actions": "None of these follow from the findings.",
        }),
        FILLED_A1_ANSWERS,
      ),
      FILLED_A1_ANSWERS,
    );

    expect(issues.map((issue) => issue.field)).toEqual(["a2_value_7.1_actions"]);
  });

  it("never requires anything of an item A1 left blank", () => {
    // A1's answers here omit 1.10 and every IMDRF row but investigation_type — all
    // "(If applicable)" and left out. A submission that never mentions them still passes. 1.11 is
    // present because the paper does not mark it, so a submitted A1 always carries one.
    const a1Answers: F004Answers = {
      device_type: "md",
      device_class: "B",
      report_stage: "initial",
      source_of_event: "malfunction",
      seriousness: "serious",
      public_health: "no",
      imdrf_investigation_type_l1: "Manufacturer investigation",
      expectedness: "unexpected",
      causality: "probable",
      c4_3: "Temporal relationship with device use; no other cause identified.",
      signal_status: "signal",
      risk_level: "high",
      actions: ["monitoring"],
      conclusion: "Recommend risk communication and enhanced monitoring.",
    };
    const body: Record<string, string | string[]> = {};
    for (const item of SECONDARY_REVIEW_ITEMS) {
      if (!isA1Blank(item, a1Answers)) body[`a2_degree_${item.key}`] = "agree";
    }

    const issues = validateSecondaryReviewForSubmit(
      collectSecondaryReview(body, a1Answers),
      a1Answers,
    );

    expect(issues).toEqual([]);
  });
});

/**
 * Disagree replaces the first assessor's answer. A replacement identical to the answer being
 * disagreed with replaces nothing — it is the same finding an empty one is, said differently, and
 * a manager reading "Disagree: Serious" against A1's "Serious" has been handed a contradiction
 * rather than a correction.
 *
 * Every one of these goes through `validateSecondaryReviewForSubmit` rather than through the page,
 * because the page is where the rule is made convenient and this is where it is made true. The
 * last one builds the payload by hand, the way a request that never loaded the page would.
 */
describe("a Disagree that repeats the answer it disagrees with", () => {
  const disagreeWith = (
    key: string,
    overrides: Record<string, string | string[]>,
  ): Record<string, string | string[]> =>
    agreeWithEverything({
      [`a2_degree_${key}`]: "disagree",
      [`a2_statement_${key}`]: "Recorded reasoning for the change.",
      ...overrides,
    });

  const issuesFor = (
    body: Record<string, string | string[]>,
    a1Answers: F004Answers = FILLED_A1_ANSWERS,
  ) =>
    validateSecondaryReviewForSubmit(collectSecondaryReview(body, a1Answers), a1Answers).map(
      (issue) => issue.field,
    );

  it("refuses a single choice that is the one A1 already made", () => {
    expect(issuesFor(disagreeWith("2.6", { "a2_value_2.6": "serious" }))).toEqual(["a2_value_2.6"]);
  });

  it("accepts a single choice that differs from A1's", () => {
    expect(issuesFor(disagreeWith("2.6", { "a2_value_2.6": "non_serious" }))).toEqual([]);
  });

  it("refuses the same choice on a card field as readily as on a radio", () => {
    expect(issuesFor(disagreeWith("6", { a2_value_6: "high" }))).toEqual(["a2_value_6"]);
    expect(issuesFor(disagreeWith("4.2", { "a2_value_4.2": "probable" }))).toEqual([
      "a2_value_4.2",
    ]);
  });

  it("refuses a retyped text answer, whitespace and all", () => {
    const a1 = "Temporal relationship with device use; no other cause identified.";

    expect(issuesFor(disagreeWith("4.3", { "a2_value_4.3": a1 }))).toEqual(["a2_value_4.3"]);
    expect(issuesFor(disagreeWith("4.3", { "a2_value_4.3": `  ${a1}  ` }))).toEqual([
      "a2_value_4.3",
    ]);
    expect(
      issuesFor(
        disagreeWith("4.3", {
          "a2_value_4.3": "Temporal relationship with device use;\n  no other cause identified.",
        }),
      ),
    ).toEqual(["a2_value_4.3"]);
  });

  it("accepts a text answer that actually says something else", () => {
    expect(
      issuesFor(disagreeWith("4.3", { "a2_value_4.3": "A concurrent medication explains it." })),
    ).toEqual([]);
  });

  it("refuses the same set of mitigation actions, in any order", () => {
    const a1Answers: F004Answers = {
      ...FILLED_A1_ANSWERS,
      actions: ["monitoring", "risk_communication"],
    };

    expect(
      issuesFor(
        disagreeWith("7.1_actions", {
          "a2_value_7.1_actions": ["risk_communication", "monitoring"],
        }),
        a1Answers,
      ),
    ).toEqual(["a2_value_7.1_actions"]);
  });

  it("accepts a set of mitigation actions that is not A1's", () => {
    expect(
      issuesFor(disagreeWith("7.1_actions", { "a2_value_7.1_actions": ["monitoring", "removal"] })),
    ).toEqual([]);
  });

  it("refuses an IMDRF grid filled in exactly as A1 left it", () => {
    expect(
      issuesFor(
        disagreeWith("3.1.1", {
          "a2_value_3.1.1_l1": "Battery",
          "a2_value_3.1.1_l2": "",
          "a2_value_3.1.1_l3": "",
          "a2_value_3.1.1_code": "",
        }),
      ),
    ).toEqual(["a2_value_3.1.1"]);
  });

  it("accepts an IMDRF grid that changes any one box", () => {
    expect(
      issuesFor(
        disagreeWith("3.1.1", { "a2_value_3.1.1_l1": "Battery", "a2_value_3.1.1_code": "A0501" }),
      ),
    ).toEqual([]);
  });

  it("leaves Agree and Need Clarification alone", () => {
    // A value posted alongside Need Clarification never reaches the payload at all, so the answer
    // being repeated cannot make a difference here — and the statement rule is the only one left.
    expect(
      issuesFor(
        agreeWithEverything({
          "a2_degree_2.6": "clarification",
          "a2_value_2.6": "serious",
          "a2_statement_2.6": "Which of the four criteria was met?",
        }),
      ),
    ).toEqual([]);

    expect(issuesFor(agreeWithEverything())).toEqual([]);
  });

  it("says nothing about an item A1 left blank, whatever is supplied", () => {
    const a1Answers: F004Answers = { ...FILLED_A1_ANSWERS, registration_number: "" };

    // `supplied`, not a degree — there is no A1 answer here to repeat.
    expect(issuesFor(agreeWithEverything({ "a2_value_1.10": "TMDA-REG-0001" }), a1Answers)).toEqual(
      [],
    );
  });

  it("refuses a hand-built payload that never went near the page", () => {
    const crafted = {
      kind: "a2_section_review" as const,
      responses: {
        ...Object.fromEntries(
          SECONDARY_REVIEW_ITEMS.map((item) => [item.key, { degree: "agree" as const }]),
        ),
        "2.6": {
          degree: "disagree" as const,
          value: "serious",
          statement: "Posted directly, bypassing every control the page draws.",
        },
      },
    };

    const issues = validateSecondaryReviewForSubmit(crafted, FILLED_A1_ANSWERS);

    expect(issues.map((issue) => issue.field)).toEqual(["a2_value_2.6"]);
    expect(issues[0]?.message).toContain("different categorization");
  });
});
