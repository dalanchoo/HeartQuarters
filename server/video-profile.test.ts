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
const empty = { topic: 'unassigned', topic2: 'unassigned', angle: 'unassigned', angle2: 'unassigned', note: '' };

it('starts empty and saves Topic, Angle and note in the video folder', () => {
  expect(readVideoProfile(PIECE)).toEqual(empty);
  const saved = { ...empty, topic: 'sdam', angle: 'story', note: 'my best video' };
  expect(saveVideoProfile(PIECE, { topic: 'sdam', angle: 'story', note: '  my best video  ' })).toEqual(saved);
  expect(readVideoProfile(PIECE)).toEqual(saved);
  expect(JSON.parse(fs.readFileSync(path.join(root, PIECE, PROFILE_FILE), 'utf8')).updatedAt).toBeTruthy();
});

it('keeps a second Topic and a second Angle, and drops a second one that repeats the main one', () => {
  expect(saveVideoProfile(PIECE, { topic: 'sdam', topic2: 'communication', angle: 'story', angle2: 'explainer', note: '' })).toEqual({ ...empty, topic: 'sdam', topic2: 'communication', angle: 'story', angle2: 'explainer' });
  expect(readVideoProfile(PIECE).topic2).toBe('communication');
  expect(saveVideoProfile(PIECE, { topic: 'sdam', topic2: 'sdam', angle: 'story', angle2: 'story', note: '' })).toMatchObject({ topic2: 'unassigned', angle2: 'unassigned' });
});

it('reads a file saved before second values existed', () => {
  fs.writeFileSync(path.join(root, PIECE, PROFILE_FILE), JSON.stringify({ topic: 'sdam', angle: 'story', note: 'old' }));
  expect(readVideoProfile(PIECE)).toEqual({ ...empty, topic: 'sdam', angle: 'story', note: 'old' });
});

it('refuses a bad topic, angle or note without changing the saved file', () => {
  saveVideoProfile(PIECE, { topic: 'healing', angle: 'wisdom', note: 'keep' });
  const keep = { topic: 'healing', angle: 'wisdom', note: 'keep' };
  expect(() => saveVideoProfile(PIECE, { ...keep, topic: 'nonsense' })).toThrow(/valid topic/);
  expect(() => saveVideoProfile(PIECE, { ...keep, angle: 'story-ish' })).toThrow(/valid angle/);
  expect(() => saveVideoProfile(PIECE, { ...keep, topic2: 'nonsense' })).toThrow(/second topic/);
  expect(() => saveVideoProfile(PIECE, { ...keep, angle2: 'nonsense' })).toThrow(/second angle/);
  expect(() => saveVideoProfile(PIECE, { ...keep, note: 'x'.repeat(MAX_NOTE + 1) })).toThrow(/under/);
  expect(() => saveVideoProfile(PIECE, { ...keep, note: 5 })).toThrow(/text/);
  expect(readVideoProfile(PIECE)).toEqual({ ...empty, ...keep });
});

it('treats an unreadable or odd file as empty instead of failing', () => {
  fs.writeFileSync(path.join(root, PIECE, PROFILE_FILE), '{ not json');
  expect(readVideoProfile(PIECE)).toEqual(empty);
  fs.writeFileSync(path.join(root, PIECE, PROFILE_FILE), JSON.stringify({ topic: 'bogus', topic2: 3, angle: 7, note: 7 }));
  expect(readVideoProfile(PIECE)).toEqual(empty);
});

it('only saves for a real piece of a video project, never another folder', () => {
  expect(() => saveVideoProfile('Writing/Other', { ...empty })).toThrow(/Choose a video/);
  expect(() => saveVideoProfile('../outside', { ...empty })).toThrow(/Choose a video/);
  expect(() => saveVideoProfile(undefined, { ...empty })).toThrow(/Choose a video/);
  expect(fs.existsSync(path.join(root, 'Writing/Other', PROFILE_FILE))).toBe(false);
});

it('preserves the contents of an older profile with a retired guess flag', () => {
  const profile = { topic: 'sdam', topic2: 'communication', angle: 'story', angle2: 'explainer', note: 'keep this' };
  const file = path.join(root, PIECE, PROFILE_FILE);
  const oldContents = JSON.stringify({ ...profile, suggested: true });
  fs.writeFileSync(file, oldContents);
  expect(readVideoProfile(PIECE)).toEqual(profile);
  expect(fs.readFileSync(file, 'utf8')).toBe(oldContents);

  const updated = { ...profile, note: 'new note' };
  expect(saveVideoProfile(PIECE, updated)).toEqual(updated);
  expect(readVideoProfile(PIECE)).toEqual(updated);
  expect(JSON.parse(fs.readFileSync(file, 'utf8'))).not.toHaveProperty('suggested');
});
