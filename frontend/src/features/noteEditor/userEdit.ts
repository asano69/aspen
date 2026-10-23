import { Annotation, Transaction } from "@codemirror/state";
import type { ViewUpdate } from "@codemirror/view";

// Tags a transaction NoteEditor dispatches itself programmatically (seeding a
// brand-new draft's header, or handing a draft's text to the card editor), so
// hasUserEdit below does not count it as a real user edit.
export const syntheticAnnotation = Annotation.define<boolean>();

// Whether `tr` is an actual user edit -- excludes the synthetic transactions
// above and the remote updates @codemirror/collab applies (receiveUpdates tags
// them with Transaction.remote).
export function isUserTransaction(tr: Transaction): boolean {
  return (
    tr.docChanged &&
    tr.annotation(syntheticAnnotation) === undefined &&
    tr.annotation(Transaction.remote) !== true
  );
}

// Whether any transaction in `update` reflects an actual user edit.
export function hasUserEdit(update: ViewUpdate): boolean {
  return update.transactions.some(isUserTransaction);
}
