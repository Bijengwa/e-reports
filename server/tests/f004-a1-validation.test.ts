import { describe, expect, it } from "vitest";
import {
  type F004Answers,
  IMDRF_GROUPS,
  SECONDARY_REVIEW_ITEMS,
  validateForSubmit,
} from "../src/domain/f004.js";

/**
 * What `validateForSubmit` guards: an answer is never a finding on its own.
 *
 * The bug these cases are written against let an assessor tick 2.6 "Serious", leave the comment
 * box beside it empty, and submit — so the next assessor and the manager inherited a verdict with
 * no reasoning behind it. The rules are read off `SECONDARY_REVIEW_ITEMS`, so the cases here are
 * driven from that metadata rather than from a second copy of the field names, which is the whole
 * point of validating from it.
 *
 * The signature itself is no longer this module's business: it is a password now, verified
 * against the signed-in account by the route, which needs the database and so is out of scope for
 * a pure-function suite like this one. Section 7's own two requirements — at least one mitigation
 * action, and a conclusion whenever the assessor's outcome is Agree — are, and are covered below.
 */

/** Every item's answer AND the comment the paper prints beside it. The baseline that must pass. */
const COMPLETE: F004Answers = {
  device_type: "md",
  device_class: "B",
  report_stage: "initial",
  source_of_event: "malfunction",
  c2_5: "Reported as a device malfunction by the facility.",
  seriousness: "serious",
  c2_6: "Required medical intervention and a 24-hour admission.",
  public_health: "no",
  c2_7: "One device, one facility; no wider exposure identified.",
  imdrf_investigation_type_l1: "Manufacturer investigation",
  imdrf_investigation_type_code: "A05",
  expectedness: "unexpected",
  c4_1: "Not described in the manufacturer's IFU or risk file.",
  causality: "probable",
  c4_3: "Temporal relationship with device use; no other cause identified.",
  signal_status: "signal",
  c5: "Second report against this lot within a month.",
  risk_level: "high",
  c6: "Serious outcome and an unresolved cause.",
  actions: ["monitoring"],
  conclusion: "Recommend risk communication and enhanced monitoring.",
};

/** The same, minus the named fields. */
function without(...fields: string[]): F004Answers {
  const answers = { ...COMPLETE };
  for (const field of fields) delete answers[field];
  return answers;
}

function fieldsFlagged(answers: F004Answers): string[] {
  return validateForSubmit(answers).map((issue) => issue.field);
}

/** Every item whose answer the paper pairs with a comment box, read from the metadata itself. */
const COMMENTED_ITEMS = SECONDARY_REVIEW_ITEMS.filter((item) => item.commentField !== undefined);

/** Every item the paper marks "(If applicable)". */
const OPTIONAL_ITEMS = SECONDARY_REVIEW_ITEMS.filter((item) => item.optional === true);

/** One IMDRF row, under the numbering F004 Rev. 05 prints beside its own boxes. */
type ImdrfBoxes = {
  key: string;
  /** "3.1.1-3.1.4" — the span of boxes this row owns on the paper. */
  boxes: string;
  optional: boolean;
  fields: readonly string[];
};

/**
 * The seven IMDRF rows, each with the span of form boxes it actually owns.
 *
 * The paper numbers the *boxes*, not the rows: 3.1 runs 3.1.1-3.1.4 for the component and then
 * 3.1.5-3.1.8 for the device problem, so a row's span is its preferred-terminology levels plus its
 * one coding box. Computed from the item table rather than typed out beside it, so a row that grew
 * or lost a level would move its own span and be caught by the pin below — which is what ties this
 * suite to the numbers actually printed on F004 Rev. 05.
 */
const IMDRF_BOXES: readonly ImdrfBoxes[] = IMDRF_GROUPS.flatMap((group) => {
  let next = 1;

  return group.items.map((item) => {
    const levels = [1, 2, 3].filter((level) => level <= item.levels);
    const first = next;
    next += levels.length + 1;

    return {
      key: item.key,
      boxes: `${group.no}.${String(first)}-${group.no}.${String(next - 1)}`,
      optional: item.optional === true,
      fields: [
        ...levels.map((level) => `imdrf_${item.key}_l${String(level)}`),
        `imdrf_${item.key}_code`,
      ],
    };
  });
});

const OPTIONAL_IMDRF = IMDRF_BOXES.filter((row) => row.optional);

/** Every box of one row filled: a term at each level the annex carries, and the coding. */
function filledWith(row: ImdrfBoxes): F004Answers {
  const answers: F004Answers = { ...COMPLETE };
  for (const field of row.fields) {
    answers[field] = field.endsWith("_code") ? "A0501" : "Battery depletion";
  }
  return answers;
}

describe("a complete first assessment", () => {
  it("is accepted", () => {
    expect(validateForSubmit(COMPLETE)).toEqual([]);
  });

  it("leaves every optional item untouched, and is still accepted", () => {
    expect(OPTIONAL_ITEMS.length).toBeGreaterThan(0);
    for (const item of OPTIONAL_ITEMS) {
      for (const field of item.a1Fields) expect(COMPLETE[field]).toBeUndefined();
    }
    expect(validateForSubmit(COMPLETE)).toEqual([]);
  });

  it("pairs a comment box with more than one answer", () => {
    expect(COMMENTED_ITEMS.length).toBeGreaterThan(1);
  });
});

describe("an answer without the comment beside it", () => {
  it.each(COMMENTED_ITEMS.map((item) => [`${item.no} ${item.title}`, item] as const))(
    "is refused for %s",
    (_label, item) => {
      const commentField = item.commentField as string;
      const issues = validateForSubmit(without(commentField));

      expect(issues.map((issue) => issue.field)).toContain(commentField);
      expect(issues.some((issue) => issue.message.startsWith(item.no))).toBe(true);
    },
  );

  it("is refused when the comment is only whitespace", () => {
    expect(fieldsFlagged({ ...COMPLETE, c2_6: "   " })).toContain("c2_6");
  });

  it("names the comment box, not the radio, so the reader is sent to what is missing", () => {
    const flagged = fieldsFlagged(without("c2_6"));
    expect(flagged).toContain("c2_6");
    expect(flagged).not.toContain("seriousness");
  });
});

describe("a missing answer", () => {
  it("is refused even when its comment was written", () => {
    expect(fieldsFlagged(without("seriousness"))).toContain("seriousness");
  });

  it("is refused for a required item that has no comment box of its own", () => {
    expect(fieldsFlagged(without("device_type"))).toContain("device_type");
    expect(fieldsFlagged(without("causality"))).toContain("causality");
    expect(fieldsFlagged(without("conclusion"))).toContain("conclusion");
  });

  it("is refused when 7.1 carries no action at all", () => {
    expect(fieldsFlagged(without("actions"))).toContain("actions");
  });

  it("does not also demand the comment, which would be two complaints about one gap", () => {
    const issues = validateForSubmit(without("seriousness", "c2_6"));
    const forItem = issues.filter((issue) => issue.message.startsWith("2.6"));

    expect(forItem).toHaveLength(1);
    expect(forItem[0]?.field).toBe("seriousness");
  });
});

describe('an "(If applicable)" item', () => {
  it("is refused when its terminology is given without the coding", () => {
    expect(fieldsFlagged({ ...COMPLETE, imdrf_component_l1: "Battery" })).toContain(
      "imdrf_component_code",
    );
  });

  it("is refused when its coding is given without the terminology", () => {
    expect(fieldsFlagged({ ...COMPLETE, imdrf_component_code: "E1204" })).toContain(
      "imdrf_component_l1",
    );
  });

  it("is accepted when it is filled in completely", () => {
    expect(
      validateForSubmit({
        ...COMPLETE,
        imdrf_component_l1: "Battery",
        imdrf_component_code: "E1204",
      }),
    ).toEqual([]);
  });

  it("does not demand the deeper terminology levels the paper leaves open", () => {
    expect(
      validateForSubmit({
        ...COMPLETE,
        imdrf_device_problem_l1: "Battery depletion",
        imdrf_device_problem_code: "A0501",
      }),
    ).toEqual([]);
  });

  it("is accepted when 1.10 is filled, having no comment box to owe", () => {
    expect(validateForSubmit({ ...COMPLETE, registration_number: "TMDA-REG-0001" })).toEqual([]);
  });
});

/**
 * What "(If applicable)" is worth, group by group, against the numbering on the paper.
 *
 * The six spans below are the ones F004 Rev. 05 opens with a parent instruction ending in
 * "(If applicable)" — the component, the device problem, the health impact, the clinical signs,
 * the investigation findings and the investigation conclusion. Each is optional as a whole and by
 * halves is not one of the states the form has: blank, or complete.
 */
describe('an IMDRF group the paper marks "(If applicable)"', () => {
  it("is one of exactly six spans, numbered as the form numbers them", () => {
    expect(OPTIONAL_IMDRF.map((row) => row.boxes)).toEqual([
      "3.1.1-3.1.4",
      "3.1.5-3.1.8",
      "3.2.1-3.2.4",
      "3.2.5-3.2.8",
      "3.3.3-3.3.6",
      "3.3.7-3.3.9",
    ]);
  });

  it.each(OPTIONAL_IMDRF.map((row) => [row.boxes, row] as const))(
    "is accepted with %s left completely blank",
    (_boxes, row) => {
      for (const field of row.fields) expect(COMPLETE[field]).toBeUndefined();
      expect(validateForSubmit(COMPLETE)).toEqual([]);
    },
  );

  it.each(
    OPTIONAL_IMDRF.flatMap((row) => row.fields.map((field) => [row.boxes, field, row] as const)),
  )("is refused when %s carries %s and nothing else", (_boxes, field, row) => {
    const issues = validateForSubmit({ ...COMPLETE, [field]: "Battery depletion" });

    // One complaint, and it names a box of this row: starting a group is starting all of it.
    expect(issues).toHaveLength(1);
    expect(row.fields).toContain(issues[0]?.field);
  });

  it.each(OPTIONAL_IMDRF.map((row) => [row.boxes, row] as const))(
    "is accepted with %s filled to every level it carries",
    (_boxes, row) => {
      expect(validateForSubmit(filledWith(row))).toEqual([]);
    },
  );

  it.each(OPTIONAL_IMDRF.map((row) => [row.boxes, row] as const))(
    "is accepted with %s stopped at level 1 and its coding, the depth an annex may end at",
    (_boxes, row) => {
      const level1 = row.fields[0] as string;
      const code = row.fields[row.fields.length - 1] as string;

      expect(
        validateForSubmit({ ...COMPLETE, [level1]: "Battery depletion", [code]: "A0501" }),
      ).toEqual([]);
    },
  );
});

/**
 * Which items the form leaves open, pinned — the guard against this drifting either way.
 *
 * Optionality lives in one table, which is what lets the page, the validation and the secondary
 * assessor's workspace agree about it. The cost of one table is that one careless `optional: true`
 * excuses an assessor from a finding the regulation asks for, silently and everywhere at once.
 * Both lists are written out so that either kind of drift fails here rather than in front of an
 * assessor: a required row turned optional, or an "(If applicable)" row turned required.
 */
describe("the item table's optionality", () => {
  it("marks exactly the rows F004 Rev. 05 prints as optional", () => {
    expect(OPTIONAL_ITEMS.map((item) => item.key)).toEqual([
      "1.10", // Device registration number (If applicable)
      "3.1.1", // 3.1.1-3.1.4  component of the medical device (If applicable)
      "3.1.2", // 3.1.5-3.1.8  medical device problem (If applicable)
      "3.2.1", // 3.2.1-3.2.4  health effects - health impact (If applicable)
      "3.2.2", // 3.2.5-3.2.8  clinical signs and symptoms (If applicable)
      "3.3.2", // 3.3.3-3.3.6  investigation findings (If applicable)
      "3.3.3", // 3.3.7-3.3.9  investigation conclusion (If applicable)
    ]);
  });

  it("leaves every other row required, the paper having marked none of them", () => {
    expect(
      SECONDARY_REVIEW_ITEMS.filter((item) => item.optional !== true).map((item) => item.key),
    ).toEqual([
      "1.3",
      "1.11",
      "1.19",
      "2.5",
      "2.6",
      "2.7",
      "3.3.1",
      "4.1",
      "4.2",
      "4.3",
      "5",
      "6",
      "7.1_actions",
      "7.1_conclusion",
    ]);
  });

  it("keeps 1.11 Device Class required, the one section-1 row beside 1.10 that is not marked", () => {
    expect(fieldsFlagged(without("device_class"))).toContain("device_class");
    expect(fieldsFlagged({ ...COMPLETE, device_class: "   " })).toContain("device_class");
  });
});

describe("the required IMDRF row, 3.3.1 Type of Investigation with its coding at 3.3.2", () => {
  it("owns exactly those two boxes, and is not one of the spans the paper leaves open", () => {
    const row = IMDRF_BOXES.find((candidate) => candidate.key === "investigation_type");

    expect(row?.boxes).toBe("3.3.1-3.3.2");
    expect(row?.optional).toBe(false);
  });

  it("stays required although 3.3.3-3.3.9 beneath it are optional", () => {
    const findings = OPTIONAL_IMDRF.find((row) => row.boxes === "3.3.3-3.3.6");
    const conclusion = OPTIONAL_IMDRF.find((row) => row.boxes === "3.3.7-3.3.9");

    expect(findings).toBeDefined();
    expect(conclusion).toBeDefined();
    expect(
      fieldsFlagged(without("imdrf_investigation_type_l1", "imdrf_investigation_type_code")),
    ).toContain("imdrf_investigation_type_l1");
  });

  it("is refused when left out entirely", () => {
    expect(
      fieldsFlagged(without("imdrf_investigation_type_l1", "imdrf_investigation_type_code")),
    ).toContain("imdrf_investigation_type_l1");
  });

  it("is refused with a terminology but no coding, which used to pass", () => {
    expect(fieldsFlagged(without("imdrf_investigation_type_code"))).toContain(
      "imdrf_investigation_type_code",
    );
  });

  it("is refused with a coding but no terminology, which used to pass", () => {
    expect(fieldsFlagged(without("imdrf_investigation_type_l1"))).toContain(
      "imdrf_investigation_type_l1",
    );
  });
});

/**
 * Section 7's own outcome: Agree, Disagree or Required clarification, chosen once for the whole
 * conclusion rather than per item. Agree is what every fixture above already is — `outcome` is
 * absent from `COMPLETE`, and absent reads exactly as Agree, which is what let every case above
 * keep asserting a conclusion is required without knowing this field exists at all.
 */
