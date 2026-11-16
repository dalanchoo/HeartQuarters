import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config, isInside, safeResolve } from './config.js';
import { buildExpressionIndex, clearExpressionIndex } from './expressions.js';
import { hasConflictingGptScores, mergeExpressionSidecars, type DuplicateScorePolicy } from './expression-sidecar-merge.js';
import { writeFileSafely } from './files.js';

type Source = { rel: string; hash: string; text: string };
type Row = { photo: string; destination: string; sources: Source[]; result: string; hasGpt: boolean; hasSonnet: boolean };
export type SidecarPlan = { rows: Row[]; skipped: string[]; token: string };
const slash = (p: string) => p.split(path.sep).join('/');
const digest = (data: string | Buffer) => crypto.createHash('sha256').update(data).digest('hex');

/** Build a read-only plan. Aliases map a renamed photo path to its old filename stem. */
export function planSidecarCleanup(aliases: Record<string, string> = {}, policy: DuplicateScorePolicy = 'first'): SidecarPlan {
  if (!['first', 'higher', 'review'].includes(policy)) throw new Error('Invalid duplicate score choice.');
  // buildExpressionIndex tolerates unreadable folders for browsing; cleanup must not silently skip them.
  const checkFolders = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith('_')) checkFolders(path.join(dir, entry.name));
    }
  };
  checkFolders(config.expressionsDir);
  const photos = buildExpressionIndex().photos;
  const known = new Set(photos.map(p => p.path));
  for (const [photo, alias] of Object.entries(aliases)) {
    if (!known.has(photo) || !alias || /[\\/:]/.test(alias) || alias === '.' || alias === '..') throw new Error(`Invalid photo alias: ${photo}`);
  }
  const directories = new Map<string, typeof photos>();
  for (const photo of photos) directories.set(photo.category, [...(directories.get(photo.category) ?? []), photo]);
  const rows: Row[] = []; const skipped: string[] = [];
  for (const [category, categoryPhotos] of directories) {
    const dir = safeResolve('expressions', category);
    const files = fs.readdirSync(dir, { withFileTypes: true });
    const claims = new Map<string, string>();
    for (const entry of files) {
      if (!entry.name.toLowerCase().endsWith('.txt')) continue;
      const candidates = categoryPhotos.flatMap(photo => [photo.name, ...(aliases[photo.path] ? [aliases[photo.path]] : [])].filter(stem => entry.name.toLowerCase() === `${stem}.txt`.toLowerCase() || entry.name.toLowerCase().startsWith(`${stem}_`.toLowerCase())).map(stem => ({ photo: photo.path, length: stem.length })));
      candidates.sort((a, b) => b.length - a.length);
      if (!candidates.length) continue;
      if (candidates[1] && candidates[0].length === candidates[1].length && candidates[0].photo !== candidates[1].photo) throw new Error(`Ambiguous sidecar: ${entry.name}`);
      if (!entry.isFile() || entry.isSymbolicLink()) throw new Error(`A sidecar is not a regular file: ${entry.name}`);
      claims.set(entry.name, candidates[0].photo);
    }
    for (const photo of categoryPhotos) {
      const image = safeResolve('expressions', photo.path);
      if (!fs.lstatSync(image).isFile()) throw new Error(`Photo is not a regular file: ${photo.path}`);
      const stems = [photo.name, ...(aliases[photo.path] ? [aliases[photo.path]] : [])];
      const sources: Source[] = [...claims.entries()].filter(([, owner]) => owner === photo.path).sort(([a], [b]) => a.localeCompare(b)).map(([file]) => {
        const rel = category ? `${category}/${file}` : file;
        const data = fs.readFileSync(safeResolve('expressions', rel));
        const text = data.toString('utf8');
        if (!Buffer.from(text, 'utf8').equals(data)) throw new Error(`Sidecar is not valid UTF-8: ${rel}`);
        return { rel, hash: digest(data), text };
      });
      const find = (suffix: string) => sources.filter(s => stems.some(stem => path.posix.basename(s.rel).toLowerCase() === `${stem}${suffix}.txt`.toLowerCase()));
      const plains = find(''), gpts = find('_GPT-5.5_Light'), sonnets = find('_Sonnet_5_Med_OLD_UNBLINDED');
      if (plains.length > 1 || gpts.length > 1 || sonnets.length > 1) throw new Error(`Multiple competing sidecars for ${photo.path}.`);
      if (policy === 'review' && gpts.length && hasConflictingGptScores(gpts[0].text)) { skipped.push(photo.path); continue; }
      const destination = `${category}/${photo.name}.txt`;
      const alreadyClean = !gpts.length && !sonnets.length && sources.length === 1 && sources[0].rel.toLowerCase() === destination.toLowerCase();
      rows.push({ photo: photo.path, destination, sources, result: alreadyClean ? sources[0].text : mergeExpressionSidecars(gpts[0]?.text ?? null, sonnets[0]?.text ?? null, plains[0]?.text ?? null, policy), hasGpt: !!gpts.length, hasSonnet: !!sonnets.length });
    }
  }
  rows.sort((a, b) => a.photo.localeCompare(b.photo));
  skipped.sort();
  const token = digest(JSON.stringify({ rows, skipped, policy }));
  return { rows, skipped, token };
}

/** Back up every original before changing any sidecar, and roll back if a change fails. */
export function applySidecarCleanup(aliases: Record<string, string>, token: string, policy: DuplicateScorePolicy = 'first'): { backup: string; photos: number; archived: number; skipped: string[] } {
  const plan = planSidecarCleanup(aliases, policy);
  if (plan.token !== token) throw new Error('The library changed since the preview; review it again.');
  const library = path.resolve(config.expressionsDir), trash = path.resolve(config.trashDir);
  if (!config.trashDir || isInside(library, trash) || isInside(trash, library)) throw new Error('The trash folder must be outside the expression library.');
  fs.mkdirSync(trash, { recursive: true });
  const backup = path.join(trash, `Expression Sidecar Cleanup ${crypto.randomUUID()}`);
  fs.mkdirSync(backup);
  const snapshots = path.join(backup, 'Originals');
  const archived = path.join(backup, 'Archived Model Sidecars');
  const changed: { row: Row; original: Source | undefined }[] = [];
  const moved: { from: string; to: string }[] = [];
  try {
    for (const row of plan.rows) for (const source of row.sources) {
      const from = safeResolve('expressions', source.rel), to = path.join(snapshots, ...source.rel.split('/'));
      if (!fs.lstatSync(from).isFile() || digest(fs.readFileSync(from)) !== source.hash) throw new Error(`Changed since preview: ${source.rel}`);
      fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
      if (digest(fs.readFileSync(to)) !== source.hash) throw new Error(`Backup could not be verified: ${source.rel}`);
    }
    fs.writeFileSync(path.join(backup, 'manifest.json'), JSON.stringify({ createdAt: new Date().toISOString(), photos: plan.rows.map(row => ({ photo: row.photo, sources: row.sources.map(s => s.rel) })) }, null, 2), { flag: 'wx' });
    for (const row of plan.rows) {
      const destination = safeResolve('expressions', row.destination);
      const original = row.sources.find(s => s.rel.toLowerCase() === row.destination.toLowerCase());
      if (original && row.sources.length === 1 && row.result === original.text) continue;
      if (original) {
        if (!fs.lstatSync(destination).isFile() || digest(fs.readFileSync(destination)) !== original.hash) throw new Error(`Changed since backup: ${row.destination}`);
        writeFileSafely(destination, row.result);
      } else fs.writeFileSync(destination, row.result, { flag: 'wx' });
      changed.push({ row, original });
      for (const source of row.sources) {
        if (source === original) continue;
        const from = safeResolve('expressions', source.rel), to = path.join(archived, ...source.rel.split('/'));
        if (!fs.lstatSync(from).isFile() || digest(fs.readFileSync(from)) !== source.hash) throw new Error(`Changed since backup: ${source.rel}`);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        if (fs.existsSync(to)) throw new Error(`Archive already exists: ${source.rel}`);
        fs.renameSync(from, to); moved.push({ from, to });
      }
    }
    clearExpressionIndex();
    return { backup, photos: plan.rows.length, archived: moved.length, skipped: plan.skipped };
  } catch (error) {
    const failures: string[] = [];
    for (const move of moved.reverse()) try { if (fs.existsSync(move.from)) throw new Error('original path occupied'); fs.renameSync(move.to, move.from); } catch { failures.push(move.from); }
    for (const change of changed.reverse()) try {
      const dest = safeResolve('expressions', change.row.destination);
      if (digest(fs.readFileSync(dest)) !== digest(change.row.result)) throw new Error('file changed after update');
      if (change.original) writeFileSafely(dest, change.original.text);
      else fs.unlinkSync(dest);
    } catch { failures.push(change.row.destination); }
    clearExpressionIndex();
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${detail} ${failures.length ? `Some changes could not be undone: ${failures.join(', ')}.` : 'Changes were rolled back.'} Backups: ${backup}`);
  }
}
