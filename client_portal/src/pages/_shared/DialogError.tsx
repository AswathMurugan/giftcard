/**
 * A validation message that stays put inside a dialog.
 *
 * `ErrorBox` from `@/components/fields` is a hover tooltip — it is `hidden`
 * until `group-hover` or `group-focus-within`. That works beside an input on a
 * wide form, where the field the user is typing in holds focus. It does NOT
 * work in a dialog: the user clicks the submit button, focus leaves the
 * group, and the message vanishes — leaving a red outline with no explanation
 * of what is wrong. Error by colour alone, which the field never recovers from
 * because the user has no reason to hover back over it.
 *
 * So dialogs render their message inline and persistently. Same `role="alert"`
 * and same `id` contract, so `aria-describedby` on the input still points at
 * real, readable text.
 */
export function DialogError({ id, message }: { id: string; message?: string | null }) {
  if (!message) return null;
  return (
    <p
      id={id}
      role="alert"
      className="rounded-md border border-danger-200 bg-danger-50 px-3 py-[0.4375rem] text-[12.5px] font-normal text-danger-600"
    >
      {message}
    </p>
  );
}

export default DialogError;
