import type { ExpressionShot } from '../../server/expression-shot-list';
import type { GenerationPreset } from './ExpressionGenerator';

const FRAMINGS = ['HeadShoulders', 'UpperBody', 'CloseUp'];
const ANGLES = ['Frontal', 'ThreeQuarter', 'LeftFacing', 'RightFacing'];
const GAZES = ['LookAtCamera', 'LookOffCamera', 'LookLeft', 'LookRight', 'LookUp', 'LookDown'];

/** Turn a Shot List look into the generator's settings, using only choices the generator offers. */
export function shotGenerationPreset(shot: ExpressionShot): GenerationPreset {
  const details = shot.morphology.length ? ` Facial details: ${shot.morphology.join(', ')}.` : '';
  return {
    framing: shot.framing.find(tag => FRAMINGS.includes(tag)) ?? 'HeadShoulders',
    angle: shot.framing.find(tag => ANGLES.includes(tag)) ?? '',
    gaze: shot.pose.find(tag => GAZES.includes(tag)) ?? '',
    look: `${shot.description}${details}`.trim(),
  };
}
