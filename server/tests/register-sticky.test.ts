import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COLUMNS, cellOverflows } from "../src/doors/staff/register/pages/register.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(path.join(root, "public/app.css"), "utf8");
const view = readFileSync(path.join(root, "src/doors/staff/register/pages/register.tsx"), "utf8");
const script = readFileSync(path.join(root, "public/register.js"), "utf8");

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}\\s*\\{[^}]*\\}`).exec(css)?.[0] ?? "";
}

/**
 * Horizontal freeze on the register is S/N only. TMDA report number, date received, and every
 * later column have to travel with the scrollbar — freezing the first three was the previous
 * behaviour and is the regression this file exists to catch.
 */
describe("register sticky columns", () => {
  it("freezes only the first column in the view", () => {
    expect(view).toMatch(/const STICKY_COUNT = 1;/);
    expect(view).not.toMatch(/const STICKY_COUNT = 3;/);
  });

  it("does not pin report number or date received in the stylesheet", () => {
    const freeze = rule(".register-table .rg-c1");

    expect(freeze).toMatch(/position:\s*sticky/);
    expect(freeze).toMatch(/left:\s*0/);
    expect(css).not.toMatch(/\.register-table \.rg-c2/);
    expect(css).not.toMatch(/\.register-table \.rg-c3/);
  });

  it("keeps the header row frozen against the scroll box", () => {
    const header = rule(".register-table th");

    expect(header).toMatch(/position:\s*sticky/);
    expect(header).toMatch(/top:\s*0/);
  });
});

/**
 * The workspace geometry. The register's viewport takes the width beside the rail and the height
 * under the toolbar, and both scrollbars belong to it — the two rules replaced here (a 90%
 * max-width and a `calc(100vh - 232px)` guess) are what left unused space to the right of and
 * underneath the sheet.
 */
describe("register workspace geometry", () => {
  it("gives the sheet the whole width beside the rail", () => {
    const pane = rule(".staff-main:has(.register-page)");

    expect(pane).toMatch(/max-width:\s*none/);
    expect(pane).not.toMatch(/max-width:\s*\d+%/);
    expect(pane).toMatch(/display:\s*flex/);
    expect(pane).toMatch(/min-height:\s*0/);
  });

  it("gives the sheet the remaining height instead of a viewport calculation", () => {
    const scroll = rule(".register-scroll");

    expect(scroll).toMatch(/flex:\s*1/);
    expect(scroll).toMatch(/min-height:\s*0/);
    // The fragile guess at the height of everything above the table, and its phone variant.
    expect(css).not.toMatch(/max-height:\s*calc\(100vh - 232px\)/);
    expect(scroll).not.toMatch(/max-height:\s*calc/);
  });

  it("bounds the register shell to the viewport so the page itself never scrolls sideways", () => {
    expect(rule(".shell:has(.register-page)")).toMatch(/overflow:\s*hidden/);
    expect(rule(".main:has(.register-page)")).toMatch(/min-height:\s*0/);
    expect(rule(".register-page")).toMatch(/flex-direction:\s*column/);
    // The table is as wide as its columns; the box around it is what scrolls.
    expect(rule(".register-table")).toMatch(/width:\s*max-content/);
  });

  it("lets the toolbar wrap on a narrow screen instead of overflowing", () => {
    expect(rule(".register-toolbar")).toMatch(/flex-wrap:\s*wrap/);

    const search = rule(".register-search");
    expect(search).toMatch(/min-width:\s*0/);
    expect(search).not.toMatch(/width:\s*280px/);

    // Below the drawer breakpoint the page scrolls normally again, with a bounded sheet viewport.
    expect(css).toMatch(/@media \(max-width: 900px\) \{\s*\.shell:has\(\.register-page\)/);
  });
});

/**
 * A cell is a preview; the record is whole. Row height is controlled by the line clamp in CSS, and
 * nothing is cut out of the document to achieve it — which is what keeps the page's search, the
 * Excel export and assistive technology reading the stored value rather than the visible one.
 */
describe("register long-value presentation", () => {
  it("clamps every cell and gives narrative columns one extra line", () => {
    expect(rule(".register-table .rg-text")).toMatch(/line-clamp:\s*3/);
    expect(rule(".register-table .rg-narrative")).toMatch(/line-clamp:\s*4/);
  });

  it("renders the full value and never truncates it server-side", () => {
    // The cell prints the value; only CSS shortens it.
    expect(view).toMatch(/\{text\}/);
    expect(view).not.toMatch(/\.slice\(0,|substring\(|\.\.\."/);
  });

  it("offers a keyboard-reachable control that opens the whole value in the shell's modal", () => {
    expect(view).toMatch(/<button[\s\S]{0,200}data-rg-open/);
    expect(view).toMatch(/aria-haspopup="dialog"/);
    expect(view).toMatch(/<dialog class="modal rg-modal"/);
    // showModal is what buys the backdrop, the focus trap and Escape-to-close.
    expect(script).toMatch(/dialog\.showModal\(\)/);
    expect(script).toMatch(/data-rg-open/);
    // The dialog is filled from the cell's own text, so it can never disagree with the record.
    expect(script).toMatch(/textContent/);
  });

  it("searches the stored value rather than the visible preview", () => {
    expect(view).toMatch(/textContent/);
    // The rendered text, which a clipped cell no longer holds all of. Named in a comment in the
    // view explaining why it is not used, hence the property access rather than the bare word.
    expect(view).not.toMatch(/\.innerText/);
  });

  it("previews a value only when it is longer than its own column can show", () => {
    const description = COLUMNS.find((col) =>
      col.header.startsWith("Adverse Event(s)/Incident(s) Description"),
    );
    const dateReceived = COLUMNS.find((col) => col.header === "Date Received");
    if (!description || !dateReceived) throw new Error("register columns changed");

    const paragraph =
      "During use, the monitor unexpectedly stopped displaying the patient's SpO2 value and " +
      "generated repeated alarm notifications despite the sensor being correctly positioned on " +
      "the patient's finger. The device was replaced and the patient was monitored manually " +
      "until a spare unit arrived from the biomedical engineering department.";

    expect(cellOverflows(description, paragraph)).toBe(true);
    expect(cellOverflows(description, "Line burst during infusion.")).toBe(false);
    // A date can never overflow, so it never grows a control.
    expect(cellOverflows(dateReceived, "2026-09-13")).toBe(false);
  });

  it("keeps long-text columns wider than short ones without letting them dominate", () => {
    const narrative = COLUMNS.filter((col) => col.narrative);
    expect(narrative.length).toBeGreaterThanOrEqual(5);

    for (const col of narrative) {
      expect(col.width, col.header).toBeGreaterThanOrEqual(180);
      // No 600px or 800px column: a single field must not swallow the sheet.
      expect(col.width, col.header).toBeLessThanOrEqual(360);
    }

    const dates = COLUMNS.filter((col) => col.header.startsWith("Date"));
    for (const col of dates) expect(col.width, col.header).toBeLessThanOrEqual(140);
  });
});

/**
 * The same class of fault elsewhere in the staff portal: a reporter-typed value deciding the width
 * of a whole list. Those tables are `nowrap`, so the value widens a column instead of growing a row
 * — bounded with an ellipsis on the free-text cells only.
 */
describe("staff list free-text cells", () => {
  it("bounds free-text cells in the shared table without touching codes or dates", () => {
    const cap = rule(".utable .cap");

    expect(cap).toMatch(/max-width:\s*\d+ch/);
    expect(cap).toMatch(/text-overflow:\s*ellipsis/);
    expect(css).not.toMatch(/\.utable td\s*\{[^}]*text-overflow/);
  });
});
