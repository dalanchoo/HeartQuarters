// Prepare read-only context for video analytics; no files in the project are modified.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { safeResolve } from './config.js';
import { readable, readText } from './safe-files.js';
import { fetchYoutubeThumbnail } from './thumbnail-files.js';
import { readScript } from './script.js';
const exec = promisify(execFile);

function files(piece: string, subfolder: string, matches: RegExp): { path: string; name: string; modified: number }[] {
  const dir = safeResolve('projects', path.join(piece, subfolder));
  if (!fs.lstatSync(dir, { throwIfNoEntry: false })?.isDirectory()) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isFile() && matches.test(e.name)).flatMap(e => {
    try { const file = safeResolve('projects', path.join(piece, subfolder, e.name)); const stat = fs.lstatSync(file); return stat.isFile() ? [{ path: file, name: e.name, modified: stat.mtimeMs }] : []; } catch { return []; }
  }).sort((a, b) => b.modified - a.modified);
}

function latestTranscript(piece: string) {
  return files(piece, 'Subtitles', /\.(srt|vtt)$/i)[0] ?? files(piece, 'Subtitles', /-captions\.txt$/i)[0];
}

export async function readAnalysisTranscript(piece: string): Promise<{ text: string; source: 'transcript' | 'script' } | null> {
  const transcript = latestTranscript(piece);
  if (transcript && fs.statSync(readable(transcript.path)).size <= 2_000_000) return { text: readText(transcript.path), source: 'transcript' };
  const script = await readScript(piece);
  return script.text.trim() ? { text: script.text.slice(0, 500_000), source: 'script' } : null;
}

/** Copies timed subtitles and a few opening frames to a temporary workspace for all reviewers. */
export async function videoContext(piece: string, work: string, published?: { title: string; thumbnail?: string | null }): Promise<{ text: string; images: string[] }> {
  if (!piece) return { text: 'Channel-wide analysis: no individual video or transcript supplied.', images: [] };
  const lines: string[] = []; const images: string[] = [];
  if (published?.title) lines.push(`YouTube title: ${published.title}`);
  if (published?.thumbnail) {
    try {
      const bytes = await fetchYoutubeThumbnail(published.thumbnail, AbortSignal.timeout(10_000));
      const extension = bytes[0] === 0xff && bytes[1] === 0xd8 ? 'jpg' : bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ? 'png' : null;
      if (!extension) throw new Error('Unsupported thumbnail format.');
      const name = `Published-Thumbnail.${extension}`;
      const file = path.join(work, name);
      fs.writeFileSync(file, bytes, { flag: 'wx' });
      images.push(file);
      lines.push(`${name} is from YouTube.`);
    } catch { lines.push('The YouTube thumbnail could not be downloaded.'); }
  }
  const packaging = safeResolve('projects', path.join(piece, 'Packaging'));
  if (fs.lstatSync(packaging, { throwIfNoEntry: false })?.isDirectory()) {
    const versions = fs.readdirSync(packaging, { withFileTypes: true }).filter(e => e.isDirectory() && /^V\d+/i.test(e.name)).sort((a, b) => Number(/^V(\d+)/i.exec(b.name)?.[1]) - Number(/^V(\d+)/i.exec(a.name)?.[1]));
    const version = versions[0]?.name;
    if (version) {
      const metadata = files(piece, `Packaging/${version}`, /^youtube\.md$/i)[0];
      if (metadata && fs.statSync(readable(metadata.path)).size <= 2_000_000) { fs.copyFileSync(readable(metadata.path), path.join(work, 'Packaging-YouTube.md'), fs.constants.COPYFILE_EXCL); lines.push(`Packaging-YouTube.md is from local ${version}; it may not match YouTube.`); }
      const cover = files(piece, `Packaging/${version}/Thumbnail`, /^thumbnail\.(png|jpe?g)$/i)[0];
      if (cover && fs.statSync(readable(cover.path)).size <= 5_000_000) { const file = path.join(work, `Packaging-Thumbnail${path.extname(cover.name).toLowerCase()}`); fs.copyFileSync(readable(cover.path), file, fs.constants.COPYFILE_EXCL); images.push(file); lines.push('Packaging thumbnail is from that local version, which may not be on YouTube.'); }
    }
  }
  const captions = latestTranscript(piece);
  if (captions) {
    try { if (fs.statSync(readable(captions.path)).size > 2_000_000) throw new Error('Too large'); fs.copyFileSync(readable(captions.path), path.join(work, 'Transcript' + path.extname(captions.name).toLowerCase()), fs.constants.COPYFILE_EXCL); lines.push(`Transcript: Transcript${path.extname(captions.name).toLowerCase()} (local file ${captions.name}). Use timestamps if present; do not invent them.`); }
    catch { lines.push('Transcript could not be read.'); }
  } else {
    try {
      const script = await readAnalysisTranscript(piece);
      if (script) {
        fs.writeFileSync(path.join(work, 'Script.txt'), script.text, { flag: 'wx' });
        lines.push('Script.txt is the local script. It may differ from what was said in the video and has no verified timings.');
      } else lines.push('No local transcript or script found.');
    } catch { lines.push('The local script could not be read.'); }
  }
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
