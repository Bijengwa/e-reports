/**
 * Icon-only controls shared across the F004 document surfaces: the compact document header
 * (back/download/print) and the reference drawer (close).
 *
 * Stroke icons on the same `viewBox="0 0 24 24"` convention `shell.tsx`'s rail icons use, so a
 * document header reads as part of the same system as the rail beside it.
 */

export function IconBack(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M14 5l-7 7 7 7" />
      <path d="M7 12h13" />
    </svg>
  );
}

export function IconDownload(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 3v13" />
      <path d="M7 11.5l5 5 5-5" />
      <path d="M4 19.5h16" />
    </svg>
  );
}

export function IconPrint(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6 8.5V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v4.5" />
      <rect x="3" y="8.5" width="18" height="8" rx="1.5" />
      <path d="M6 15.5h12V21a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-5.5z" />
    </svg>
  );
}

export function IconClose(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  );
}
