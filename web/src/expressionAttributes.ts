import type { Tag } from './api';
import { FRAMING_TAGS, MORPHOLOGY_TAGS, POSE_TAGS } from '../../server/expression-attribute-vocabulary';

const FRAMING = new Set(FRAMING_TAGS.map(tag => tag.toLowerCase()));
const POSE = new Set(POSE_TAGS.map(tag => tag.toLowerCase()));
const MORPHOLOGY = new Set(MORPHOLOGY_TAGS.map(tag => tag.toLowerCase()));

export function groupExpressionAttributes(tags: Tag[]): { details: Tag[]; framing: Tag[]; pose: Tag[]; morphology: Tag[]; expressions: Tag[] } {
  const groups: { details: Tag[]; framing: Tag[]; pose: Tag[]; morphology: Tag[]; expressions: Tag[] } = { details: [], framing: [], pose: [], morphology: [], expressions: [] };
  for (const tag of tags) {
    const key = tag.tag.toLowerCase();
    const group = key === 'aigenerated' || key === 'motionimage' ? 'details' : FRAMING.has(key) ? 'framing' : POSE.has(key) ? 'pose' : MORPHOLOGY.has(key) ? 'morphology' : 'expressions';
    groups[group].push(tag);
  }
  for (const group of Object.values(groups)) group.sort((a, b) => Number(b.confirmed) - Number(a.confirmed));
  return groups;
}
