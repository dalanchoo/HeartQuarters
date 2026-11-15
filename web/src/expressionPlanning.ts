import type { ExpressionCategory } from './api';

const KEY = 'hq-expression-reference-photos';
export function readReferences(storage: Pick<Storage, 'getItem'>): string[] {
  try { const value: unknown = JSON.parse(storage.getItem(KEY) ?? '[]'); return Array.isArray(value) ? [...new Set(value.filter((p): p is string => typeof p === 'string'))] : []; } catch { return []; }
}
export function saveReferences(storage: Pick<Storage, 'setItem'>, paths: string[]): void { storage.setItem(KEY, JSON.stringify([...new Set(paths)])); }

/** A starting suggestion, not an assessment of whether existing photos are good. */
export function suggestedCategories(categories: ExpressionCategory[]): ExpressionCategory[] {
  const useful = /^(curiosity|confusion|skepticism|concern|surprise|thinking|joy|sadness|confidence|disbelief|frustration|warmth)$/i;
  const parents = new Set(categories.map((c) => c.parent));
  return categories.filter((c) => c.path && !parents.has(c.path) && useful.test(c.name) && c.ownCount < 5)
    .sort((a, b) => a.ownCount - b.ownCount || a.name.localeCompare(b.name)).slice(0, 12);
}
