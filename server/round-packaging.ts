import type { BriefPick } from './projects.js';

export type RoundPackaging = Partial<Pick<BriefPick, 'title' | 'thumbnailText' | 'thumbnailIdea'>>;
const fields = [
  ['title', 'Title'],
  ['thumbnailText', 'Thumbnail Text'],
  ['thumbnailIdea', 'Thumbnail Idea'],
] as const;

export function roundNumber(image: string): string | undefined {
  return /(?:^|[/\\])(\d+)\.(?:png|jpe?g|webp)$/i.exec(image)?.[1];
}

export function roundPackagingIn(text: string): RoundPackaging {
  const result: RoundPackaging = {};
  for (const [key, label] of fields) {
    const value = new RegExp('^[ \\t]*Final ' + label + ':[ \\t]*(.*)$', 'im').exec(text)?.[1].trim();
    if (value || value === '' && key === 'thumbnailText') result[key] = value;
  }
  return result;
}

export function applyRoundPackaging(pick: BriefPick | null, changes?: RoundPackaging): BriefPick | null {
  if (!changes || !Object.keys(changes).length) return pick;
  const next = { ...(pick ?? { title: '', thumbnailText: '', accent: '', expression: '', background: '', why: '', backedBy: [] }) };
  for (const [key] of fields) {
    if (typeof changes[key] === 'string') next[key] = changes[key].replace(/[\r\n]+/g, ' ').trim();
  }
  if (pick && next.thumbnailText !== pick.thumbnailText) next.accent = '';
  return next;
}

export function thumbnailIdea(pick: BriefPick | null): string {
  return pick?.thumbnailIdea ?? [pick?.expression, pick?.background].filter(Boolean).join('. ');
}
