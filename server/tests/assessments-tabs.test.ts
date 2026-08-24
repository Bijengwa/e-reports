import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../public/app.css"),
  "utf8",
);

/**
 * The three tabs on /assessments are hash links plus `:target`. The default group (Not started)
 * stays visible when the URL has no hash, and must stay visible when the hash is #not-started
 * itself — that click is how an Officer comes back from In progress or Submitted.
 */
describe("my assessments tabs", () => {
  it("carries no rule for the secondary-assessment tab that was removed", () => {
    // Two things at once. The tab is gone, so a rule naming it is dead weight — and the rules that
    // named it were already dead: they said `#second-assessment` while the page rendered
    // `id="secondary-assessments"`, so the fourth tab never painted as selected and Not started
    // stayed green behind it. Neither spelling may come back.
    expect(css).not.toContain("#second-assessment");
    expect(css).not.toContain("#secondary-assessments");
  });

  it("shows whichever group is :target", () => {
    expect(css).toMatch(/\.mya:target\s*\{\s*display:\s*block/);
  });

  it("does not hide the default group when that group is itself the :target", () => {
    // `.mya-wrap:has(.mya:target) .mya-default { display: none }` is more specific than
    // `.mya:target { display: block }`. Not started is both, so that rule blanks it the moment
    // the hash is #not-started — landing with no hash still looked fine.
    expect(css).toMatch(
      /\.mya-wrap:has\(\.mya:target\) \.mya-default:not\(:target\)\s*\{\s*display:\s*none/,
    );
  });

  it("does not un-mark the default tab when Not started is the :target", () => {
    // The server-rendered `on` class is the default tab. Un-marking every `a.on` as soon as any
    // group is :target would leave Not started looking unselected when it is the chosen one,
    // unless a more specific rule paints it back — which is the same trap as the panel hide.
    expect(css).not.toMatch(/\.mya-wrap:has\(\.mya:target\) \.mya-tabs a\.on\s*\{/);
    expect(css).toMatch(/\.mya-wrap:has\(#in-progress:target\) \.mya-tabs a\.on/);
    expect(css).toMatch(/\.mya-wrap:has\(#submitted:target\) \.mya-tabs a\.on/);
  });
});

/**
 * Every wide table scrolls inside its own box, so the page itself never scrolls sideways.
 *
 * The two rules are one decision and have to be read together: a box that scrolls on one axis has
 * no `visible` left on the other, which makes it the scroll container for anything sticky inside
 * it. Bounding the height is what keeps the frozen header working from there — and the header's
 * offset has to be 0, because 56px was measured against the title bar the header no longer sticks
 * to.
 */
describe("wide tables", () => {
  it("gives the scroll box a bounded height, not just a horizontal overflow", () => {
    const box = /\.tscroll\s*\{[^}]*\}/.exec(css)?.[0] ?? "";

    expect(box).toMatch(/overflow:\s*auto/);
    expect(box).toMatch(/max-height:/);
    // Not `overflow-x` alone: that reads as if the vertical axis were untouched, which is exactly
    // the assumption that silently kills the sticky header.
    expect(box).not.toMatch(/overflow-x:\s*auto/);
  });

  it("freezes the table header against the box rather than against the title bar", () => {
    const header = /\.utable th\s*\{[^}]*\}/.exec(css)?.[0] ?? "";

    expect(header).toMatch(/position:\s*sticky/);
    expect(header).toMatch(/top:\s*0/);
    expect(header).not.toMatch(/top:\s*56px/);
  });

  it("no longer breaks the table into a block to scroll it on a phone", () => {
    // The old answer below 620px was `display: block` on the table itself, which scrolled it by
    // destroying its column layout. The box does the scrolling now, at every width.
    expect(css).not.toMatch(/\.utable\s*\{\s*display:\s*block/);
  });
});
