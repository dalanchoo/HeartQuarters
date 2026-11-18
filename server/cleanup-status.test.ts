// The Can Clean Up badges: which pieces have files to go, worked out in the background. Fake folders only.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from './config';
import { capcutLinks } from './cleanup';
import { cleanupDone, cleanupStatus, refresh } from './cleanup-status';
import { makeTree, removeTree } from './testing';

describe('which pieces can be cleaned up', () => {
  let tmp: string;
  let saved: { videos: string; drafts: string };
  const V = (...s: string[]) => path.join(tmp, 'Video Projects', '022 - V', ...s);
  const fwd = (p: string) => p.split(path.sep).join('/');
  const content = () => path.join(tmp, 'Drafts', '022 - V', 'draft_content.json');

  beforeEach(() => {
    tmp = makeTree({
      'Video Projects/022 - V/Longform/Raw/take.mp4': 'raw',
      'Video Projects/022 - V/Longform/Intermediate/used.mov': 'used',
      'Video Projects/022 - V/Longform/Intermediate/unused.mov': 'unused',
      'Video Projects/022 - V/Shorts/Shorts Plan.json': '{}',
      'Video Projects/022 - V/Shorts/022_S01 - A/Exports/a.mp4': 'export',
    });
    const draft = path.join(tmp, 'Drafts', '022 - V');
    fs.mkdirSync(draft, { recursive: true });
    const used = [V('Longform', 'Raw', 'take.mp4'), V('Longform', 'Intermediate', 'used.mov')].map(fwd);
    fs.writeFileSync(path.join(draft, 'draft_meta_info.json'), JSON.stringify({ draft_materials: [{ value: used.map((p) => ({ file_Path: p })) }] }));
    fs.writeFileSync(content(), JSON.stringify({ materials: { videos: used.map((p) => ({ path: p })) } }));
    saved = { videos: config.videoProjectsDir, drafts: config.capcutDraftsDir };
    config.videoProjectsDir = path.join(tmp, 'Video Projects');
    config.capcutDraftsDir = path.join(tmp, 'Drafts');
  });
  afterEach(() => {
    config.videoProjectsDir = saved.videos;
    config.capcutDraftsDir = saved.drafts;
    removeTree(tmp);
  });

  it('counts the files for each piece, and for Make Shorts', async () => {
    cleanupDone('none'); // start from a check that's due
    await refresh();
    const { pieces, busy, checkedAt } = cleanupStatus();
    expect(busy).toBe(false);
    expect(checkedAt).not.toBeNull();
    expect(pieces['022 - V/Longform']).toEqual({ files: 1, bytes: 'unused'.length, missing: 0 });
    expect(pieces['022 - V/Shorts']).toEqual({ files: 1, bytes: 2, missing: 0 });
    expect(pieces['022 - V/Shorts/022_S01 - A']).toEqual({ files: 0, bytes: 0, missing: 0 });
  });

  it('reports a missing link, and drops a piece once it was cleaned up', async () => {
    const gone = fwd(V('Longform', 'Intermediate', 'renamed.mov'));
    fs.writeFileSync(content(), JSON.stringify({ materials: { videos: [{ path: gone }] } }));
    await refresh();
    expect(cleanupStatus().pieces['022 - V/Longform']).toEqual({ files: 1, bytes: 'unused'.length, missing: 1 });
    // A piece with nothing to clean (made by hand) isn't blocked by the broken link.
    expect(cleanupStatus().pieces['022 - V/Shorts/022_S01 - A']).toEqual({ files: 0, bytes: 0, missing: 0 });
    cleanupDone('022 - V/Longform');
    expect(cleanupStatus().pieces['022 - V/Longform']).toBeUndefined();
    // Asking started a new check; it finishes (inside the fake folders) and the piece is back.
    await vi.waitFor(() => expect(cleanupStatus().busy).toBe(false));
    expect(cleanupStatus().pieces['022 - V/Longform'].missing).toBe(1);
  });

  it('reads a project file again once it changes', () => {
    expect(capcutLinks('022 - V').used.has(fwd(V('Longform', 'Intermediate', 'used.mov')).toLowerCase())).toBe(true);
    fs.writeFileSync(path.join(tmp, 'Drafts', '022 - V', 'draft_meta_info.json'), '{}');
    fs.writeFileSync(content(), JSON.stringify({ materials: { videos: [] } }));
    expect(capcutLinks('022 - V').used.size).toBe(0);
  });
});
