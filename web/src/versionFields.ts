import { parseFields, setFieldValue } from './packaging';

/** Include fields unique to either version, without duplicating differently cased names. */
export function comparisonLabels(left: string, right: string): string[] {
  const labels: string[] = [];
  for (const field of [...(parseFields(left) ?? []), ...(parseFields(right) ?? [])]) {
    if (!labels.some(label => label.toLowerCase() === field.label.toLowerCase())) labels.push(field.label);
  }
  return labels;
}

/** Copy selected fields without changing any others; refuse ambiguous or unparseable files. */
export function copyVersionFields(target: string, source: string, labels: string[]): string {
  const from = parseFields(source); if (!from || !parseFields(target)) throw new Error('Both YouTube files must have recognizable fields.');
  let result = target;
  for (const label of labels) {
    const matches = from.filter(f => f.label.toLowerCase() === label.toLowerCase());
    const current = parseFields(result)!; const positions = current.map((f, i) => ({ f, i })).filter(x => x.f.label.toLowerCase() === label.toLowerCase());
    if (matches.length !== 1 || positions.length > 1) throw new Error(`Cannot copy ${label}: the field is missing or duplicated.`);
    if (positions.length) result = setFieldValue(result, positions[0].i, matches[0].value);
    else result = `${result.replace(/\s+$/, '')}\n\n${label}:\n${matches[0].value}\n`;
  }
  return result;
}
