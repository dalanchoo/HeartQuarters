/** Prefer the VTT when the folder contains alternate formats of the same named captions. */
export function defaultSubtitle(files: { path: string; name: string }[]): string {
  if (files.length === 1) return files[0].path;
  if (files.length > 1 && new Set(files.map((f) => f.name.replace(/\.(vtt|srt|sbv)$/i, '').toLowerCase())).size === 1) {
    return files.find((f) => /\.vtt$/i.test(f.name))?.path ?? '';
  }
  return '';
}
