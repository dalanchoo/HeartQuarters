import type { Angle, Topic } from '../../server/video-profile';

// The names shown for each Topic and Angle. The lists themselves are in server/video-profile.ts;
// these are typed so the build fails if a list changes and a label is forgotten.
export const TOPIC_LABELS: Record<Topic, string> = {
  unassigned: 'Unassigned', sdam: 'SDAM', aphantasia: 'Aphantasia', psychedelics: 'Psychedelics', emotions: 'Emotions',
  relationships: 'Relationships', kink: 'Kink', healing: 'Healing', meaning: 'Meaning',
};
export const ANGLE_LABELS: Record<Angle, string> = { unassigned: 'Unassigned', story: 'My Story', wisdom: 'Wisdom' };
