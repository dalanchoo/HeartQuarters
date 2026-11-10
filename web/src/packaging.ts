// Packaging files (YouTube.md etc.) are written as labelled blocks:
//
//   Title:
//   When Should You Tell Someone You Have SDAM?
//
//   Description:
//   ...
//
// parseFields splits them into fields so each one gets its own Copy button.
export interface Field {
  label: string;
  value: string;
}

// John's platforms, most important first. Any other file comes after these, in the order it was found.
const PLATFORMS = ['youtube', 'substack', 'instagram', 'tiktok', 'linkedin'];

function platformRank(name: string): number {
  // Files in a subfolder are named with it: "Metadata/YouTube v01.md".
  const file = name.split('/').pop()!.toLowerCase();
  const rank = PLATFORMS.findIndex((p) => file.startsWith(p));
  return rank < 0 ? PLATFORMS.length : rank;
}

/** The files with YouTube's first, then Substack, Instagram, TikTok and LinkedIn. */
export function inPlatformOrder<T extends { name: string }>(files: T[]): T[] {
  return [...files].sort((a, b) => platformRank(a.name) - platformRank(b.name));
}

const LABEL_RE = /^([A-Z][A-Za-z ]{0,30}):\s*$/;

// A description has lines of its own that look like labels ("Full video:", above a link). Only these end it.
const AFTER_DESCRIPTION = new Set(['title', 'tags', 'pinned comment', 'comment', 'hashtags', 'thumbnail text', 'accessibility', 'purpose', 'video language', 'visibility', 'made for kids', 'altered content', 'playlists']);

/** True for a file nobody has filled in: nothing but headings, labels and the template's "#tags". */
export function isBlankPackaging(text: string): boolean {
  return text.split(/\r?\n/).every((line) => {
    const trimmed = line.trim();
    return trimmed === '' || trimmed === '#tags' || trimmed.startsWith('# ') || LABEL_RE.test(trimmed);
  });
}

/** Returns the fields, or null if the file isn't in the labelled-block format. */
export function parseFields(text: string): Field[] | null {
  const lines = text.split(/\r?\n/);
  const spans = fieldSpans(lines);
  if (spans.length === 0) return null;
  // One label after other writing is more likely a note than a field, and showing only the field would hide the rest.
  const before = lines.slice(0, spans[0].from - 1).filter((l) => l.trim() !== '' && !l.trim().startsWith('#'));
  if (spans.length === 1 && before.length > 0) return null;
  return spans.map((s) => ({ label: s.label, value: lines.slice(s.from, s.to).join('\n').trim() }));
}

/** Each field's label and which lines hold its value: from just after the label, up to the next label. */
function fieldSpans(lines: string[]): { label: string; from: number; to: number }[] {
  const spans: { label: string; from: number; to: number }[] = [];
  lines.forEach((line, i) => {
    const match = LABEL_RE.exec(line.trim());
    if (!match) return;
    const current = spans[spans.length - 1];
    if (current?.label.toLowerCase() === 'description' && !AFTER_DESCRIPTION.has(match[1].toLowerCase())) return;
    if (current) current.to = i;
    spans.push({ label: match[1], from: i + 1, to: lines.length });
  });
  return spans;
}

/**
 * The file's text with one field's value replaced (`index` counts the fields from 0). Everything else stays exactly
 * as it was: headings, the other fields, the line endings.
 */
export function setFieldValue(text: string, index: number, value: string): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const span = fieldSpans(lines)[index];
  if (!span) throw new Error("That field isn't in the file any more. Reload the page.");
  const body = lines.slice(span.from, span.to);
  const isLast = span.to === lines.length;
  const trimmed = value.trim();
  const newBody = trimmed === '' ? [] : trimmed.split(/\r?\n/);
  // Keeps a blank line before the next field, and the file's last line ending if it had one.
  const endsWithBlank = isLast ? body[body.length - 1] === '' : true;
  return [...lines.slice(0, span.from), ...newBody, ...(endsWithBlank ? [''] : []), ...lines.slice(span.to)].join(eol);
}

// ---- The AI-generated lines in a YouTube description ------------------------------

const VISUALS_LINE = 'Some visuals are AI-generated or AI-enhanced.';
const MUSIC_LINE = 'The music is AI-generated.';
const BOTH_LINE = 'Some visuals and music are AI-generated or AI-enhanced.';
const isAiLine = (line: string) => [VISUALS_LINE, MUSIC_LINE, BOTH_LINE].includes(line.trim());

export interface AiLines {
  visuals: boolean;
  music: boolean;
}

/** Where the description's lines are: from just after its label, up to the next field or the end of the file. */
function descriptionLines(lines: string[]): { from: number; to: number } | null {
  const label = lines.findIndex((l) => /^description:\s*$/i.test(l.trim()));
  if (label < 0) return null;
  const next = lines.findIndex((l, i) => {
    const match = i > label ? LABEL_RE.exec(l.trim()) : null;
    return !!match && AFTER_DESCRIPTION.has(match[1].toLowerCase());
  });
  return { from: label + 1, to: next < 0 ? lines.length : next };
}

/** Which AI lines the description has, or null if the file has no description. */
export function readAiLines(text: string): AiLines | null {
  const lines = text.split(/\r?\n/);
  const range = descriptionLines(lines);
  if (!range) return null;
  const body = lines.slice(range.from, range.to).map((l) => l.trim());
  return {
    visuals: body.includes(VISUALS_LINE) || body.includes(BOTH_LINE),
    music: body.includes(MUSIC_LINE) || body.includes(BOTH_LINE),
  };
}

const notBlank = (line: string) => line.trim() !== '';

/** Without blank lines at either end. */
function trimBlank(lines: string[]): string[] {
  const first = lines.findIndex(notBlank);
  if (first < 0) return [];
  return lines.slice(first, lines.length - [...lines].reverse().findIndex(notBlank));
}

/**
 * The file's text with the AI lines as asked, and everything else untouched. They stay where they already are;
 * new ones go in a paragraph of their own, above the hashtags if the description ends with those.
 */
export function setAiLines(text: string, want: AiLines): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const range = descriptionLines(lines);
  const has = readAiLines(text);
  if (!range || !has || (has.visuals === want.visuals && has.music === want.music)) return text;

  const body = lines.slice(range.from, range.to);
  const others = body.filter((l) => !isAiLine(l));
  let at = body.findIndex(isAiLine); // the lines before the first AI line are all "others", so this index holds
  if (at < 0) {
    const last = others.map(notBlank).lastIndexOf(true);
    at = last >= 0 && /^#\S/.test(others[last].trim()) ? last : last + 1;
  }
  const paragraphs = [
    trimBlank(others.slice(0, at)),
    [...(want.visuals ? [VISUALS_LINE] : []), ...(want.music ? [MUSIC_LINE] : [])],
    trimBlank(others.slice(at)),
  ].filter((p) => p.length > 0);
  const newBody = paragraphs.flatMap((p, i) => (i === 0 ? p : ['', ...p]));
  const endsWithBlank = range.to < lines.length || body[body.length - 1] === '';
  return [...lines.slice(0, range.from), ...newBody, ...(endsWithBlank ? [''] : []), ...lines.slice(range.to)].join(eol);
}
