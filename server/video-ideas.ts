// John's list of videos he might make (the Ideas tab). It lives in Drive, in Video Projects\Video Ideas.json,
// so it survives without the app. The order in the file is John's order: the top is what he'd make next.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config, isInside, safeResolve } from './config.js';
import { readChannelVideos, type ChannelVideo } from './channel-videos.js';
import { STANDALONE_GROUP } from './create.js';
import { writeFileSafely } from './files.js';
import { listProjectVideos } from './projects.js';
import { makeFolder, readable, readText, writable, writeFile } from './safe-files.js';
import { readVideoProfile } from './video-profile.js';

export const IDEAS_FILE = '_HeartQuarters/Ideas/Video Ideas.json';
export const IDEA_RESOURCES_DIR = '_HeartQuarters/Ideas/Resources';
/** Where an idea is on its way to becoming a video. */
/** Raw is a brain dump; Processed has been turned into a clear idea; the rest follow the idea toward a video. */
export const IDEA_STATUSES = ['raw', 'processed', 'brainstorming', 'researching', 'packaged', 'filming', 'made', 'dropped'] as const;
export type IdeaStatus = (typeof IDEA_STATUSES)[number];
/** Whether the idea would be a longform video or a Short. New ideas start Undecided, and so do ideas saved before this field existed. */
export const IDEA_FORMATS = ['undecided', 'longform', 'short'] as const;
export type IdeaFormat = (typeof IDEA_FORMATS)[number];
/** The topic an idea belongs to. New and older ideas start Unassigned. */
export const IDEA_CATEGORIES = ['unassigned', 'sdam', 'aphantasia', 'psychedelics', 'emotions', 'relationships', 'kink', 'healing', 'meaning', 'wisdom', 'story'] as const;
export type IdeaCategory = (typeof IDEA_CATEGORIES)[number];
/** `upNext` puts an idea on the short list at the top of the Ideas tab. */
/** A link to a place or thing that informs the idea, with a note saying why it matters. */
export interface IdeaReference { id: string; url: string; note: string }
/** A file attached to an idea (such as a PDF or notes doc), stored in Video Projects\_IdeaResources\<ideaId>\. */
export interface IdeaAttachment { id: string; name: string; note: string; size: number; addedAt: string }
export interface VideoIdea { id: string; title: string; notes: string; status: IdeaStatus; format: IdeaFormat; category: IdeaCategory; upNext: boolean; references: IdeaReference[]; attachments: IdeaAttachment[]; createdAt: string; updatedAt: string }

const TITLE_MAX = 300;
const NOTES_MAX = 20_000;
const URL_MAX = 2000;
const REFERENCES_MAX = 200;
const ATTACHMENTS_MAX = 100;
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
const IDEA_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const BLOCKED_EXTS = new Set(['.lnk', '.exe', '.bat', '.cmd', '.ps1', '.vbs', '.js', '.msi']);

function location() {
  return writable(safeResolve('projects', IDEAS_FILE));
}

function validAttachment(a: unknown): boolean {
  const item = a as IdeaAttachment;
  return !!item
    && typeof item.id === 'string'
    && typeof item.name === 'string'
    && typeof item.note === 'string'
    && typeof item.size === 'number'
    && typeof item.addedAt === 'string';
}

function valid(idea: unknown): idea is VideoIdea {
  const i = idea as VideoIdea;
  return !!i && typeof i.id === 'string' && typeof i.title === 'string' && typeof i.notes === 'string'
    && (IDEA_STATUSES.includes(i.status) || (i.status as string) === 'thinking') && (i.format === undefined || IDEA_FORMATS.includes(i.format)) && (i.category === undefined || IDEA_CATEGORIES.includes(i.category)) && ((i as { processed?: unknown }).processed === undefined || typeof (i as { processed?: unknown }).processed === 'boolean') && (i.upNext === undefined || typeof i.upNext === 'boolean')
    && (i.references === undefined || (Array.isArray(i.references) && i.references.every(r => !!r && typeof r.id === 'string' && typeof r.url === 'string' && typeof r.note === 'string')))
    && (i.attachments === undefined || (Array.isArray(i.attachments) && i.attachments.every(validAttachment)))
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
  // Ideas saved before the format, processed, references, or attachments fields existed get safe defaults.
  // Older files had a Thinking About It status and a separate processed tick: those become the Raw and Processed statuses.
  const ideas = (data.ideas as (VideoIdea & { processed?: boolean })[]).map(({ processed, ...i }) => ({
    ...i,
    status: (i.status as string) === 'thinking' ? (processed ? 'processed' : 'raw') : i.status,
    format: i.format ?? 'undecided',
    category: i.category ?? 'unassigned',
    upNext: i.upNext ?? false,
    references: (i.references ?? []).map(r => ({ id: r.id, url: r.url, note: r.note })),
    attachments: (i.attachments ?? []).map(a => ({ id: a.id, name: a.name, note: a.note, size: a.size, addedAt: a.addedAt })),
  }));
  return { ideas, original };
}

/** Save, but only if nobody else changed the file since it was read (another browser tab, or an AI). */
function save(ideas: VideoIdea[], original: string | null) {
  const file = location();
  const now = fs.existsSync(file) ? readText(file) : null;
  if (now !== original) throw new Error('The ideas list changed elsewhere. Reload it and try again; nothing was changed.');
  makeFolder(path.dirname(file));
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

/** A new idea goes at the top, as Raw. */
export function addIdea(title: unknown, notes: unknown = ''): VideoIdea[] {
  const clean = text(title, TITLE_MAX, 'title').trim();
  if (!clean) throw new Error('Give the idea a title.');
  const { ideas, original } = load(); const now = new Date().toISOString();
  ideas.unshift({ id: randomUUID(), title: clean, notes: text(notes, NOTES_MAX, 'notes'), status: 'raw', format: 'undecided', category: 'unassigned', upNext: false, references: [], attachments: [], createdAt: now, updatedAt: now });
  save(ideas, original); return ideas;
}

/** Change an idea's title, notes or status; leave out what isn't changing. */
export function updateIdea(id: unknown, changes: { title?: unknown; notes?: unknown; status?: unknown; format?: unknown; category?: unknown; upNext?: unknown }): VideoIdea[] {
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
  if (changes.upNext !== undefined) {
    if (typeof changes.upNext !== 'boolean') throw new Error('Choose whether the idea is up next.');
    idea.upNext = changes.upNext;
  }
  idea.updatedAt = new Date().toISOString();
  save(ideas, original); return ideas;
}

/** Move an idea one place up (-1) or down (+1), or swap with a visible neighbor. */
export function moveIdea(id: unknown, step: unknown, targetId?: unknown): VideoIdea[] {
  if (step !== -1 && step !== 1) throw new Error('Choose up or down.');
  const { ideas, original } = load(); const at = find(ideas, id);
  const to = targetId !== undefined ? find(ideas, targetId) : at + step;
  if (to < 0 || to >= ideas.length || to === at) return ideas;
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

/** Web addresses or internal HeartQuarters #Videos/ or #Substack/ links, so a reference can't hold a file path or script. */
export function checkUrl(value: unknown): string {
  const url = text(value, URL_MAX, 'link').trim();
  if (url.startsWith('#Videos/') || url.startsWith('#Substack/')) {
    const isVideo = url.startsWith('#Videos/');
    const prefix = isVideo ? '#Videos/' : '#Substack/';
    if (url.length <= prefix.length || /[\r\n\t]/.test(url)) {
      throw new Error(isVideo ? 'Choose a valid video in HeartQuarters.' : 'Choose a valid Substack piece in HeartQuarters.');
    }
    return url;
  }
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error('The link must start with https://, http://, #Videos/, or #Substack/.'); }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('The link must start with https://, http://, #Videos/, or #Substack/.');
  return url;
}

function isPrivateIpv4(a: number, b: number): boolean {
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function isPublicHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return false;
  const parts = h.split('.').map(Number);
  if (parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    return !isPrivateIpv4(parts[0], parts[1]);
  }
  if (h.includes(':')) {
    if (h === '::' || h === '::1' || /^(?:0+:){7}0*1?$/.test(h)) return false;
    if (/^f[cd]/i.test(h) || /^fe[89ab]/i.test(h)) return false;
    const mapped4 = /^::ffff:(\d+)\.(\d+)\.(\d+)\.(\d+)$/i.exec(h);
    if (mapped4) return !isPrivateIpv4(Number(mapped4[1]), Number(mapped4[2]));
    const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(h);
    if (mappedHex) {
      const hi = Number.parseInt(mappedHex[1], 16);
      return !isPrivateIpv4((hi >> 8) & 0xff, hi & 0xff);
    }
  }
  return true;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—',
};

function decodeHtmlEntities(raw: string): string {
  return raw.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, code: string) => {
    if (code.startsWith('#x') || code.startsWith('#X')) {
      const n = Number.parseInt(code.slice(2), 16);
      return Number.isFinite(n) ? String.fromCodePoint(n) : match;
    }
    if (code.startsWith('#')) {
      const n = Number.parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : match;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}

/** Pull a readable page title from HTML (<title>, og:title, or twitter:title). */
export function extractHtmlTitle(html: string): string {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const ogMatch = html.match(/<meta[^>]+(?:property|name)=["'](?:og:title|twitter:title)["'][^>]+content=["']([^"']+)["']/i)
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:title|twitter:title)["']/i);
  const raw = titleMatch?.[1] || ogMatch?.[1] || '';
  return decodeHtmlEntities(raw).replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX);
}

const PAGE_TITLE_BYTES = 65536;

async function readHeadText(res: Response, limit: number): Promise<string> {
  if (!res.body) return (await res.text()).slice(0, limit);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < limit) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const take = value.byteLength > limit - total ? value.subarray(0, limit - total) : value;
      chunks.push(take);
      total += take.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks, total).toString('utf8');
}

/** Best-effort fetch of a web page's title when adding a bare URL; returns '' on any failure. */
export async function fetchPageTitle(rawUrl: string): Promise<string> {
  try {
    let current = new URL(checkUrl(rawUrl));
    let res: Response | null = null;
    for (let hops = 0; hops <= 3; hops++) {
      if ((current.protocol !== 'https:' && current.protocol !== 'http:') || !isPublicHostname(current.hostname)) return '';
      res = await fetch(current.toString(), {
        redirect: 'manual',
        signal: AbortSignal.timeout(4000),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HeartQuarters/1.0)' },
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location || hops === 3) return '';
        current = new URL(location, current);
        continue;
      }
      break;
    }
    if (!res || !res.ok) return '';
    const type = res.headers.get('content-type') ?? '';
    if (!/text\/html|application\/xhtml\+xml/i.test(type)) return '';
    const html = await readHeadText(res, PAGE_TITLE_BYTES);
    return extractHtmlTitle(html);
  } catch {
    return '';
  }
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

function checkIdeaFolderId(ideaId: unknown): string {
  if (typeof ideaId !== 'string' || !IDEA_ID_RE.test(ideaId)) throw new Error('Choose a valid idea.');
  return ideaId;
}

function cleanAttachmentName(raw: unknown): { stem: string; ext: string } {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('Choose a file to attach.');
  const base = raw.replace(/\\/g, '/').split('/').pop() ?? '';
  const ext = path.extname(base).toLowerCase();
  if (BLOCKED_EXTS.has(ext)) throw new Error(`Files ending in ${ext} cannot be attached.`);
  const stem = path
    .basename(base, ext)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 120);
  const safeStem = !stem || stem === '.' || stem === '..' || RESERVED_NAME.test(stem) ? 'Resource' : stem;
  return { stem: safeStem, ext };
}

function attachmentAt(idea: VideoIdea, attachmentId: unknown): number {
  const at = typeof attachmentId === 'string' ? idea.attachments.findIndex(a => a.id === attachmentId) : -1;
  if (at < 0) throw new Error('That attached file is no longer on the idea. Reload it and try again.');
  return at;
}

/** Attach a file (such as a PDF) to one idea, storing it under Video Projects\_IdeaResources\<ideaId>\. */
export function addAttachment(ideaId: unknown, rawName: unknown, bytes: Buffer, rawNote: unknown = ''): VideoIdea[] {
  const folderId = checkIdeaFolderId(ideaId);
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new Error('The attached file is empty.');
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw new Error('Attached files must be 50 MB or smaller.');
  const note = text(rawNote ?? '', NOTES_MAX, 'note');

  const { ideas, original } = load();
  const idea = ideas[find(ideas, folderId)];
  if (idea.attachments.length >= ATTACHMENTS_MAX) throw new Error('This idea has too many attached files.');

  const { stem, ext } = cleanAttachmentName(rawName);
  const dir = makeFolder(safeResolve('projects', path.posix.join(IDEA_RESOURCES_DIR, folderId)));
  const existing = new Set(fs.readdirSync(dir).map(n => n.toLowerCase()));
  let candidate = `${stem}${ext}`;
  let n = 2;
  while (existing.has(candidate.toLowerCase())) {
    candidate = `${stem} (${n++})${ext}`;
  }

  const target = safeResolve('projects', path.posix.join(IDEA_RESOURCES_DIR, folderId, candidate));
  writeFile(target, bytes, { flag: 'wx' });

  const now = new Date().toISOString();
  idea.attachments.push({ id: randomUUID(), name: candidate, note, size: bytes.length, addedAt: now });
  idea.updatedAt = now;
  try {
    save(ideas, original);
  } catch (e) {
    fs.rmSync(target, { force: true });
    throw e;
  }
  return ideas;
}

/** Update the note on an attached file. */
export function updateAttachment(ideaId: unknown, attachmentId: unknown, changes: { note?: unknown }): VideoIdea[] {
  const { ideas, original } = load();
  const idea = ideas[find(ideas, ideaId)];
  const att = idea.attachments[attachmentAt(idea, attachmentId)];
  if (changes.note !== undefined) att.note = text(changes.note, NOTES_MAX, 'note');
  idea.updatedAt = new Date().toISOString();
  save(ideas, original);
  return ideas;
}

/** Remove an attachment from an idea and move its file to HeartQuarters Trash. */
export function deleteAttachment(ideaId: unknown, attachmentId: unknown): VideoIdea[] {
  const folderId = checkIdeaFolderId(ideaId);
  const { ideas, original } = load();
  const idea = ideas[find(ideas, folderId)];
  const idx = attachmentAt(idea, attachmentId);
  const att = idea.attachments[idx];
  const file = safeResolve('projects', path.posix.join(IDEA_RESOURCES_DIR, folderId, att.name));

  const hasFile = fs.existsSync(file);
  let trash = '';
  if (hasFile) {
    writable(file);
    const projects = path.resolve(config.videoProjectsDir);
    trash = path.resolve(config.trashDir);
    if (!config.trashDir || isInside(projects, trash) || isInside(trash, projects)) {
      throw new Error('The trash folder must be outside Video Projects.');
    }
  }

  idea.attachments.splice(idx, 1);
  idea.updatedAt = new Date().toISOString();
  save(ideas, original);

  if (hasFile) {
    fs.mkdirSync(trash, { recursive: true });
    const holder = fs.mkdtempSync(path.join(trash, 'Idea Resources '));
    fs.renameSync(file, path.join(holder, path.basename(file)));
  }
  return ideas;
}

/** Checked path to an idea's attached file for serving sandboxed in the browser. */
export function attachmentFile(ideaId: unknown, attachmentId: unknown): string {
  const folderId = checkIdeaFolderId(ideaId);
  const ideas = load().ideas;
  const idea = ideas[find(ideas, folderId)];
  const att = idea.attachments[attachmentAt(idea, attachmentId)];
  const full = readable(safeResolve('projects', path.posix.join(IDEA_RESOURCES_DIR, folderId, att.name)));
  const stat = fs.lstatSync(full, { throwIfNoEntry: false });
  if (!stat || !stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('That attached file could not be found.');
  }
  return full;
}

/**
 * Every Video Project piece on Drive for Ideas' Video Finder, enriched with YouTube titles/dates when available.
 * Works even when YouTube data hasn't been fetched or omits a video.
 */
export function ideaVideos(): ChannelVideo[] {
  const byPiece = new Map(
    (readChannelVideos()?.videos ?? [])
      .filter((v): v is ChannelVideo & { piece: string } => !!v.piece)
      .map((v) => [v.piece, v]),
  );
  const out: ChannelVideo[] = [];
  for (const { video } of listProjectVideos()) {
    const longform = video.pieces.find((p) => p.kind === 'longform');
    for (const p of video.pieces) {
      const existing = byPiece.get(p.path);
      if (existing) {
        out.push(existing);
        continue;
      }
      const kind = p.kind === 'longform' ? 'longform' : 'short';
      const fromLongform = kind === 'short'
        ? (p.path.startsWith(`${STANDALONE_GROUP}/`) ? 'standalone' : longform?.path ?? null)
        : undefined;
      out.push({
        id: p.path,
        title: '',
        publishedAt: '',
        seconds: 0,
        privacy: 'unknown',
        kind,
        kindGuessed: false,
        piece: p.path,
        numbers: null,
        fromLongform,
        ...readVideoProfile(p.path),
      });
    }
  }
  return out;
}
