import { parseFields } from './packaging';

/** A readable list of fields changed in a draft, including fields added or removed. */
export function changedPackagingFields(before: string, after: string): string[] {
  const a = parseFields(before) ?? [];
  const b = parseFields(after) ?? [];
  const labels = [...a.map(f => f.label), ...b.map(f => f.label)].filter((label, i, all) => all.findIndex(x => x.toLowerCase() === label.toLowerCase()) === i);
  return labels.filter(label => a.find(f => f.label.toLowerCase() === label.toLowerCase())?.value !== b.find(f => f.label.toLowerCase() === label.toLowerCase())?.value);
}

/** Refuse to overwrite a destination that changed after editing began. */
export function applyStagedText(current: string, baseline: string, draft: string): string {
  if (current !== baseline) throw new Error('This local file changed since you started editing. Reload and review it before applying.');
  return draft;
}
