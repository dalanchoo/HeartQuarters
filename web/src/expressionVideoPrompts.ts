import type { ExpressionIndex } from './api';
import type { ExpressionShot } from '../../server/expression-shot-list';

export type VideoPromptMode = 'shot-list' | 'library-gaps';
export type VideoGazeDirection = 'right' | 'left' | 'both';

export interface ExpressionTarget {
  label: string;
  detail?: string;
}

export interface LibraryGap {
  path: string;
  name: string;
  definition: string | null;
  count: number;
  rightCount: number;
  leftCount: number;
}

export interface GeneratedVideoPrompt {
  title: string;
  expressions: string[];
  prompt: string;
}

/** Finds leaf expression categories sorted by fewest photos (and fewest camera-right photos) first. */
export function findLibraryGaps(index: ExpressionIndex): LibraryGap[] {
  const parents = new Set(index.categories.map((c) => c.parent).filter((p): p is string => !!p));
  const leaves = index.categories.filter((c) => c.path && !parents.has(c.path));

  const photosByCat = new Map<string, { right: number; left: number }>();
  for (const photo of index.photos) {
    const activeTags = new Set(photo.tags.filter((t) => !t.disconfirmed).map((t) => t.tag));
    const entry = photosByCat.get(photo.category) ?? { right: 0, left: 0 };
    if (activeTags.has('RightFacing') || activeTags.has('LookRight')) entry.right++;
    if (activeTags.has('LeftFacing') || activeTags.has('LookLeft')) entry.left++;
    photosByCat.set(photo.category, entry);
  }

  return leaves
    .map((c) => {
      const counts = photosByCat.get(c.path) ?? { right: 0, left: 0 };
      return {
        path: c.path,
        name: c.name,
        definition: c.definition,
        count: c.ownCount,
        rightCount: counts.right,
        leftCount: counts.left,
      };
    })
    .sort((a, b) => a.count - b.count || a.rightCount - b.rightCount || a.path.localeCompare(b.path));
}

function formatShotExpression(shot: ExpressionShot): ExpressionTarget {
  const clean = shot.expression.trim().replace(/\s+/g, ' ');
  return { label: clean };
}

function formatGapExpression(gap: LibraryGap): ExpressionTarget {
  const label = gap.path.split('/').join(' > ');
  return {
    label,
    detail: gap.definition ? gap.definition.trim() : undefined,
  };
}

function gazeInstruction(gaze: VideoGazeDirection): string {
  if (gaze === 'right') {
    return 'He is angled and looking toward camera right (looking toward the right side of the frame, ideal for placing him on the left side of a YouTube thumbnail), keeping both eyes clearly visible.';
  }
  if (gaze === 'left') {
    return 'He is angled and looking toward camera left (looking toward the left side of the frame, ideal for placing him on the right side of a YouTube thumbnail), keeping both eyes clearly visible.';
  }
  return 'For each expression, he holds it looking toward camera right for a clear beat, then smoothly turns his head and gaze to hold the same expression looking toward camera left, keeping both eyes clearly visible.';
}

/** Builds ready-to-paste AI video prompts batched into `perClip` expressions per clip. */
export function buildVideoPrompts(
  targets: ExpressionTarget[],
  gaze: VideoGazeDirection,
  perClip = 3,
): GeneratedVideoPrompt[] {
  if (targets.length === 0) return [];
  const size = Math.max(1, Math.min(8, Math.round(perClip)));
  const batches: ExpressionTarget[][] = [];
  for (let i = 0; i < targets.length; i += size) {
    batches.push(targets.slice(i, i + size));
  }

  const gazeLabel = gaze === 'right' ? 'Camera Right' : gaze === 'left' ? 'Camera Left' : 'Right & Left';

  return batches.map((batch, index) => {
    const lines = batch.map((item, i) =>
      item.detail ? `${i + 1}. ${item.label} — ${item.detail}` : `${i + 1}. ${item.label}`,
    );
    const estSeconds = Math.max(6, Math.round(batch.length * (gaze === 'both' ? 4 : 2.5)));
    const holdText = gaze === 'both' ? 'about 1 to 1.5 seconds on each side' : 'about 1.5 seconds';
    const prompt = [
      'Using the attached reference photo of the man, preserve his exact facial identity, grey hair, goatee, age, skin texture, and clothing completely consistently throughout the entire video.',
      'Framing & Background: Medium close-up from the chest and shoulders up, standing in front of a clean, solid matte neutral medium-grey studio backdrop with sharp, uncluttered separation around his hair and shoulders so he is easy to cut out for YouTube thumbnails.',
      'Lighting: Perfect, soft, even studio key lighting on his face with gentle fill light and a subtle rim light separating him from the neutral background. Crisp focus, high detail, no harsh shadows, and no motion blur.',
      `Gaze Direction: ${gazeInstruction(gaze)}`,
      `Action & Timing: Static locked-off camera with no camera movement. Over roughly ${estSeconds} seconds, he smoothly transitions through the following ${batch.length} distinct facial ${batch.length === 1 ? 'expression' : 'expressions'} in order, pausing and holding each expression still for ${holdText} with unhurried transitions so crisp individual still frames can be captured:`,
      lines.join('\n'),
      'Style: Natural, authentic, grounded human expressions — no exaggerated cartoon faces, no speaking or lip movement unless part of the expression.',
    ].join('\n\n');

    return {
      title: `Clip ${index + 1} (${gazeLabel} · ${batch.length} ${batch.length === 1 ? 'expression' : 'expressions'} · ~${estSeconds}s)`,
      expressions: batch.map((b) => b.label),
      prompt,
    };
  });
}

export function buildPromptsFromShotList(
  shots: ExpressionShot[],
  gaze: VideoGazeDirection,
  perClip = 3,
): GeneratedVideoPrompt[] {
  const remaining = shots.filter((s) => !s.done).map(formatShotExpression);
  return buildVideoPrompts(remaining, gaze, perClip);
}

export function buildPromptsFromGaps(
  gaps: LibraryGap[],
  gaze: VideoGazeDirection,
  perClip = 3,
  maxExistingPhotos = 2,
): GeneratedVideoPrompt[] {
  const needed = gaps.filter((g) => g.count <= maxExistingPhotos).map(formatGapExpression);
  return buildVideoPrompts(needed, gaze, perClip);
}
