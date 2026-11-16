import { parseTags, type Tag } from './expressions.js';

// Observable framing, facial mechanics, gaze and pose. Subjective emotions from the
// unblinded assessment are deliberately not in this list.
const PHYSICAL = new Set(`Asymmetric BothHandsVisible BothArmsRaised CheekCover ChinRest ChinTouch ClenchedFist CloseUp Crying DuckFace ExtremeCloseUp EyesClenched EyesClosed EyesWide FaceTouch Facepalm FingerGun Frontal FullBody FurrowedBrow Grin HandNeck HandOnChest HandOnHead HandsClasped HandsOnHips HandsOutOfFrame HandsVisible HeadBack HeadDown HeadShoulders HeadTilt IndexFingerRaised KissFace LeaningBack LeaningIn LeftFacing LipPress LookAtCamera LookDown LookLeft LookOffCamera LookRight LookUp MiddleFinger MouthOpen NosePick OMouth OneArmRaised OneHandVisible OpenMouthLaugh OpenMouthWide OpenPalm PalmOut PalmUp PeaceSign Pointing Pout Profile PursedLips RaisedBrow RightFacing Seated ShouldersRaised SideEye Smile Smirk Snarl Sneer Squint Standing TeethVisible TempleTouch ThreeQuarter ThumbsUp ThumbSuck TongueOut UpperBody Whistle Wince ArmsCrossed`.toLowerCase().split(' '));

function readAssessment(text: string, source: string): Tag[] {
  const result: Tag[] = [];
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const value = line.trim();
    if (!value || /^=+$/.test(value) || /^(Morphology|PoseGaze|Framing|Expression)$/i.test(value)) continue;
    if (!/^[^,:]+(?:,|:)\s*(?:N\/A|\d{1,3}%?)\s*,\s*(?:UNCONFIRMED|CONFIRMED)\s*$/i.test(value)) throw new Error(`Unrecognized line in ${source}: ${value}`);
    const tag = parseTags(value)[0];
    if (!tag || (tag.confidence !== null && (tag.confidence < 0 || tag.confidence > 100))) throw new Error(`Invalid tag in ${source}: ${value}`);
    result.push(tag);
  }
  return result;
}

export type DuplicateScorePolicy = 'first' | 'higher' | 'review';

export function hasConflictingGptScores(text: string): boolean {
  const seen = new Map<string, number | null>();
  for (const tag of readAssessment(text, 'GPT sidecar')) {
    const key = tag.tag.toLowerCase();
    if (seen.has(key) && seen.get(key) !== tag.confidence) return true;
    seen.set(key, tag.confidence);
  }
  return false;
}

/** Merge independent GPT guesses, observable unblinded attributes, and John's confirmations. */
export function mergeExpressionSidecars(gpt: string | null, sonnet: string | null, plain: string | null, policy: DuplicateScorePolicy = 'first'): string {
  const merged = new Map<string, Tag>();
  const add = (tag: Tag, trustConfirmation: boolean) => {
    const key = tag.tag.toLowerCase();
    const current = merged.get(key);
    if (!current) merged.set(key, { ...tag, confirmed: trustConfirmation && tag.confirmed });
    else {
      if (current.confidence === null && tag.confidence !== null) current.confidence = tag.confidence;
      if (trustConfirmation && tag.confirmed) current.confirmed = true;
    }
  };
  if (gpt !== null) {
    if (policy === 'review' && hasConflictingGptScores(gpt)) throw new Error('This photo has conflicting GPT scores and needs review.');
    for (const tag of readAssessment(gpt, 'GPT sidecar')) {
      const current = merged.get(tag.tag.toLowerCase());
      if (policy === 'higher' && current && tag.confidence !== null && (current.confidence === null || tag.confidence > current.confidence)) current.confidence = tag.confidence;
      else add(tag, false);
    }
  }
  if (sonnet !== null) for (const tag of readAssessment(sonnet, 'Sonnet sidecar')) if (PHYSICAL.has(tag.tag.toLowerCase())) add(tag, false);
  // If the model files are already gone, retain the existing sidecar in full;
  // running cleanup a second time must never erase the previous merge.
  if (plain !== null) for (const tag of readAssessment(plain, 'existing sidecar')) if ((gpt === null && sonnet === null) || tag.confirmed || PHYSICAL.has(tag.tag.toLowerCase())) add(tag, true);
  return [...merged.values()].map(tag => `${tag.tag}, ${tag.confidence === null ? 'N/A' : `${tag.confidence}%`}, ${tag.confirmed ? 'CONFIRMED' : 'UNCONFIRMED'}`).join('\n') + (merged.size ? '\n' : '');
}
