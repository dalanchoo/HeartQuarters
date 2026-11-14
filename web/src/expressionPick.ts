import type { ExpressionPhoto } from './api';

/**
 * The expressions-library categories a pick names, as folder paths: "Positive > Relief, Composure > Calm (a tired,
 * soft smile)" gives ["Positive/Relief", "Composure/Calm"]. Only "Category > Sub" names count; the words after are a
 * description.
 */
export function categoriesIn(expression: string): string[] {
  const found: string[] = [];
  for (const m of expression.matchAll(/([A-Z][A-Za-z]*(?: [A-Z][A-Za-z]*)*)\s*>\s*([A-Z][A-Za-z]*(?: [A-Z][A-Za-z]*)*)/g)) {
    const path = `${m[1]}/${m[2]}`;
    if (!found.includes(path)) found.push(path);
  }
  return found;
}

/** The photos in a category and its sub-categories. */
export function photosIn(photos: ExpressionPhoto[], category: string): ExpressionPhoto[] {
  const c = category.toLowerCase();
  return photos.filter((p) => p.category.toLowerCase() === c || p.category.toLowerCase().startsWith(c + '/'));
}
