// John's list of videos he might make (the Ideas tab). It lives in Drive, in Video Projects\Video Ideas.json,
// so it survives without the app. The order in the file is John's order: the top is what he'd make next.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { safeResolve } from './config.js';
import { readText, writable, writeFile } from './safe-files.js';

export const IDEAS_FILE = 'Video Ideas.json';
/** Where an idea is on its way to becoming a video. */
export const IDEA_STATUSES = ['thinking', 'researching', 'packaged', 'filming', 'made', 'dropped'] as const;
export type IdeaStatus = (typeof IDEA_STATUSES)[number];
/** Whether the idea would be a longform video or a Short. Ideas saved before this field existed are longform. */
export const IDEA_FORMATS = ['longform', 'short'] as const;
export type IdeaFormat = (typeof IDEA_FORMATS)[number];
export interface VideoIdea { id: string; title: string; notes: string; status: IdeaStatus; format: IdeaFormat; createdAt: string; updatedAt: string }

const TITLE_MAX = 300;
const NOTES_MAX = 20_000;

function location() {
  return writable(safeResolve('projects', IDEAS_FILE));
}

function valid(idea: unknown): idea is VideoIdea {
  const i = idea as VideoIdea;
  return !!i && typeof i.id === 'string' && typeof i.title === 'string' && typeof i.notes === 'string'
    && IDEA_STATUSES.includes(i.status) && (i.format === undefined || IDEA_FORMATS.includes(i.format))
    && typeof i.createdAt === 'string' && typeof i.updatedAt === 'string';
}

function load(): { ideas: VideoIdea[]; original: string | null } {
  const file = location();
  if (!fs.existsSync(file)) return { ideas: [], original: null };
  const original = readText(file);
  let data: { version?: unknown; ideas?: unknown };
  try { data = JSON.parse(original.replace(/^﻿/, '')); }
  catch { throw new Error('The ideas list could not be read. Nothing was changed.'); }
  if (data?.version !== 1 || !Array.isArray(data.ideas) || !data.ideas.every(valid)) throw new Error('The ideas list has an unexpected format. Nothing was changed.');
  // Ideas saved before the format field existed are longform.
  const ideas = (data.ideas as VideoIdea[]).map(i => ({ ...i, format: i.format ?? 'longform' }));
  return { ideas, original };
}

/** Save, but only if nobody else changed the file since it was read (another browser tab, or an AI). */
function save(ideas: VideoIdea[], original: string | null) {
  const file = location();
  const now = fs.existsSync(file) ? readText(file) : null;
  if (now !== original) throw new Error('The ideas list changed elsewhere. Reload it and try again; nothing was changed.');
  writeFile(file, JSON.stringify({ version: 1, ideas }, null, 2) + '\n');
}

function text(value: unknown, max: number, label: string): string {
  if (typeof value !== 'string' || value.length > max) throw new Error(`The ${label} is invalid or too long.`);
  return value;
}

function find(ideas: VideoIdea[], id: unknown): number {
  const at = typeof id === 'string' ? ideas.findIndex(i => i.id === id) : -1;
  if (at < 0) throw new Error('That idea is no longer on the list. Reload it and try again.');
  return at;
}

export function readIdeas(): VideoIdea[] { return load().ideas; }

/** A new idea goes at the top, as "Thinking About It". */
export function addIdea(title: unknown, notes: unknown = ''): VideoIdea[] {
  const clean = text(title, TITLE_MAX, 'title').trim();
  if (!clean) throw new Error('Give the idea a title.');
  const { ideas, original } = load(); const now = new Date().toISOString();
  ideas.unshift({ id: randomUUID(), title: clean, notes: text(notes, NOTES_MAX, 'notes'), status: 'thinking', format: 'longform', createdAt: now, updatedAt: now });
  save(ideas, original); return ideas;
}

/** Change an idea's title, notes or status; leave out what isn't changing. */
export function updateIdea(id: unknown, changes: { title?: unknown; notes?: unknown; status?: unknown; format?: unknown }): VideoIdea[] {
  const { ideas, original } = load(); const idea = ideas[find(ideas, id)];
  if (changes.title !== undefined) {
    const clean = text(changes.title, TITLE_MAX, 'title').trim();
    if (!clean) throw new Error('Give the idea a title.');
    idea.title = clean;
  }
  if (changes.notes !== undefined) idea.notes = text(changes.notes, NOTES_MAX, 'notes');
  if (changes.status !== undefined) {
    if (!IDEA_STATUSES.includes(changes.status as IdeaStatus)) throw new Error('Choose a valid status.');
    idea.status = changes.status as IdeaStatus;
  }
  if (changes.format !== undefined) {
    if (!IDEA_FORMATS.includes(changes.format as IdeaFormat)) throw new Error('Choose longform or short.');
    idea.format = changes.format as IdeaFormat;
  }
  idea.updatedAt = new Date().toISOString();
  save(ideas, original); return ideas;
}

/** Move an idea one place up (-1) or down (+1). */
export function moveIdea(id: unknown, step: unknown): VideoIdea[] {
  if (step !== -1 && step !== 1) throw new Error('Choose up or down.');
  const { ideas, original } = load(); const at = find(ideas, id); const to = at + step;
  if (to < 0 || to >= ideas.length) return ideas;
  [ideas[at], ideas[to]] = [ideas[to], ideas[at]];
  save(ideas, original); return ideas;
}

/** Remove one idea from the list. Only the list file changes. */
export function deleteIdea(id: unknown): VideoIdea[] {
  const { ideas, original } = load(); ideas.splice(find(ideas, id), 1);
  save(ideas, original); return ideas;
}
