import path from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium } from "playwright";

/**
 * The Final F004's PDF, produced from the same HTML and the same print stylesheet the browser's
 * own Ctrl+P already turns into a document — see `.fd-print-page` and the `@media print` rules in
 * css/case.css, and `FinalDocumentPrintPage` in `doors/staff/final-reports/pages/final-document.tsx`.
 *
 * A headless Chromium is the only way to get a real, forced-attachment PDF out of a server that
 * renders its documents as HTML+CSS rather than through a PDF-construction library: there is no
 * second, parallel description of the F004's layout to keep in sync, because Chromium is printing
 * the exact markup the screen and the on-screen print button both use. `preferCSSPageSize` is what
 * lets the existing `@page { size: A4; margin: 14mm 12mm }` rule stay the one place page size is
 * decided, rather than this module repeating it as launch options that could drift from the CSS.
 *
 * One browser process, launched once and kept warm — a `chromium.launch()` per request would cost
 * several hundred milliseconds nobody asked to pay on every download. A crashed browser is
 * recreated on the next call rather than crashing the request that found it dead.
 */
export type PdfRenderer = {
  render(html: string): Promise<Buffer>;
  close(): Promise<void>;
};

export type PdfRendererConfig = {
  /**
   * The Chromium binary to launch, when the platform does not ship Playwright's own downloaded
   * one — the production container installs a system Chromium and points here rather than
   * bundling Playwright's, which Alpine's musl libc cannot run. Undefined locally, where
   * `npx playwright install chromium` has put Playwright's own build where it expects it.
   */
  executablePath?: string;
};

export function createPdfRenderer(config: PdfRendererConfig = {}): PdfRenderer {
  let browser: Browser | null = null;

  async function getBrowser(): Promise<Browser> {
    if (browser !== null && browser.isConnected()) return browser;
    browser = await chromium.launch({
      headless: true,
      executablePath: config.executablePath,
      // The container runs as the unprivileged `node` user (see docker/Dockerfile), where
      // Chromium's own sandbox cannot set up its usual namespaces and refuses to start at all.
      // Only passed when a system Chromium was configured — the developer's own Playwright-
      // installed build runs unsandboxed under the ordinary desktop user just fine.
      args: config.executablePath === undefined ? [] : ["--no-sandbox"],
    });
    return browser;
  }

  return {
    async render(html: string): Promise<Buffer> {
      const page = await (await getBrowser()).newPage();
      try {
        await page.setContent(html, { waitUntil: "load" });
        // The stylesheets are read straight off disk rather than fetched over HTTP: the page was
        // never navigated to a URL, so there is no origin for a relative <link> to resolve
        // against, and there is no reason to round-trip through the app's own HTTP server to read
        // files already sitting beside this process. Two files, not one — `base.css` for the
        // tokens and primitives every `.f4-*`/`.fd-*` rule in `case.css` builds on, `case.css` for
        // the F004/Final-document rules themselves — mirroring exactly what `FinalDocumentPrintPage`
        // asks `Layout` to load when a browser reaches it directly.
        await page.addStyleTag({ path: assetsPath("css/base.css") });
        await page.addStyleTag({ path: assetsPath("css/case.css") });
        await page.emulateMedia({ media: "print" });
        const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true });
        return Buffer.from(pdf);
      } finally {
        await page.close();
      }
    },

    async close(): Promise<void> {
      if (browser !== null) {
        await browser.close();
        browser = null;
      }
    },
  };
}

const here = path.dirname(fileURLToPath(import.meta.url));
/** Resolves to <project>/public from both src (tsx) and dist (node) — mirrors server.ts's own. */
function assetsPath(file: string): string {
  return path.join(here, "..", "..", "public", file);
}

declare module "fastify" {
  interface FastifyInstance {
    pdf: PdfRenderer;
  }
}
