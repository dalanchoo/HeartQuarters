import type { ExpressionCategory, ExpressionPhoto } from './api';

const KEY = 'hq-expression-reference-photos';
export type CategoryOption = { value: string; label: string; disabled?: boolean };
export function filterCategoryOptions(options: CategoryOption[], query: string): CategoryOption[] {
  const term = query.trim().toLocaleLowerCase();
  return options.filter(option => option.label.toLocaleLowerCase().includes(term));
}
export function nextCategoryIndex(options: CategoryOption[], current: number, direction: 1 | -1): number {
  for (let index = current + direction; index >= 0 && index < options.length; index += direction) if (!options[index].disabled) return index;
  return current >= 0 && current < options.length && !options[current].disabled ? current : -1;
}
export function readReferences(storage: Pick<Storage, 'getItem'>): string[] {
  try { const value: unknown = JSON.parse(storage.getItem(KEY) ?? '[]'); return Array.isArray(value) ? [...new Set(value.filter((p): p is string => typeof p === 'string'))] : []; } catch { return []; }
}
export function saveReferences(storage: Pick<Storage, 'setItem'>, paths: string[]): void { storage.setItem(KEY, JSON.stringify([...new Set(paths)])); }

export function generationCategories(categories: ExpressionCategory[]): ExpressionCategory[] {
  const parents = new Set(categories.map(c => c.parent));
  return categories.filter(c => !!c.path && !parents.has(c.path));
}

export function generationCategoryOnSwitch(categories: ExpressionCategory[], libraryPath: string, previous: string): string {
  return generationCategories(categories).some(c => c.path === libraryPath) ? libraryPath : previous;
}

export function readyCandidateCount(jobs: { state: string }[]): number {
  return jobs.filter(job => job.state === 'ready').length;
}

/** A starting suggestion, not an assessment of whether existing photos are good. */
export function suggestedCategories(categories: ExpressionCategory[]): ExpressionCategory[] {
  const useful = /^(curiosity|confusion|skepticism|concern|surprise|thinking|joy|sadness|confidence|disbelief|frustration|warmth)$/i;
  const parents = new Set(categories.map((c) => c.parent));
  return categories.filter((c) => c.path && !parents.has(c.path) && useful.test(c.name) && c.ownCount < 5)
    .sort((a, b) => a.ownCount - b.ownCount || a.name.localeCompare(b.name)).slice(0, 12);
}

export function filterSelectablePhotos(photos: ExpressionPhoto[], stars: string[], filter: { scope: 'starred' | 'all'; category: string; query: string; attribute?: string }): ExpressionPhoto[] {
  const normalize = (value: string) => value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '').replace(/lookingoffcamera/g, 'lookoffcamera').replace(/lookingatcamera/g, 'lookatcamera');
  const term = normalize(filter.query); const starred = new Set(stars);
  return photos.filter(photo => (filter.scope === 'all' || starred.has(photo.path)) && (!filter.attribute || photo.tags.some(tag => tag.tag === filter.attribute)) && (filter.category === '*' || photo.category === filter.category || photo.category.startsWith(filter.category + '/')) && normalize([photo.name, photo.category, ...photo.tags.map(t => t.tag)].join(' ')).includes(term));
}
