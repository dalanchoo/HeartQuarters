import { parseFields, setFieldValue } from './packaging';

/** A readable list of fields changed in a draft, including fields added or removed. */
export function changedPackagingFields(before: string, after: string): string[] {
  const a = parseFields(before) ?? [];
  const b = parseFields(after) ?? [];
  const labels = [...a.map(f => f.label), ...b.map(f => f.label)].filter((label, i, all) => all.findIndex(x => x.toLowerCase() === label.toLowerCase()) === i);
  return labels.filter(label => a.find(f => f.label.toLowerCase() === label.toLowerCase())?.value !== b.find(f => f.label.toLowerCase() === label.toLowerCase())?.value);
}

/**
 * The fields you edited (between `baseline` and `draft`) whose value was also changed in `current`, the file as it is
 * now, to something else. These can't be merged: whichever is kept, one change would be lost.
 */
export function clashingFields(current: string, baseline: string, draft: string): string[] {
  if (current === baseline) return [];
  const value = (text: string, label: string) => parseFields(text)?.find(f => f.label.toLowerCase() === label.toLowerCase())?.value;
  return changedPackagingFields(baseline, draft).filter(label => value(current, label) !== value(baseline, label) && value(current, label) !== value(draft, label));
}

/**
 * Your edits applied to the file as it is now. When the file changed since you started editing, only the fields you
 * edited are put in; everything else keeps its newer value. Refuses when the same field changed in both places, or
 * when a field was added or removed, since then something would be lost.
 */
export function applyStagedText(current: string, baseline: string, draft: string): string {
  if (current === baseline) return draft;
  if (!parseFields(current) || !parseFields(baseline) || !parseFields(draft)) throw new Error('This file changed outside this page since you started editing, and it isn’t in the usual labeled format, so nothing was saved. Your edits are still here.');
  const clashes = clashingFields(current, baseline, draft);
  if (clashes.length) throw new Error(`${clashes.join(', ')} also changed outside this page since you started editing, so nothing was saved. Your edits are still here.`);
  let result = current;
  for (const label of changedPackagingFields(baseline, draft)) {
    const fields = parseFields(result);
    const mine = parseFields(draft)?.find(f => f.label.toLowerCase() === label.toLowerCase());
    const index = fields?.findIndex(f => f.label.toLowerCase() === label.toLowerCase()) ?? -1;
    if (!fields || !mine || index < 0) throw new Error(`${label} was added or removed while the file also changed outside this page, so nothing was saved. Your edits are still here.`);
    if (fields[index].value !== mine.value) result = setFieldValue(result, index, mine.value);
  }
  return result;
}

/** Allow cancelling a selected copy, but never select one that would replace an unsaved edit. */
export function canSelectIncomingCopy(edited: boolean, alreadySelected: boolean): boolean {
  return !edited || alreadySelected;
}
