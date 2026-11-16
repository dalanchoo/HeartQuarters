import type { Tag } from './api';
import { FRAMING_TAGS, MORPHOLOGY_TAGS } from '../../server/expression-attribute-vocabulary';

// Pose and gaze are shown with framing; emotional and gestural categories are expressions.
const FRAMING = new Set(FRAMING_TAGS.map(tag => tag.toLowerCase()));
const MORPHOLOGY = new Set(MORPHOLOGY_TAGS.map(tag => tag.toLowerCase()));

export function groupExpressionAttributes(tags: Tag[]): { details: Tag[]; framing: Tag[]; morphology: Tag[]; expressions: Tag[] } {
  const groups: { details: Tag[]; framing: Tag[]; morphology: Tag[]; expressions: Tag[] } = { details: [], framing: [], morphology: [], expressions: [] };
  for (const tag of tags) {
    const key = tag.tag.toLowerCase();
    const group = key === 'aigenerated' ? 'details' : FRAMING.has(key) ? 'framing' : MORPHOLOGY.has(key) ? 'morphology' : 'expressions';
    groups[group].push(tag);
  }
  for (const group of Object.values(groups)) group.sort((a, b) => Number(b.confirmed) - Number(a.confirmed));
  return groups;
}
