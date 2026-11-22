import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { makeTree, removeTree } from './testing.js';

const PIECE = '016 - Ocean/Longform';
vi.mock('./projects.js', () => ({ listProjectVideos: () => [{ projectId: 'x', video: { name: 'x', path: '016 - Ocean', pieces: [{ kind: 'longform', path: '016 - Ocean/Longform' }] } }] }));
import { MAX_NOTE, PROFILE_FILE, readVideoProfile, saveVideoProfile, suggestVideoProfile } from './video-profile.js';

let root: string; let previous: string;
beforeEach(() => { root = makeTree({ [`${PIECE}/`]: '', 'Writing/Other/': '' }); previous = config.videoProjectsDir; config.videoProjectsDir = root; });
afterEach(() => { config.videoProjectsDir = previous; removeTree(root); });
const empty = { topic: 'unassigned', topic2: 'unassigned', angle: 'unassigned', angle2: 'unassigned', note: '', suggested: false };

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

it('saves a guess as suggested, and a save from the app confirms it', () => {
  expect(suggestVideoProfile(PIECE, { topic: 'communication', angle: 'wisdom', note: '', suggested: true })).toBe(true);
  expect(readVideoProfile(PIECE)).toEqual({ ...empty, topic: 'communication', angle: 'wisdom', suggested: true });
  expect(saveVideoProfile(PIECE, { topic: 'communication', angle: 'wisdom', note: '' }).suggested).toBe(false);
  expect(readVideoProfile(PIECE).suggested).toBe(false);
});

it('a new guess may replace an older guess, but never a profile John saved or confirmed', () => {
  suggestVideoProfile(PIECE, { topic: 'communication', angle: 'wisdom', note: '', suggested: true });
  expect(suggestVideoProfile(PIECE, { topic: 'communication', topic2: 'sdam', angle: 'wisdom', note: '', suggested: true })).toBe(true);
  expect(readVideoProfile(PIECE).topic2).toBe('sdam');
  saveVideoProfile(PIECE, { topic: 'sdam', angle: 'story', note: 'mine' });
  expect(suggestVideoProfile(PIECE, { topic: 'kink', angle: 'wisdom', note: '', suggested: true })).toBe(false);
  expect(readVideoProfile(PIECE)).toEqual({ ...empty, topic: 'sdam', angle: 'story', note: 'mine' });
});

it('a guess can replace an older import only when the caller names a cutoff, and never anything saved at or after it', () => {
  saveVideoProfile(PIECE, { topic: 'emotions', angle: 'story', note: '' });
  const file = path.join(root, PIECE, PROFILE_FILE);
  const stamped = (at: string) => fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), updatedAt: at }));
  stamped('2026-11-22T02:32:00.000Z');
  const guess = { topic: 'emotions', topic2: 'healing', angle: 'story', note: '', suggested: true };
  expect(suggestVideoProfile(PIECE, guess)).toBe(false); // no cutoff: a saved profile is left alone
  expect(suggestVideoProfile(PIECE, guess, '2026-11-22T02:00:00.000Z')).toBe(false); // saved after the cutoff
  expect(suggestVideoProfile(PIECE, guess, '2026-11-22T02:32:00.000Z')).toBe(false); // saved exactly at it
  expect(suggestVideoProfile(PIECE, guess, '2026-11-22T03:00:00.000Z')).toBe(true);
  expect(readVideoProfile(PIECE)).toEqual({ ...empty, topic: 'emotions', topic2: 'healing', angle: 'story', suggested: true });
});

it('a profile with no readable save time is never replaced by a cutoff', () => {
  fs.writeFileSync(path.join(root, PIECE, PROFILE_FILE), JSON.stringify({ topic: 'sdam', angle: 'story', note: 'mine' }));
  expect(suggestVideoProfile(PIECE, { topic: 'kink', angle: 'wisdom', note: '', suggested: true }, '2099-01-01T00:00:00.000Z')).toBe(false);
  expect(readVideoProfile(PIECE).note).toBe('mine');
});
