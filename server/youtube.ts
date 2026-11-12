// Uploads only a selected export. Original files are opened for reading, never changed.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { appDir, isInside, safeResolve } from './config.js';
import { youtubeAccessToken, youtubeStatus } from './youtube-auth.js';
import { readSubtitle, sendSubtitle, uploadSubtitle } from './youtube-captions.js';
import { setVideoLanguage, videoLanguage } from './youtube-language.js';
import { addYoutubePlaylist, checkPlaylistIds, listYoutubePlaylists, playlistVideoItems, removePlaylistVideoItem } from './youtube-playlists.js';
import { readYoutubeVideo, updateYoutubeVideo, youtubeCaptionTracks, youtubeVideoId, type YoutubeVideoSettings } from './youtube-video.js';
import { fetchYoutubeThumbnail, savePackagingThumbnail } from './thumbnail-files.js';
import { isShortPiece, waitForShortProcessing, youtubeProcessingStatus } from './youtube-processing.js';

export interface UploadInput { piece: string; video: string; cover: string; subtitle?: string; language?: string; playlistIds?: string[]; title: string; description: string; tags: string[]; privacy: 'private' | 'unlisted' | 'public'; madeForKids: boolean; synthetic: boolean }
export interface UploadJob { id: string; piece: string; video: string; status: 'uploading' | 'done' | 'failed' | 'unknown' | 'checked'; sent: number; total: number; phase?: 'waiting-thumbnail'; videoId?: string; error?: string; warning?: string; subtitleStatus?: 'uploading' | 'sent' | 'error'; subtitleError?: string; /** The captions file last sent, and whether it added a track or replaced one. */ subtitleFile?: string; subtitleAction?: 'added' | 'replaced'; playlistResults?: { id: string; status: 'added' | 'error'; error?: string }[] }
const jobs = new Map<string, UploadJob>();
const jobsDir = () => process.env.HQ_YOUTUBE_JOBS_DIR ?? path.join(appDir, 'data', 'youtube-uploads');
function record(job: UploadJob) { fs.mkdirSync(jobsDir(), { recursive: true }); fs.writeFileSync(path.join(jobsDir(), `${job.id}.json`), JSON.stringify(job, null, 2)); }
export function uploadsFor(piece: string): UploadJob[] {
  if (!fs.existsSync(jobsDir())) return [];
  return fs.readdirSync(jobsDir()).filter((f) => /^[\da-f-]+\.json$/i.test(f)).flatMap((f) => {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(jobsDir(), f), 'utf8')) as UploadJob;
      if (j.piece !== piece) return [];
      const live = jobs.get(j.id); if (live) return [live];
      if (j.status === 'uploading') { j.status = j.videoId ? 'done' : 'unknown'; if (j.videoId) j.warning = 'The upload completed, but the remaining steps may have been interrupted. Check YouTube Studio.'; }
      if (j.subtitleStatus === 'uploading') { j.subtitleStatus = 'error'; j.subtitleError = 'HeartQuarters restarted while sending subtitles'; }
      return [j];
    } catch { return []; }
  }).reverse();
}
export function validateUpload(input: UploadInput) {
  if (!input || typeof input.piece !== 'string' || !input.piece || typeof input.video !== 'string' || typeof input.cover !== 'string') throw new Error('Choose a video and packaging.');
  const piece = safeResolve('projects', input.piece);
  const video = safeResolve('projects', input.video);
  const exports = safeResolve('projects', path.join(input.piece, 'Exports'));
  if (!isInside(exports, video) || !/\.(mp4|mov|mkv|webm)$/i.test(video) || !fs.statSync(video).isFile()) throw new Error('Choose a video from this project’s Exports folder.');
  let cover = '';
  if (input.cover) {
    cover = safeResolve('projects', input.cover);
    if (!isInside(path.join(piece, 'Packaging'), cover) || !/\.(png|jpe?g)$/i.test(cover) || !fs.statSync(cover).isFile() || fs.statSync(cover).size > 2_000_000) throw new Error('Choose a PNG or JPEG cover under 2 MB from this project’s packaging.');
  }
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 100 || typeof input.description !== 'string' || input.description.length > 5000) throw new Error('A title is required (up to 100 characters); descriptions can be up to 5,000 characters.');
  if (!Array.isArray(input.tags) || input.tags.some((t) => typeof t !== 'string') || input.tags.join(',').length > 500) throw new Error('Tags must be text, with at most 500 characters in total.');
  if (!['private', 'unlisted', 'public'].includes(input.privacy) || typeof input.madeForKids !== 'boolean' || typeof input.synthetic !== 'boolean') throw new Error('Choose visibility, audience and altered-content settings.');
  const stat = fs.statSync(video);
  if (!stat.size || stat.size > 256 * 1024 ** 3) throw new Error('The video is empty or larger than YouTube’s 256 GB limit.');
  if (input.subtitle !== undefined && typeof input.subtitle !== 'string') throw new Error('Choose a subtitle file.');
  videoLanguage(input.language);
  checkPlaylistIds(input.playlistIds);
  if (input.subtitle) readSubtitle(input.piece, input.subtitle);
  return { video, cover, size: stat.size };
}
async function responseError(res: Response) { const s = await res.text(); try { const j = JSON.parse(s) as { error?: { message?: string } }; return j.error?.message ?? `YouTube returned ${res.status}`; } catch { return `YouTube returned ${res.status}`; } }
export async function youtubeChannel() {
  const token = await youtubeAccessToken();
  const res = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(await responseError(res));
  const data = await res.json() as { items?: { id: string; snippet: { title: string } }[] };
  if (data.items?.length !== 1) throw new Error('Google did not return one YouTube channel. Check which channel you selected when signing in.');
  return { id: data.items[0].id, title: data.items[0].snippet.title };
}
export function startUpload(input: UploadInput): UploadJob {
  const files = validateUpload(input);
  if (input.subtitle && !youtubeStatus().captionAccess) throw new Error('Reconnect YouTube and grant caption permission before uploading subtitles.');
  if (input.playlistIds?.length && !youtubeStatus().captionAccess) throw new Error('Reconnect YouTube and grant playlist permission first.');
  if (uploadsFor(input.piece).some((j) => j.video === input.video && (j.status === 'uploading' || j.status === 'unknown'))) throw new Error('An upload of this file is still running or its result is unknown. Check YouTube Studio before trying again.');
  const job: UploadJob = { id: randomUUID(), piece: input.piece, video: input.video, status: 'uploading', sent: 0, total: files.size };
  record(job); jobs.set(job.id, job);
  void upload(job, input, files).catch((e: unknown) => { job.status = job.videoId ? 'done' : 'unknown'; job.error = e instanceof Error ? e.message : String(e); record(job); });
  return job;
}
export async function youtubePlaylists() { return listYoutubePlaylists(await youtubeAccessToken()); }

/** Read-only review: a caption permission failure is reported as unknown. */
export async function checkYoutubeDetails(value: unknown) {
  const id = youtubeVideoId(value); const token = await youtubeAccessToken();
  const { settings } = await readYoutubeVideo(token, id);
  let captions: Awaited<ReturnType<typeof youtubeCaptionTracks>> | null = null;
  try { captions = await youtubeCaptionTracks(token, id); } catch { /* Do not mistake a permissions error for no captions. */ }
  return { video: settings, captions };
}

/** Link a video the owner identifies, after verifying it belongs to the connected channel. */
export async function linkYoutubeVideo(piece: string, value: unknown): Promise<UploadJob> {
  if (!piece || !fs.statSync(safeResolve('projects', piece)).isDirectory()) throw new Error('Choose a project folder.');
  const videoId = youtubeVideoId(value);
  const existing = uploadsFor(piece).find((j) => j.videoId === videoId && j.status === 'done');
  if (existing) return existing;
  const [video, channel] = await Promise.all([readYoutubeVideo(await youtubeAccessToken(), videoId), youtubeChannel()]);
  if (video.resource.snippet?.channelId !== channel.id) throw new Error('That video is not on the connected YouTube channel.');
  const job: UploadJob = { id: randomUUID(), piece, video: '', status: 'done', videoId, sent: 0, total: 0 };
  record(job); jobs.set(job.id, job); return job;
}

async function playlistSnapshot(token: string, videoId: string) {
  const playlists = await listYoutubePlaylists(token);
  const items = await Promise.all(playlists.map((p) => playlistVideoItems(token, p.id, videoId)));
  return { playlists, entries: new Map(playlists.map((p, i) => [p.id, items[i]])) };
}

function completedUpload(piece: string, id: string): UploadJob {
  const job = uploadsFor(piece).find((j) => j.id === id);
  if (!job?.videoId || job.status !== 'done') throw new Error('That completed upload was not found.');
  return job;
}

export async function downloadYoutubeThumbnail(piece: string, id: string, version: string, name: unknown) {
  const job = completedUpload(piece, id);
  const video = await readYoutubeVideo(await youtubeAccessToken(), job.videoId!);
  if (!video.settings.thumbnail) throw new Error('YouTube did not provide a thumbnail for this video.');
  const data = await fetchYoutubeThumbnail(video.settings.thumbnail);
  const extension = data[0] === 0xff && data[1] === 0xd8 ? '.jpg' : '.png';
  return savePackagingThumbnail(piece, version, `${String(name ?? '').trim()}${extension}`, data);
}

export async function existingYoutubeSettings(piece: string, id: string) {
  const job = completedUpload(piece, id); const token = await youtubeAccessToken();
  const [video, playlists] = await Promise.all([readYoutubeVideo(token, job.videoId!), videoPlaylists(piece, id)]);
  let captions: Awaited<ReturnType<typeof youtubeCaptionTracks>> | null = null;
  let captionError: string | null = null;
  try { captions = await youtubeCaptionTracks(token, job.videoId!); } catch (e) { captionError = e instanceof Error ? e.message : String(e); }
  return { video: video.settings, ...playlists, captions, captionError };
}

export async function syncYoutubeSettings(piece: string, id: string, baseline: YoutubeVideoSettings, desired: YoutubeVideoSettings, before: unknown, after: unknown, subtitle: unknown, cover: unknown) {
  const job = completedUpload(piece, id);
  if (!youtubeStatus().captionAccess) throw new Error('Reconnect YouTube to save changes.');
  if (typeof subtitle !== 'string' || typeof cover !== 'string') throw new Error('Check the subtitle and thumbnail choices.');
  if (!Array.isArray(before) || !Array.isArray(after)) throw new Error('Load the current YouTube playlists first.');
  if (subtitle && job.subtitleStatus === 'uploading') throw new Error('Subtitles are still being sent to this video. Wait for that to finish.');
  if (subtitle) readSubtitle(piece, subtitle);
  let coverPath = '';
  if (cover) {
    const folder = safeResolve('projects', path.join(piece, 'Packaging'));
    coverPath = safeResolve('projects', cover);
    if (!isInside(folder, coverPath) || !/\.(png|jpe?g)$/i.test(coverPath) || !fs.statSync(coverPath).isFile() || fs.statSync(coverPath).size > 2_000_000) throw new Error('Choose a PNG or JPEG cover under 2 MB from this project’s packaging.');
  }
  const oldIds = checkPlaylistIds(before); const newIds = checkPlaylistIds(after);
  const current = await videoPlaylists(piece, id);
  const available = new Set(current.playlists.map((p) => p.id));
  if ([...oldIds, ...newIds].some((p) => !available.has(p))) throw new Error('Your playlist list changed. Reload the YouTube settings before saving.');
  if (current.playlists.some((p) => oldIds.includes(p.id) !== newIds.includes(p.id) && current.selected.includes(p.id) !== oldIds.includes(p.id))) throw new Error('A playlist changed in Studio. Reload the YouTube settings before saving.');
  const token = await youtubeAccessToken();
  await updateYoutubeVideo(token, job.videoId!, baseline, desired);
  const errors: string[] = [];
  try { const result = await saveVideoPlaylists(piece, id, oldIds, newIds); errors.push(...result.errors); }
  catch (e) { errors.push(`Playlists: ${e instanceof Error ? e.message : String(e)}`); }
  if (coverPath) {
    try {
      if (isShortPiece(piece) && await youtubeProcessingStatus(token, job.videoId!) !== 'succeeded') throw new Error('YouTube is still processing this Short. Choose the thumbnail again after processing finishes.');
      const response = await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(job.videoId!)}&uploadType=media`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': coverPath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg' }, body: new Uint8Array(await fs.promises.readFile(coverPath)) });
      if (!response.ok) throw new Error(await responseError(response));
    } catch (e) { errors.push(`Thumbnail: ${e instanceof Error ? e.message : String(e)}`); }
  }
  if (subtitle) {
    try { await addSubtitle(piece, id, subtitle, desired.language ?? 'en-US'); const updated = uploadsFor(piece).find((j) => j.id === id); if (updated?.subtitleStatus !== 'sent') throw new Error(updated?.subtitleError ?? 'YouTube did not confirm the subtitle upload.'); }
    catch (e) { errors.push(`Subtitles: ${e instanceof Error ? e.message : String(e)}`); }
  }
  return { errors };
}

export async function videoPlaylists(piece: string, id: string) {
  const job = completedUpload(piece, id);
  const snapshot = await playlistSnapshot(await youtubeAccessToken(), job.videoId!);
  return { playlists: snapshot.playlists, selected: snapshot.playlists.filter((p) => snapshot.entries.get(p.id)!.length > 0).map((p) => p.id) };
}

/** Apply only the boxes the user changed, after checking for changes made in Studio. */
export async function saveVideoPlaylists(piece: string, id: string, before: unknown, after: unknown) {
  if (before === undefined || after === undefined) throw new Error('Load the video’s current playlists first.');
  const oldIds = checkPlaylistIds(before); const newIds = checkPlaylistIds(after);
  const job = completedUpload(piece, id);
  if (!youtubeStatus().captionAccess) throw new Error('Reconnect YouTube to allow playlist changes.');
  const token = await youtubeAccessToken();
  const snapshot = await playlistSnapshot(token, job.videoId!);
  const allowed = new Set(snapshot.playlists.map((p) => p.id));
  if ([...oldIds, ...newIds].some((id) => !allowed.has(id))) throw new Error('Your playlist list changed. Reload it and try again.');
  const changed = snapshot.playlists.filter((p) => oldIds.includes(p.id) !== newIds.includes(p.id));
  if (changed.some((p) => (snapshot.entries.get(p.id)!.length > 0) !== oldIds.includes(p.id))) throw new Error('A selected playlist changed in YouTube Studio. Reload the playlists and try again.');
  const errors: string[] = [];
  const applied: typeof changed = [];
  for (const playlist of changed) {
    try {
      if (newIds.includes(playlist.id)) await addYoutubePlaylist(token, playlist.id, job.videoId!);
      else for (const entry of snapshot.entries.get(playlist.id)!) await removePlaylistVideoItem(token, entry);
      applied.push(playlist);
    } catch (e) { errors.push(`${playlist.title}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  // YouTube's playlist reads can briefly lag behind a successful change.
  let pending = applied;
  for (let attempt = 0; pending.length && attempt < 4; attempt++) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 1000));
    const checks = await Promise.all(pending.map(async (p) => {
      try { return (await playlistVideoItems(token, p.id, job.videoId!)).length > 0 === newIds.includes(p.id); }
      catch { return false; }
    }));
    pending = pending.filter((_p, i) => !checks[i]);
  }
  for (const playlist of pending) errors.push(`${playlist.title}: YouTube has not confirmed the change yet; reload the playlists shortly`);
  return { errors };
}

async function putInPlaylists(job: UploadJob, token: string, ids: string[]) {
  const allowed = new Set((await listYoutubePlaylists(token)).map((p) => p.id));
  for (const id of ids) {
    try {
      if (!allowed.has(id)) throw new Error('This playlist is no longer available on the connected channel.');
      await addYoutubePlaylist(token, id, job.videoId!);
      job.playlistResults = [...(job.playlistResults ?? []).filter((r) => r.id !== id), { id, status: 'added' }];
    } catch (e) {
      job.playlistResults = [...(job.playlistResults ?? []).filter((r) => r.id !== id), { id, status: 'error', error: e instanceof Error ? e.message : String(e) }];
    }
    record(job);
  }
}

export async function addPlaylists(piece: string, id: string, value: unknown): Promise<void> {
  const ids = checkPlaylistIds(value);
  if (!ids.length) throw new Error('Choose at least one playlist.');
  const job = uploadsFor(piece).find((j) => j.id === id);
  if (!job?.videoId || job.status !== 'done') throw new Error('That completed upload was not found.');
  if (!youtubeStatus().captionAccess) throw new Error('Reconnect YouTube to allow playlist changes.');
  await putInPlaylists(job, await youtubeAccessToken(), ids);
}
/** Add or replace captions on a video already on YouTube, without re-uploading the video (see sendSubtitle). */
export async function addSubtitle(piece: string, id: string, subtitle: string, language: unknown = 'en-US'): Promise<void> {
  const job = uploadsFor(piece).find((j) => j.id === id);
  if (!job?.videoId || job.status !== 'done') throw new Error('That completed upload was not found.');
  if (job.subtitleStatus === 'uploading') throw new Error('Subtitles are still being sent to this video. Wait for that to finish.');
  if (!youtubeStatus().captionAccess) throw new Error('Reconnect YouTube and grant caption permission first.');
  const bytes = readSubtitle(piece, subtitle); const selectedLanguage = videoLanguage(language);
  job.subtitleStatus = 'uploading'; job.subtitleError = undefined; jobs.set(job.id, job); record(job);
  try { const token = await youtubeAccessToken(); await setVideoLanguage(token, job.videoId, selectedLanguage); job.subtitleAction = await sendSubtitle(token, job.videoId, bytes, selectedLanguage); job.subtitleFile = subtitle; job.subtitleStatus = 'sent'; }
  catch (e) { job.subtitleStatus = 'error'; job.subtitleError = e instanceof Error ? e.message : String(e); }
  record(job);
}
/** Explicitly acknowledge an uncertain upload only after checking YouTube Studio. */
export function acknowledgeUpload(piece: string, id: string) {
  const job = uploadsFor(piece).find((j) => j.id === id);
  if (!job || job.status !== 'unknown') throw new Error('That upload is not awaiting a check.');
  job.status = 'checked';
  jobs.delete(job.id);
  record(job);
}
async function upload(job: UploadJob, input: UploadInput, files: { video: string; cover: string; size: number }) {
  let token: string;
  try { token = await youtubeAccessToken(); } catch (e) { job.status = 'failed'; job.error = e instanceof Error ? e.message : String(e); record(job); return; }
  const init = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Length': String(files.size), 'X-Upload-Content-Type': 'application/octet-stream' },
    body: JSON.stringify({ snippet: { title: input.title.trim(), description: input.description, tags: input.tags, categoryId: '22', defaultAudioLanguage: videoLanguage(input.language), defaultLanguage: videoLanguage(input.language) }, status: { privacyStatus: input.privacy, selfDeclaredMadeForKids: input.madeForKids, containsSyntheticMedia: input.synthetic } }),
  });
  if (!init.ok) { job.status = 'failed'; job.error = await responseError(init); record(job); return; }
  const url = init.headers.get('location'); if (!url || !url.startsWith('https://www.googleapis.com/')) throw new Error('YouTube did not return a valid upload address.');
  const handle = await fs.promises.open(files.video, 'r');
  try {
    const chunk = Buffer.alloc(8 * 1024 * 1024);
    while (job.sent < files.size) {
      const n = Math.min(chunk.length, files.size - job.sent);
      const { bytesRead } = await handle.read(chunk, 0, n, job.sent);
      if (bytesRead !== n) throw new Error('The export changed or could not be read during upload.');
      const res = await fetch(url, { method: 'PUT', headers: { 'Content-Length': String(n), 'Content-Range': `bytes ${job.sent}-${job.sent + n - 1}/${files.size}` }, body: new Uint8Array(chunk.buffer, chunk.byteOffset, n) });
      if (res.status === 308) { const range = /^bytes=0-(\d+)$/.exec(res.headers.get('range') ?? ''); if (!range || Number(range[1]) + 1 !== job.sent + n) throw new Error('YouTube reported an unexpected upload position.'); job.sent += n; }
      else if (res.ok) { const result = await res.json() as { id?: string }; if (!result.id) throw new Error('YouTube did not return a video ID.'); job.videoId = result.id; job.sent = files.size; record(job); }
      else throw new Error(await responseError(res));
    }
  } finally { await handle.close(); }
  if (!job.videoId) throw new Error('YouTube did not confirm the completed upload.');
  if (input.playlistIds?.length) {
    try { await putInPlaylists(job, token, checkPlaylistIds(input.playlistIds)); }
    catch (e) { job.playlistResults = input.playlistIds.map((id) => ({ id, status: 'error', error: e instanceof Error ? e.message : String(e) })); record(job); }
  }
  if (files.cover) {
    try {
      if (isShortPiece(job.piece)) {
        job.phase = 'waiting-thumbnail'; record(job);
        await waitForShortProcessing(() => youtubeProcessingStatus(token, job.videoId!), () => new Promise((resolve) => setTimeout(resolve, 5000)));
        delete job.phase; record(job);
      }
      const res = await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(job.videoId)}&uploadType=media`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': files.cover.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg' }, body: new Uint8Array(await fs.promises.readFile(files.cover)) });
      if (!res.ok) throw new Error(await responseError(res));
    } catch (e) { delete job.phase; job.warning = `The video uploaded, but its thumbnail did not: ${e instanceof Error ? e.message : String(e)}. Try the thumbnail again after processing or set it in YouTube Studio.`; }
  }
  if (input.subtitle) {
    job.subtitleStatus = 'uploading'; record(job);
    try { const language = videoLanguage(input.language); await setVideoLanguage(token, job.videoId, language); await uploadSubtitle(token, job.videoId, readSubtitle(input.piece, input.subtitle), language); job.subtitleFile = input.subtitle; job.subtitleAction = 'added'; job.subtitleStatus = 'sent'; }
    catch (e) { job.subtitleStatus = 'error'; job.subtitleError = e instanceof Error ? e.message : String(e); }
  }
  job.status = 'done'; record(job);
}
