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
