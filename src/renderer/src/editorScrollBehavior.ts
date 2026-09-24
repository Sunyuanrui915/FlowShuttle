import type { Transaction } from "@tiptap/pm/state";
import { ReplaceAroundStep } from "@tiptap/pm/transform";

/** A checkbox changes task metadata without moving the text selection. */
export function isTaskCheckboxToggle(transaction: Transaction): boolean {
  if (transaction.steps.length !== 1 || !(transaction.steps[0] instanceof ReplaceAroundStep)) {
    return false;
  }

  const position = transaction.before.content.findDiffStart(transaction.doc.content);
  if (position === null) {
    return false;
  }

  const previous = transaction.before.nodeAt(position);
  const current = transaction.doc.nodeAt(position);
  if (
    previous?.type.name !== "taskItem" ||
    current?.type !== previous.type ||
    typeof previous.attrs.checked !== "boolean" ||
    previous.attrs.checked === current.attrs.checked
  ) {
    return false;
  }

  const end = transaction.before.content.findDiffEnd(transaction.doc.content);
  if (
    !end ||
    end.a !== position + previous.nodeSize ||
    end.b !== position + current.nodeSize
  ) {
    return false;
  }

  return previous.type.create(
    { ...previous.attrs, checked: current.attrs.checked },
    previous.content,
    previous.marks
  ).eq(current);
}
