import { describe, expect, it } from 'vitest';
import { shotGenerationPreset } from './shotPreset';

describe('shotGenerationPreset', () => {
  it('fills the generator from a look and ignores tags the generator cannot use', () => {
    const shot = { id: '1', category: 'Composure/Calm', title: 'Settled', description: 'A slight smile.', framing: ['Frontal', 'HeadShoulders'], pose: ['ShouldersRaised', 'LookAtCamera'], morphology: ['Smile'], alsoFits: [], sources: [], addedAt: '', done: false };
    expect(shotGenerationPreset(shot)).toEqual({ framing: 'HeadShoulders', angle: 'Frontal', gaze: 'LookAtCamera', look: 'A slight smile. Facial details: Smile.' });
    expect(shotGenerationPreset({ ...shot, framing: [], pose: [], morphology: [] })).toEqual({ framing: 'HeadShoulders', angle: '', gaze: '', look: 'A slight smile.' });
  });
});
