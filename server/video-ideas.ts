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
/** Whether the idea would be a longform video or a Short. New ideas start Undecided, and so do ideas saved before this field existed. */
export const IDEA_FORMATS = ['undecided', 'longform', 'short'] as const;
export type IdeaFormat = (typeof IDEA_FORMATS)[number];
/** The topic an idea belongs to. New and older ideas start Unassigned. */
export const IDEA_CATEGORIES = ['unassigned', 'sdam', 'aphantasia', 'psychedelics', 'emotions', 'relationships', 'kink', 'healing', 'meaning', 'wisdom'] as const;
export type IdeaCategory = (typeof IDEA_CATEGORIES)[number];
/** `processed` is false for a raw brain dump; true once John has turned it into a clear idea. Older ideas are unprocessed. */
/** A link to a place or thing that informs the idea, with a note saying why it matters. */
export interface IdeaReference { id: string; url: string; note: string }
export interface VideoIdea { id: string; title: string; notes: string; status: IdeaStatus; format: IdeaFormat; category: IdeaCategory; processed: boolean; references: IdeaReference[]; createdAt: string; updatedAt: string }

const TITLE_MAX = 300;
const NOTES_MAX = 20_000;
const URL_MAX = 2000;
const REFERENCES_MAX = 200;

function location() {
  return writable(safeResolve('projects', IDEAS_FILE));
}

function valid(idea: unknown): idea is VideoIdea {
  const i = idea as VideoIdea;
  return !!i && typeof i.id === 'string' && typeof i.title === 'string' && typeof i.notes === 'string'
    && IDEA_STATUSES.includes(i.status) && (i.format === undefined || IDEA_FORMATS.includes(i.format)) && (i.category === undefined || IDEA_CATEGORIES.includes(i.category)) && (i.processed === undefined || typeof i.processed === 'boolean')
    && (i.references === undefined || (Array.isArray(i.references) && i.references.every(r => !!r && typeof r.id === 'string' && typeof r.url === 'string' && typeof r.note === 'string')))
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
  // Ideas saved before the format and processed fields existed are undecided and unprocessed.
  const ideas = (data.ideas as VideoIdea[]).map(i => ({ ...i, format: i.format ?? 'undecided', category: i.category ?? 'unassigned', processed: i.processed ?? false, references: (i.references ?? []).map(r => ({ id: r.id, url: r.url, note: r.note })) }));
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
  ideas.unshift({ id: randomUUID(), title: clean, notes: text(notes, NOTES_MAX, 'notes'), status: 'thinking', format: 'undecided', category: 'unassigned', processed: false, references: [], createdAt: now, updatedAt: now });
  save(ideas, original); return ideas;
}

/** Change an idea's title, notes or status; leave out what isn't changing. */
export function updateIdea(id: unknown, changes: { title?: unknown; notes?: unknown; status?: unknown; format?: unknown; category?: unknown; processed?: unknown }): VideoIdea[] {
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
    if (!IDEA_FORMATS.includes(changes.format as IdeaFormat)) throw new Error('Choose undecided, longform or short.');
    idea.format = changes.format as IdeaFormat;
  }
  if (changes.category !== undefined) {
    if (!IDEA_CATEGORIES.includes(changes.category as IdeaCategory)) throw new Error('Choose a valid category.');
    idea.category = changes.category as IdeaCategory;
  }
  if (changes.processed !== undefined) {
    if (typeof changes.processed !== 'boolean') throw new Error('Choose processed or unprocessed.');
    idea.processed = changes.processed;
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

function referenceAt(idea: VideoIdea, referenceId: unknown): number {
  const at = typeof referenceId === 'string' ? idea.references.findIndex(r => r.id === referenceId) : -1;
  if (at < 0) throw new Error('That reference is no longer on the idea. Reload it and try again.');
  return at;
}

/** Only web addresses, so a reference can't hold a file path or a script. */
export function checkUrl(value: unknown): string {
  const url = text(value, URL_MAX, 'link').trim();
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error('The link must be a full web address starting with https://.'); }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('The link must start with https:// or http://.');
  return url;
}

/** Add a reference to the end of one idea's list. */
export function addReference(ideaId: unknown, input: { url?: unknown; note?: unknown }): VideoIdea[] {
  const { ideas, original } = load(); const idea = ideas[find(ideas, ideaId)];
  if (idea.references.length >= REFERENCES_MAX) throw new Error('This idea has too many references.');
  idea.references.push({ id: randomUUID(), url: checkUrl(input.url), note: text(input.note ?? '', NOTES_MAX, 'note') });
  idea.updatedAt = new Date().toISOString();
  save(ideas, original); return ideas;
}

/** Change one reference's link or note; leave out what isn't changing. */
export function updateReference(ideaId: unknown, referenceId: unknown, changes: { url?: unknown; note?: unknown }): VideoIdea[] {
  const { ideas, original } = load(); const idea = ideas[find(ideas, ideaId)]; const ref = idea.references[referenceAt(idea, referenceId)];
  if (changes.url !== undefined) ref.url = checkUrl(changes.url);
  if (changes.note !== undefined) ref.note = text(changes.note, NOTES_MAX, 'note');
  idea.updatedAt = new Date().toISOString();
  save(ideas, original); return ideas;
}

/** Move one reference up (-1) or down (+1) within its idea. */
export function moveReference(ideaId: unknown, referenceId: unknown, step: unknown): VideoIdea[] {
  if (step !== -1 && step !== 1) throw new Error('Choose up or down.');
  const { ideas, original } = load(); const idea = ideas[find(ideas, ideaId)];
  const at = referenceAt(idea, referenceId); const to = at + step;
  if (to < 0 || to >= idea.references.length) return ideas;
  [idea.references[at], idea.references[to]] = [idea.references[to], idea.references[at]];
  idea.updatedAt = new Date().toISOString();
  save(ideas, original); return ideas;
}

/** Remove one reference from its idea. */
export function deleteReference(ideaId: unknown, referenceId: unknown): VideoIdea[] {
  const { ideas, original } = load(); const idea = ideas[find(ideas, ideaId)];
  idea.references.splice(referenceAt(idea, referenceId), 1);
  idea.updatedAt = new Date().toISOString();
  save(ideas, original); return ideas;
}
