import fs from 'node:fs';
import path from 'node:path';
import { safeResolve } from './config.js';
import { nextVersionName, versionFolder } from './packaging-version.js';
import { copyVersionThumbnail } from './thumbnail-files.js';
import { parseFields } from '../web/src/packaging.js';

/** Pick an exact target before starting the AI; existing metadata creates a new version. */
export function prepareMetadataVersion(piece: string, selected: string): string {
  const source = versionFolder(piece, selected);
  const names = fs.readdirSync(source);
  const metadata = names.find(n => /^youtube\.md$/i.test(n));
  const text = metadata ? fs.readFileSync(safeResolve('projects', path.join(selected, metadata)), 'utf8') : '';
  const fields = parseFields(text);
  // Unrecognized nonempty text is treated as content: never ask the AI to overwrite it.
  const hasContent = fields ? fields.some(f => /^(title|description|tags)$/i.test(f.label) && !!f.value.trim()) : !!text.trim();
  if (!hasContent) return selected;
  const name = nextVersionName(piece); const dest = path.posix.join(piece.replace(/\\/g, '/'), 'Packaging', name);
  const folder = safeResolve('projects', dest); fs.mkdirSync(folder);
  try {
    const thumbnail = safeResolve('projects', path.join(selected, 'Thumbnail'));
    if (fs.existsSync(thumbnail)) {
      if (!fs.lstatSync(thumbnail).isDirectory() || fs.lstatSync(thumbnail).isSymbolicLink()) throw new Error('The source thumbnail folder must be a real folder.');
      const entries = fs.readdirSync(thumbnail).filter(n => /^thumbnail\.(png|jpe?g)$/i.test(n));
      if (entries.length > 0) copyVersionThumbnail(piece, selected, dest);
    }
  } catch (e) { throw new Error(`Could not prepare ${name}; it may be incomplete. ${e instanceof Error ? e.message : String(e)}`); }
  return dest;
}
