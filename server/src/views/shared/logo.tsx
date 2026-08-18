/**
 * The application mark, taken from the prototype's `<template id="logo">`.
 *
 * A document behind a folder with a white cross on it: a report, filed, about a medical device.
 * The geometry is the prototype's unchanged — only the colours move, and they move in CSS rather
 * than here, so one mark serves the dark rail and the light sign-in card without a second copy of
 * the paths to keep in step.
 *
 * `role="img"` with a label, because to a screen reader this is the product's name rather than
 * four shapes.
 */
export function Logo(): JSX.Element {
  return (
    <svg class="logo" viewBox="0 0 512 512" role="img" aria-label="AE Reports">
      <path class="doc" d="M177 47h258a38 38 0 0 1 38 38v300a38 38 0 0 1-38 38h-14" />
      <rect class="tab" x="243" y="103" width="172" height="42" rx="9" />
      <path
        class="body"
        d="M39 213a58 58 0 0 1 58-58h81a24 24 0 0 1 17 7l45 45h130a58 58 0 0 1 58 58v142a58 58 0 0 1-58 58H97a58 58 0 0 1-58-58z"
      />
      <path class="cross" d="M195 285h48v56h56v48h-56v56h-48v-56h-56v-48h56z" />
    </svg>
  );
}
