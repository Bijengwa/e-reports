import type { Children } from "@kitajs/html";
import { IconBack } from "./icons.js";

export type DocHeaderProps = {
  /** Where the icon-only back control goes. */
  backHref: string;
  /** Read to a screen reader; the control itself carries no visible text. */
  backLabel: string;
  /** The dynamic F004/assessment title — "Assessment (A1)", "Secondary assessment (A2)", "Final F004". */
  title: string;
  /** A small fixed-width badge beside the title — the `Countdown`, when the surface has one. */
  badge?: JSX.Element;
  /** Right-aligned controls — Orange Report, the Final F004 type selector, Download, Print. */
  children?: Children;
};

/**
 * The one-row toolbar every F004 surface opens with, immediately above the official document.
 *
 * Replaces the old `.staff-head` block — an Orange Report summary card, a standalone back button,
 * and (on secondary assessment) an explanatory heading and legend — that used to sit between the
 * application chrome and the F004's own masthead. A reader opening any F004 now sees this one row
 * and then the document itself; nothing of the application repeats what the form already says
 * about itself in `.f4-doc-head`.
 *
 * `back` is icon-only by design — see the F004 refactor's own rule that back/download/print/close
 * are SVG, not text buttons, on a toolbar that otherwise stays out of the document's way.
 */
export function DocHeader({
  backHref,
  backLabel,
  title,
  badge,
  children,
}: DocHeaderProps): JSX.Element {
  return (
    <div class="f4-toolbar">
      <a href={backHref} class="f4-icon-btn f4-toolbar-back" aria-label={backLabel}>
        <IconBack />
      </a>
      <h2 class="f4-toolbar-title" safe>
        {title}
      </h2>
      {badge}
      <div class="f4-toolbar-actions">{children}</div>
    </div>
  );
}
