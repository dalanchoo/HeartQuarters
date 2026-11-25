// Filling in a Shot List look's tags from its description (John, 2026-11-25). The descriptions are detailed ("looking
// at the camera, one eyebrow gently raised, mouth slightly parted, no squint"), so an AI reads each one and picks the
// library's Framing, Pose & Gaze and Morphology tags it states or plainly implies, and the tags it rules out. Tags are
// only ever added: a look keeps every tag it already has. The tags go into the picture's prompt and tag file.
import { changeShotList, readShotList, type ExpressionShot } from './expression-shot-list.js';
import { FRAMING_TAGS, MORPHOLOGY_TAGS, POSE_TAGS } from './expression-attribute-vocabulary.js';
import type { AskText } from './expression-shot-merge.js';

export interface FoundTags { framing: string[]; pose: string[]; morphology: string[]; ruledOut: string[] }

const VOCABULARY = { framing: FRAMING_TAGS, pose: POSE_TAGS, morphology: MORPHOLOGY_TAGS };
const ALL = new Map([...FRAMING_TAGS, ...POSE_TAGS, ...MORPHOLOGY_TAGS].map(tag => [tag.toLowerCase(), tag]));

/** The question: for each look, the tags its words state or imply, and the tags they rule out. */
export function shotTagsPrompt(shots: ExpressionShot[]): string {
  const looks = shots.map(shot => ({ id: shot.id, folder: shot.category.replace('/', ' > '), look: [shot.title, shot.description].filter(Boolean).join('. ') }));
  return [
    'You are tagging a shot list of facial expressions a YouTuber, John, wants photographed of himself for thumbnails. Each look has a written description. Tag each look using ONLY these tag words, spelled exactly:',
    `Framing: ${FRAMING_TAGS.join(' ')}`,
    `Pose & Gaze: ${POSE_TAGS.join(' ')}`,
    `Morphology (the face): ${MORPHOLOGY_TAGS.join(' ')}`,
    'For each look give the tags its description states or plainly implies. For example "looking straight at the camera" is LookAtCamera, "one eyebrow raised" is RaisedBrow and Asymmetric, "mouth slightly parted" is MouthOpen, "a half-smile" is Smile and Asymmetric. Do not guess at things the description leaves open.',
    'Also give the tags the description rules out, in "ruledOut". For example "no squint" rules out Squint, "eyes open" rules out EyesClosed, "no exaggerated surprise" rules out EyesWide, "lips closed" rules out MouthOpen. Only rule out what the words exclude; a tag that is merely not mentioned is not ruled out. A tag cannot be both given and ruled out.',
    'Answer with JSON only, in this form: {"looks": [{"id": "...", "framing": [], "pose": [], "morphology": [], "ruledOut": []}, ...]}, one entry per look.',
    'The looks:',
    JSON.stringify(looks, null, 1),
  ].join('\n\n');
}

/** The AI's tags for each known look, keeping only real tag words in the right list. */
export function parseShotTags(answer: string, shots: ExpressionShot[]): Map<string, FoundTags> {
  const start = answer.indexOf('{'); const end = answer.lastIndexOf('}');
  let value: unknown;
  try { value = JSON.parse(answer.slice(start, end + 1)); } catch { throw new Error('The AI did not answer with tags for the looks.'); }
  const looks = (value as { looks?: unknown })?.looks;
  if (start < 0 || !Array.isArray(looks)) throw new Error('The AI did not answer with tags for the looks.');
  const known = new Set(shots.map(s => s.id));
  const pick = (list: unknown, allowed: string[]) => {
    const names = new Map(allowed.map(tag => [tag.toLowerCase(), tag]));
    return Array.isArray(list) ? [...new Set(list.flatMap(t => typeof t === 'string' && names.has(t.trim().toLowerCase()) ? [names.get(t.trim().toLowerCase())!] : []))] : [];
  };
  const result = new Map<string, FoundTags>();
  for (const item of looks) {
    const entry = item as Record<string, unknown>;
    if (!entry || typeof entry.id !== 'string' || !known.has(entry.id) || result.has(entry.id)) continue;
    const found = { framing: pick(entry.framing, VOCABULARY.framing), pose: pick(entry.pose, VOCABULARY.pose), morphology: pick(entry.morphology, VOCABULARY.morphology) };
    const given = new Set([...found.framing, ...found.pose, ...found.morphology]);
    result.set(entry.id, { ...found, ruledOut: pick(entry.ruledOut, [...ALL.values()]).filter(tag => !given.has(tag)) });
  }
  return result;
}

/**
 * Adds the found tags to each look; nothing it already has is removed. A tag the look already has is never ruled out,
 * and a ruled-out tag is not added. Returns how many looks gained a tag.
 */
export function applyShotTags(shots: ExpressionShot[], found: Map<string, FoundTags>): number {
  let changed = 0;
  for (const shot of shots) {
    const tags = found.get(shot.id); if (!tags) continue;
    const before = JSON.stringify([shot.framing, shot.pose, shot.morphology, shot.ruledOut ?? []]);
    const ruledOut = new Set(shot.ruledOut ?? []);
    for (const key of ['framing', 'pose', 'morphology'] as const) shot[key] = [...new Set([...shot[key], ...tags[key].filter(t => !ruledOut.has(t))])];
    const given = new Set([...shot.framing, ...shot.pose, ...shot.morphology]);
    const out = [...new Set([...(shot.ruledOut ?? []), ...tags.ruledOut])].filter(t => !given.has(t));
    if (out.length) shot.ruledOut = out; else delete shot.ruledOut;
    if (JSON.stringify([shot.framing, shot.pose, shot.morphology, shot.ruledOut ?? []]) !== before) changed++;
  }
  return changed;
}

/** Asks the AI about the looks with these ids (every look with a description when none are given) and saves the tags. */
export async function tagShots(ask: AskText, ids?: Set<string>): Promise<{ shots: ExpressionShot[]; tagged: number }> {
  const chosen = readShotList().filter(s => s.description.trim() && (!ids || ids.has(s.id)));
  if (!chosen.length) return { shots: readShotList(), tagged: 0 };
  const found = parseShotTags(await ask(shotTagsPrompt(chosen)), chosen);
  let tagged = 0;
  const shots = changeShotList(list => { tagged = applyShotTags(list, found); });
  return { shots, tagged };
}

let filling = false;
/** Fill In Tags: every look on the list, one at a time per run. */
export async function fillInShotTags(ask: AskText): Promise<{ shots: ExpressionShot[]; tagged: number }> {
  if (filling) throw new Error('Tags are already being filled in.');
  filling = true;
  try { return await tagShots(ask); } finally { filling = false; }
}
