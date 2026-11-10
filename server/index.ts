// The HeartQuarters engine: a small web server on this PC only (127.0.0.1).
// The screens (web/) talk to it through the /api routes below.
import express, { type Request, type Response } from 'express';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { appDir, config, parseRoot, safeResolve } from './config.js';
import { listProjects, readProject } from './projects.js';
import { deleteFolder, manageInfo, renameFolder, openInCapCut } from './manage.js';
import { createSeries, createVideoFolder, draftsForVideo, listDrafts, parseKind, suggestPrefix } from './create.js';
import { getJob, listTools, runTool } from './tools.js';
import { savePackagingText } from './metadata.js';
import { copyPackagingVersion, renamePackagingVersion, trashPackagingVersion } from './packaging-version.js';
import { draftHtml, listWriting, readWriting } from './writing.js';
import { expressionIndex } from './expressions.js';
import { thumbnail } from './thumbs.js';
import { listSkills, setSkillLink, targetFolder } from './skills.js';
import { aiOverview, chooseAi } from './ai.js';
import { getRun, parseShortsJob, sendNote, startEdit, startShortsProposal, stopRun } from './claude.js';
import {
  hasRetention,
  keepOldPlan,
  makeShort,
  metadataRun,
  readTranscript,
  readLongformUrl,
  regenerateShort,
  retireRetention,
  savePlan,
  saveRetention,
  shortsOverview,
  saveLongformUrl,
  writeShortMetadata,
} from './shorts.js';
import { guard, sandboxHeaders } from './security.js';
import { authorizationUrl, configureYoutube, disconnectYoutube, finishYoutubeAuth, youtubeStatus } from './youtube-auth.js';
import { acknowledgeUpload, addPlaylists, addSubtitle, existingYoutubeSettings, linkYoutubeVideo, saveVideoPlaylists, startUpload, syncYoutubeSettings, uploadsFor, videoPlaylists, youtubeChannel, youtubePlaylists, type UploadInput } from './youtube.js';
import { subtitleFiles } from './youtube-captions.js';
import { openYouTubeStudio } from './youtube-studio.js';

const app = express();
app.use(guard); // see security.ts: blocks other websites
app.use('/api/shorts/retention', express.json({ limit: '40mb' })); // a pasted screenshot
app.use(express.json());

// YouTube sign-in and uploads. The callback is a Google browser redirect; its
// one-use state and PKCE verifier are checked before accepting the response.
app.get('/api/youtube/status', handle((_req, res) => { res.json(youtubeStatus()); }));
app.post('/api/youtube/configure', handle((req, res) => { configureYoutube(req.body?.clientId, req.body?.clientSecret); res.json({ ok: true }); }));
app.post('/api/youtube/disconnect', handle((_req, res) => { disconnectYoutube(); res.json({ ok: true }); }));
app.post('/api/youtube/connect', handle((req, res) => {
  const address = req.socket.localAddress;
  if (address !== '127.0.0.1') throw new Error('Connect using 127.0.0.1.');
  res.json({ url: authorizationUrl(req.socket.localPort!) });
}));
app.get('/api/youtube/callback', (req, res) => {
  finishYoutubeAuth(String(req.query.state ?? ''), String(req.query.code ?? '')).then(
    () => res.type('text/plain').send('YouTube is connected. You can close this tab and return to HeartQuarters.'),
    () => res.status(400).type('text/plain').send('YouTube sign-in was not completed. Return to HeartQuarters and try again.'),
  );
});
app.get('/api/youtube/channel', (_req, res) => { youtubeChannel().then((channel) => res.json(channel), (e) => res.status(400).json({ error: e instanceof Error ? e.message : String(e) })); });
app.get('/api/youtube/playlists', (_req, res) => { youtubePlaylists().then((playlists) => res.json(playlists), (e) => res.status(400).json({ error: e instanceof Error ? e.message : String(e) })); });
app.get('/api/youtube/video-playlists', (req, res) => { videoPlaylists(String(req.query.piece ?? ''), String(req.query.id ?? '')).then((result) => res.json(result), (e) => res.status(400).json({ error: e instanceof Error ? e.message : String(e) })); });
app.post('/api/youtube/video-playlists', (req, res) => { saveVideoPlaylists(String(req.body?.piece ?? ''), String(req.body?.id ?? ''), req.body?.before, req.body?.after).then((result) => res.json(result), (e) => res.status(400).json({ error: e instanceof Error ? e.message : String(e) })); });
app.get('/api/youtube/video-settings', (req, res) => { existingYoutubeSettings(String(req.query.piece ?? ''), String(req.query.id ?? '')).then((result) => res.json(result), (e) => res.status(400).json({ error: e instanceof Error ? e.message : String(e) })); });
app.post('/api/youtube/video-settings', (req, res) => { syncYoutubeSettings(String(req.body?.piece ?? ''), String(req.body?.id ?? ''), req.body?.baseline, req.body?.desired, req.body?.before, req.body?.after, req.body?.subtitle, req.body?.cover).then((result) => res.json(result), (e) => res.status(400).json({ error: e instanceof Error ? e.message : String(e) })); });
app.get('/api/youtube/uploads', handle((req, res) => { res.json(uploadsFor(String(req.query.piece ?? ''))); }));
app.post('/api/youtube/link', (req, res) => { linkYoutubeVideo(String(req.body?.piece ?? ''), req.body?.url).then((result) => res.json(result), (e) => res.status(400).json({ error: e instanceof Error ? e.message : String(e) })); });
app.get('/api/youtube/subtitles', handle((req, res) => { res.json(subtitleFiles(String(req.query.piece ?? ''))); }));
app.get('/api/youtube/related', handle((req, res) => {
  const video = String(req.query.video ?? '');
  const uploaded = uploadsFor(path.posix.join(video, 'Longform')).find((j) => j.videoId && j.status === 'done');
  const url = readLongformUrl(video) ?? (uploaded?.videoId ? `https://www.youtube.com/watch?v=${encodeURIComponent(uploaded.videoId)}` : null);
  res.json({ url });
}));
app.post('/api/youtube/upload', handle((req, res) => { res.json(startUpload(req.body as UploadInput)); }));
app.post('/api/youtube/playlists', (req, res) => { addPlaylists(String(req.body?.piece ?? ''), String(req.body?.id ?? ''), req.body?.playlists).then(() => res.json({ ok: true }), (e) => res.status(400).json({ error: e instanceof Error ? e.message : String(e) })); });
app.post('/api/youtube/subtitles', (req, res) => {
  addSubtitle(String(req.body?.piece ?? ''), String(req.body?.id ?? ''), String(req.body?.subtitle ?? ''), req.body?.language).then(
    () => res.json({ ok: true }), (e) => res.status(400).json({ error: e instanceof Error ? e.message : String(e) }),
  );
});
app.post('/api/youtube/acknowledge', handle((req, res) => { acknowledgeUpload(String(req.body?.piece ?? ''), String(req.body?.id ?? '')); res.json({ ok: true }); }));
app.post('/api/youtube/studio', (req, res) => {
  try {
    openYouTubeStudio(req.body?.videoId).then(() => res.json({ ok: true }), (e) => res.status(400).json({ error: e instanceof Error ? e.message : String(e) }));
  } catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : String(e) }); }
});

/** Runs a route handler and turns any error into a readable JSON message. */
function handle(fn: (req: Request, res: Response) => void) {
  return (req: Request, res: Response) => {
    try {
      fn(req, res);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  };
}

// ---- Projects -------------------------------------------------------------

app.get('/api/projects', handle((_req, res) => {
  res.json(listProjects());
}));
app.post('/api/packaging/rename-version', handle((req, res) => { res.json(renamePackagingVersion(String(req.body?.piece ?? ''), String(req.body?.source ?? ''), req.body?.name)); }));
app.post('/api/packaging/trash-version', handle((req, res) => { res.json(trashPackagingVersion(String(req.body?.piece ?? ''), String(req.body?.source ?? ''))); }));

// ?id= is a relative path, e.g. "005 - Ayahuasca/005B - Night One".
app.get('/api/project', handle((req, res) => {
  res.json(readProject(String(req.query.id ?? '')));
}));

// ---- New folders (copies a template; see create.ts) -------------------------

// ?kind=top|part|short|standalone&parent=<id> -> { prefix: "023 - " }
// For a short, also lists the CapCut drafts it could copy (the video's own first).
app.get('/api/create/suggest', handle((req, res) => {
  const kind = parseKind(req.query.kind);
  const parent = String(req.query.parent ?? '');
  const prefix = suggestPrefix(kind, parent);
  if (kind !== 'short') return void res.json({ prefix });
  const all = listDrafts();
  const mine = draftsForVideo(parent, all);
  res.json({ prefix, videoDrafts: mine, otherDrafts: all.filter((d) => !mine.includes(d)) });
}));

// Async: copying a big CapCut draft can take a while.
app.post('/api/create', async (req, res) => {
  try {
    const { kind, parent, name, copyDraft } = req.body ?? {};
    res.json(await createVideoFolder(parseKind(kind), String(parent ?? ''), String(name ?? ''), String(copyDraft ?? '')));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// A new series with its first part: { name: "023 - Test", partName: "023A - Part 1" }
app.post('/api/create/series', async (req, res) => {
  try {
    res.json(await createSeries(String(req.body?.name ?? ''), String(req.body?.partName ?? '')));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---- Rename and delete (see manage.ts; delete moves to the trash folder) ---

app.get('/api/manage/info', handle((req, res) => {
  res.json(manageInfo(String(req.query.path ?? '')));
}));

app.post('/api/manage/rename', handle((req, res) => {
  res.json(renameFolder(String(req.body?.path ?? ''), String(req.body?.newName ?? ''), req.body?.drafts));
}));

app.post('/api/manage/delete', handle((req, res) => {
  res.json(deleteFolder(String(req.body?.path ?? ''), req.body?.drafts));
}));

// ---- Files ----------------------------------------------------------------

// Sends any file inside the allowed folders (images, videos, text).
// Videos support seeking because Express handles "Range" requests.
app.get('/api/file', handle((req, res) => {
  const full = safeResolve(parseRoot(req.query.root), String(req.query.path ?? ''));
  sandboxHeaders(res);
  res.sendFile(full, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'File not found.' });
  });
}));

app.get('/api/text', handle((req, res) => {
  const full = safeResolve(parseRoot(req.query.root), String(req.query.path ?? ''));
  if (fs.statSync(full).size > 2_000_000) throw new Error('File too large to show as text.');
  sandboxHeaders(res);
  res.type('text/plain; charset=utf-8').send(fs.readFileSync(full, 'utf8'));
}));

// Opens a folder in File Explorer (for a file, opens the folder it's in).
app.post('/api/open', handle((req, res) => {
  const full = safeResolve(parseRoot(req.body?.root), String(req.body?.path ?? ''));
  const folder = fs.statSync(full).isDirectory() ? full : path.dirname(full);
  spawn('explorer.exe', [folder], { detached: true, stdio: 'ignore' }).unref();
  res.json({ ok: true });
}));

// Small JPEG preview of an image (made once, then cached in data/thumbs).
app.get('/api/thumb', (req, res) => {
  try {
    const full = safeResolve(parseRoot(req.query.root), String(req.query.path ?? ''));
    const width = Math.min(800, Math.max(120, Number(req.query.w) || 360));
    thumbnail(full, width).then(
      (thumb) => res.set('Cache-Control', 'max-age=86400').sendFile(thumb),
      (e) => res.status(500).json({ error: e instanceof Error ? e.message : String(e) }),
    );
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---- Expressions ----------------------------------------------------------

app.get('/api/expressions', handle((_req, res) => {
  res.json(expressionIndex());
}));

// ---- Writing (Substack) ---------------------------------------------------

app.get('/api/writing', handle((_req, res) => {
  res.json(listWriting());
}));

app.get('/api/writing/piece', handle((req, res) => {
  res.json(readWriting(String(req.query.id ?? '')));
}));

app.get('/api/writing/draft', (req, res) => {
  draftHtml(String(req.query.path ?? '')).then(
    (html) => res.json({ html }),
    (e) => res.status(400).json({ error: e instanceof Error ? e.message : String(e) }),
  );
});

// ---- Guides ---------------------------------------------------------------

app.get('/api/guides', handle((_req, res) => {
  res.json(
    config.guides.map((g) => ({ ...g, found: fs.existsSync(safeResolve(g.root, g.path)) })),
  );
}));

// ---- Skills (which AI gets which skill; see skills.ts) ----------------------

app.get('/api/skills', handle((_req, res) => {
  res.json(listSkills());
}));

// { skill: "HMF_Skills/longform-edit", target: "claude", on: true } -> { state: "on" }
app.post('/api/skills/link', handle((req, res) => {
  const state = setSkillLink(String(req.body?.skill ?? ''), String(req.body?.target ?? ''), req.body?.on === true);
  res.json({ state });
}));

// { target: "claude" }: opens that AI's skills folder (only folders listed in config.json).
app.post('/api/skills/open', handle((req, res) => {
  const folder = targetFolder(String(req.body?.target ?? ''));
  spawn('explorer.exe', [folder], { detached: true, stdio: 'ignore' }).unref();
  res.json({ ok: true });
}));

// ---- CapCut ------------------------------------------------------------------

// { draft }: starts CapCut. It can't open that project by itself, so the page copies the name.
app.post('/api/capcut/open', handle((req, res) => {
  res.json({ name: openInCapCut(req.body?.draft) });
}));

// ---- Which AI (see ai.ts) ---------------------------------------------------

app.get('/api/ai', handle((_req, res) => {
  res.json(aiOverview());
}));

// { id: "claude" or "codex" }
app.post('/api/ai', handle((req, res) => {
  chooseAi(req.body?.id);
  res.json(aiOverview());
}));

// ---- Edit with Claude (see claude.ts) --------------------------------------

app.get('/api/claude', handle((req, res) => {
  res.json(getRun(String(req.query.video ?? '')));
}));

app.post('/api/claude/start', handle((req, res) => {
  res.json(startEdit(String(req.body?.video ?? '')));
}));

app.post('/api/claude/note', handle((req, res) => {
  res.json(sendNote(String(req.body?.video ?? ''), String(req.body?.text ?? '')));
}));

app.post('/api/claude/stop', handle((req, res) => {
  res.json(stopRun(String(req.body?.video ?? '')));
}));

// ---- Packaging files (see metadata.ts) --------------------------------------

// { path, text, was }: saves the file only if it still says "was".
app.post('/api/packaging/save', handle((req, res) => {
  savePackagingText(String(req.body?.path ?? ''), req.body?.text, req.body?.was);
  res.json({ ok: true });
}));
app.post('/api/packaging/copy-version', (req, res) => {
  copyPackagingVersion(String(req.body?.piece ?? ''), String(req.body?.source ?? ''), req.body?.name).then(
    (result) => res.json(result), (e) => res.status(400).json({ error: e instanceof Error ? e.message : String(e) }),
  );
});

// ---- Shorts plan (see shorts.ts) -------------------------------------------

app.get('/api/shorts', handle((req, res) => {
  res.json(shortsOverview(String(req.query.video ?? '')));
}));

app.get('/api/shorts/transcript', handle((req, res) => {
  res.json(readTranscript(String(req.query.video ?? '')));
}));

app.post('/api/shorts/propose', handle((req, res) => {
  const video = String(req.body?.video ?? '');
  if (getRun(video, 'shorts')?.status === 'running') throw new Error('The AI is already proposing shorts for this video.');
  keepOldPlan(video);
  res.json(startShortsProposal(video, hasRetention(video)));
}));

// { video, job: "shorts" or "short-S07", text }
app.post('/api/shorts/note', handle((req, res) => {
  res.json(sendNote(String(req.body?.video ?? ''), String(req.body?.text ?? ''), parseShortsJob(req.body?.job)));
}));

app.post('/api/shorts/stop', handle((req, res) => {
  res.json(stopRun(String(req.body?.video ?? ''), parseShortsJob(req.body?.job ?? 'shorts')));
}));

app.post('/api/shorts/plan', handle((req, res) => {
  res.json(savePlan(String(req.body?.video ?? ''), req.body?.shorts, req.body?.rejected));
}));

app.post('/api/shorts/retention', handle((req, res) => {
  saveRetention(String(req.body?.video ?? ''), req.body?.png);
  res.json({ ok: true });
}));

app.post('/api/shorts/retention/remove', handle((req, res) => {
  retireRetention(String(req.body?.video ?? ''));
  res.json({ ok: true });
}));

// Copying the CapCut project can take minutes, so this one waits without holding up the rest of the app.
app.post('/api/shorts/make', async (req, res) => {
  try {
    const { video, id, draft } = req.body ?? {};
    res.json(await makeShort(String(video ?? ''), String(id ?? ''), String(draft ?? '')));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// { video, url }
app.post('/api/shorts/longform-url', handle((req, res) => {
  saveLongformUrl(String(req.body?.video ?? ''), req.body?.url);
  res.json({ ok: true });
}));

// ?video=&short=: that short's conversation, or null.
app.get('/api/shorts/metadata', handle((req, res) => {
  res.json(metadataRun(String(req.query.video ?? ''), String(req.query.short ?? '')));
}));

// { video, short }: the AI writes that short's YouTube metadata, in its conversation.
app.post('/api/shorts/metadata', handle((req, res) => {
  res.json(writeShortMetadata(String(req.body?.video ?? ''), String(req.body?.short ?? '')));
}));

// Moves the old short to the trash, then makes it again: the same wait as above.
app.post('/api/shorts/regenerate', async (req, res) => {
  try {
    const { video, id, draft } = req.body ?? {};
    res.json(await regenerateShort(String(video ?? ''), String(id ?? ''), String(draft ?? '')));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---- Tools ----------------------------------------------------------------

app.get('/api/tools', handle((_req, res) => {
  res.json(listTools());
}));

app.post('/api/tools/:id/run', handle((req, res) => {
  res.json(runTool(String(req.params.id)));
}));

app.get('/api/jobs/:id', handle((req, res) => {
  const job = getJob(String(req.params.id));
  if (!job) throw new Error('No such job.');
  res.json(job);
}));

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Unknown API route.' });
});

// ---- Screens (built by `npm run build`) -----------------------------------

// The screens are rebuilt in the background while the app runs (npm start),
// so look for them on each request rather than once at startup.
const webDir = path.join(appDir, 'dist', 'web');
app.use(express.static(webDir));
app.use((_req, res) => {
  res.sendFile(path.join(webDir, 'index.html'), (err) => {
    if (err && !res.headersSent) res.status(503).send('The screens are still building. Refresh in a moment.');
  });
});

/**
 * With auto-reload, the engine restarts whenever its code changes. Only open
 * the browser on the first start: the watcher (our parent process) stays the
 * same across restarts, so remember which watcher already opened it.
 */
function shouldOpenBrowser(): boolean {
  if (!process.argv.includes('--open')) return false;
  const marker = path.join(appDir, 'data', 'browser-opened-by.txt');
  const watcher = String(process.ppid);
  try {
    if (fs.readFileSync(marker, 'utf8') === watcher) return false;
  } catch {
    /* first run */
  }
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, watcher);
  return true;
}

// HQ_PORT lets a second copy run alongside (e.g. for testing).
const port = Number(process.env.HQ_PORT) || config.port;
const url = `http://127.0.0.1:${port}`;
app.listen(port, '127.0.0.1', () => {
  console.log(`HeartQuarters is running at ${url}`);
  console.log('Close this window (or press Ctrl+C) to stop it.');
  if (shouldOpenBrowser()) {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  }
});
