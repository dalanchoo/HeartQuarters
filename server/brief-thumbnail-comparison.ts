import fs from 'node:fs';
import path from 'node:path';
import { packagingThumbnail, previousLongformPiece } from './projects.js';
import { readable } from './safe-files.js';

const GUIDANCE = 'Compare against the previous numbered longform episode only. Compare the overall impression at phone size. A color or expression can repeat if the thumbnails are easy to tell apart. Treat this video’s own packaging as revision context, and allow its photo, color, or layout to carry forward. Ignore older comparisons in the brief that used upload or edit recency.';

export function thumbnailComparisonNote(context = ''): string {
  return `${GUIDANCE}\n${context || 'No numbered comparison image is available for this request. Say so in the brief.'}`;
}

/** Copy the relevant thumbnails into the AI work folder so every provider can inspect the same images. */
export function stageLongformThumbnails(piece: string, work: string): { context: string; images: string[] } {
  const images: string[] = [];
  const lines: string[] = [];
  const previous = previousLongformPiece(piece);
  const stage = (source: string, prefix: string, preferRecorded: boolean) => {
    try {
      const thumbnail = packagingThumbnail(source, preferRecorded);
      if (!thumbnail) return null;
      const name = `${prefix}${path.extname(thumbnail.file).toLowerCase()}`;
      const destination = path.join(work, name);
      fs.copyFileSync(readable(thumbnail.file), destination);
      images.push(destination);
      return { ...thumbnail, name };
    } catch {
      return null;
    }
  };
  if (previous) {
    const cover = stage(previous, 'Previous-Episode-Thumbnail', true);
    if (cover) {
      const status = cover.recorded ? 'publication recorded in local notes' : 'local version, YouTube status unverified';
      lines.push(`For "Thumbnail comparison", inspect ${cover.name} from "${previous}" (${cover.version}, ${status}). Describe the visual difference you are aiming for.`);
    } else {
      lines.push(`The previous numbered longform is "${previous}". No readable thumbnail is available for it. Say so in the brief.`);
    }
  } else {
    lines.push('No previous numbered longform episode was found. Say so in the brief.');
  }
  const current = stage(piece, 'Current-Episode-Thumbnail', false);
  if (current) lines.push(`${current.name} is from this video's latest local thumbnail version (${current.version}). Use it as revision context.`);
  return { context: lines.join('\n'), images };
}
