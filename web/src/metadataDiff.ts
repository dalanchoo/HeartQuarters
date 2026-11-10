import type { SyncField } from './youtubePackaging';

export interface DiffPart { text: string; changed: boolean }
export interface MetadataDiff { left: DiffPart[]; right: DiffPart[]; same: boolean; reordered: boolean; limited: boolean }
const plain = (text: string): DiffPart[] => [{ text, changed: false }];
const tagKey = (value: string) => value.trim().toLocaleLowerCase();
const tags = (value: string) => value.split(',').map((tag) => tag.trim()).filter(Boolean);

/** Compare tags as a set: YouTube can return the same tags in a different order. */
function compareTags(left: string, right: string): MetadataDiff {
  const a = tags(left); const b = tags(right);
  const aSet = new Set(a.map(tagKey)); const bSet = new Set(b.map(tagKey));
  const same = aSet.size === bSet.size && [...aSet].every((tag) => bSet.has(tag));
  const pieces = (values: string[], other: Set<string>) => values.flatMap((tag, i) => [ ...(i ? [{ text: ', ', changed: false }] : []), { text: tag, changed: !other.has(tagKey(tag)) } ]);
  return { left: pieces(a, bSet), right: pieces(b, aSet), same, reordered: same && a.map(tagKey).join('\0') !== b.map(tagKey).join('\0'), limited: false };
}

/** Highlight word and punctuation changes while preserving the text on both sides. */
export function metadataDiff(field: SyncField, left: string, right: string): MetadataDiff {
  if (field === 'Tags') return compareTags(left, right);
  if (left === right) return { left: plain(left), right: plain(right), same: true, reordered: false, limited: false };
  const tokenize = (text: string) => text.match(/\s+|[\p{L}\p{N}]+|[^\s\p{L}\p{N}]+/gu) ?? [];
  const a = tokenize(left); const b = tokenize(right);
  if ((a.length + 1) * (b.length + 1) > 500_000) return { left: [{ text: left, changed: true }], right: [{ text: right, changed: true }], same: false, reordered: false, limited: true };
  const cols = b.length + 1; const table = new Uint16Array((a.length + 1) * cols);
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) table[i * cols + j] = a[i] === b[j] ? table[(i + 1) * cols + j + 1] + 1 : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1]);
  const leftParts: DiffPart[] = []; const rightParts: DiffPart[] = [];
  const append = (parts: DiffPart[], text: string, changed: boolean) => { const last = parts.at(-1); if (last?.changed === changed) last.text += text; else parts.push({ text, changed }); };
  let i = 0; let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { append(leftParts, a[i++], false); append(rightParts, b[j++], false); }
    else if (table[(i + 1) * cols + j] >= table[i * cols + j + 1]) append(leftParts, a[i++], true);
    else append(rightParts, b[j++], true);
  }
  while (i < a.length) append(leftParts, a[i++], true);
  while (j < b.length) append(rightParts, b[j++], true);
  return { left: leftParts, right: rightParts, same: false, reordered: false, limited: false };
}
