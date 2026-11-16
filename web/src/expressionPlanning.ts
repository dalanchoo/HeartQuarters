import type { ExpressionCategory } from './api';

const KEY = 'hq-expression-reference-photos';
export function readReferences(storage: Pick<Storage, 'getItem'>): string[] {
  try { const value: unknown = JSON.parse(storage.getItem(KEY) ?? '[]'); return Array.isArray(value) ? [...new Set(value.filter((p): p is string => typeof p === 'string'))] : []; } catch { return []; }
}
export function saveReferences(storage: Pick<Storage, 'setItem'>, paths: string[]): void { storage.setItem(KEY, JSON.stringify([...new Set(paths)])); }

/** Search the full category path so both category and parent names can be found. */
export function matchingDestinations(categories: ExpressionCategory[], current: string, query: string): ExpressionCategory[] {
  const term = query.trim().toLocaleLowerCase();
  return categories.filter(c => !!c.path && c.path !== current && c.path.toLocaleLowerCase().includes(term));
}

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
