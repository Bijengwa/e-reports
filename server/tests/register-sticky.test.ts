import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(path.join(root, "public/app.css"), "utf8");
const view = readFileSync(path.join(root, "src/doors/staff/views/register.tsx"), "utf8");

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

  it("lets the register use most of the workspace beside the rail", () => {
    const pane = /\.staff-main:has\(\.register-page\)\s*\{[^}]*\}/.exec(css)?.[0] ?? "";

    expect(pane).toMatch(/max-width:\s*90%/);
  });

  it("does not pin report number or date received in the stylesheet", () => {
    const freeze = /\.register-table \.rg-c1\s*\{[^}]*\}/.exec(css)?.[0] ?? "";

    expect(freeze).toMatch(/position:\s*sticky/);
    expect(freeze).toMatch(/left:\s*0/);
    expect(css).not.toMatch(/\.register-table \.rg-c2/);
    expect(css).not.toMatch(/\.register-table \.rg-c3/);
  });
});
