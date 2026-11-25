// The HeartQuarters engine: a small web server on this PC only (127.0.0.1).
// The screens (web/) talk to it through the /api routes below.
import express, { type Request, type Response } from 'express';
import { shouldOpenBrowser } from './browser-session.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { appDir, config, parseRoot, safeResolve } from './config.js';
import { listProjects, readProject } from './projects.js';
import { deleteFolder, manageInfo, renameFolder, openInCapCut } from './manage.js';
import { createSeries, createVideoFolder, draftsForVideo, listDrafts, parseKind, suggestPrefix } from './create.js';
import { getJob, listTools, runTool } from './tools.js';
import { savePackagingText, saveVersionNotes } from './metadata.js';
import { copyPackagingVersion, createFirstPackagingVersion, trashPackagingVersion } from './packaging-version.js';
import { copyVersionThumbnail, decodeThumbnail, savePackagingThumbnail } from './thumbnail-files.js';
import { draftHtml, listWriting, readWriting } from './writing.js';
import { assessmentJob, startAssessment } from './expression-assessment.js';
import { slowRequestLogger, watchEngineStalls } from './slow-watch.js';
import { expressionCategories, expressionIndex, inboxExpressionPhotos } from './expressions.js';
import { copyInboxPhotoForPhotopea, copyThumbnailToInbox, ensureExpressionInbox, importInboxPhoto, trashInboxPhoto } from './expression-inbox.js';
import { addExpressionShots, deleteShot, readShotList, setShotDone } from './expression-shot-list.js';
import { addAttachment, addIdea, addReference, attachmentFile, deleteAttachment, deleteIdea, deleteReference, moveIdea, moveReference, readIdeas, updateAttachment, updateIdea, updateReference } from './video-ideas.js';
import { clearBrainstorm, readBrainstorm, sendBrainstormMessage } from './idea-brainstorm.js';
import { copyShotReferenceToInbox, migrateShotReferences, removeShotReference, shotReferenceFile, shotReferences, startShotReference } from './shot-reference.js';
import { ensureGeneratedVideosDir, generatedVideoFile, listGeneratedVideos, renameGeneratedVideo, saveGeneratedVideo, trashGeneratedVideo } from './expression-videos.js';
import { confirmExpressionFolder } from './confirm-expression-folder.js';
import { addExpressionTag, confirmExpressionTag, disconfirmExpressionTag, removeExpressionTag } from './confirm-expression-tag.js';
import { markExpressionAi } from './mark-expression-ai.js';
import { setExpressionRating } from './expression-rating.js';
import { applyExpressionChange, previewExpressionChange } from './expression-manage.js';
import { readExpressionReferences, readLikenessReferences, saveExpressionReferences, saveLikenessReferences } from './expression-references.js';
import { approveExpression, assignExpressionCategory, candidateFile, expressionJobs, previewExpressionPrompt, rejectExpression, startExpressionGeneration } from './expression-generation.js';
import { thumbnail } from './thumbs.js';
import { rankingJob, readRanking, startRanking } from './photo-ranking.js';
import { cleanupPlan, runCleanup } from './cleanup.js';
import { cleanupDone, cleanupStatus } from './cleanup-status.js';
import { listSkills, setSkillLink, targetFolder } from './skills.js';
import { aiOverview, chooseAiModel, parseAi } from './ai.js';
import { aiSignIns, openSignIn } from './ai-signin.js';
import { forgetIdleRuns, getRun, parseShortsJob, sendNote, startShortsProposal, stopRun } from './claude.js';
import { briefSource, briefSourceText, chooseBriefPhoto, chooseBriefPick, getBrief, parseBriefPlan, startBrief, startPicks } from './brief.js';
import { changeThumbnail, startThumbnail, thumbJobs } from './thumbnails.js';
import { startThumbnailReview, thumbnailReviews } from './thumbnail-feedback.js';
import { useDraft } from './use-draft.js';
import {
  hasRetention,
  keepOldPlan,
  makeShort,
  readTranscript,
  readLongformUrl,
  regenerateShort,
  retireRetention,
  savePlan,
  saveRetention,
  shortsOverview,
  clearPiece,
  generatePiece,
  notePiece,
  pieceState,
  pieceRun,
  stopPiece,
} from './shorts.js';
import { guard, sandboxHeaders } from './security.js';
import { authorizationUrl, configureYoutube, disconnectYoutube, finishYoutubeAuth, youtubeStatus } from './youtube-auth.js';
import { acknowledgeUpload, checkYoutubeVideos, downloadYoutubeThumbnail, existingYoutubeSettings, linkYoutubeVideo, startUpload, syncYoutubeSettings, uploadsFor, youtubeChannel, youtubePlaylists, type UploadInput, downloadYoutubeCaptions, removeExtraCaptions } from './youtube.js';
import { subtitleFiles } from './youtube-captions.js';
import { videoOverview } from './video-overview.js';
import { youtubeQuota } from './youtube-quota.js';
import { downloadVideoAnalytics } from './analytics.js';
import { downloadChannelAnalytics } from './channel-analytics.js';
import { syncLinkFiles } from './link-sync.js';
import { migrateReferenceFiles } from './expression-references.js';
import { readChannelVideos, refreshChannelVideos } from './channel-videos.js';
import { readVideoProfile, saveVideoProfile } from './video-profile.js';
import { saveYoutubeCaptions } from './caption-save.js';
import { analyticsAnalysis, analyticsSnapshots, startAnalyticsAnalysis, startAnalyticsSummary, videoSnapshotNames } from './analytics-analysis.js';
import { channelOverview, channelVideoDetail, refreshChannelWorkspace, startChannelVideoAnalysis } from './channel-workspace.js';
import { readScript, saveScript } from './script.js';
import { checkAiWriting } from './ai-writing.js';
import { ensureExportsFolder } from './exports-folder.js';
import { checkOwnComments } from './youtube-comment.js';
import { listStoredComments, moderateComment, replyToComment, syncAllChannelComments, syncVideoComments } from './channel-comments.js';
import { gatherTopicEvidence, readTopicResearch, runTopicResearch, sendResearchMessage, topicCounts } from './channel-research.js';
import { outsideOverview, runYoutubeScan, saveScanSettings } from './outside-youtube.js';

const app = express();
app.use(slowRequestLogger()); // prints a line in this window when a request takes over a second
watchEngineStalls();
app.use(guard); // see security.ts: blocks other websites
app.use('/api/shorts/retention', express.json({ limit: '40mb' })); // a pasted screenshot
app.use('/api/packaging/import-thumbnail', express.json({ limit: '3mb' }));
app.use('/api/expressions/inbox/import', express.json({ limit: '24mb' }));
app.use('/api/thumbs/change', express.json({ limit: '80mb' })); // up to 4 pasted reference images
app.use(['/api/brief/start', '/api/brief/picks'], express.json({ limit: '120mb' })); // screenshots pasted into the brief's boxes
app.use(express.json());

// YouTube sign-in and uploads. The callback is a Google browser redirect; its
// one-use state and PKCE verifier are checked before accepting the response.
app.get('/api/youtube/status', handle((_req, res) => { res.json(youtubeStatus()); }));
app.post('/api/youtube/analytics/video', (req, res) => {
  downloadVideoAnalytics(String(req.body?.piece ?? ''), String(req.body?.id ?? '')).then(result => res.json(result), (error: unknown) => res.status(400).json({ error: error instanceof Error ? error.message : String(error) }));
});
app.post('/api/youtube/analytics/channel', (_req, res) => {
  downloadChannelAnalytics().then(result => res.json(result), (error: unknown) => res.status(400).json({ error: error instanceof Error ? error.message : String(error) }));
});
app.get('/api/channel/videos', handle((_req, res) => { res.json(readChannelVideos()); }));
app.get('/api/channel/overview', handle((_req, res) => { res.json(channelOverview()); }));
app.get('/api/channel/video', (req, res) => {
  channelVideoDetail(String(req.query.id ?? '')).then(result => res.json(result), (error: unknown) => res.status(400).json({ error: error instanceof Error ? error.message : String(error) }));
});
app.post('/api/channel/refresh', (_req, res) => {
  refreshChannelWorkspace().then(result => res.json(result), (error: unknown) => res.status(400).json({ error: error instanceof Error ? error.message : String(error) }));
});
app.get('/api/channel/comments', handle((_req, res) => { res.json(listStoredComments()); }));
app.post('/api/channel/comments/sync', (req, res) => {
  const videoId = req.body?.videoId;
  const run = typeof videoId === 'string' && videoId.trim()
    ? syncVideoComments(videoId).then((file) => ({ synced: 1, disabled: file.disabled ? 1 : 0, failed: [], totalThreads: file.threads.length, syncedAt: file.syncedAt, stored: listStoredComments() }))
    : syncAllChannelComments().then((result) => ({ ...result, stored: listStoredComments() }));
  run.then((result) => res.json(result), (error: unknown) => res.status(400).json({ error: error instanceof Error ? error.message : String(error) }));
});
app.post('/api/channel/comments/reply', (req, res) => {
  replyToComment(req.body?.videoId, req.body?.parentId, req.body?.text)
    .then((file) => res.json({ file, stored: listStoredComments() }), (error: unknown) => res.status(400).json({ error: error instanceof Error ? error.message : String(error) }));
});
app.post('/api/channel/comments/moderate', (req, res) => {
  moderateComment(req.body?.videoId, req.body?.commentId, req.body?.action)
    .then((file) => res.json({ file, stored: listStoredComments() }), (error: unknown) => res.status(400).json({ error: error instanceof Error ? error.message : String(error) }));
});
app.get('/api/channel/research/topics', handle((_req, res) => { res.json(topicCounts()); }));
app.get('/api/channel/research', (req, res) => {
  gatherTopicEvidence(req.query.topic)
    .then((evidence) => res.json({ evidence, research: readTopicResearch(evidence.topic) }), (error: unknown) => res.status(400).json({ error: error instanceof Error ? error.message : String(error) }));
});
app.get('/api/channel/research/outside', handle((req, res) => { res.json(outsideOverview(req.query.topic)); }));
app.post('/api/channel/research/outside/settings', handle((req, res) => { saveScanSettings(req.body?.topic, req.body?.settings); res.json(outsideOverview(req.body?.topic)); }));
app.post('/api/channel/research/outside/scan', (req, res) => {
  runYoutubeScan(req.body?.topic)
    .then(() => res.json(outsideOverview(req.body?.topic)), (error: unknown) => res.status(400).json({ error: error instanceof Error ? error.message : String(error) }));
});
app.post('/api/channel/research/message', (req, res) => {
  sendResearchMessage(req.body?.topic, req.body?.reportId, req.body?.ai, req.body?.message)
    .then((research) => res.json(research), (error: unknown) => res.status(400).json({ error: error instanceof Error ? error.message : String(error) }));
});
app.post('/api/channel/research/run', (req, res) => {
  runTopicResearch(req.body?.topic, req.body?.ai, req.body?.focus)
    .then((research) => res.json(research), (error: unknown) => res.status(400).json({ error: error instanceof Error ? error.message : String(error) }));
});
app.post('/api/channel/video-analysis', (req, res) => {
  startChannelVideoAnalysis(String(req.body?.videoId ?? '')).then(result => res.json(result), (error: unknown) => res.status(400).json({ error: error instanceof Error ? error.message : String(error) }));
});
app.post('/api/youtube/captions/save', handle((req, res) => { res.json(saveYoutubeCaptions(req.body?.piece, req.body?.text)); }));
app.get('/api/video-profile', handle((req, res) => { res.json(readVideoProfile(String(req.query.piece ?? ''))); }));
app.post('/api/video-profile', handle((req, res) => { res.json(saveVideoProfile(req.body?.piece, req.body)); }));
app.post('/api/channel/videos/refresh', (_req, res) => {
  refreshChannelVideos().then(result => res.json(result), (error: unknown) => res.status(400).json({ error: error instanceof Error ? error.message : String(error) }));
});
app.get('/api/youtube/analytics/snapshots', handle((req, res) => {
  const piece = String(req.query.piece ?? '');
  res.json(piece && typeof req.query.videoId === 'string' ? videoSnapshotNames(piece, req.query.videoId) : analyticsSnapshots(piece));
}));
app.get('/api/youtube/analytics/analysis', handle((req, res) => { res.json(analyticsAnalysis(String(req.query.piece ?? ''), String(req.query.snapshot ?? ''))); }));
app.post('/api/youtube/analytics/analyze', handle((req, res) => { res.json(startAnalyticsAnalysis(String(req.body?.piece ?? ''), String(req.body?.snapshot ?? ''), undefined, req.body?.reach).job); }));
app.post('/api/youtube/analytics/summarize', handle((req, res) => { res.json(startAnalyticsSummary(String(req.body?.piece ?? ''), String(req.body?.snapshot ?? ''), String(req.body?.id ?? '')).step); }));
// How much of today's YouTube quota HeartQuarters has used (it counts its own requests).
app.get('/api/youtube/quota', handle((_req, res) => { res.json(youtubeQuota()); }));
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
// ?ids=a,b,c (up to 50): video details for the review tags, without captions.
// ?ids=a,b,…: whether the channel's own comment is posted on each video (1 unit per video).
app.get('/api/youtube/own-comments', (req, res) => { checkOwnComments(req.query.ids).then((result) => res.json(result), (e) => res.status(400).json({ error: e instanceof Error ? e.message : String(e) })); });
app.get('/api/youtube/check-videos', (req, res) => { checkYoutubeVideos(req.query.ids).then((result) => res.json(result), (e) => res.status(400).json({ error: e instanceof Error ? e.message : String(e) })); });
app.get('/api/youtube/playlists', (_req, res) => { youtubePlaylists().then((playlists) => res.json(playlists), (e) => res.status(400).json({ error: e instanceof Error ? e.message : String(e) })); });
app.get('/api/youtube/video-settings', (req, res) => { existingYoutubeSettings(String(req.query.piece ?? ''), String(req.query.id ?? ''), req.query.captions !== '0').then((result) => res.json(result), (e) => res.status(400).json({ error: e instanceof Error ? e.message : String(e) })); });
// ?piece=&id=: the captions on YouTube as text, only when John asks (about 250 units).
app.get('/api/youtube/captions', (req, res) => { downloadYoutubeCaptions(String(req.query.piece ?? ''), String(req.query.id ?? '')).then((result) => res.json(result), (e) => res.status(400).json({ error: e instanceof Error ? e.message : String(e) })); });
// { piece, id }: deletes the other caption tracks in HeartQuarters' own track's language (the copy Studio's editor makes).
app.post('/api/youtube/captions/remove-extra', (req, res) => { removeExtraCaptions(String(req.body?.piece ?? ''), String(req.body?.id ?? '')).then((result) => res.json(result), (e) => res.status(400).json({ error: e instanceof Error ? e.message : String(e) })); });
app.post('/api/youtube/video-settings', (req, res) => { syncYoutubeSettings(String(req.body?.piece ?? ''), String(req.body?.id ?? ''), req.body?.baseline, req.body?.desired, req.body?.before, req.body?.after, req.body?.subtitle, req.body?.cover, req.body?.version).then((result) => res.json(result), (e) => res.status(400).json({ error: e instanceof Error ? e.message : String(e) })); });
app.post('/api/youtube/download-thumbnail', (req, res) => { downloadYoutubeThumbnail(String(req.body?.piece ?? ''), String(req.body?.id ?? ''), String(req.body?.version ?? '')).then((result) => res.json(result), (e) => res.status(400).json({ error: e instanceof Error ? e.message : String(e) })); });
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
app.post('/api/youtube/acknowledge', handle((req, res) => { acknowledgeUpload(String(req.body?.piece ?? ''), String(req.body?.id ?? '')); res.json({ ok: true }); }));

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
app.get('/api/video-overview', handle((_req, res) => { res.json(videoOverview()); }));
app.get('/api/script', (req, res) => {
  readScript(String(req.query.piece ?? '')).then((result) => res.json(result), (e: unknown) => res.status(400).json({ error: e instanceof Error ? e.message : String(e) }));
});
app.post('/api/script', (req, res) => {
  saveScript(String(req.body?.piece ?? ''), {
    html: req.body?.html !== undefined ? String(req.body.html) : undefined,
    text: req.body?.text !== undefined ? String(req.body.text) : undefined,
  }).then((result) => res.json(result), (e: unknown) => res.status(400).json({ error: e instanceof Error ? e.message : String(e) }));
});
app.post('/api/ai-writing-check', (req, res) => {
  checkAiWriting(req.body?.text, req.body?.label, req.body?.ai).then((result) => res.json(result), (e: unknown) => res.status(400).json({ error: e instanceof Error ? e.message : String(e) }));
});
app.post('/api/packaging/trash-version', handle((req, res) => { res.json(trashPackagingVersion(String(req.body?.piece ?? ''), String(req.body?.source ?? ''))); }));
app.post('/api/packaging/copy-thumbnail', handle((req, res) => { res.json(copyVersionThumbnail(String(req.body?.piece ?? ''), String(req.body?.source ?? ''), String(req.body?.target ?? ''), req.body?.expected, req.body?.sourceExpected)); }));
app.post('/api/packaging/import-thumbnail', handle((req, res) => { res.json(savePackagingThumbnail(String(req.body?.piece ?? ''), String(req.body?.version ?? ''), decodeThumbnail(req.body?.data))); }));

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

// Opens a folder in File Explorer (for a file, opens its folder with that file selected).
app.post('/api/open', handle((req, res) => {
  const full = safeResolve(parseRoot(req.body?.root), String(req.body?.path ?? ''));
  const args = fs.statSync(full).isDirectory() ? [full] : ['/select,', full];
  spawn('explorer.exe', args, { detached: true, stdio: 'ignore' }).unref();
  res.json({ ok: true });
}));

// { piece }: opens a longform's or short's Exports folder in File Explorer, making it (empty) first if needed.
app.post('/api/open-exports', handle((req, res) => {
  const full = ensureExportsFolder(req.body?.piece);
  spawn('explorer.exe', [full], { detached: true, stdio: 'ignore' }).unref();
  res.json({ ok: true, path: full });
}));

// Small JPEG preview of an image (made once, then cached in data/thumbs).
app.get('/api/thumb', (req, res) => {
  try {
    const full = safeResolve(parseRoot(req.query.root), String(req.query.path ?? ''));
    const width = Math.min(1600, Math.max(120, Number(req.query.w) || 360));
    thumbnail(full, width).then(
      (thumb) => res.set('Cache-Control', req.query.root === 'expressions' ? 'no-cache' : 'max-age=86400').sendFile(thumb),
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
app.get('/api/expressions/categories', handle((_req, res) => { res.json(expressionCategories()); }));
app.get('/api/expressions/inbox', handle((_req, res) => { res.json(inboxExpressionPhotos()); }));
app.post('/api/expressions/inbox/open', handle((_req, res) => { ensureExpressionInbox(); res.json({ ok: true }); }));
app.post('/api/expressions/inbox/import', handle((req, res) => { res.json(importInboxPhoto(req.body?.name, req.body?.data, req.body?.ai)); }));
app.post('/api/expressions/inbox/photopea-copy', handle((req, res) => {
  const result = copyInboxPhotoForPhotopea(String(req.body?.photo ?? ''));
  const full = safeResolve('expressions', result.path);
  spawn('explorer.exe', ['/select,', full], { detached: true, stdio: 'ignore' }).unref();
  res.json(result);
}));
app.post('/api/expressions/inbox/copy-thumbnail', handle((req, res) => { res.json(copyThumbnailToInbox(String(req.body?.piece ?? ''), String(req.body?.image ?? ''))); }));
app.post('/api/expressions/inbox/trash', handle((req, res) => { res.json(trashInboxPhoto(String(req.body?.photo ?? ''))); }));
app.get('/api/ideas', handle((_req, res) => { res.json(readIdeas()); }));
app.post('/api/ideas/add', handle((req, res) => { res.json(addIdea(req.body?.title, req.body?.notes ?? '')); }));
app.post('/api/ideas/update', handle((req, res) => { res.json(updateIdea(req.body?.id, { title: req.body?.title, notes: req.body?.notes, status: req.body?.status, format: req.body?.format, category: req.body?.category, processed: req.body?.processed })); }));
app.post('/api/ideas/move', handle((req, res) => { res.json(moveIdea(req.body?.id, req.body?.step)); }));
app.post('/api/ideas/delete', handle((req, res) => { res.json(deleteIdea(req.body?.id)); }));
app.post('/api/ideas/reference/add', handle((req, res) => { res.json(addReference(req.body?.id, req.body ?? {})); }));
app.post('/api/ideas/reference/update', handle((req, res) => { res.json(updateReference(req.body?.id, req.body?.referenceId, req.body ?? {})); }));
app.post('/api/ideas/reference/move', handle((req, res) => { res.json(moveReference(req.body?.id, req.body?.referenceId, req.body?.step)); }));
app.post('/api/ideas/reference/delete', handle((req, res) => { res.json(deleteReference(req.body?.id, req.body?.referenceId)); }));
app.get('/api/ideas/attachment', handle((req, res) => { sandboxHeaders(res); res.sendFile(attachmentFile(req.query.id, req.query.attachmentId)); }));
app.post('/api/ideas/attachment/upload', express.raw({ type: 'application/octet-stream', limit: '50mb' }), handle((req, res) => {
  res.json(addAttachment(req.query.id, req.query.name, Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), req.query.note ?? ''));
}));
app.post('/api/ideas/attachment/update', handle((req, res) => { res.json(updateAttachment(req.body?.id, req.body?.attachmentId, req.body ?? {})); }));
app.post('/api/ideas/attachment/delete', handle((req, res) => { res.json(deleteAttachment(req.body?.id, req.body?.attachmentId)); }));
app.get('/api/ideas/brainstorm', handle((req, res) => { res.json(readBrainstorm(req.query.id)); }));
app.post('/api/ideas/brainstorm/send', (req, res) => {
  sendBrainstormMessage(req.body?.id, req.body?.ai, req.body?.message).then(
    (result) => res.json(result),
    (e: unknown) => res.status(400).json({ error: e instanceof Error ? e.message : String(e) }),
  );
});
app.post('/api/ideas/brainstorm/clear', handle((req, res) => { res.json(clearBrainstorm(req.body?.id)); }));
app.get('/api/expressions/shot-list', handle((_req, res) => { res.json(readShotList()); }));
app.post('/api/expressions/shot-list/add', handle((req, res) => { res.json(addExpressionShots(String(req.body?.piece ?? ''), req.body?.shots)); }));
app.post('/api/expressions/shot-list/status', handle((req, res) => { res.json(setShotDone(req.body?.id, req.body?.done)); }));
app.post('/api/expressions/shot-list/delete', handle((req, res) => { const shots = deleteShot(req.body?.id); removeShotReference(String(req.body?.id)); res.json(shots); }));
app.get('/api/expressions/shot-list/references', handle((_req, res) => { res.json(shotReferences()); }));
app.post('/api/expressions/shot-list/reference/start', handle((req, res) => { res.json(startShotReference(req.body?.id).job); }));
app.get('/api/expressions/shot-list/reference/image', handle((req, res) => { sandboxHeaders(res); res.sendFile(shotReferenceFile(String(req.query.id ?? ''), String(req.query.name ?? ''))); }));
app.post('/api/expressions/shot-list/reference/copy-to-inbox', handle((req, res) => { res.json(copyShotReferenceToInbox(req.body?.id, req.body?.name)); }));
app.get('/api/expressions/videos', handle((_req, res) => { res.json(listGeneratedVideos()); }));
app.post('/api/expressions/videos/open', handle((_req, res) => { res.json({ ok: true, path: ensureGeneratedVideosDir() }); }));
app.post('/api/expressions/videos/upload', express.raw({ type: 'application/octet-stream', limit: '250mb' }), handle((req, res) => {
  res.json(saveGeneratedVideo(req.query.name, Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)));
}));
app.post('/api/expressions/videos/rename', handle((req, res) => { res.json(renameGeneratedVideo(req.body?.name, req.body?.newName)); }));
app.post('/api/expressions/videos/trash', handle((req, res) => { res.json(trashGeneratedVideo(req.body?.name)); }));
app.get('/api/expressions/videos/file', handle((req, res) => { sandboxHeaders(res); res.sendFile(generatedVideoFile(req.query.name)); }));
app.post('/api/expressions/assess', handle((req, res) => { res.json(startAssessment(String(req.body?.photo ?? ''))); }));
app.get('/api/expressions/assessment', handle((req, res) => { res.json(assessmentJob(String(req.query.id ?? ''))); }));
app.post('/api/expressions/rating', handle((req, res) => { setExpressionRating(String(req.body?.photo ?? ''), req.body?.rating ?? null); res.json({ ok: true }); }));
app.post('/api/expressions/mark-ai', handle((req, res) => { markExpressionAi(String(req.body?.photo ?? '')); res.json({ ok: true }); }));
app.post('/api/expressions/confirm-expression', handle((req, res) => { res.json(confirmExpressionFolder(String(req.body?.photo ?? ''), String(req.body?.tag ?? ''), req.body?.confidence)); }));
app.post('/api/expressions/confirm-tag', handle((req, res) => { confirmExpressionTag(String(req.body?.photo ?? ''), String(req.body?.tag ?? ''), req.body?.confidence); res.json({ ok: true }); }));
app.post('/api/expressions/disconfirm-tag', handle((req, res) => { disconfirmExpressionTag(String(req.body?.photo ?? ''), String(req.body?.tag ?? ''), req.body?.confidence, req.body?.confirmed, req.body?.disconfirmed); res.json({ ok: true }); }));
app.post('/api/expressions/remove-tag', handle((req, res) => { removeExpressionTag(String(req.body?.photo ?? ''), String(req.body?.tag ?? ''), req.body?.confidence, req.body?.confirmed); res.json({ ok: true }); }));
app.post('/api/expressions/add-tag', handle((req, res) => { addExpressionTag(String(req.body?.photo ?? ''), String(req.body?.tag ?? ''), req.body?.group); res.json({ ok: true }); }));
app.post('/api/expressions/preview-change', handle((req, res) => { res.json(previewExpressionChange(String(req.body?.photo ?? ''), req.body?.destination === null ? null : String(req.body?.destination ?? ''))); }));
app.post('/api/expressions/apply-change', handle((req, res) => { res.json(applyExpressionChange(String(req.body?.photo ?? ''), req.body?.destination === null ? null : String(req.body?.destination ?? ''), String(req.body?.token ?? ''))); }));
app.get('/api/expression-references', handle((_req, res) => { res.json(readExpressionReferences()); }));
app.post('/api/expression-references', handle((req, res) => { res.json(saveExpressionReferences(req.body?.paths, req.body?.initialize === true)); }));
app.get('/api/likeness-references', handle((_req, res) => { res.json({ paths: readLikenessReferences() }); }));
app.post('/api/likeness-references', handle((req, res) => { res.json({ paths: saveLikenessReferences(req.body?.paths) }); }));
app.post('/api/expression-generation/start', handle((req, res) => { res.json(startExpressionGeneration(String(req.body?.category ?? ''), req.body?.references, req.body?.options, req.body?.ai, undefined, req.body?.prompt).job); }));
app.get('/api/expression-generation/prompt', handle((req, res) => { res.json({ prompt: previewExpressionPrompt(String(req.query.category ?? ''), { framing: String(req.query.framing ?? ''), angle: String(req.query.angle ?? ''), gaze: String(req.query.gaze ?? '') }) }); }));
app.get('/api/expression-generation/jobs', handle((req, res) => { res.json(expressionJobs(req.query.category === undefined ? undefined : String(req.query.category))); }));
app.get('/api/expression-generation/image', handle((req, res) => { sandboxHeaders(res); res.sendFile(candidateFile(String(req.query.id ?? ''))); }));
app.post('/api/expression-generation/assign-category', handle((req, res) => { res.json(assignExpressionCategory(String(req.body?.id ?? ''), String(req.body?.category ?? ''))); }));
app.post('/api/expression-generation/reject', handle((req, res) => { rejectExpression(String(req.body?.id ?? '')); res.json({ ok: true }); }));
app.post('/api/expression-generation/approve', handle((req, res) => { res.json(approveExpression(String(req.body?.id ?? ''))); }));

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

// ---- The AIs: which model each uses, and their sign-ins (see ai.ts) --------

app.get('/api/ai', handle((_req, res) => {
  res.json(aiOverview());
}));

// { id: "claude" | "codex" | "gemini", model: string }: the model that AI uses ("" for its own default).
app.post('/api/ai', handle((req, res) => {
  chooseAiModel(req.body?.id, req.body?.model);
  res.json(aiOverview());
}));

// Whether Claude, ChatGPT and Gemini are signed in (asks their programs; free). See ai-signin.ts.
app.get('/api/ai/sign-ins', (_req, res) => {
  aiSignIns().then((r) => res.json(r), (e) => res.status(500).json({ error: e instanceof Error ? e.message : String(e) }));
});

// { id }: opens that AI's sign-in in its own window.
app.post('/api/ai/sign-in', handle((req, res) => {
  res.json(openSignIn(req.body?.id));
}));

// ---- Packaging files (see metadata.ts) --------------------------------------

// { path, text, was }: saves the file only if it still says "was".
app.post('/api/packaging/save', handle((req, res) => {
  savePackagingText(String(req.body?.path ?? ''), req.body?.text, req.body?.was);
  res.json({ ok: true });
}));
// { version, text, was }: saves a version's Notes.md, making it if needed.
app.post('/api/packaging/notes', handle((req, res) => {
  saveVersionNotes(String(req.body?.version ?? ''), req.body?.text, req.body?.was);
  res.json({ ok: true });
}));
app.post('/api/packaging/first-version', handle((req, res) => { res.json(createFirstPackagingVersion(String(req.body?.piece ?? ''))); }));
app.post('/api/packaging/copy-version', (req, res) => {
  copyPackagingVersion(String(req.body?.piece ?? ''), String(req.body?.source ?? '')).then(
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
  res.json(startShortsProposal(video, hasRetention(video), parseAi(req.body?.ai)));
}));

// { video, job: "shorts" or "short-S07", text, ai }
app.post('/api/shorts/note', handle((req, res) => {
  res.json(sendNote(String(req.body?.video ?? ''), String(req.body?.text ?? ''), parseShortsJob(req.body?.job), parseAi(req.body?.ai)));
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
    const { video, id, draft, ai } = req.body ?? {};
    res.json(await makeShort(String(video ?? ''), String(id ?? ''), String(draft ?? ''), parseAi(ai)));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---- A piece's AI box: the longform's or a short's conversation (see shorts.ts) ------
// ?video=&piece= ("Longform", or a short's folder name)
app.get('/api/piece-ai', handle((req, res) => {
  res.json(pieceRun(String(req.query.video ?? ''), String(req.query.piece ?? '')));
}));

// { video, piece, text, ai }: a note, which starts a conversation if the piece has none.
app.post('/api/piece-ai/note', handle((req, res) => {
  res.json(notePiece(String(req.body?.video ?? ''), String(req.body?.piece ?? ''), req.body?.text, parseAi(req.body?.ai)));
}));

// ?video=&piece=: whether the card's button says Generate or Regenerate, and whether it can be used.
app.get('/api/piece-ai/state', handle((req, res) => {
  res.json(pieceState(String(req.query.video ?? ''), String(req.query.piece ?? '')));
}));

// { video, piece, regenerate, ai }: copying a CapCut project can take minutes, so this waits without holding up the rest.
app.post('/api/piece-ai/generate', async (req, res) => {
  try {
    res.json(await generatePiece(String(req.body?.video ?? ''), String(req.body?.piece ?? ''), req.body?.regenerate, parseAi(req.body?.ai)));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// { video, piece }: forgets that card's conversation.
app.post('/api/piece-ai/clear', handle((req, res) => {
  clearPiece(String(req.body?.video ?? ''), String(req.body?.piece ?? ''));
  res.json({ ok: true });
}));

// The page calls this when it loads, so a reload starts with no old conversations. Turns still running carry on.
app.post('/api/conversations/forget', handle((_req, res) => {
  forgetIdleRuns();
  res.json({ ok: true });
}));

app.post('/api/piece-ai/stop', handle((req, res) => {
  res.json(stopPiece(String(req.body?.video ?? ''), String(req.body?.piece ?? '')));
}));

// ?piece=: what the brief would be made from, and the brief being written, if any.
app.get('/api/brief', handle((req, res) => {
  const piece = String(req.query.piece ?? '');
  res.json({ source: briefSource(piece), job: getBrief(piece) });
}));

// ?piece=: the brief's transcript (or script) as text, for the vidIQ and Ask Studio question before the video is on
// YouTube. Reads only.
app.get('/api/brief/source-text', async (req, res) => {
  try {
    res.json(await briefSourceText(String(req.query.piece ?? '')));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// { piece, notes, plan }: the plan's first AI writes the brief, the others review it, then its picker picks the top 3,
// in the background.
app.post('/api/brief/start', async (req, res) => {
  try {
    const { job } = await startBrief(String(req.body?.piece ?? ''), String(req.body?.notes ?? ''), undefined, req.body?.images, parseBriefPlan(req.body?.plan));
    res.json(job);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// { piece, image, version, thumbnail, title }: Use Thumbnail / Use Title / Use Both: a draft image into that version.
app.post('/api/packaging/use-draft', async (req, res) => {
  try {
    const b = req.body ?? {};
    res.json(await useDraft(String(b.piece ?? ''), String(b.image ?? ''), String(b.version ?? ''), { thumbnail: b.thumbnail === true, title: b.title === true }));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ?piece=: the thumbnails being made for this video, and how each went.
app.get('/api/thumbs', handle((req, res) => {
  res.json(thumbJobs(String(req.query.piece ?? '')));
}));

// Feedback reviews an existing image and its generated packaging without changing either.
app.get('/api/thumbs/reviews', handle((req, res) => {
  res.json(thumbnailReviews(String(req.query.piece ?? ''), String(req.query.image ?? '')));
}));
app.post('/api/thumbs/reviews', handle((req, res) => {
  res.json(startThumbnailReview(String(req.body?.piece ?? ''), String(req.body?.image ?? ''), req.body?.ai, req.body?.question ?? '').job);
}));

// { piece, ai }: Make Thumbnail with ChatGPT ("codex") or Gemini, from the chosen pair and photo, in the background.
app.post('/api/thumbs/make', handle((req, res) => {
  res.json(startThumbnail(String(req.body?.piece ?? ''), req.body?.ai).job);
}));

// { piece, conversation, text, pasted, drafts }: a change request, with any reference images (pasted, or drafts of this video), to the conversation that made that draft.
app.post('/api/thumbs/change', handle((req, res) => {
  res.json(changeThumbnail(String(req.body?.piece ?? ''), String(req.body?.conversation ?? ''), req.body?.text, undefined, { pasted: req.body?.pasted, drafts: req.body?.drafts, photo: req.body?.photo }).job);
}));

// { piece, index }: John chose one of the top 3 pairs (saved as Drafts\Choice.json).
app.post('/api/brief/choose', handle((req, res) => {
  res.json(chooseBriefPick(String(req.body?.piece ?? ''), req.body?.index));
}));

// { piece, photo }: the expressions-library photo for the chosen pair.
app.post('/api/brief/photo', handle((req, res) => {
  res.json(chooseBriefPhoto(String(req.body?.piece ?? ''), req.body?.photo));
}));

// ?piece=: Clean Up's list for a finished longform or Short (reads the CapCut projects; changes nothing). See cleanup.ts.
app.get('/api/cleanup', handle((req, res) => {
  res.json(cleanupPlan(String(req.query.piece ?? '')));
}));

// { piece, token }: carries out the list John approved; everything goes to HeartQuarters Trash.
app.post('/api/cleanup', handle((req, res) => {
  const piece = String(req.body?.piece ?? '');
  const done = runCleanup(piece, req.body?.token);
  cleanupDone(piece);
  res.json(done);
}));

// Which pieces Clean Up has something for (the Videos page's badges). Answers at once; checks again in the background.
app.get('/api/cleanup/status', handle((_req, res) => {
  res.json(cleanupStatus());
}));

// ?piece=: the saved photo ranking for the chosen pair, and whether Claude is ranking now. See photo-ranking.ts.
app.get('/api/brief/ranking', handle((req, res) => {
  const piece = String(req.query.piece ?? '');
  res.json({ ranking: readRanking(piece), job: rankingJob(piece) });
}));

// { piece }: Claude looks at the pair's category photos and the starred ones, and ranks the best five.
app.post('/api/brief/rank-photos', handle((req, res) => {
  res.json(startRanking(String(req.body?.piece ?? '')).job);
}));

// { piece, notes, picker }: only the last step, the picker AI choosing the top 3 pairs, on the brief that's already there.
app.post('/api/brief/picks', async (req, res) => {
  try {
    const { job } = await startPicks(String(req.body?.piece ?? ''), String(req.body?.notes ?? ''), undefined, req.body?.images, parseAi(req.body?.picker ?? 'claude'));
    res.json(job);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Moves the old short to the trash, then makes it again: the same wait as above.
app.post('/api/shorts/regenerate', async (req, res) => {
  try {
    const { video, id, draft, ai } = req.body ?? {};
    res.json(await regenerateShort(String(video ?? ''), String(id ?? ''), String(draft ?? ''), parseAi(ai)));
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

app.use('/api', (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = typeof (err as { status?: unknown })?.status === 'number' ? (err as { status: number }).status : 500;
  const message = status === 413 ? 'That upload is too large.' : err instanceof Error ? err.message : String(err);
  res.status(status).json({ error: message });
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

// HQ_PORT lets a second copy run alongside (e.g. for testing).
const port = Number(process.env.HQ_PORT) || config.port;
const url = `http://127.0.0.1:${port}`;
app.listen(port, '127.0.0.1', () => {
  console.log(`HeartQuarters is running at ${url}`);
  console.log('Close this window (or press Ctrl+C) to stop it.');
  try { const n = migrateShotReferences(); if (n) console.log(`Shot reference pictures: copied ${n} files to Drive.`); } catch (e) { console.log(`Shot reference pictures not moved this time: ${e instanceof Error ? e.message : String(e)}`); }
  try { const n = migrateReferenceFiles(); if (n) console.log(`Reference photo lists: copied ${n} to Drive.`); } catch (e) { console.log(`Reference photo lists not moved this time: ${e instanceof Error ? e.message : String(e)}`); }
  try {
    const { written, restored } = syncLinkFiles();
    if (written || restored) console.log(`YouTube links: saved ${written} to Drive, restored ${restored} from Drive.`);
  } catch (e) { console.log(`YouTube links not checked this time: ${e instanceof Error ? e.message : String(e)}`); }
  if (shouldOpenBrowser(process.argv.includes('--open'), path.join(appDir, 'data'), process.env.HQ_BROWSER_SESSION, process.ppid)) {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  }
});
