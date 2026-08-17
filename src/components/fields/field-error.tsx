// Shared error/required affordances for form fields — a red "!" icon overlaid
// on an input, a hover/focus-revealed tinted callout, and the required "*"
// mark. Use these for EVERY field error treatment instead of improvising per
// control, so errors read identically across the app.
//
// Accessibility: the callout reveals on `group-focus-within` as well as hover
// (wrap the control + ErrorBox in the same `group relative` container), so
// keyboard users see the message when they focus the errored field;
// `role="alert"` announces it to screen readers the moment it becomes visible.
// Optional `id` lets a consumer point its input's `aria-describedby` at it.

/** Filled circle "!" indicator overlaid on an input-like field in error.
 *  Decorative — the message itself (ErrorBox) is the announced alert. */
export function ErrorIcon({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute right-[0.75rem] top-1/2 grid size-[1.125rem] -translate-y-1/2 place-content-center rounded-full bg-danger-600 text-[0.6875rem] font-bold leading-none text-white"
    >
      !
    </span>
  );
}

/** Hover/focus-revealed tinted error callout with an upward caret. `caretClass`
 *  positions the caret under the field's error indicator (further left for SSN,
 *  whose "!" sits left of the eye toggle). Message = helper-copy sizing
 *  (`text-sm`, 14px) at weight 400 — the red color + "!" icon already carry
 *  the emphasis (weight 500 is reserved for badges). */
export function ErrorBox({
  message,
  caretClass = 'right-[1rem]',
  id,
}: {
  message?: string;
  caretClass?: string;
  id?: string;
}) {
  if (!message) return null;
  return (
    <span
      id={id}
      role="alert"
      className="absolute left-0 right-0 top-full z-10 mt-[0.1875rem] hidden rounded-md border border-danger-200 bg-danger-50 px-3 py-[0.4375rem] text-sm font-normal text-danger-600 group-focus-within:block group-hover:block"
    >
      <span
        className={`absolute -top-[0.3125rem] size-[0.5625rem] rotate-45 border-l border-t border-danger-200 bg-danger-50 ${caretClass}`}
        aria-hidden="true"
      />
      {message}
    </span>
  );
}

/** Red required "*" for a field label (the label-side counterpart of the gold
 *  left-bar the Input draws for `required`). */
export function RequiredMark({ show = true }: { show?: boolean }) {
  if (!show) return null;
  return <span className="ml-0.5 text-danger-500">*</span>;
}
