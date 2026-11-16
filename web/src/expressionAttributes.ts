import type { Tag } from './api';

// Pose and gaze are shown with framing; emotional and gestural categories are expressions.
const FRAMING = new Set(`Frontal ThreeQuarter Profile ExtremeCloseUp CloseUp HeadShoulders UpperBody FullBody LeftFacing RightFacing LookAtCamera LookOffCamera LookUp LookDown LookLeft LookRight SideEye HeadTilt HeadBack HeadDown LeaningIn LeaningBack Standing Seated HandsOutOfFrame OneHandVisible BothHandsVisible HandsVisible ChinTouch ChinRest FaceTouch TempleTouch CheekCover HandNeck HandOnChest HandsClasped HandsOnHips ArmsCrossed OneArmRaised BothArmsRaised ShouldersRaised OpenPalm PalmUp PalmOut IndexFingerRaised`.toLowerCase().split(' '));
const MORPHOLOGY = new Set(`Smile Grin Smirk Sneer Snarl Crying Pout MouthOpen OMouth OpenMouthWide OpenMouthLaugh TeethVisible PursedLips LipPress Squint RaisedBrow FurrowedBrow EyesWide EyesClosed EyesClenched Asymmetric`.toLowerCase().split(' '));

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
