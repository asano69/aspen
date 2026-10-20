import {
  EditorState,
  type Extension,
  type Text,
  type Transaction,
} from "@codemirror/state";
import { isBlankLine } from "../../parser/cardpod/indent";
import { isUserTransaction } from "../../userEdit";

// Whether `doc` needs a blank line appended: its last line holds text. The
// first line is the card's title (see parser/cardpod/rules/title.ts) and is
// never extended: adding a line right after the first keystroke would count
// as confirming the title (see titleCandidatePlugin.ts's headerJustCommitted).
export function needsTrailingLine(doc: Text): boolean {
  return doc.lines > 1 && !isBlankLine(doc.line(doc.lines).text);
}

// Whether `tr` inserted text into the last line of the new document. Pure
// deletions never count, so the user can remove the blank line again with
// Backspace or Delete.
function insertedIntoLastLine(tr: Transaction): boolean {
  const lastLineFrom = tr.newDoc.line(tr.newDoc.lines).from;
  let inserted = false;
  tr.changes.iterChanges((_fromA, _toA, _fromB, toB, text) => {
    if (text.length > 0 && toB >= lastLineFrom) inserted = true;
  });
  return inserted;
}

// Adds a blank line below the last line when the user types into it, so
// there is an empty line to continue writing on. The newline is added to the
// very transaction of the user's edit, so y-codemirror.next sends both to the
// Y.Text at once. Remote and synthetic transactions are left alone: a change
// added to them would exist in the editor only, not in the Y.Text.
export const trailingBlankLine: Extension = EditorState.transactionFilter.of(
  (tr) => {
    if (
      !isUserTransaction(tr) ||
      !needsTrailingLine(tr.newDoc) ||
      !insertedIntoLastLine(tr)
    ) {
      return tr;
    }
    return [
      tr,
      { changes: { from: tr.newDoc.length, insert: "\n" }, sequential: true },
    ];
  },
);
