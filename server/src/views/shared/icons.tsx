/**
 * The portal's icon set, on one 24x24 grid.
 *
 * Geometry only: no `stroke`, no `stroke-width`, no size. Those live in `base.css` on `.ic`, so a
 * caller changes an icon's colour by changing the colour of the text beside it (`currentcolor`)
 * and its size by setting `--ic` in a stylesheet rule. The CSP forbids inline styles, so that is
 * not merely tidier — it is the only arrangement that works here.
 *
 * This module sits in `views/shared` rather than inside a door because both doors draw from it.
 * Each icon carries `ic-<name>` as well as `ic`, which is what the motion rules in `base.css`
 * hook onto: an icon that means a direction moves in that direction when its control is hovered.
 *
 * Icons are `aria-hidden` throughout. They sit beside a text label that already says what the
 * control does; an icon-only control names itself with `aria-label` on the control, not here.
 *
 * The shapes are the conventional ones on purpose — a tray for received, a triangle for danger, a
 * magnifier for search. An icon nobody has to learn is worth more than an original one.
 */

type IconProps = { readonly class?: string };

function cls(name: string, extra?: string): string {
  return extra ? `ic ic-${name} ${extra}` : `ic ic-${name}`;
}

/* ---------- navigation and chrome ---------- */

export function IconBack({ class: c }: IconProps = {}): JSX.Element {
  return (
    <svg class={cls("back", c)} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M14 5l-7 7 7 7" />
      <path d="M7 12h13" />
    </svg>
  );
}

export function IconArrowRight({ class: c }: IconProps = {}): JSX.Element {
  return (
    <svg class={cls("arrow-right", c)} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </svg>
  );
}

export function IconChevron({ class: c }: IconProps = {}): JSX.Element {
  return (
    <svg class={cls("chevron", c)} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function IconClose({ class: c }: IconProps = {}): JSX.Element {
  return (
    <svg class={cls("close", c)} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  );
}

export function IconDownload({ class: c }: IconProps = {}): JSX.Element {
  return (
    <svg class={cls("download", c)} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 3v13" />
      <path d="M7 11.5l5 5 5-5" />
      <path d="M4 19.5h16" />
    </svg>
  );
}

export function IconUpload({ class: c }: IconProps = {}): JSX.Element {
  return (
    <svg class={cls("upload", c)} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 16.5V4" />
      <path d="M7 9l5-5 5 5" />
      <path d="M4 19.5h16" />
    </svg>
  );
}

export function IconPrint({ class: c }: IconProps = {}): JSX.Element {
  return (
    <svg class={cls("print", c)} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path class="sheet" d="M6 8.5V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v4.5" />
      <rect x="3" y="8.5" width="18" height="8" rx="1.5" />
      <path d="M6 15.5h12V21a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-5.5z" />
    </svg>
  );
}

export function IconSearch({ class: c }: IconProps = {}): JSX.Element {
  return (
    <svg class={cls("search", c)} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0z" />
      <path d="M15.5 15.5L20 20" />
    </svg>
  );
}

/* ---------- actions ---------- */

export function IconCheck({ class: c }: IconProps = {}): JSX.Element {
  return (
    <svg class={cls("check", c)} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

export function IconPen({ class: c }: IconProps = {}): JSX.Element {
  return (
    <svg class={cls("pen", c)} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 20h4L19 9a2.83 2.83 0 0 0-4-4L4 16z" />
      <path d="M14.5 5.5l4 4" />
    </svg>
  );
}

export function IconSave({ class: c }: IconProps = {}): JSX.Element {
  return (
    <svg class={cls("save", c)} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 5a1 1 0 0 1 1-1h11l4 4v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
      <path d="M8 4v5h7V4" />
      <path d="M8 20v-6h8v6" />
    </svg>
  );
}

export function IconSend({ class: c }: IconProps = {}): JSX.Element {
  return (
    <svg class={cls("send", c)} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M21 3L3 10.5l7.5 3L13.5 21z" />
      <path d="M21 3l-10.5 10.5" />
    </svg>
  );
}

export function IconKey({ class: c }: IconProps = {}): JSX.Element {
  return (
    <svg class={cls("key", c)} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M11 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z" />
      <path d="M11 12h10" />
      <path d="M18 12v3.5" />
      <path d="M21 12v2.5" />
    </svg>
  );
}

export function IconSignOut({ class: c }: IconProps = {}): JSX.Element {
  return (
    <svg class={cls("sign-out", c)} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
      <path d="M9 16.5l4.5-4.5L9 7.5" />
      <path d="M13.5 12H3" />
    </svg>
  );
}

export function IconSignIn({ class: c }: IconProps = {}): JSX.Element {
  return (
    <svg class={cls("sign-in", c)} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" />
      <path d="M15.5 16.5L20 12l-4.5-4.5" />
      <path d="M20 12H9.5" />
    </svg>
  );
}

/* ---------- people ---------- */

export function IconUsers({ class: c }: IconProps = {}): JSX.Element {
  return (
    <svg class={cls("users", c)} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12.5 8.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" />
      <path d="M3 20v-1.5A4.5 4.5 0 0 1 7.5 14h1A4.5 4.5 0 0 1 13 18.5V20" />
      <path d="M16 5.5a3 3 0 0 1 0 6" />
      <path d="M17 14a4.5 4.5 0 0 1 4 4.5V20" />
    </svg>
  );
}

export function IconUserPlus({ class: c }: IconProps = {}): JSX.Element {
  return (
    <svg class={cls("user-plus", c)} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M13 8.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0z" />
      <path d="M3 20v-1.5A4.5 4.5 0 0 1 7.5 14h4a4.5 4.5 0 0 1 4.5 4.5V20" />
      <path d="M18.5 8v6" />
      <path d="M15.5 11h6" />
    </svg>
  );
}

export function IconUserCheck({ class: c }: IconProps = {}): JSX.Element {
  return (
    <svg class={cls("user-check", c)} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 8.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0z" />
      <path d="M2 20v-1.5A4.5 4.5 0 0 1 6.5 14h4a4.5 4.5 0 0 1 4.5 4.5V20" />
      <path d="M16.5 12.5l2 2 4-4" />
    </svg>
  );
}

/* ---------- documents and work ---------- */

export function IconFileText({ class: c }: IconProps = {}): JSX.Element {
  return (
    <svg class={cls("file-text", c)} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6" />
      <path d="M9 17h4" />
    </svg>
  );
}

export function IconFileCheck({ class: c }: IconProps = {}): JSX.Element {
  return (
    <svg class={cls("file-check", c)} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M8.5 15l2.5 2.5 4.5-4.5" />
    </svg>
  );
}

export function IconClipboardCheck({ class: c }: IconProps = {}): JSX.Element {
  return (
    <svg class={cls("clipboard-check", c)} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M9 4H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2" />
      <rect x="9" y="2.5" width="6" height="4" rx="1" />
      <path d="M8.5 14l2.5 2.5 4.5-4.5" />
    </svg>
  );
}

export function IconArchive({ class: c }: IconProps = {}): JSX.Element {
  return (
    <svg class={cls("archive", c)} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="3" y="4" width="18" height="4.5" rx="1" />
      <path d="M5 8.5V19a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8.5" />
      <path d="M10 12.5h4" />
    </svg>
  );
}

export function IconInbox({ class: c }: IconProps = {}): JSX.Element {
  return (
    <svg class={cls("inbox", c)} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M3 13.5h5l1.5 3h5l1.5-3h5" />
      <path d="M5.5 4.5h13l2.5 9V19a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5.5z" />
    </svg>
  );
}

export function IconBriefcase({ class: c }: IconProps = {}): JSX.Element {
  return (
    <svg class={cls("briefcase", c)} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="3" y="7.5" width="18" height="12" rx="2" />
      <path d="M9 7.5V5.5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5.5v2" />
      <path d="M3 12.5h18" />
    </svg>
  );
}

/* ---------- state ---------- */

export function IconClock({ class: c }: IconProps = {}): JSX.Element {
  return (
    <svg class={cls("clock", c)} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
      <path class="hand" d="M12 7v5.5l3.5 2" />
    </svg>
  );
}

export function IconCircle({ class: c }: IconProps = {}): JSX.Element {
  return (
    <svg class={cls("circle", c)} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
    </svg>
  );
}

export function IconAlertTriangle({ class: c }: IconProps = {}): JSX.Element {
  return (
    <svg class={cls("alert-triangle", c)} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M10.6 4.2a1.6 1.6 0 0 1 2.8 0l7.2 12.9a1.6 1.6 0 0 1-1.4 2.4H4.8a1.6 1.6 0 0 1-1.4-2.4z" />
      <path d="M12 9.5v4" />
      <path d="M12 16.5h.01" />
    </svg>
  );
}
