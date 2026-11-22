import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { makeTree, removeTree } from './testing.js';

const PIECE = '016 - Ocean/Longform';
vi.mock('./projects.js', () => ({ listProjectVideos: () => [{ projectId: 'x', video: { name: 'x', path: '016 - Ocean', pieces: [{ kind: 'longform', path: '016 - Ocean/Longform' }] } }] }));
import { MAX_NOTE, PROFILE_FILE, readVideoProfile, saveVideoProfile } from './video-profile.js';

let root: string; let previous: string;
beforeEach(() => { root = makeTree({ [`${PIECE}/`]: '', 'Writing/Other/': '' }); previous = config.videoProjectsDir; config.videoProjectsDir = root; });
afterEach(() => { config.videoProjectsDir = previous; removeTree(root); });
const empty = { topic: 'unassigned', angle: 'unassigned', note: '' };

it('starts empty and saves Topic, Angle and note in the video folder', () => {
  expect(readVideoProfile(PIECE)).toEqual(empty);
  expect(saveVideoProfile(PIECE, { topic: 'sdam', angle: 'story', note: '  my best video  ' })).toEqual({ topic: 'sdam', angle: 'story', note: 'my best video' });
  expect(readVideoProfile(PIECE)).toEqual({ topic: 'sdam', angle: 'story', note: 'my best video' });
  expect(JSON.parse(fs.readFileSync(path.join(root, PIECE, PROFILE_FILE), 'utf8')).updatedAt).toBeTruthy();
});

it('refuses a bad topic, angle or note without changing the saved file', () => {
  saveVideoProfile(PIECE, { topic: 'healing', angle: 'wisdom', note: 'keep' });
  const keep = { topic: 'healing', angle: 'wisdom', note: 'keep' };
  expect(() => saveVideoProfile(PIECE, { ...keep, topic: 'nonsense' })).toThrow(/valid topic/);
  expect(() => saveVideoProfile(PIECE, { ...keep, angle: 'story-ish' })).toThrow(/valid angle/);
  expect(() => saveVideoProfile(PIECE, { ...keep, note: 'x'.repeat(MAX_NOTE + 1) })).toThrow(/under/);
  expect(() => saveVideoProfile(PIECE, { ...keep, note: 5 })).toThrow(/text/);
  expect(readVideoProfile(PIECE)).toEqual(keep);
});

it('treats an unreadable or odd file as empty instead of failing', () => {
  fs.writeFileSync(path.join(root, PIECE, PROFILE_FILE), '{ not json');
  expect(readVideoProfile(PIECE)).toEqual(empty);
  fs.writeFileSync(path.join(root, PIECE, PROFILE_FILE), JSON.stringify({ topic: 'bogus', angle: 7, note: 7 }));
  expect(readVideoProfile(PIECE)).toEqual(empty);
});

it('only saves for a real piece of a video project, never another folder', () => {
  expect(() => saveVideoProfile('Writing/Other', { ...empty })).toThrow(/Choose a video/);
  expect(() => saveVideoProfile('../outside', { ...empty })).toThrow(/Choose a video/);
  expect(() => saveVideoProfile(undefined, { ...empty })).toThrow(/Choose a video/);
  expect(fs.existsSync(path.join(root, 'Writing/Other', PROFILE_FILE))).toBe(false);
});
