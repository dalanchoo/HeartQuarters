// The shared vocabulary used by the photo viewer and the server when adding tags.
export const FRAMING_TAGS = `Frontal ThreeQuarter Profile ExtremeCloseUp CloseUp HeadShoulders UpperBody FullBody LeftFacing RightFacing`.split(' ');
export const POSE_TAGS = `LookAtCamera LookOffCamera LookUp LookDown LookLeft LookRight SideEye HeadTilt HeadBack HeadDown LeaningIn LeaningBack Standing Seated HandsOutOfFrame OneHandVisible BothHandsVisible HandsVisible ChinTouch ChinRest FaceTouch TempleTouch CheekCover HandNeck HandOnChest HandsClasped HandsOnHips ArmsCrossed OneArmRaised BothArmsRaised ShouldersRaised OpenPalm PalmUp PalmOut IndexFingerRaised`.split(' ');
export const MORPHOLOGY_TAGS = `Smile Grin Smirk Sneer Snarl Crying Pout MouthOpen OMouth OpenMouthWide OpenMouthLaugh TeethVisible PursedLips LipPress Squint RaisedBrow FurrowedBrow EyesWide EyesClosed EyesClenched Asymmetric`.split(' ');

export const OPEN_MOUTH_TAGS = ['MouthOpen', 'OMouth', 'OpenMouthWide', 'OpenMouthLaugh'];
export const THUMBNAIL_PHOTO_ATTRIBUTES = [...POSE_TAGS.filter(tag => tag.startsWith('Look')), ...OPEN_MOUTH_TAGS, 'PursedLips', 'LipPress'];
