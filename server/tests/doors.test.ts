import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Config } from "../src/config.js";
import { loadConfig, publicOrigin } from "../src/config.js";
import { buildServer } from "../src/server.js";

const config: Config = Object.freeze({
  NODE_ENV: "test",
  LOG_LEVEL: "fatal",
  HOST: "127.0.0.1",
  PORT: 3000,
  PUBLIC_HOST: "public.test",
  STAFF_HOST: "staff.test",
  // Never connected to: postgres.js is lazy and no route in this slice queries.
  DATABASE_URL: "postgres://ereports:ereports@localhost:5432/ereports_test",
  // Rooted outside the project so a test that does upload something cannot litter the repo.
  STORAGE_DRIVER: "filesystem",
  STORAGE_ROOT: path.join(os.tmpdir(), "e-reports-test-storage"),
  MAX_UPLOAD_MB: 10,
  SESSION_IDLE_MINUTES: 30,
  SESSION_ABSOLUTE_HOURS: 12,
} satisfies Config);

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildServer(config);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("door isolation", () => {
  it("serves step 1 of the orange form on the public host", async () => {
    const res = await app.inject({ url: "/", headers: { host: config.PUBLIC_HOST } });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Medical Device Adverse Event Report");
    // The step-1 field set, so a regression that renders the wrong step is caught.
    expect(res.body).toContain('name="device_name"');
  });

  it("serves staff sign-in on the staff host", async () => {
    const res = await app.inject({ url: "/", headers: { host: config.STAFF_HOST } });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("TMDA Staff Portal");
  });

  it("points the staff login across to the public door by absolute origin", async () => {
    const res = await app.inject({ url: "/", headers: { host: config.STAFF_HOST } });

    // Relative would keep the reporter on the staff hostname, so the origin must be spelled out.
    expect(res.body).toContain(`href="http://${config.PUBLIC_HOST}"`);
  });

  it("does not leak the orange form onto the staff host", async () => {
    const res = await app.inject({ url: "/", headers: { host: config.STAFF_HOST } });

    expect(res.body).not.toContain('name="device_name"');
  });

  it("does not leak the sign-in form onto the public host", async () => {
    const res = await app.inject({ url: "/", headers: { host: config.PUBLIC_HOST } });

    expect(res.body).not.toContain('name="password"');
  });

  it("answers nothing at all on an unknown host", async () => {
    const res = await app.inject({ url: "/", headers: { host: "somewhere.else" } });

    expect(res.statusCode).toBe(404);
  });

  it("scopes health probes to their own door", async () => {
    const publicProbe = await app.inject({
      url: "/healthz",
      headers: { host: config.PUBLIC_HOST },
    });
    const staffProbe = await app.inject({ url: "/healthz", headers: { host: config.STAFF_HOST } });

    expect(publicProbe.json()).toEqual({ status: "ok", door: "public" });
    expect(staffProbe.json()).toEqual({ status: "ok", door: "staff" });
  });
});

describe("orange form wizard", () => {
  /** Submit the form the way a browser would, with no JavaScript involved. */
  async function post(fields: Record<string, string | string[]>) {
    const body = new URLSearchParams();
    for (const [name, value] of Object.entries(fields)) {
      for (const single of Array.isArray(value) ? value : [value]) body.append(name, single);
    }

    return app.inject({
      method: "POST",
      url: "/orange-form",
      headers: {
        host: config.PUBLIC_HOST,
        "content-type": "application/x-www-form-urlencoded",
      },
      payload: body.toString(),
    });
  }

  /** The step number the strip marks as current. The tabs are buttons, so the reporter can jump. */
  function currentStep(html: string): string | undefined {
    return /<li class="on"><button[^>]*><span class="num">(\d)/.exec(html)?.[1];
  }

  /** Enough of step 1 to get past it. */
  const step1 = { device_name: "Infusion Pump X" };

  it("moves forward a step on Continue", async () => {
    const res = await post({ step: "1", action: "next", device_name: "Infusion Pump X" });

    expect(currentStep(res.body)).toBe("2");
    expect(res.body).toContain('name="incident_narrative"');
  });

  it("carries answers from other steps as hidden inputs", async () => {
    const res = await post({ step: "1", action: "next", device_name: "Infusion Pump X" });

    expect(res.body).toContain('type="hidden" name="device_name" value="Infusion Pump X"');
  });

  it("goes back without discarding what was typed further on", async () => {
    const res = await post({
      step: "2",
      action: "back",
      device_name: "Infusion Pump X",
      source: "Hospital",
      incident_date: "2026-08-01",
    });

    expect(currentStep(res.body)).toBe("1");
    // Step 1 is on screen, so its answers come back as real values, not hidden inputs.
    expect(res.body).toContain('name="device_name" required value="Infusion Pump X"');
    expect(res.body).toContain('value="Hospital" checked');
    // The step-2 answer is not on screen but must survive the round trip.
    expect(res.body).toContain('name="incident_date" value="2026-08-01"');
  });

  it("keeps every box ticked in a checkbox group", async () => {
    const res = await post({
      step: "2",
      action: "next",
      incident_type: ["Malfunction", "Deterioration"],
    });

    expect(res.body).toContain('name="incident_type" value="Malfunction"');
    expect(res.body).toContain('name="incident_type" value="Deterioration"');
  });

  it("clamps a tampered step number into range instead of trusting it", async () => {
    const forward = await post({ step: "99", action: "next", ...step1 });
    const backward = await post({ step: "-4", action: "back" });

    expect(forward.statusCode).toBe(200);
    // 99 is not a step, so it is read as the first one and Continue moves on from there.
    expect(currentStep(forward.body)).toBe("2");
    // Back from the first step cannot go below it.
    expect(currentStep(backward.body)).toBe("1");
  });

  it("refuses an incomplete submission instead of filing it", async () => {
    const res = await post({ step: "5", action: "submit", reporter_name: "A. Mwita" });

    // No report number may be shown for a report that was not stored — a reporter must never be
    // told their device failure was filed when it was not.
    expect(res.statusCode).toBe(422);
    expect(res.body).not.toContain("confirm-num");
    expect(res.body).toContain("This step is not complete yet");
    // Whatever they had already typed survives the rejection.
    expect(res.body).toContain('value="A. Mwita"');
  });

  it("will not move on from a step whose required fields are empty", async () => {
    // The browser's `required` is a convenience for the reporter, never a guarantee to us:
    // nothing stops a client posting straight here with the field missing.
    const res = await post({ step: "1", action: "next" });

    expect(res.statusCode).toBe(422);
    expect(currentStep(res.body)).toBe("1");
    expect(res.body).toContain(
      "Full name of the medical device or in vitro diagnostic is required",
    );
  });

  it("sends the reporter back to the first unfinished step, not the last one", async () => {
    // Submitting from step 5 with step 2 still blank must land them on step 2.
    const res = await post({
      step: "5",
      action: "submit",
      ...step1,
      reporter_name: "A. Mwita",
      facility_address: "Muhimbili National Hospital",
      location: "Dar es Salaam",
      phone: "712345678",
      report_date: "2026-08-02",
      device_location: "Biomedical workshop",
    });

    expect(res.statusCode).toBe(422);
    expect(currentStep(res.body)).toBe("2");
  });

  it("lets a reporter jump back to an earlier step but not skip ahead", async () => {
    const back = await post({ step: "3", action: "goto:1", ...step1 });
    const skip = await post({ step: "1", action: "goto:5", ...step1 });

    // Going back to re-read or correct something is never blocked.
    expect(back.statusCode).toBe(200);
    expect(currentStep(back.body)).toBe("1");

    // Skipping ahead over an unfinished step 2 is.
    expect(skip.statusCode).toBe(422);
    expect(currentStep(skip.body)).toBe("2");
  });

  it("requires the date only once the supplier has actually been informed", async () => {
    const answered = { step: "4", action: "next", measures_taken: "Set it aside" };

    const saidNo = await post({ ...answered, informed_supplier: "No" });
    const saidYes = await post({ ...answered, informed_supplier: "Yes" });

    expect(saidNo.statusCode).toBe(200);
    expect(saidYes.statusCode).toBe(422);
    expect(saidYes.body).toContain("Date you informed them is required");
  });

  it("drops an explanation whose option is no longer chosen", async () => {
    // Ticking "Other", typing a reason, then switching to Malfunction must not file the reason.
    const res = await post({
      step: "2",
      action: "next",
      incident_date: "2026-08-01",
      incident_type: "Malfunction",
      incident_type_other: "left over from a previous answer",
      incident_narrative: "Pump stopped mid-infusion.",
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain("left over from a previous answer");
  });

  it("switches language without throwing the half-filled report away", async () => {
    const res = await post({ step: "1", action: "lang:sw", ...step1 });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('lang="sw"');
    expect(res.body).toContain("Jina kamili la kifaa tiba");
    // The answer survives the switch.
    expect(res.body).toContain('value="Infusion Pump X"');
  });

  it("shows the nine national digits, not whatever shape the number arrived in", async () => {
    const res = await post({
      step: "4",
      action: "next",
      measures_taken: "Set it aside",
      informed_supplier: "No",
      phone: "0712 345 678",
    });

    // The trunk 0 and the spacing are stripped for display, so the box beside the fixed +255
    // always holds exactly the nine national digits however the reporter pasted them.
    expect(res.body).toContain('value="712345678"');
    expect(res.body).toContain('<span class="phone-cc" aria-hidden="true">+255</span>');
  });

  it("keeps document-control metadata out of the reporter's way", async () => {
    const res = await app.inject({ url: "/", headers: { host: config.PUBLIC_HOST } });

    // Still recorded, but in the footer rather than the opening sentence.
    expect(res.body).toContain("TMDA/DMD/MDV/F/001 Rev 06");
    expect(res.body).toMatch(/<footer class="ofoot">[\s\S]*TMDA\/DMD\/MDV\/F\/001 Rev 06/);
    expect(res.body).not.toMatch(/<div class="obanner">[^<]*TMDA\/DMD/);
  });

  it("escapes reporter input on the way back out", async () => {
    const res = await post({
      step: "1",
      action: "next",
      device_name: '" autofocus onfocus="alert(1)',
    });

    expect(res.body).not.toContain('value="" autofocus onfocus="');
    expect(res.body).toContain("&#34;");
  });
});

describe("staff sign-in", () => {
  /** Post the form the way a browser would, with no JavaScript involved. */
  async function signIn(fields: Record<string, string>) {
    return app.inject({
      method: "POST",
      url: "/login",
      headers: {
        host: config.STAFF_HOST,
        "content-type": "application/x-www-form-urlencoded",
      },
      payload: new URLSearchParams(fields).toString(),
    });
  }

  // Every case here omits either the address or the password, so the shape check answers before
  // the first query. That is what keeps this suite runnable without a database; sign-in against
  // real rows is tests/integration/staff-login.test.ts.
  it("rejects a submission with no password before it reaches the database", async () => {
    const res = await signIn({ email: "a@tmda.go.tz" });

    expect(res.statusCode).toBe(400);
    expect(res.body).toContain("Email or password is incorrect");
  });

  it("never echoes the submitted password back onto the page", async () => {
    const res = await signIn({ email: "", password: "hunter2" });

    expect(res.body).not.toContain("hunter2");
  });

  it("says the same thing however the credentials are malformed", async () => {
    // Distinguishing "no such account" from "wrong password" hands an attacker a list of real
    // staff addresses. Both malformed shapes must produce one sentence.
    const missingPassword = await signIn({ email: "a@tmda.go.tz" });
    const missingEmail = await signIn({ password: "hunter2" });

    expect(missingPassword.body).toContain("Email or password is incorrect");
    expect(missingEmail.body).toContain("Email or password is incorrect");
  });
});

describe("sign-in rate limiting", () => {
  /** Posts only the address, so the shape check answers before any query. */
  function attempt(email: string) {
    return app.inject({
      method: "POST",
      url: "/login",
      headers: {
        host: config.STAFF_HOST,
        "content-type": "application/x-www-form-urlencoded",
      },
      payload: new URLSearchParams({ email }).toString(),
    });
  }

  it("stops answering after ten attempts on one address from one place", async () => {
    const answers = [];
    for (let n = 0; n < 11; n += 1) answers.push(await attempt("target@tmda.go.tz"));

    expect(answers[9]?.statusCode).toBe(400);
    expect(answers[10]?.statusCode).toBe(429);
  });

  it("counts a different address separately", async () => {
    // Keyed on the address as well as the IP, so one person fumbling their password cannot lock
    // out everyone else behind the same office NAT.
    expect((await attempt("someone-else@tmda.go.tz")).statusCode).toBe(400);
  });

  it("normalizes the address, so casing cannot buy a second bucket", async () => {
    for (let n = 0; n < 10; n += 1) await attempt("shared@tmda.go.tz");

    // Same account, different spelling. It must land in the bucket that is already full.
    expect((await attempt("  Shared@TMDA.go.tz  ")).statusCode).toBe(429);
  });

  it("does not disturb the limit the orange form already has", async () => {
    // The public door registers its own rate limit, 30 a minute, because it is the
    // unauthenticated door. The sign-in limit is registered in the staff door's scope rather
    // than at the root precisely so it cannot reach across and replace that one.
    const form = await app.inject({
      method: "POST",
      url: "/orange-form",
      headers: {
        host: config.PUBLIC_HOST,
        "content-type": "application/x-www-form-urlencoded",
      },
      payload: new URLSearchParams({
        step: "1",
        action: "next",
        device_name: "Infusion Pump X",
      }).toString(),
    });

    expect(form.headers["x-ratelimit-limit"]).toBe("30");
  });

  it("applies the stricter limit to sign-in and nothing else", async () => {
    const signIn = await attempt("header-check@tmda.go.tz");
    const loginPage = await app.inject({ url: "/", headers: { host: config.STAFF_HOST } });

    expect(signIn.headers["x-ratelimit-limit"]).toBe("10");
    // global:false — the sign-in page itself is not a credential check and carries no limit.
    expect(loginPage.headers["x-ratelimit-limit"]).toBeUndefined();
  });
});

describe("the staff door's authenticated area", () => {
  // These run without a database: with no cookie present the guard redirects before it would
  // query. Signed-in behaviour is tests/integration/staff-login.test.ts.
  it("sends an unsigned-in visitor to the sign-in page", async () => {
    const res = await app.inject({ url: "/dashboard", headers: { host: config.STAFF_HOST } });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/");
  });

  it("guards the forced password change too — it is not an anonymous page", async () => {
    const res = await app.inject({
      url: "/change-password",
      headers: { host: config.STAFF_HOST },
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/");
  });

  it("keeps the authenticated area off the public host entirely", async () => {
    // Not a redirect to sign-in: on the public hostname these routes must not exist at all.
    const res = await app.inject({ url: "/dashboard", headers: { host: config.PUBLIC_HOST } });

    expect(res.statusCode).toBe(404);
  });

  it("leaves the sign-in page itself reachable", async () => {
    const res = await app.inject({ url: "/", headers: { host: config.STAFF_HOST } });

    expect(res.statusCode).toBe(200);
  });
});

describe("configuration guards host isolation", () => {
  const base = {
    PUBLIC_HOST: "public.test",
    STAFF_HOST: "staff.test",
    DATABASE_URL: "postgres://u:p@localhost:5432/db",
  };

  it("refuses to start when both doors share a hostname", () => {
    expect(() => loadConfig({ ...base, STAFF_HOST: base.PUBLIC_HOST })).toThrow(/must differ/);
  });

  it("refuses to start without a database url", () => {
    expect(() => loadConfig({ PUBLIC_HOST: "a.test", STAFF_HOST: "b.test" })).toThrow(
      /DATABASE_URL/,
    );
  });

  it("accepts a well-formed environment", () => {
    expect(loadConfig(base).PORT).toBe(3000);
  });

  it("derives the public origin from the configured host", () => {
    expect(publicOrigin(loadConfig(base))).toBe("http://public.test");
  });

  it("assumes TLS for the public origin in production", () => {
    expect(publicOrigin(loadConfig({ ...base, NODE_ENV: "production" }))).toBe(
      "https://public.test",
    );
  });

  it("reads the session lifetimes from the environment", () => {
    const config = loadConfig({ ...base, SESSION_IDLE_MINUTES: "45", SESSION_ABSOLUTE_HOURS: "8" });

    expect(config.SESSION_IDLE_MINUTES).toBe(45);
    expect(config.SESSION_ABSOLUTE_HOURS).toBe(8);
  });

  it("falls back to the documented defaults", () => {
    expect(loadConfig(base).SESSION_IDLE_MINUTES).toBe(30);
    expect(loadConfig(base).SESSION_ABSOLUTE_HOURS).toBe(12);
  });

  it("refuses a session lifetime of zero", () => {
    // A zero idle window expires every session before its first request, which would look
    // exactly like a broken password check.
    expect(() => loadConfig({ ...base, SESSION_IDLE_MINUTES: "0" })).toThrow();
  });
});
