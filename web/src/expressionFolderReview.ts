import type { ExpressionCategory, ExpressionPhoto, Tag } from './api';
import { groupExpressionAttributes } from './expressionAttributes';

const key = (value: string) => value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '');

export type FolderReviewMode = 'missing' | 'higher';

/** These comparisons describe recorded labels; they do not decide which folder is correct. */
export function reviewExpressionFolder(photo: ExpressionPhoto, categoryNames: Set<string>, mode: FolderReviewMode): { folder: string; alternatives: Tag[]; folderTag?: Tag } | null {
  const folder = photo.category.split('/').filter(Boolean).at(-1);
  if (!folder || !categoryNames.has(key(folder))) return null;
  const expressions = groupExpressionAttributes(photo.tags).expressions.filter(tag => categoryNames.has(key(tag.tag)));
  const folderTag = expressions.find(tag => key(tag.tag) === key(folder));
  if ((mode === 'missing' && folderTag) || (mode === 'higher' && (!folderTag || folderTag.confidence === null))) return null;
  const alternatives = expressions.filter(tag => key(tag.tag) !== key(folder) && (mode === 'missing' || (tag.confidence !== null && folderTag?.confidence !== null && folderTag !== undefined && tag.confidence > folderTag.confidence)))
    .sort((a, b) => (b.confidence ?? -1) - (a.confidence ?? -1));
  return alternatives.length ? { folder, alternatives, folderTag } : null;
}

export function expressionCategoryNames(categories: ExpressionCategory[]): Set<string> {
  return new Set(categories.filter(c => c.path).map(c => key(c.name)));
}
