import type { BriefPick } from './projects.js';

export interface ShotSuggestion { expression: string; context: string; cues?: string[] }
const key = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();

/** Collect labelled expression ideas from the whole brief as well as the final picks. */
export function expressionShotSuggestions(brief: string, picks: BriefPick[]): ShotSuggestion[] {
  const found: ShotSuggestion[] = [];
  const add = (expression: string, context: string, cues: string[] = []) => {
    const value = expression.replace(/\*\*/g, '').trim();
    if (!value || found.some(item => key(item.expression) === key(value))) return;
    found.push({ expression: value, context, ...(cues.length ? { cues } : {}) });
  };
  // A pick's gaze and mouth cues go with it, so its look is made the way the packaging needs (John, 2026-11-25).
  picks.forEach((pick, i) => { if (pick.expression) add(pick.expression, `Top ${i + 1}: ${pick.title}`, pick.photoAttributes ?? []); });
  let heading = 'Brief';
  for (const line of brief.split(/\r?\n/)) {
    const section = /^\s*#{2,6}\s+(.+?)\s*$/.exec(line);
    if (section) heading = section[1].replace(/\*\*/g, '').trim();
    const match = /^\s*(?:[-*]\s*)?(?:\*\*)?expression(?:\s+categories)?(?:\*\*)?\s*:(?:\*\*)?\s*(.+?)\s*$/i.exec(line);
    if (match) add(match[1], heading);
  }
  return found;
}
