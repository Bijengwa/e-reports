import { describe, expect, it } from "vitest";
import {
  allowedDegrees,
  DEVICE_ROWS,
  EVENT_ROWS,
  F004_SECTION_KEYS,
  IMDRF_GROUPS,
  SECONDARY_REVIEW_ITEMS,
} from "../src/domain/f004.js";
import {
  controlsFor,
  DERIVED_FIELDS,
  DISCREPANCY_ITEMS,
  degreesFor,
  F004_ITEM_SEMANTICS,
  isReviewable,
  reasonLabel,
  reasonRequired,
  semanticsFor,
} from "../src/domain/f004-semantics.js";

/**
 * The registry is the one place that says what each F004 item is. Two things have to hold for
 * that to mean anything: it has to cover the form completely, and the controls a page draws have
 * to be the ones it derives. Both are asserted here rather than left to a reader comparing two
 * tables by eye.
 */
describe("the item semantics registry", () => {
  it("declares each item once", () => {
    const numbers = F004_ITEM_SEMANTICS.map((item) => item.no);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it("places every item in a section the document has", () => {
    for (const item of F004_ITEM_SEMANTICS) {
      expect(F004_SECTION_KEYS as readonly string[]).toContain(item.section);
    }
  });

  it("covers every section-1 row of the form, and adds none of its own", () => {
    const declared = F004_ITEM_SEMANTICS.filter((item) => item.section === "1");

    expect(declared.map((item) => item.no)).toEqual(DEVICE_ROWS.map((row) => row.no));
    for (const row of DEVICE_ROWS) {
      expect(semanticsFor(row.no)?.fields).toEqual([row.key]);
    }
  });

  it("covers 2.1 to 2.4 as the reporter's own account", () => {
    for (const row of EVENT_ROWS) {
      const item = semanticsFor(row.no);
      expect(item?.fields).toEqual([row.key]);
      expect(item?.origin).toBe("reporter");
      expect(item?.reviewClass).toBe("transcribed");
    }
  });

  it("covers every IMDRF row, with its levels and code named as resolved consequences", () => {
    for (const group of IMDRF_GROUPS) {
      for (const entry of group.items) {
        const item = semanticsFor(`${group.no}.${entry.letter}`);

        expect(item?.reviewClass).toBe("terminology");
        expect(item?.fields).toEqual([`imdrf_${entry.key}_term_id`]);
        expect(item?.derivedFields).toEqual([
          `imdrf_${entry.key}_l1`,
          `imdrf_${entry.key}_l2`,
          `imdrf_${entry.key}_l3`,
          `imdrf_${entry.key}_code`,
        ]);
        expect(item?.optional ?? false).toBe(entry.optional === true);
      }
    }
  });

  it("knows every item A2 is asked to take a position on", () => {
    for (const item of SECONDARY_REVIEW_ITEMS) {
      expect(
        semanticsFor(item.key),
        `${item.key} is a review item with no declared semantics`,
      ).toBeDefined();
      expect(isReviewable(item.key)).toBe(true);
    }
  });
});

describe("the controls one item offers", () => {
  it("offers a reporter's fact only a discrepancy, because there is no finding to agree with", () => {
    // 1.8 is the manufacturer's name as filed. A second assessor who thinks it is wrong is not
    // disagreeing with the first assessor; they are saying the Orange Report and the F004 do not
    // match, which is what `flag_discrepancy` records.
    expect(controlsFor("1.8")).toEqual(["flag_discrepancy"]);
    expect(controlsFor("2.1")).toEqual(["flag_discrepancy"]);
    expect(isReviewable("1.8")).toBe(false);
  });

  it("offers a closed classification two positions and no third", () => {
    for (const no of ["1.3", "1.10", "1.11", "1.19"]) {
      expect(controlsFor(no), no).toEqual(["agree", "disagree"]);
    }
  });

  it("offers a controlled terminology two positions and no clarification", () => {
    // Section 3 is a published vocabulary: the term A1 chose is the right one, or another
    // published term is. There is no wording to amend, so there is nothing to clarify.
    for (const no of ["3.1.1", "3.1.2", "3.2.1", "3.2.2", "3.3.1", "3.3.2", "3.3.3"]) {
      expect(controlsFor(no), no).toEqual(["agree", "disagree"]);
      expect(controlsFor(no), no).not.toContain("clarification");
    }
  });

  it("offers all three where the finding carries reasoning or prose", () => {
    for (const no of ["2.5", "2.6", "2.7", "4.1", "4.2", "5", "6", "7.1_actions"]) {
      expect(controlsFor(no), no).toEqual(["agree", "disagree", "clarification"]);
    }
    for (const no of ["4.3", "7.1_conclusion"]) {
      expect(controlsFor(no), no).toEqual(["agree", "disagree", "clarification"]);
    }
  });

  it("offers nothing against a value the application resolved, or a signature", () => {
    // 1.18 is the date the report reached TMDA, written by the application. 3.0 is the IMDRF
    // release the assessment is bound to. Neither is anybody's finding.
    expect(controlsFor("1.18")).toEqual([]);
    expect(controlsFor("3.0")).toEqual([]);
    expect(controlsFor("8")).toEqual([]);
  });

  it("asks only whether to supply a value where A1 left an optional item blank", () => {
    expect(controlsFor("1.10", { a1Blank: true })).toEqual(["supply"]);
    expect(controlsFor("3.1.1", { a1Blank: true })).toEqual(["supply"]);
    expect(degreesFor("1.10")).not.toContain("supplied");
  });

  it("leaves a blank reporter's row as a discrepancy question, not a gap to fill", () => {
    // Nobody here may answer 1.4 on the reporter's behalf. If it should have been filed and was
    // not, that is a discrepancy against the report.
    expect(controlsFor("1.4", { a1Blank: true })).toEqual(["flag_discrepancy"]);
  });

  it("is what the review page actually draws", () => {
    for (const item of SECONDARY_REVIEW_ITEMS) {
      expect(allowedDegrees(item), item.key).toEqual(degreesFor(item.key));
    }
  });

  it("requires something written for every action but Agree", () => {
    expect(reasonRequired("agree")).toBe(false);
    for (const control of ["disagree", "clarification", "supply", "flag_discrepancy"] as const) {
      expect(reasonRequired(control), control).toBe(true);
    }
  });
});

describe("what an item's own prose is called", () => {
  it("names a basis, a justification, and nothing where there is no prose", () => {
    expect(reasonLabel("2.5")).toBe("Basis");
    expect(reasonLabel("4.1")).toBe("Basis");
    // 6 asks for a risk level to be justified, which is not the same statement as the basis for
    // classifying an event's source — the document says which it is reading.
    expect(reasonLabel("6")).toBe("Justification");
    // 4.2's reasoning is 4.3, an item of its own with its own number.
    expect(reasonLabel("4.2")).toBeNull();
    expect(reasonLabel("4.3")).toBeNull();
    expect(reasonLabel("1.1")).toBeNull();
  });

  it("names the field the prose is stored in wherever it claims one", () => {
    for (const item of F004_ITEM_SEMANTICS) {
      if (item.reasonRole === "none") expect(item.reasonField, item.no).toBeUndefined();
      else expect(item.reasonField, item.no).toBeTypeOf("string");
    }
  });
});

describe("resolved fields", () => {
  it("counts every IMDRF level and code, the release, and the received date", () => {
    expect(DERIVED_FIELDS.has("imdrf_component_l1")).toBe(true);
    expect(DERIVED_FIELDS.has("imdrf_investigation_conclusion_code")).toBe(true);
    expect(DERIVED_FIELDS.has("imdrf_release_id")).toBe(true);
    expect(DERIVED_FIELDS.has("received_at")).toBe(true);
    // The term reference is the assessor's own choice, not a consequence of it.
    expect(DERIVED_FIELDS.has("imdrf_component_term_id")).toBe(false);
  });
});

describe("the rows a discrepancy may be raised against", () => {
  it("is the reporter's rows, and never a first assessor's finding", () => {
    const numbers = DISCREPANCY_ITEMS.map((item) => item.no);

    expect(numbers).toContain("1.1");
    expect(numbers).toContain("2.4");
    expect(numbers).not.toContain("1.3");
    expect(numbers).not.toContain("1.18");
    expect(numbers).not.toContain("2.5");

    for (const item of DISCREPANCY_ITEMS) {
      expect(item.origin, item.no).toBe("reporter");
      // Not review items: a discrepancy is never required before a submission, and the review
      // payload has no position to record for one.
      expect(SECONDARY_REVIEW_ITEMS.map((review) => review.key)).not.toContain(item.no);
    }
  });
});
