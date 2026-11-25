import { useState } from 'react';
import type { AiId } from './api';

// Choosing an AI for one button. Each button remembers its own last choice in this browser (a convenience only:
// losing it just means picking again), so there is no app-wide AI setting.

export const AI_OPTIONS: { id: AiId; name: string }[] = [
  { id: 'claude', name: 'Claude' },
  { id: 'codex', name: 'ChatGPT' },
  { id: 'gemini', name: 'Gemini' },
];

export const aiName = (id: AiId) => AI_OPTIONS.find((a) => a.id === id)?.name ?? id;

const isAiId = (v: unknown): v is AiId => v === 'claude' || v === 'codex' || v === 'gemini';

/** A value kept in this browser under `key`, or `initial` until there is one (or when it can't be read). */
export function useRemembered<T>(key: string, initial: T, valid: (v: unknown) => v is T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      const parsed: unknown = raw === null ? undefined : JSON.parse(raw);
      return valid(parsed) ? parsed : initial;
    } catch {
      return initial;
    }
  });
  const set = (v: T) => {
    setValue(v);
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {
      /* kept only until the page is reloaded */
    }
  };
  return [value, set];
}

/** The AI one button uses, remembered for that button (`job`, e.g. "edit" or "ai-writing"). */
export function useAiFor(job: string, initial: AiId = 'claude'): [AiId, (ai: AiId) => void] {
  return useRemembered<AiId>(`hq-ai:${job}`, initial, isAiId);
}

/** A small dropdown of the three AIs. `disabled` lists ones that can't do this job, with the reason as a tooltip. */
export function AiSelect({ value, onChange, disabled = {}, title = 'Which AI does this', label }: { value: AiId; onChange: (ai: AiId) => void; disabled?: Partial<Record<AiId, string>>; title?: string; label?: string }) {
  const select = (
    <select className="ai-select" value={value} title={disabled[value] ?? title} onChange={(e) => onChange(e.target.value as AiId)}>
      {AI_OPTIONS.map((a) => (
        <option key={a.id} value={a.id} disabled={!!disabled[a.id]} title={disabled[a.id]}>
          {a.name}
        </option>
      ))}
    </select>
  );
  return label ? (
    <label className="ai-select-label">
      {label} {select}
    </label>
  ) : (
    select
  );
}
