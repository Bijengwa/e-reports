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
