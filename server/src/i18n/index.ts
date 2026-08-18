/**
 * Every string the public door shows a reporter, in both languages.
 *
 * One flat table rather than per-view fragments: the orange form is a translation of a single
 * paper form, and a reviewer from TMDA has to be able to read the Swahili column top to bottom
 * without opening five files.
 *
 * IMPORTANT — the Swahili column is a working draft and has NOT been approved by TMDA. The form is
 * a regulatory instrument: a mistranslated question produces a wrong answer, and a wrong answer in
 * a vigilance report is a safety issue. Treat `sw` as placeholder copy until TMDA signs it off.
 * Nothing outside this file needs to change when they do.
 */

export const LOCALES = ["en", "sw"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/** Name of the cookie that remembers the reporter's choice between requests. */
export const LOCALE_COOKIE = "locale";

const messages = {
  // ---- Chrome ----------------------------------------------------------------
  "app.formTitle": { en: "Orange Form — AE Reports", sw: "Fomu ya Machungwa — AE Reports" },
  "app.confirmTitle": { en: "Report Submitted — AE Reports", sw: "Ripoti Imetumwa — AE Reports" },
  "app.heading": {
    en: "Medical Device Adverse Event Report",
    sw: "Ripoti ya Tukio Baya la Kifaa Tiba",
  },
  "lang.switchTo": { en: "Badili lugha: Kiswahili", sw: "Switch language: English" },

  "banner.official": {
    en: "This is the official TMDA form for reporting adverse events and incidents involving medical devices and in-vitro diagnostics.",
    sw: "Hii ni fomu rasmi ya TMDA ya kuripoti matukio mabaya yanayohusisha vifaa tiba na vitendanishi vya uchunguzi.",
  },
  "footer.formVersion": { en: "TMDA form reference", sw: "Kumbukumbu ya fomu ya TMDA" },
  "footer.privacy": {
    en: "Your report goes only to TMDA. Nothing on this page is shared with the manufacturer or supplier.",
    sw: "Ripoti yako inakwenda TMDA pekee. Hakuna taarifa inayoshirikishwa na mtengenezaji wala msambazaji.",
  },

  // ---- Steps -----------------------------------------------------------------
  "step.1": { en: "Device details", sw: "Taarifa za kifaa" },
  "step.2": { en: "Incident details", sw: "Taarifa za tukio" },
  "step.3": { en: "Event details", sw: "Taarifa za madhara" },
  "step.4": { en: "User / operator", sw: "Mtumiaji / mwendeshaji" },
  "step.5": { en: "Reporter details", sw: "Taarifa za mtoa taarifa" },
  "step.goto": { en: "Go to step", sw: "Nenda hatua ya" },

  // ---- Navigation ------------------------------------------------------------
  "nav.back": { en: "Back", sw: "Rudi" },
  "nav.continue": { en: "Continue", sw: "Endelea" },
  "nav.submit": { en: "Submit report", sw: "Wasilisha ripoti" },

  // ---- Validation ------------------------------------------------------------
  "error.heading": { en: "This step is not complete yet:", sw: "Hatua hii bado haijakamilika:" },
  "error.required": { en: "{label} is required", sw: "{label} inahitajika" },
  "error.phone": {
    en: "{label} must be nine digits starting with 7 or 6",
    sw: "{label} lazima iwe tarakimu tisa kuanzia 7 au 6",
  },
  "error.upload": {
    en: "{name} was not attached: only JPG, PNG and PDF up to {size} MB are accepted.",
    sw: "{name} haikuambatishwa: JPG, PNG na PDF pekee, hadi MB {size}.",
  },
  "error.notFiled": {
    en: "Your answers are still on this page, but TMDA's records could not be reached, so this report has NOT been filed. Please try again in a moment.",
    sw: "Majibu yako bado yapo kwenye ukurasa huu, lakini kumbukumbu za TMDA hazikufikika, hivyo ripoti hii HAIJAWASILISHWA. Tafadhali jaribu tena baada ya muda mfupi.",
  },

  // ---- Step 1: device --------------------------------------------------------
  "f.device_name": {
    en: "Full name of the medical device or in vitro diagnostic",
    sw: "Jina kamili la kifaa tiba au kitendanishi cha uchunguzi",
  },
  "f.device_name.ph": {
    en: "Exactly as written on the label",
    sw: "Kama kilivyoandikwa kwenye lebo",
  },
  "f.brand_name": { en: "Brand name", sw: "Jina la biashara" },
  "f.common_name": { en: "Common name", sw: "Jina linalojulikana" },
  "f.common_name.ph": { en: "e.g. infusion pump", sw: "mfano: pampu ya dripu" },
  "f.size": { en: "Size (if applicable)", sw: "Ukubwa (kama inahusika)" },
  "f.serial_number": { en: "Serial number", sw: "Namba ya kifaa (serial)" },
  "f.manufacturing_date": { en: "Manufacturing date", sw: "Tarehe ya kutengenezwa" },
  "f.batch_number": { en: "Batch number / lot number", sw: "Namba ya bechi / lot" },
  "f.expiry_date": { en: "Expiry date", sw: "Tarehe ya mwisho wa matumizi" },
  "f.manufacturer": {
    en: "Manufacturer's name and physical address",
    sw: "Jina na anwani ya mtengenezaji",
  },
  "f.source": { en: "Source of device", sw: "Chanzo cha kifaa" },
  "o.source.hospital": { en: "Hospital", sw: "Hospitali" },
  "o.source.pharmacy": { en: "Pharmacy / medical device outlet", sw: "Duka la dawa / vifaa tiba" },
  "o.source.diagnostic": { en: "Diagnostic centre", sw: "Kituo cha uchunguzi" },
  "o.source.other": { en: "Others", sw: "Nyingine" },
  "f.supplier": {
    en: "Name of the supplier and physical address (if known)",
    sw: "Jina na anwani ya msambazaji (kama unajua)",
  },
  "f.status": { en: "Status of the device", sw: "Hali ya kifaa" },
  "o.status.new": { en: "New device", sw: "Kifaa kipya" },
  "o.status.refurbished": { en: "Re-serviced / refurbished", sw: "Kilichofanyiwa marekebisho" },
  "f.duration": { en: "How long the device has been in use", sw: "Kifaa kimetumika kwa muda gani" },
  "o.duration.6m": { en: "Less than six (6) months", sw: "Chini ya miezi sita (6)" },
  "o.duration.1y": { en: "Less than one (1) year", sw: "Chini ya mwaka mmoja (1)" },
  "o.duration.1to5": { en: "1-5 years", sw: "Miaka 1-5" },
  "o.duration.other": { en: "Others", sw: "Nyingine" },
  "f.duration_other": { en: "If others, please explain", sw: "Kama nyingine, tafadhali eleza" },

  // ---- Step 2: incident ------------------------------------------------------
  "lead.incident": {
    en: "This section is about the device — what went wrong with it.",
    sw: "Sehemu hii inahusu kifaa — nini kilikwenda vibaya.",
  },
  "f.incident_date": { en: "Onset date of incident", sw: "Tarehe tukio lilipoanza" },
  "f.devices_involved": { en: "Number of devices involved", sw: "Idadi ya vifaa vilivyohusika" },
  "f.incident_type": {
    en: "Type of incident (device related)",
    sw: "Aina ya tukio (linalohusu kifaa)",
  },
  "o.incident.design": { en: "Inadequate design", sw: "Muundo usiotosheleza" },
  "o.incident.labeling": {
    en: "Inaccurate labeling / instruction for use",
    sw: "Lebo au maelekezo yasiyo sahihi",
  },
  "o.incident.malfunction": { en: "Malfunction", sw: "Kutofanya kazi ipasavyo" },
  "o.incident.deterioration": { en: "Deterioration", sw: "Kuharibika kwa ubora" },
  "o.other": { en: "Other", sw: "Nyingine" },
  "f.incident_type_other": {
    en: "If other, please give details",
    sw: "Kama nyingine, tafadhali eleza",
  },
  "f.incident_narrative": { en: "Incident narrative description", sw: "Maelezo ya tukio" },
  "f.incident_narrative.ph": {
    en: "Explain what went wrong with the device. Include the date, the time, who was present and what was noticed first.",
    sw: "Eleza nini kilikwenda vibaya kwenye kifaa. Taja tarehe, saa, waliokuwepo na kilichoonekana kwanza.",
  },

  // ---- Step 3: event ---------------------------------------------------------
  "lead.event": {
    en: "This section is about the person — what happened to the patient or the user.",
    sw: "Sehemu hii inahusu mtu — nini kilimtokea mgonjwa au mtumiaji.",
  },
  "f.event_date": { en: "Onset date of event", sw: "Tarehe madhara yalipoanza" },
  "f.users_involved": { en: "Number of users involved", sw: "Idadi ya watumiaji walioathirika" },
  "f.event_type": { en: "Type of event (user related)", sw: "Aina ya madhara (yanayomhusu mtu)" },
  "o.event.death": { en: "Death", sw: "Kifo" },
  "o.event.lifeThreatening": { en: "Life threatening", sw: "Hatari kwa maisha" },
  "o.event.malfunction": { en: "Malfunction", sw: "Kutofanya kazi ipasavyo" },
  "o.event.disability": {
    en: "Caused persistent disability or incapability",
    sw: "Kulisababisha ulemavu wa kudumu",
  },
  "o.event.hospitalization": {
    en: "Required or prolonged hospitalization",
    sw: "Kulazwa au kuongezeka kwa siku za kulazwa",
  },
  "f.event_type_other": {
    en: "If other, please give details",
    sw: "Kama nyingine, tafadhali eleza",
  },
  "f.event_narrative": { en: "Event narrative description", sw: "Maelezo ya madhara" },

  // ---- Step 4: user / operator ----------------------------------------------
  "f.operator": {
    en: "User or operator at the time of the event or incident",
    sw: "Mtumiaji au mwendeshaji wakati wa tukio",
  },
  "o.operator.hcp": { en: "Healthcare Providers", sw: "Mtoa huduma za afya" },
  "o.operator.engineer": { en: "Maintenance Engineer", sw: "Fundi wa matengenezo" },
  "f.operator_other": { en: "If other, please mention", sw: "Kama nyingine, tafadhali taja" },
  "f.measures_taken": {
    en: "Measures taken by the user or operator",
    sw: "Hatua zilizochukuliwa na mtumiaji au mwendeshaji",
  },
  "f.measures_taken.ph": {
    en: "e.g. stopped using it, kept it aside, switched to another one",
    sw: "mfano: kuacha kukitumia, kukitenga, kubadilisha kifaa kingine",
  },
  "f.measures_outcome": {
    en: "Outcome of the measures taken (if applicable)",
    sw: "Matokeo ya hatua zilizochukuliwa (kama inahusika)",
  },
  "f.informed_supplier": { en: "Have you informed the supplier?", sw: "Umemjulisha msambazaji?" },
  "o.yes": { en: "Yes", sw: "Ndiyo" },
  "o.no": { en: "No", sw: "Hapana" },
  "f.informed_date": { en: "Date you informed them", sw: "Tarehe uliyomjulisha" },
  "f.informed_date.hint": {
    en: "Required when you answered Yes.",
    sw: "Inahitajika kama umejibu Ndiyo.",
  },

  // ---- Step 5: reporter ------------------------------------------------------
  "f.reporter_name": { en: "Name or initials", sw: "Jina au herufi za jina" },
  "f.reporter_type": { en: "Are you a medical practitioner?", sw: "Wewe ni mtaalamu wa afya?" },
  "o.reporter.practitioner": { en: "Medical practitioner", sw: "Mtaalamu wa afya" },
  "f.facility_address": { en: "Physical address (facility)", sw: "Anwani ya kituo" },
  "f.location": { en: "District / region / city", sw: "Wilaya / mkoa / jiji" },
  "f.email": { en: "Email", sw: "Barua pepe" },
  "f.phone": { en: "Mobile phone", sw: "Namba ya simu" },
  "f.phone.hint": {
    en: "Enter the nine digits after +255, starting with 7 or 6. Leave out the first 0.",
    sw: "Andika tarakimu tisa baada ya +255, kuanzia 7 au 6. Acha sifuri ya mwanzo.",
  },
  "f.phone.sms": {
    en: "TMDA sends your report number by SMS.",
    sw: "TMDA hutuma namba ya ripoti kwa SMS.",
  },
  "f.report_date": { en: "Date of report", sw: "Tarehe ya ripoti" },
  "f.device_location": { en: "Current location of the device", sw: "Kifaa kilipo sasa" },
  "f.device_location.ph": {
    en: "e.g. sealed in the biomedical workshop",
    sw: "mfano: kimehifadhiwa karakana ya vifaa tiba",
  },
  "f.attachments": { en: "Attach photos or documents", sw: "Ambatisha picha au nyaraka" },
  "f.attachments.hint": {
    en: "Photos of the device, the label, the serial plate, and the instructions for use.",
    sw: "Picha za kifaa, lebo, bamba la namba, na maelekezo ya matumizi.",
  },
  "f.attachments.limits": {
    en: "Up to {count} files, {size} MB each. JPG, PNG or PDF.",
    sw: "Hadi faili {count}, kila moja MB {size}. JPG, PNG au PDF.",
  },
  "f.attachments.attached": { en: "Already attached", sw: "Zilizokwisha ambatishwa" },

  // ---- Confirmation ----------------------------------------------------------
  "done.eyebrow": { en: "Report received", sw: "Ripoti imepokelewa" },
  "done.lead": {
    en: "Thank you. Your report has been received by TMDA.",
    sw: "Asante. Ripoti yako imepokelewa na TMDA.",
  },
  "done.hint": {
    en: "You will also receive an SMS and email confirmation shortly.",
    sw: "Utapokea uthibitisho kwa SMS na barua pepe hivi karibuni.",
  },
  "done.keep": {
    en: "Keep this number. You will need it to ask TMDA about this report.",
    sw: "Hifadhi namba hii. Utaihitaji kuuliza TMDA kuhusu ripoti hii.",
  },
  "done.another": { en: "Submit another report", sw: "Wasilisha ripoti nyingine" },
} as const satisfies Record<string, Record<Locale, string>>;

export type MessageKey = keyof typeof messages;

/**
 * Look up one string.
 *
 * `vars` fills `{name}` placeholders. A missing key is a type error rather than a runtime
 * surprise, which is the whole reason the table is `as const`.
 */
export function t(
  locale: Locale,
  key: MessageKey,
  vars?: Readonly<Record<string, string | number>>,
): string {
  const entry: Record<Locale, string> = messages[key];
  let out: string = entry[locale] ?? entry[DEFAULT_LOCALE];

  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      out = out.replaceAll(`{${name}}`, String(value));
    }
  }

  return out;
}

/** Narrow arbitrary input — a cookie value, a form field — to a locale we actually ship. */
export function parseLocale(raw: unknown): Locale {
  return LOCALES.includes(raw as Locale) ? (raw as Locale) : DEFAULT_LOCALE;
}

/** The translator bound to one request, so views take `t("key")` rather than threading a locale. */
export type Translate = (
  key: MessageKey,
  vars?: Readonly<Record<string, string | number>>,
) => string;

export function translatorFor(locale: Locale): Translate {
  return (key, vars) => t(locale, key, vars);
}
