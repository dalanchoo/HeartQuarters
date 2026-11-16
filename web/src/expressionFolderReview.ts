import type { ExpressionCategory, ExpressionPhoto, Tag } from './api';
import { groupExpressionAttributes } from './expressionAttributes';

const key = (value: string) => value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '');

/** Suggestions are not proof: only recorded expression labels are compared with the photo's folder. */
export function reviewExpressionFolder(photo: ExpressionPhoto, categoryNames: Set<string>): { folder: string; alternatives: Tag[]; folderTag?: Tag } | null {
  const folder = photo.category.split('/').filter(Boolean).at(-1);
  if (!folder || !categoryNames.has(key(folder))) return null;
  const expressions = groupExpressionAttributes(photo.tags).expressions.filter(tag => categoryNames.has(key(tag.tag)));
  const folderTag = expressions.find(tag => key(tag.tag) === key(folder));
  // A confirmed folder label is the owner's judgment, so don't override it with AI guesses.
  if (folderTag?.confirmed) return null;
  const alternatives = expressions.filter(tag => key(tag.tag) !== key(folder) && (tag.confirmed || !folderTag || (tag.confidence !== null && folderTag.confidence !== null && tag.confidence > folderTag.confidence)))
    .sort((a, b) => Number(b.confirmed) - Number(a.confirmed) || (b.confidence ?? -1) - (a.confidence ?? -1));
  return alternatives.length ? { folder, alternatives, folderTag } : null;
}

export function expressionCategoryNames(categories: ExpressionCategory[]): Set<string> {
  return new Set(categories.filter(c => c.path).map(c => key(c.name)));
}
