import { describe, expect, it } from "vitest";
import { type F004Answers, SECONDARY_REVIEW_ITEMS, validateForSubmit } from "../src/domain/f004.js";

/**
 * What `validateForSubmit` guards: an answer is never a finding on its own.
 *
 * The bug these cases are written against let an assessor tick 2.6 "Serious", leave the comment
 * box beside it empty, and submit — so the next assessor and the manager inherited a verdict with
 * no reasoning behind it. The rules are read off `SECONDARY_REVIEW_ITEMS`, so the cases here are
 * driven from that metadata rather than from a second copy of the field names, which is the whole
 * point of validating from it.
 */

const ASSESSOR = "Asha Mrema";

/** Every item's answer AND the comment the paper prints beside it. The baseline that must pass. */
const COMPLETE: F004Answers = {
  device_type: "md",
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
  signature: ASSESSOR,
};

/** The same, minus the named fields. */
function without(...fields: string[]): F004Answers {
  const answers = { ...COMPLETE };
  for (const field of fields) delete answers[field];
  return answers;
}

function fieldsFlagged(answers: F004Answers): string[] {
  return validateForSubmit(answers, ASSESSOR).map((issue) => issue.field);
}

/** Every item whose answer the paper pairs with a comment box, read from the metadata itself. */
const COMMENTED_ITEMS = SECONDARY_REVIEW_ITEMS.filter((item) => item.commentField !== undefined);

/** Every item the paper marks "(If applicable)". */
const OPTIONAL_ITEMS = SECONDARY_REVIEW_ITEMS.filter((item) => item.optional === true);

describe("a complete first assessment", () => {
  it("is accepted", () => {
    expect(validateForSubmit(COMPLETE, ASSESSOR)).toEqual([]);
  });

  it("leaves every optional item untouched, and is still accepted", () => {
    expect(OPTIONAL_ITEMS.length).toBeGreaterThan(0);
    for (const item of OPTIONAL_ITEMS) {
      for (const field of item.a1Fields) expect(COMPLETE[field]).toBeUndefined();
    }
    expect(validateForSubmit(COMPLETE, ASSESSOR)).toEqual([]);
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
      const issues = validateForSubmit(without(commentField), ASSESSOR);

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
    const issues = validateForSubmit(without("seriousness", "c2_6"), ASSESSOR);
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
      validateForSubmit(
        { ...COMPLETE, imdrf_component_l1: "Battery", imdrf_component_code: "E1204" },
        ASSESSOR,
      ),
    ).toEqual([]);
  });

  it("does not demand the deeper terminology levels the paper leaves open", () => {
    expect(
      validateForSubmit(
        {
          ...COMPLETE,
          imdrf_device_problem_l1: "Battery depletion",
          imdrf_device_problem_code: "A0501",
        },
        ASSESSOR,
      ),
    ).toEqual([]);
  });

  it("is accepted when 1.10 and 1.11 are filled, having no comment box to owe", () => {
    expect(
      validateForSubmit(
        { ...COMPLETE, registration_number: "TMDA-REG-0001", device_class: "B" },
        ASSESSOR,
      ),
    ).toEqual([]);
  });
});

describe("the required IMDRF row, 3.3.1", () => {
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

describe("the signature", () => {
  it("is still required", () => {
    expect(fieldsFlagged(without("signature"))).toContain("signature");
  });

  it("must still be the assessor's own name", () => {
    expect(fieldsFlagged({ ...COMPLETE, signature: "Someone Else" })).toContain("signature");
  });
});
