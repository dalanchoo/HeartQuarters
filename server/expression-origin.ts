/** Recognize explicitly marked AI photos, including older AI filenames. */
export function isAiExpression(photo: { name: string; tags: { tag: string; confirmed: boolean }[] }): boolean {
  return /_AI_[^/]+$/i.test(photo.name) || photo.tags.some(t => t.confirmed && t.tag.toLowerCase() === 'aigenerated');
}

export function matchesExpressionOrigin(photo: { name: string; tags: { tag: string; confirmed: boolean }[] }, filter: 'all' | 'real' | 'ai'): boolean {
  return filter === 'all' || (filter === 'ai') === isAiExpression(photo);
}

/** Recognize photos explicitly marked as motion images (for example video frame snapshots). */
export function isMotionExpression(photo: { tags: { tag: string; confirmed: boolean }[] }): boolean {
  return photo.tags.some(t => t.confirmed && t.tag.toLowerCase() === 'motionimage');
}

export function matchesMotionFilter(photo: { tags: { tag: string; confirmed: boolean }[] }, filter: 'all' | 'motion' | 'still'): boolean {
  return filter === 'all' || (filter === 'motion') === isMotionExpression(photo);
}
