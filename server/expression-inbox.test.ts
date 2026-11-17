import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from './config';
import { copyThumbnailToInbox, fileInboxPhoto, importInboxPhoto, inboxNormalizationJob, normalizeInboxPhoto, trashInboxPhoto } from './expression-inbox';
import { assessmentJob, startAssessment } from './expression-assessment';
import { confirmExpressionFolder } from './confirm-expression-folder';
import { addExpressionTag } from './confirm-expression-tag';
import { buildExpressionIndex, inboxExpressionPhotos } from './expressions';
import { makeTree, removeTree } from './testing';
import type { MakeImage } from './thumbnails';

const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), Buffer.from('fake image')]);
const piece = 'Video/Longform'; const thumbnail = `${piece}/Packaging/Drafts/ChatGPT 01/01.png`;
let root: string; let old: { projects: string; expressions: string; trash: string };
beforeEach(() => {
  root = makeTree({ 'Expressions/Positive/Warmth/Warmth.txt': 'A kind look', 'Expressions/Framing.txt': 'framing', 'Expressions/PoseGaze.txt': 'pose', 'Expressions/Morphology.txt': 'morphology', 'Expressions/ExpressionCategories.txt': 'expressions', [`Projects/${thumbnail}`]: '' });
  old = { projects: config.videoProjectsDir, expressions: config.expressionsDir, trash: config.trashDir }; config.trashDir = path.join(root, 'Trash'); config.videoProjectsDir = path.join(root, 'Projects'); config.expressionsDir = path.join(root, 'Expressions');
  fs.writeFileSync(path.join(config.videoProjectsDir, thumbnail), png);
});
afterEach(() => { config.videoProjectsDir = old.projects; config.expressionsDir = old.expressions; config.trashDir = old.trash; removeTree(root); });

describe('expression inbox', () => {
  it('imports with unique names, keeps the inbox out of the library and marks AI photos', () => {
    const a = importInboxPhoto('My photo.png', png.toString('base64'), false);
    const b = importInboxPhoto('My photo.png', png.toString('base64'), true);
    expect(a.path).not.toBe(b.path); expect(inboxExpressionPhotos()).toHaveLength(2);
    expect(buildExpressionIndex().photos).toHaveLength(0);
    expect(inboxExpressionPhotos().find(p => p.path === b.path)?.tags).toContainEqual(expect.objectContaining({ tag: 'AIGenerated', confirmed: true }));
  });
  it('copies a draft thumbnail without changing its source, and refuses paths outside the piece', () => {
    const result = copyThumbnailToInbox(piece, thumbnail);
    expect(fs.readFileSync(path.join(config.videoProjectsDir, thumbnail))).toEqual(png);
    expect(fs.readFileSync(path.join(config.expressionsDir, result.path))).toEqual(png);
    expect(() => copyThumbnailToInbox('Other/Longform', thumbnail)).toThrow();
  });
  it('files an AI photo and its sidecars with the category naming convention', () => {
    const result = importInboxPhoto('source.png', png.toString('base64'), true);
    const filed = fileInboxPhoto(result.path, 'Positive/Warmth');
    expect(filed.path).toBe('Positive/Warmth/Warmth_AI_001.png');
    expect(fs.readFileSync(path.join(config.expressionsDir, 'Positive/Warmth/Warmth_AI_001.txt'), 'utf8')).toContain('AIGenerated');
    expect(inboxExpressionPhotos()).toHaveLength(0);
  });
  it('assesses an inbox photo and files it when its suggested expression is confirmed', async () => {
    const photo = importInboxPhoto('new.png', png.toString('base64'), false);
    addExpressionTag(photo.path, 'CloseUp', 'framing');
    const job = startAssessment(photo.path, async () => '[{"tag":"Warmth","confidence":91}]', async (_source, dest) => { fs.writeFileSync(dest, png); });
    await vi.waitFor(() => expect(assessmentJob(job.id).state).not.toBe('working'));
    expect(job.state).toBe('done');
    expect(inboxExpressionPhotos()[0].tags).toEqual(expect.arrayContaining([expect.objectContaining({ tag: 'CloseUp', confirmed: true }), expect.objectContaining({ tag: 'Warmth', confidence: 91 })]));
    const result = confirmExpressionFolder(photo.path, 'Warmth', 91);
    expect(result.path).toBe('Positive/Warmth/Warmth_001.png');
    expect(fs.readFileSync(path.join(config.expressionsDir, 'Positive/Warmth/Warmth_001.txt'), 'utf8')).toContain('Warmth, 91%, CONFIRMED');
  });
  it('moves only the chosen inbox photo and its sidecars to recoverable trash', () => {
    const photo = importInboxPhoto('candidate.png', png.toString('base64'), true);
    const other = importInboxPhoto('other.png', png.toString('base64'), false);
    const result = trashInboxPhoto(photo.path);
    expect(fs.readFileSync(path.join(result.trashPath, 'candidate.png'))).toEqual(png);
    expect(fs.readFileSync(path.join(result.trashPath, 'candidate.txt'), 'utf8')).toContain('AIGenerated');
    expect(fs.existsSync(path.join(config.expressionsDir, other.path))).toBe(true);
    expect(() => trashInboxPhoto('Positive/Warmth/Warmth.txt')).toThrow();
  });
  it('refuses ambiguous photo names and does not move either photo', () => {
    const photo = importInboxPhoto('same.png', png.toString('base64'), false);
    fs.writeFileSync(path.join(config.expressionsDir, '_Inbox/same.jpg'), png);
    expect(() => trashInboxPhoto(photo.path)).toThrow(/ambiguous/);
    expect(fs.existsSync(path.join(config.expressionsDir, photo.path))).toBe(true);
  });
  it('prepares a separate AI candidate from a temporary copy, preserving the inbox original', async () => {
    const photo = importInboxPhoto('original.png', png.toString('base64'), true);
    const make: MakeImage = async (_ai, prompt, cwd, out, opts) => {
      expect(prompt).toContain('Preserve the exact facial expression'); expect(opts.photo).not.toContain(config.expressionsDir);
      expect(fs.readFileSync(opts.photo!)).toEqual(png);
      const image = path.join(cwd, out); fs.writeFileSync(image, png); return { image, session: 's' };
    };
    const job = normalizeInboxPhoto(photo.path, 'codex', make);
    await vi.waitFor(() => expect(inboxNormalizationJob(job.id).state).not.toBe('working'));
    expect(job.state).toBe('done'); expect(job.result).not.toBe(photo.path);
    expect(fs.readFileSync(path.join(config.expressionsDir, photo.path))).toEqual(png);
    expect(inboxExpressionPhotos().find(p => p.path === job.result)?.tags).toContainEqual(expect.objectContaining({ tag: 'AIGenerated', confirmed: true }));
  });
});
