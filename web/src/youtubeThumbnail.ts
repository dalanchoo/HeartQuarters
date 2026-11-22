/**
 * Whether two YouTube thumbnail addresses are the same picture. The engine adds a changing "hq" number to every address
 * it reads (so YouTube's image servers never hand back an old copy), so two reads of an unchanged thumbnail
 * differ only in that number; it is ignored here.
 */
export function sameThumbnail(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return a === b || (!a && !b);
  const strip = (url: string) => {
    try { const u = new URL(url); u.searchParams.delete('hq'); return u.toString(); } catch { return url; }
  };
  return strip(a) === strip(b);
}
