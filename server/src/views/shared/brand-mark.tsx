import { Logo } from "./logo.js";

/**
 * The product's name, wherever it is shown.
 *
 * One component for the rail and both auth cards, so the mark, the name and the line under it
 * cannot drift apart across three files. Editing this changes sign-in, the forced password change
 * and the staff rail together — which is the point of it existing.
 *
 * It carries no colours of its own. The rail sets `on-dark` above it and the palette follows;
 * the sign-in card leaves it alone. `brand-text` is a single element so the collapsed rail can
 * hide the words and keep the mark with one rule.
 */
export function BrandMark(): JSX.Element {
  return (
    <span class="brand-mark">
      <Logo />
      <span class="brand-text">
        <b>AE Reports</b>
        <span>TMDA · Device vigilance</span>
      </span>
    </span>
  );
}
