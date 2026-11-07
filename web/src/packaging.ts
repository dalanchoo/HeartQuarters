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

const LABEL_RE = /^([A-Z][A-Za-z ]{0,30}):\s*$/;

/** Returns the fields, or null if the file isn't in the labelled-block format. */
export function parseFields(text: string): Field[] | null {
  const fields: { label: string; lines: string[] }[] = [];
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const match = LABEL_RE.exec(line.trim());
    if (match) fields.push({ label: match[1], lines: [] });
    else if (fields.length) fields[fields.length - 1].lines.push(line);
  }
  if (fields.length < 2) return null;
  return fields.map((f) => ({ label: f.label, value: f.lines.join('\n').trim() }));
}
