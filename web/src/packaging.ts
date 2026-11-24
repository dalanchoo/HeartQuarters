// Packaging files (YouTube.md etc.) are written as Markdown sections (or legacy labelled blocks):
//
//   ## Title
//   When Should You Tell Someone You Have SDAM?
//
//   ## Description
//   ...
//
// parseFields splits them into fields so each one gets its own Copy button.
export interface Field {
  label: string;
  value: string;
}

/** Alphabetize comma-separated YouTube tags without changing their spelling or removing duplicates. */
export function sortTags(value: string): string {
  return value.split(',').map(tag => tag.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }) || a.localeCompare(b, 'en')).join(', ');
}

/** Sort tags when a YouTube metadata file is saved, leaving all other fields intact. */
export function sortYoutubeTags(text: string): string {
  const fields = parseFields(text);
  if (!fields || fields.filter(f => f.label.toLowerCase() === 'tags').length !== 1) return text;
  const index = fields.findIndex(f => f.label.toLowerCase() === 'tags');
  return setFieldValue(text, index, sortTags(fields[index].value));
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

const HEADING_LABEL_RE = /^##\s+([A-Z][A-Za-z ]{0,30}):?\s*$/;
const LABEL_RE = /^([A-Z][A-Za-z ]{0,30}):\s*$/;

// A description has lines of its own that look like labels ("Full video:", above a link). Only these end it.
const AFTER_DESCRIPTION = new Set(['title', 'tags', 'pinned comment', 'comment', 'hashtags', 'thumbnail text', 'thumbnail idea', 'thumbnail prompt', 'accessibility', 'purpose', 'video language', 'visibility', 'made for kids', 'altered content', 'playlists']);

/** Format a new field heading as Markdown (`## Label`), or `Label:` when adding to an un-migrated colon-label file. */
export function formatFieldLabel(text: string, label: string): string {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const hasHeading = lines.some((line) => HEADING_LABEL_RE.test(line));
  const hasColon = lines.some((line) => LABEL_RE.test(line));
  return !hasHeading && hasColon ? `${label}:` : `## ${label}`;
}

/** Add missing planning fields, leaving the existing document and its values alone. */
export function addThumbnailPlanningFields(text: string): string {
  const parsed = parseFields(text);
  if (!parsed && text.replace(/^#.*$/gm, '').trim()) throw new Error('This file is not in the usual labeled format. Add thumbnail fields in the file manually.');
  const fields = parsed ?? [];
  const existing = new Set(fields.map((field) => field.label.toLowerCase()));
  const missing = ['Thumbnail text', 'Thumbnail idea'].filter((label) => !existing.has(label.toLowerCase()));
  if (!missing.length) return text;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const prefix = text && !text.endsWith('\n') ? `${eol}${eol}` : text ? eol : '';
  return text + prefix + missing.map((label) => `${formatFieldLabel(text, label)}${eol}`).join(eol);
}

/** True for a file nobody has filled in: nothing but headings, labels and the template's "#tags". */
export function isBlankPackaging(text: string): boolean {
  return text.split(/\r?\n/).every((line) => {
    const trimmed = line.trim();
    return trimmed === '' || trimmed === '#tags' || trimmed.startsWith('# ') || labelOf(trimmed) !== null;
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

/**
 * A line's label, or null if it isn't one. A label is "## Title" (Markdown) or legacy "Title:" on its own line.
 * Older files also wrote some labels in capitals without the colon ("PINNED COMMENT"); those count when they're one
 * of the known field names, and are given the usual spelling ("Pinned Comment").
 */
export function labelOf(line: string): string | null {
  const trimmed = line.trim();
  const heading = HEADING_LABEL_RE.exec(trimmed);
  if (heading) return heading[1];
  const match = LABEL_RE.exec(trimmed);
  if (match) return match[1];
  const old = /^([A-Z][A-Z ]{2,30}):?$/.exec(trimmed);
  if (old && AFTER_DESCRIPTION.has(old[1].toLowerCase())) return old[1].toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  return null;
}

/** Each field's label and which lines hold its value: from just after the label, up to the next label. */
function fieldSpans(lines: string[]): { label: string; from: number; to: number }[] {
  const spans: { label: string; from: number; to: number }[] = [];
  lines.forEach((line, i) => {
    const label = labelOf(line);
    if (!label) return;
    const current = spans[spans.length - 1];
    // Free-writing fields (a description, a pinned comment) can hold lines like "Register here:"; only a real field label ends them.
    if (current && ['description', 'pinned comment', 'comment'].includes(current.label.toLowerCase()) && !AFTER_DESCRIPTION.has(label.toLowerCase())) return;
    if (current) current.to = i;
    spans.push({ label, from: i + 1, to: lines.length });
  });
  return spans;
}

/**
 * Convert legacy labelled packaging text ("Title:", "PINNED COMMENT") to standard Markdown "## Field" headings.
 * Leaves non-packaging prose, descriptions containing "Full video:" lines, line endings, and BOM intact.
 */
export function migratePackagingText(text: string): string {
  const bom = text.startsWith('\uFEFF') ? '\uFEFF' : '';
  const body = bom ? text.slice(1) : text;
  const before = parseFields(body);
  if (!before) return text;
  const eol = body.includes('\r\n') ? '\r\n' : '\n';
  const lines = body.split(/\r?\n/);
  for (const span of fieldSpans(lines)) lines[span.from - 1] = `## ${span.label}`;
  const next = bom + lines.join(eol);
  const after = parseFields(bom ? next.slice(1) : next);
  if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error('Migration changed parsed field values.');
  return next;
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

/** Restore a field from the saved file, or remove it when the draft introduced it. */
export function undoFieldEdit(text: string, saved: string, label: string): string {
  const current = parseFields(text); const original = parseFields(saved);
  if (!current || !original) throw new Error('The packaging file does not have recognizable fields.');
  const matching = current.map((field, i) => ({ field, i })).filter(item => item.field.label.toLowerCase() === label.toLowerCase());
  const was = original.filter(field => field.label.toLowerCase() === label.toLowerCase());
  if (matching.length !== 1 || was.length > 1) throw new Error(`Cannot undo ${label}: the field is missing or duplicated.`);
  if (was.length) {
    const restored = setFieldValue(text, matching[0].i, was[0].value);
    return restored.trimEnd() === saved.trimEnd() ? saved : restored;
  }
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/); const span = fieldSpans(lines)[matching[0].i];
  const restored = [...lines.slice(0, span.from - 1), ...lines.slice(span.to)].join(eol);
  return restored.trimEnd() === saved.trimEnd() ? saved : restored;
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
  const label = lines.findIndex((l) => labelOf(l)?.toLowerCase() === 'description');
  if (label < 0) return null;
  const next = lines.findIndex((l, i) => {
    const found = i > label ? labelOf(l) : null;
    return !!found && AFTER_DESCRIPTION.has(found.toLowerCase());
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

/** What a YouTube text file needs before the video counts as having its metadata, in the order they appear. */
const REQUIRED_METADATA = ['Title', 'Description', 'Hashtags', 'Tags', 'Pinned Comment', 'Video language', 'Made for kids', 'Altered content'];

/**
 * The metadata a YouTube text file is still missing (empty when it's complete). Hashtags count when the description
 * or a Hashtags field has at least one, other than the template's "#tags".
 */
export function missingMetadata(text: string): string[] {
  const fields = parseFields(text.replace(/^﻿/, ''));
  if (!fields) return [...REQUIRED_METADATA];
  const value = (label: string) => fields.find((f) => f.label.toLowerCase() === label.toLowerCase())?.value.trim() ?? '';
  const hashtags = `${value('Description')}\n${value('Hashtags')}`.match(/(^|\s)#[\p{L}\p{N}_]+/gu)?.some((tag) => tag.trim().toLowerCase() !== '#tags') ?? false;
  return REQUIRED_METADATA.filter((label) => (label === 'Hashtags' ? !hashtags : !value(label)));
}
