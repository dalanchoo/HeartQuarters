/** Recognize explicitly marked AI photos, including older AI filenames. */
export function isAiExpression(photo: { name: string; tags: { tag: string; confirmed: boolean }[] }): boolean {
  return /_AI_[^/]+$/i.test(photo.name) || photo.tags.some(t => t.confirmed && t.tag.toLowerCase() === 'aigenerated');
}

export function matchesExpressionOrigin(photo: { name: string; tags: { tag: string; confirmed: boolean }[] }, filter: 'all' | 'real' | 'ai'): boolean {
  return filter === 'all' || (filter === 'ai') === isAiExpression(photo);
}

/** Recognize photos that are Motion Photos (embedded video in the file). */
export function isMotionExpression(photo: { motionPhoto?: boolean }): boolean {
  return !!photo.motionPhoto;
}

export function matchesMotionFilter(photo: { motionPhoto?: boolean }, filter: 'all' | 'motion' | 'still'): boolean {
  return filter === 'all' || (filter === 'motion') === isMotionExpression(photo);
}
