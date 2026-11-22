// John's own description of a video: its Topic (what it is about), its Angle (what kind of video it is) and a note.
// Kept in that video's Drive folder as "About This Video.json", shown in Video Projects and on the Channel tab.
import fs from 'node:fs';
import path from 'node:path';
import { safeResolve } from './config.js';
import { listProjectVideos } from './projects.js';
import { readText, writeFile } from './safe-files.js';

export const PROFILE_FILE = 'About This Video.json';
export const MAX_NOTE = 2000;
// The two lists John chooses from. Change them here (and the labels in web/src/videoProfile.ts).
export const TOPICS = ['unassigned', 'communication', 'sdam', 'aphantasia', 'psychedelics', 'emotions', 'relationships', 'kink', 'healing', 'meaning'] as const;
export const ANGLES = ['unassigned', 'story', 'wisdom', 'explainer'] as const;
export type Topic = (typeof TOPICS)[number];
export type Angle = (typeof ANGLES)[number];
/** `suggested` is true while Topic and Angle are only a guess waiting for John; any save from the app clears it. */
export interface VideoProfile { topic: Topic; angle: Angle; note: string; suggested: boolean }
const EMPTY: VideoProfile = { topic: 'unassigned', angle: 'unassigned', note: '', suggested: false };

/** The profile file for a piece, or null when the piece folder doesn't exist. */
function profileFile(piece: string): string | null {
  try {
    const folder = safeResolve('projects', piece);
    if (!fs.statSync(folder).isDirectory()) return null;
    return path.join(folder, PROFILE_FILE);
  } catch { return null; } // not a real folder in the projects library
}

/** Only a real piece folder of a video project can have a profile, never any other folder in Drive. */
function requirePiece(piece: unknown): string {
  if (typeof piece !== 'string' || !listProjectVideos().some(({ video }) => video.pieces.some((p) => p.path === piece))) throw new Error('Choose a video from Video Projects.');
  return piece;
}

export function readVideoProfile(piece: string): VideoProfile {
  const file = profileFile(piece);
  if (!file) return EMPTY;
  try {
    const saved = JSON.parse(readText(file)) as Partial<VideoProfile>;
    return {
      topic: TOPICS.includes(saved.topic as Topic) ? saved.topic as Topic : 'unassigned',
      angle: ANGLES.includes(saved.angle as Angle) ? saved.angle as Angle : 'unassigned',
      note: typeof saved.note === 'string' ? saved.note.slice(0, MAX_NOTE) : '',
      suggested: saved.suggested === true,
    };
  } catch { return EMPTY; } // no file yet, or one we can't read
}

/** Save a guess for a video that has no profile yet. Never replaces one John (or an earlier guess) already saved; returns whether it saved. */
export function suggestVideoProfile(piece: unknown, value: unknown): boolean {
  const checked = requirePiece(piece);
  const file = profileFile(checked);
  if (!file) throw new Error('That video has no folder.');
  if (fs.existsSync(file)) return false;
  saveVideoProfile(checked, value, true);
  return true;
}

/** Save a profile. `keepSuggested` is for importing guesses; saves from the screens leave it off, which confirms the values. */
export function saveVideoProfile(piece: unknown, value: unknown, keepSuggested = false): VideoProfile {
  const given = (value ?? {}) as Partial<VideoProfile>;
  if (!TOPICS.includes(given.topic as Topic)) throw new Error('Choose a valid topic.');
  if (!ANGLES.includes(given.angle as Angle)) throw new Error('Choose a valid angle.');
  if (typeof given.note !== 'string') throw new Error('The note must be text.');
  if (given.note.length > MAX_NOTE) throw new Error(`Keep the note under ${MAX_NOTE} characters.`);
  const checked = requirePiece(piece);
  const file = profileFile(checked);
  if (!file) throw new Error('That video has no folder.');
  const profile: VideoProfile = { topic: given.topic as Topic, angle: given.angle as Angle, note: given.note.trim(), suggested: keepSuggested && given.suggested === true };
  writeFile(file, JSON.stringify({ ...profile, updatedAt: new Date().toISOString() }, null, 2) + '\n');
  return profile;
}
