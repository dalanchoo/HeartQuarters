// Prepare read-only context for video analytics; no files in the project are modified.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { safeResolve } from './config.js';
const exec = promisify(execFile);

function files(piece: string, subfolder: string, matches: RegExp): { path: string; name: string; modified: number }[] {
  const dir = safeResolve('projects', path.join(piece, subfolder));
  if (!fs.lstatSync(dir, { throwIfNoEntry: false })?.isDirectory()) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isFile() && matches.test(e.name)).flatMap(e => {
    try { const file = safeResolve('projects', path.join(piece, subfolder, e.name)); const stat = fs.lstatSync(file); return stat.isFile() ? [{ path: file, name: e.name, modified: stat.mtimeMs }] : []; } catch { return []; }
  }).sort((a, b) => b.modified - a.modified);
}

/** Copies timed subtitles and a few opening frames to a temporary workspace for all reviewers. */
export async function videoContext(piece: string, work: string): Promise<{ text: string; images: string[] }> {
  if (!piece) return { text: 'Channel-wide analysis: no individual video or transcript supplied.', images: [] };
  const lines: string[] = []; const images: string[] = [];
  const packaging = safeResolve('projects', path.join(piece, 'Packaging'));
  if (fs.lstatSync(packaging, { throwIfNoEntry: false })?.isDirectory()) {
    const versions = fs.readdirSync(packaging, { withFileTypes: true }).filter(e => e.isDirectory() && /^V\d+/i.test(e.name)).sort((a, b) => Number(/^V(\d+)/i.exec(b.name)?.[1]) - Number(/^V(\d+)/i.exec(a.name)?.[1]));
    const version = versions[0]?.name;
    if (version) {
      const metadata = files(piece, `Packaging/${version}`, /^youtube\.md$/i)[0];
      if (metadata && fs.statSync(metadata.path).size <= 2_000_000) { fs.copyFileSync(metadata.path, path.join(work, 'Packaging-YouTube.md'), fs.constants.COPYFILE_EXCL); lines.push(`Packaging-YouTube.md is from local ${version}; it may not match YouTube.`); }
      const cover = files(piece, `Packaging/${version}/Thumbnail`, /^thumbnail\.(png|jpe?g)$/i)[0];
      if (cover && fs.statSync(cover.path).size <= 5_000_000) { const file = path.join(work, `Packaging-Thumbnail${path.extname(cover.name).toLowerCase()}`); fs.copyFileSync(cover.path, file, fs.constants.COPYFILE_EXCL); images.push(file); lines.push('Packaging thumbnail is from that local version, which may not be on YouTube.'); }
    }
  }
  const captions = files(piece, 'Subtitles', /\.(srt|vtt)$/i)[0] ?? files(piece, 'Subtitles', /-captions\.txt$/i)[0];
  if (captions) {
    try { if (fs.statSync(captions.path).size > 2_000_000) throw new Error('Too large'); fs.copyFileSync(captions.path, path.join(work, 'Transcript' + path.extname(captions.name).toLowerCase()), fs.constants.COPYFILE_EXCL); lines.push(`Transcript: Transcript${path.extname(captions.name).toLowerCase()} (local file ${captions.name}). Use timestamps if present; do not invent them.`); }
    catch { lines.push('Transcript could not be read.'); }
  } else lines.push('No local transcript found.');
  const video = files(piece, 'Exports', /\.(mp4|mov|m4v|webm|mkv)$/i)[0];
  if (!video) { lines.push('No exported video found; duration and opening frames unavailable.'); return { text: lines.join('\n'), images }; }
  lines.push(`Video: ${video.name} (newest local export; it may differ from the YouTube version).`);
  try {
    const result = await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', video.path], { windowsHide: true, timeout: 30000 });
    const duration = Number(result.stdout.trim());
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('Invalid duration');
    lines.push(`Duration: ${duration.toFixed(2)} seconds. Opening stills are samples, not the full video or audio.`);
    for (const second of [1, 5, 15].filter(t => t < duration)) {
      const output = path.join(work, `Opening-${second}s.jpg`);
      try { await exec('ffmpeg', ['-v', 'error', '-ss', String(second), '-i', video.path, '-frames:v', '1', '-vf', 'scale=960:-2', output], { windowsHide: true, timeout: 30000 }); images.push(output); } catch { /* The transcript and duration can still be used. */ }
    }
  } catch { lines.push('Video duration could not be measured.'); }
  return { text: lines.join('\n'), images };
}
