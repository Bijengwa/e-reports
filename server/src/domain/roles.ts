/**
 * What each role is called on screen.
 *
 * The database enum stays `manager | assessor | administrator`. "Officer" is the word TMDA uses
 * for the person the schema calls an assessor, and renaming the enum would mean a migration, a
 * rewrite of every query that names it, and a window where rows and code disagree — all to change
 * a caption. So the enum is the stored fact and this is the caption, in one place.
 *
 * Every surface that prints a role reads it from here. Two of them printed the raw enum value and
 * one hard-coded "Assessor" in a `<select>`, which is exactly the drift this closes.
 */
export const ROLE_LABELS = {
  administrator: "Administrator",
  manager: "Manager",
  assessor: "Officer",
} as const;

export type Role = keyof typeof ROLE_LABELS;

/**
 * The caption for a role.
 *
 * Falls back to the stored value rather than throwing or printing a blank. A role that reached the
 * page without a caption is a bug in this file, and showing `assessor` makes that obvious while
 * leaving the page readable; an empty cell would hide it.
 */
export function roleLabel(role: string): string {
  return ROLE_LABELS[role as Role] ?? role;
}
