// Move and remove expression photos, keeping their sidecars and known HQ references together.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config, safeResolve } from './config.js';
import { buildExpressionIndex, clearExpressionIndex } from './expressions.js';
import { isAiExpression } from './expression-origin.js';
import { readExpressionReferences, saveExpressionReferences } from './expression-references.js';
import { writeFileSafely } from './files.js';

type Change = { from: string; to: string | null };
type JsonLink = { file: string; before: string; after: string; copyFrom?: string; copyTo?: string };
export type ExpressionPlan = { photo: string; destination: string | null; changes: Change[]; sidecars: string[]; links: string[]; references: string[]; token: string };
const image = /\.(?:jpe?g|png|webp)$/i;
const normalize = (s: string) => s.replace(/\\/g, '/');
const eq = (a: string, b: string) => normalize(a).toLowerCase() === normalize(b).toLowerCase();
const rel = (full: string) => normalize(path.relative(config.expressionsDir, full));

function filesFor(photo: string): string[] {
  const full = safeResolve('expressions', photo);
  const dir = path.dirname(full), base = path.basename(full, path.extname(full));
  const files = fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.name.toLowerCase() === path.basename(full).toLowerCase() || e.name.toLowerCase().startsWith(`${base.toLowerCase()}.`) || e.name.toLowerCase().startsWith(`${base.toLowerCase()}_`));
  if (files.some(e => !e.isFile() || e.isSymbolicLink())) throw new Error('A related file is a shortcut or folder. Nothing was changed.');
  if (files.filter(e => image.test(e.name) && path.parse(e.name).name.toLowerCase() === base.toLowerCase()).length !== 1) throw new Error('More than one photo has this name. Nothing was changed.');
  if (files.some(e => image.test(e.name) && e.name.toLowerCase() !== path.basename(full).toLowerCase())) throw new Error('Another photo has a similar name; its sidecars cannot be safely distinguished. Nothing was changed.');
  return files.map(e => rel(path.join(dir, e.name)));
}

function findLinks(changes: Change[]): JsonLink[] {
  const found: JsonLink[] = [];
  const root = config.videoProjectsDir;
  if (!fs.existsSync(root)) throw new Error('The Video Projects folder is not available. Nothing was changed.');
  function walk(dir: string) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isSymbolicLink()) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!e.isFile() || !/^(Choice|Conversation)\.json$/i.test(e.name)) continue;
      const before = fs.readFileSync(full, 'utf8');
      let obj: Record<string, unknown>;
      try { obj = JSON.parse(before.replace(/^\uFEFF/, '')); } catch { throw new Error(`Cannot read ${full}; references cannot be checked. Nothing was changed.`); }
      if (typeof obj.photo !== 'string') continue;
      const change = changes.find(c => eq(c.from, obj.photo as string));
      if (!change) continue;
      let copyFrom: string | undefined, copyTo: string | undefined;
      if (change.to) obj.photo = change.to;
      else {
        const drafts = e.name.toLowerCase() === 'choice.json' ? dir : path.dirname(dir);
        if (path.basename(drafts).toLowerCase() !== 'drafts' || path.basename(path.dirname(drafts)).toLowerCase() !== 'packaging') throw new Error(`Unexpected thumbnail file location: ${full}. Nothing was changed.`);
        const sourceDir = path.join(drafts, 'Source');
        const copyName = `Expression - ${crypto.createHash('sha256').update(change.from).digest('hex').slice(0, 16)}${path.extname(change.from)}`;
        copyTo = path.join(sourceDir, copyName);
        const copyRel = normalize(path.relative(root, copyTo));
        if (safeResolve('projects', copyRel) !== copyTo) throw new Error('Invalid project copy path.');
        copyFrom = safeResolve('expressions', change.from);
        obj.photo = `project:${copyRel}`;
      }
      found.push({ file: full, before, after: JSON.stringify(obj, null, 2), copyFrom, copyTo });
    }
  }
  walk(root);
  return found;
}

function makePlan(photo: string, destination: string | null) {
  const index = buildExpressionIndex();
  const selected = index.photos.find(p => p.path === photo);
  if (!selected) throw new Error('That photo is no longer in the library.');
  if (destination !== null && (!index.categories.some(c => c.path === destination) || !destination || destination === selected.category)) throw new Error('Choose a different expression category.');
  const changes: Change[] = [];
  if (destination !== null) {
    const category = index.categories.find(c => c.path === destination)!;
    const occupied = fs.readdirSync(safeResolve('expressions', destination)).map(s => s.toLowerCase());
    const prefix = `${category.name}${isAiExpression(selected) ? '_AI' : ''}_`;
    let n = 1;
    while (occupied.some(s => s.startsWith(`${prefix}${String(n).padStart(3, '0')}`.toLowerCase() + '.') || s.startsWith(`${prefix}${String(n).padStart(3, '0')}`.toLowerCase() + '_'))) n++;
    changes.push({ from: photo, to: `${destination}/${prefix}${String(n).padStart(3, '0')}${path.extname(photo)}` });
  } else changes.push({ from: photo, to: null });
  const match = /^(.*)_(\d+)$/.exec(selected.name);
  if (match) {
    const candidates = index.photos.filter(p => p.category === selected.category && new RegExp(`^${match[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_\\d+$`, 'i').test(p.name));
    const last = candidates.sort((a, b) => Number(b.name.slice(match[1].length + 1)) - Number(a.name.slice(match[1].length + 1)))[0];
    if (last && last.path !== photo && Number(last.name.slice(match[1].length + 1)) > Number(match[2])) changes.push({ from: last.path, to: `${selected.category}/${selected.name}${path.extname(last.path)}` });
  }
  const sidecars = changes.flatMap(c => filesFor(c.from));
  const links = findLinks(changes);
  const references = readExpressionReferences().paths;
  const state = { photo, destination, changes, sidecars: sidecars.map(p => { const s = fs.statSync(safeResolve('expressions', p)); return [p, s.size, s.mtimeMs]; }), links: links.map(l => [l.file, l.before]), references };
  const token = crypto.createHash('sha256').update(JSON.stringify(state)).digest('hex');
  return { plan: { photo, destination, changes, sidecars, links: links.map(l => normalize(path.relative(config.videoProjectsDir, l.file))), references: references.filter(p => changes.some(c => eq(p, c.from))), token }, links, references };
}

export function previewExpressionChange(photo: string, destination: string | null): ExpressionPlan { return makePlan(photo, destination).plan; }

export function applyExpressionChange(photo: string, destination: string | null, token: string): ExpressionPlan {
  const { plan, links, references } = makePlan(photo, destination);
  if (plan.token !== token) throw new Error('The files changed since the preview. Review the action again.');
  if (!config.trashDir) throw new Error('No trash folder is configured. Nothing was changed.');
  const trash = path.join(config.trashDir, `Expression ${crypto.randomUUID()}`);
  const moved: { from: string; to: string }[] = [], written: JsonLink[] = [], copies: string[] = [];
  let refsWritten = false;
  try {
    fs.mkdirSync(trash, { recursive: true });
    for (const l of links) if (l.copyTo && l.copyFrom) {
      fs.mkdirSync(path.dirname(l.copyTo), { recursive: true });
      if (fs.lstatSync(path.dirname(l.copyTo)).isSymbolicLink()) throw new Error('The project Source folder is a shortcut. Nothing was changed.');
      if (fs.existsSync(l.copyTo)) {
        if (!fs.readFileSync(l.copyTo).equals(fs.readFileSync(l.copyFrom))) throw new Error(`A different source photo already exists at ${l.copyTo}.`);
      } else { fs.copyFileSync(l.copyFrom, l.copyTo, fs.constants.COPYFILE_EXCL); copies.push(l.copyTo); }
    }
    for (const change of plan.changes) {
      const fromBase = path.basename(change.from, path.extname(change.from));
      const toBase = change.to ? path.basename(change.to, path.extname(change.to)) : '';
      for (const sidecar of filesFor(change.from)) {
        const from = safeResolve('expressions', sidecar);
        const suffix = path.basename(sidecar).slice(fromBase.length);
        const to = change.to ? safeResolve('expressions', `${path.posix.dirname(change.to)}/${toBase}${suffix}`) : path.join(trash, path.basename(sidecar));
        if (fs.existsSync(to)) throw new Error(`A file already exists at ${to}.`);
        fs.renameSync(from, to); moved.push({ from, to });
      }
    }
    for (const link of links) { writeFileSafely(link.file, link.after); written.push(link); }
    const next = references.flatMap(p => { const c = plan.changes.find(x => eq(x.from, p)); return c ? c.to ? [c.to] : [] : [p]; });
    if (JSON.stringify(next) !== JSON.stringify(references)) { saveExpressionReferences(next, false); refsWritten = true; }
    clearExpressionIndex();
    return plan;
  } catch (error) {
    const failures: string[] = [];
    if (refsWritten) try { saveExpressionReferences(references, false); } catch { failures.push('reference list'); }
    for (const l of written.reverse()) try { writeFileSafely(l.file, l.before); } catch { failures.push(l.file); }
    for (const m of moved.reverse()) try { fs.renameSync(m.to, m.from); } catch { failures.push(m.to); }
    for (const copy of copies) try { fs.unlinkSync(copy); } catch { failures.push(copy); }
    clearExpressionIndex();
    if (failures.length) throw new Error(`The operation failed and some changes could not be undone: ${failures.join(', ')}. Check ${trash}.`);
    throw error;
  }
}
