import { useSyncExternalStore } from 'react';
import type { AiWritingSuggestion } from '../../server/ai-writing';

// The AI writing check's rewrites for each field, so the field's edit box can underline them where you type.
// Keyed by the file and field label ("…/YouTube.md|Description"). Kept only in this page.
const lists = new Map<string, AiWritingSuggestion[]>();
const listeners = new Set<() => void>();
const NONE: AiWritingSuggestion[] = [];

export function fieldKey(file: string, label: string): string {
  return `${file}|${label.toLowerCase()}`;
}

export function setFieldSuggestions(key: string, suggestions: AiWritingSuggestion[]): void {
  if (suggestions.length) lists.set(key, suggestions);
  else lists.delete(key);
  listeners.forEach((listener) => listener());
}

/** Drops one rewrite (used or dismissed), leaving the others underlined. */
export function dropFieldSuggestion(key: string, suggestion: AiWritingSuggestion): void {
  setFieldSuggestions(key, (lists.get(key) ?? []).filter((s) => s !== suggestion));
}

export function useFieldSuggestions(key: string | undefined): AiWritingSuggestion[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => (key ? lists.get(key) ?? NONE : NONE),
  );
}
