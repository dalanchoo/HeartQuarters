import type { Angle, Topic } from '../../server/video-profile';

// The names shown for each Topic and Angle. The lists themselves are in server/video-profile.ts;
// these are typed so the build fails if a list changes and a label is forgotten.
export const TOPIC_LABELS: Record<Topic, string> = {
  unassigned: 'Unassigned', communication: 'Communication', sdam: 'SDAM', aphantasia: 'Aphantasia', psychedelics: 'Psychedelics', emotions: 'Emotions',
  relationships: 'Relationships', kink: 'Kink', healing: 'Healing', meaning: 'Meaning',
};
export const ANGLE_LABELS: Record<Angle, string> = { unassigned: 'Unassigned', story: 'My Story', wisdom: 'Wisdom', explainer: 'Explainer' };

/** "SDAM + Communication" for a main and second value, "SDAM" for just a main one, "" for neither. */
export function pairLabel<T extends string>(first: T, second: T, labels: Record<T, string>): string {
  return [first, second].filter((v) => v !== 'unassigned').map((v) => labels[v]).join(' + ');
}
