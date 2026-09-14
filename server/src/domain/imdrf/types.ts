/**
 * Shared vocabulary for the IMDRF terminology subsystem: the parser, the validator, the import
 * service, the query service and the routes all import from here rather than restating these.
 */

/** The seven annexes the 2026 consolidated workbook carries, one per sheet. */
export const ANNEXES = ["A", "B", "C", "D", "E", "F", "G"] as const;

export type Annex = (typeof ANNEXES)[number];

export function isAnnex(value: string): value is Annex {
  return (ANNEXES as readonly string[]).includes(value);
}

export type ReleaseStatus = "draft" | "published";

/** One (annex, count) pair, as the admin preview and the sidebar's annex list both need it. */
export type AnnexSummary = { annex: Annex; count: number };

/** IMDRF's own fixed annex titles. Presentation copy, not stored — an annex's description does
 *  not vary release to release, so this lives once in the domain layer rather than being
 *  hardcoded in every view that needs it. */
export const ANNEX_DESCRIPTIONS: Record<Annex, string> = {
  A: "Medical Device Problem",
  B: "Type of Investigation",
  C: "Investigation Findings",
  D: "Investigation Conclusion",
  E: "Clinical Signs, Symptoms or Conditions",
  F: "Health Impact",
  G: "Medical Device Component",
};
