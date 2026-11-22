/** Caption formats in the order they are preferred: John's own .srt first, then a .vtt (an older YouTube download), then .sbv. */
const PREFERENCE = [/\.srt$/i, /\.vtt$/i, /\.sbv$/i];

/** Pick the captions file to send. When the folder holds alternate formats of the same named captions, the .srt wins. */
export function defaultSubtitle(files: { path: string; name: string }[]): string {
  if (files.length === 1) return files[0].path;
  if (files.length > 1 && new Set(files.map((f) => f.name.replace(/\.(vtt|srt|sbv)$/i, '').toLowerCase())).size === 1) {
    for (const format of PREFERENCE) {
      const found = files.find((f) => format.test(f.name));
      if (found) return found.path;
    }
  }
  return '';
}
