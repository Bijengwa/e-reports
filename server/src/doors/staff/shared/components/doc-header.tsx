import type { Children } from "@kitajs/html";
import { IconBack } from "../../../../views/shared/icons.js";

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
 * An F004 working surface's whole title-bar row, rendered in place of `pageTitle` via `StaffShell`'s
 * `topContent` — ONE `.top` bar, not a second row underneath it. The hamburger and the signed-in
 * name/role are `StaffShell`'s own and stay put; this is everything between them.
 *
 * The same "one `.top` bar" pattern `CaseDetailTopContent` (`register/pages/report-detail.tsx`) and
 * `FinalF004TopContent` (`final-reports/pages/final-document.tsx`) already use, shared here because
 * Assessment 1 and Secondary assessment need exactly the same row and nothing surface-specific:
 * back, the dynamic title, an optional badge (the `Countdown`), and the surface's own actions
 * (Orange Report today).
 *
 * `back` is icon-only by design — see the F004 refactor's own rule that back/download/print/close
 * are SVG, not text buttons, on a bar that otherwise stays out of the document's way.
 */
export function DocHeader({
  backHref,
  backLabel,
  title,
  badge,
  children,
}: DocHeaderProps): JSX.Element {
  return (
    <div class="f4-surface-top">
      <a href={backHref} class="f4-icon-btn" aria-label={backLabel}>
        <IconBack />
      </a>
      <h1 safe>{title}</h1>
      {badge}
      <div class="f4-toolbar-actions">{children}</div>
    </div>
  );
}
