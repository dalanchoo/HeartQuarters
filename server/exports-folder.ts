import { safeResolve } from './config.js';
import { makeFolder } from './safe-files.js';

/**
 * A longform's or short's Exports folder ("<video>/Longform" or "<video>/Shorts/<short>" plus "/Exports"), made
 * (empty) when it isn't there yet, so it can be opened before the first export. Returns its full path.
 */
export function ensureExportsFolder(piece: unknown): string {
  const text = String(piece ?? '');
  if (!text || text.split('/').some((part) => !part || part === '.' || part === '..' || part.includes('\\'))) throw new Error('Choose a video first.');
  return makeFolder(safeResolve('projects', `${text}/Exports`));
}
