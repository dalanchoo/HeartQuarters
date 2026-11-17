import { useEffect, useRef, useState, type ReactNode } from 'react';
import { fileStamp, fileUrl, getJson, getText, postJson, type FileRef, type Piece } from './api';
import { CopyButton, type LoadedDoc } from './PackagingDoc';
import type { UploadJob } from '../../server/youtube';
import type { YoutubeVideoSettings } from '../../server/youtube-video';
import { VIDEO_LANGUAGES } from '../../server/youtube-language';
import { SHORTS_PLAYLIST, type YoutubePlaylist } from '../../server/youtube-playlists';
import { readAiLines, setAiLines, setFieldValue, sortTags, type AiLines, type Field } from './packaging';
import { ComparisonRow, isLongComparisonField } from './ComparisonRow';
import { localBoolean, localValue, setLocalValue, SYNC_FIELDS, youtubeValues, type SyncField } from './youtubePackaging';
import { existingYoutubeJob, preferredYoutubeJob, rememberYoutubeJob, shouldLinkLongform, youtubeVideoUrl } from './youtubePanel';
import { metadataDiff, type DiffPart } from './metadataDiff';
import { checkYoutubeVideo } from './videoChecks';
import { cachedYoutube } from './youtubeCache';
import { defaultSubtitle } from './subtitleChoice';
import { isQuotaError, plainYoutubeError, quotaMessage, quotaUsedUp, readVideoCost, units, useYoutubeQuota } from './youtubeQuota';
import { useStagedDoc } from './useStagedDoc';
import { copyVersionFields } from './versionFields';
import { CopyDirectionControls, CopyDirectionFrame, youtubeCopyDirection, type CopyDirection } from './CopyDirection';
import { canSelectIncomingCopy } from './stagedPackaging';

// A video's YouTube metadata in one place (John, 2026-11-14): the link to YouTube sits on the card's status line, and
// "Local vs YouTube" shows every field of YouTube.md, with one switch for all of them: the local file, what YouTube
// has, or the differences. A field's Use Local on YouTube marks it to be sent; Push Changes to YouTube sends what's
// marked. A video not on YouTube yet shows only the local file, with the Upload button.

type Status = { configured: boolean; connected: boolean; captionAccess: boolean };
type Existing = { video: YoutubeVideoSettings; playlists: YoutubePlaylist[]; selected: string[] };
type FileChoice = { path: string; name: string };

// ---- The link to YouTube, shared by the status line and Local vs YouTube ------------------------------------

export interface YoutubeLink {
  status: Status | null;
  jobs: UploadJob[] | null;
  /** The linked video (an upload that finished, or one linked by its link), or the upload in progress. */
  job: UploadJob | undefined;
  channel: string;
  /** Goes up by one on Reload from YouTube: what was read from YouTube is read again. */
  reloads: number;
  reload: () => void;
  error: string;
  setError: (e: string) => void;
  busy: boolean;
  action: (fn: () => Promise<void>) => Promise<void>;
  refreshJobs: () => Promise<UploadJob[]>;
  refreshStatus: () => Promise<void>;
  setMode: (id: string) => void;
}

/** `enabled`: false while the card is closed, so a closed card reads nothing. */
export function useYoutubeLink(piece: Piece, longformProject?: string, enabled = true): YoutubeLink {
  const [status, setStatus] = useState<Status | null>(null);
  const [jobs, setJobs] = useState<UploadJob[] | null>(null);
  const [mode, setMode] = useState<string | null>(null);
  const [channel, setChannel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reloads, setReloads] = useState(0);
  const refreshStatus = async () => setStatus(await getJson<Status>('/api/youtube/status'));
  const refreshJobs = async () => {
    const items = await getJson<UploadJob[]>(`/api/youtube/uploads?piece=${encodeURIComponent(piece.path)}`);
    setJobs(items);
    return items;
  };
  const action = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!enabled) return;
    let stale = false;
    const start = async () => {
      const [connection, items] = await Promise.all([getJson<Status>('/api/youtube/status'), getJson<UploadJob[]>(`/api/youtube/uploads?piece=${encodeURIComponent(piece.path)}`)]);
      if (stale) return;
      setStatus(connection);
      setJobs(items);
      const existing = existingYoutubeJob(items, preferredYoutubeJob(localStorage, piece.path));
      if (existing) return setMode(existing.id);
      if (shouldLinkLongform(items, connection.connected, longformProject)) {
        try {
          const related = await getJson<{ url: string | null }>(`/api/youtube/related?video=${encodeURIComponent(longformProject!)}`);
          if (related.url) {
            const linked = await postJson<UploadJob>('/api/youtube/link', { piece: piece.path, url: related.url });
            if (!stale) {
              setJobs([...items, linked]);
              setMode(linked.id);
              rememberYoutubeJob(localStorage, piece.path, linked.id);
            }
            return;
          }
        } catch (e) {
          if (!stale) setError(`Couldn't connect the saved long-form link: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (!stale) setMode('new');
    };
    void start().catch((e: Error) => {
      if (!stale) setError(e.message);
    });
    return () => {
      stale = true;
    };
  }, [piece.path, longformProject, enabled]);
  useEffect(() => {
    if (!status?.connected) return setChannel('');
    cachedYoutube<{ title: string }>('/api/youtube/channel', reloads > 0).then(
      (c) => setChannel(c.title),
      (e: Error) => {
        setChannel('(not available right now)');
        setError(e.message);
      },
    );
  }, [status?.connected, reloads]);
  useEffect(() => {
    if (!jobs?.some((j) => j.status === 'uploading')) return;
    const timer = setInterval(() => void refreshJobs().catch((e: Error) => setError(e.message)), 1500);
    return () => clearInterval(timer);
  }, [jobs]);
  const job = jobs?.find((j) => j.id === mode);
  useEffect(() => {
    if (job?.status === 'done') window.dispatchEvent(new CustomEvent('hq-video-status-changed'));
  }, [job?.status, job?.videoId]);
  return {
    status,
    jobs,
    job,
    channel,
    reloads,
    reload: () => {
      setError('');
      setReloads((n) => n + 1);
    },
    error,
    setError,
    busy,
    action,
    refreshJobs,
    refreshStatus,
    setMode: (id) => {
      setMode(id);
      rememberYoutubeJob(localStorage, piece.path, id);
    },
  };
}

/** On the card's status line: the channel, the linked video, and the buttons that change the link. */
export function YouTubeLinkBar({ piece, link }: { piece: Piece; link: YoutubeLink }) {
  const { status, jobs, job, channel, busy, action } = link;
  const [url, setUrl] = useState('');
  const [connectUrl, setConnectUrl] = useState('');
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const short = piece.kind === 'short';
  useEffect(() => setUrl(job?.videoId ? youtubeVideoUrl(job.videoId, short) : ''), [job?.id, job?.videoId, short]);
  const quota = useYoutubeQuota();
  const out = quotaUsedUp(quota);
  const shownError = out && isQuotaError(link.error) ? '' : plainYoutubeError(link.error, quota);
  const linked = job?.status === 'done';
  const completed = jobs?.filter((j) => j.status === 'done' && j.videoId) ?? [];
  const signIn = (
    <>
      <button className="small" disabled={busy} onClick={() => void action(async () => setConnectUrl((await postJson<{ url: string }>('/api/youtube/connect')).url))}>
        Start YouTube Sign-In
      </button>{' '}
      {connectUrl && (
        <a href={connectUrl} target="_blank" rel="noreferrer">
          Open Google sign-in ↗
        </a>
      )}{' '}
      <button className="small" onClick={() => void action(link.refreshStatus)}>
        I’ve Signed In
      </button>
    </>
  );
  if (!status) return null;
  return (
    <div className="yt-linkbar">
      {out && <p className="error">{quotaMessage(quota)}</p>}
      {shownError && <p className="error">{shownError}</p>}
      {!status.connected && (
        <div>
          <p className="small-text">Connect your YouTube channel. Credentials are kept in Windows Credential Manager.</p>
          {!status.configured ? (
            <>
              <label>
                Client ID <input value={clientId} onChange={(e) => setClientId(e.target.value)} />
              </label>
              <label>
                Client secret <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} />
              </label>
              <button
                className="small"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    await postJson('/api/youtube/configure', { clientId, clientSecret: secret });
                    setSecret('');
                    await link.refreshStatus();
                  })
                }
              >
                Save Google Setup
              </button>
            </>
          ) : (
            signIn
          )}
        </div>
      )}
      {status.connected && (
        <>
          <div className="yt-linkbar-row">
            <span className="small-text">
              Channel: <strong>{channel || 'Checking…'}</strong>
            </span>
            <input className="yt-link-input" value={url} disabled={job?.status === 'uploading'} onChange={(e) => setUrl(e.target.value)} placeholder="Paste the YouTube link if this video is already on YouTube" />
            <button
              className="small"
              disabled={busy || out || job?.status === 'uploading' || !url.trim() || (!!job?.videoId && url.trim() === youtubeVideoUrl(job.videoId, short))}
              onClick={() => {
                if (linked && !window.confirm('Link a different YouTube video? Anything marked to push is cleared.')) return;
                void action(async () => {
                  const result = await postJson<UploadJob>('/api/youtube/link', { piece: piece.path, url });
                  await link.refreshJobs();
                  link.setMode(result.id);
                  window.dispatchEvent(new CustomEvent('hq-video-status-changed', { detail: piece.path }));
                });
              }}
            >
              {linked ? 'Change Linked Video' : 'Link Existing Video'}
            </button>
            <span className="muted small-text">{units(2)}</span>
            {linked && (
              <button className="small" onClick={() => void action(async () => void (await postJson('/api/youtube/studio', { videoId: job!.videoId })))}>
                Open in YouTube Studio ↗
              </button>
            )}
            {linked && (
              <button className="small" disabled={busy || out} onClick={link.reload} title="Reads this video's settings from YouTube again">
                Reload from YouTube
              </button>
            )}
          </div>
          {!status.captionAccess && (
            <p className="small-text">
              To save playlists and captions, reconnect and grant Google’s additional permission. {signIn}
            </p>
          )}
          {new Set(completed.map((j) => j.videoId)).size > 1 && <p className="error">More than one YouTube video was linked to this project before. Check the link above before pushing changes.</p>}
          {job?.status === 'uploading' && (
            <p className="small-text">
              {job.phase === 'waiting-thumbnail' ? 'Video uploaded. Waiting for YouTube to finish processing before sending its thumbnail…' : `Uploading ${Math.round((job.sent / job.total) * 100)}%…`} Please keep HeartQuarters running.
            </p>
          )}
          {job?.status === 'failed' && (
            <p className="error">
              Upload failed: {job.error}{' '}
              <button className="small" onClick={() => link.setMode('new')}>
                Try Again
              </button>
            </p>
          )}
          {jobs
            ?.filter((j) => j.status === 'unknown')
            .map((j) => (
              <p className="error" key={j.id}>
                An earlier upload has an unknown result. Check YouTube Studio before uploading another copy.{' '}
                <button className="small" onClick={() => void action(async () => void (await postJson('/api/youtube/studio')))}>
                  Open Studio
                </button>{' '}
                <button
                  className="small"
                  onClick={() =>
                    void action(async () => {
                      await postJson('/api/youtube/acknowledge', { piece: piece.path, id: j.id });
                      await link.refreshJobs();
                    })
                  }
                >
                  I Checked Studio
                </button>
              </p>
            ))}
        </>
      )}
    </div>
  );
}

// ---- Local vs YouTube ----------------------------------------------------------------------------------------------

type View = 'local' | 'youtube' | 'diff';
type RowKey = SyncField | 'Thumbnail' | 'Captions';
const VIEW_KEY = 'hq-local-vs-youtube-view';
// The order of the rows. Fields YouTube doesn't have are shown from the file only.
const ORDER = ['Title', 'Description', 'Hashtags', 'Tags', 'Pinned Comment', 'Video language', 'Made for kids', 'Altered content'];
const LOCAL_ONLY_NOTE: Record<string, string> = {
  hashtags: 'On YouTube, these are the end of the description.',
  'pinned comment': "YouTube doesn't let apps read or set the pinned comment. Copy it and pin it in Studio.",
  'thumbnail text': 'A planning note, kept only in the file.',
  'thumbnail idea': 'A planning note, kept only in the file.',
};

function loadView(): View {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === 'youtube' || v === 'diff' ? v : 'local';
  } catch {
    return 'local';
  }
}

function isSync(label: string): label is SyncField {
  return (SYNC_FIELDS as readonly string[]).includes(label);
}

/** Captions as plain words, for comparing: no numbers or times. */
function captionWords(srt: string): string {
  return srt
    .split(/\r?\n/)
    .filter((l) => l.trim() && !/^\d+$/.test(l.trim()) && !l.includes('-->') && l.trim() !== 'WEBVTT')
    .join(' ');
}

export function LocalVsYouTube({ piece, doc: originalDoc, covers, version, link, onChanged, longform, display, reverse = false, versionName, onDirty }: { piece: Piece; doc: LoadedDoc; covers: FileRef[]; version?: string; link: YoutubeLink; onChanged?: () => void; longform?: string; display?: View; reverse?: boolean; versionName?: string; onDirty?: (dirty: boolean) => void }) {
  const draft = useStagedDoc(originalDoc);
  const doc = draft.doc;
  const [view, setView] = useState<View>(loadView);
  const chooseView = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* only remembered for this page */
    }
  };
  const quota = useYoutubeQuota();
  const out = quotaUsedUp(quota);
  const job = link.job?.status === 'done' ? link.job : undefined;
  const linked = !!job;

  // What YouTube has: read only when needed (looking at YouTube or the differences, or pushing), then remembered.
  const [data, setData] = useState<Existing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [staged, setStaged] = useState<RowKey[]>([]);
  const [fromYoutube, setFromYoutube] = useState<SyncField[]>([]);
  const [youtubeThumbnail, setYoutubeThumbnail] = useState(false);
  const localBaseline = useRef<string | null>(null);
  const [privacy, setPrivacy] = useState<YoutubeVideoSettings['privacy']>('private');
  const [playlists, setPlaylists] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const load = async (fresh = false) => {
    if (!job) return;
    setLoading(true);
    setError('');
    try {
      const r = await cachedYoutube<Existing>(`/api/youtube/video-settings?piece=${encodeURIComponent(piece.path)}&id=${encodeURIComponent(job.id)}&captions=0`, fresh);
      setData(r);
      setPrivacy(r.video.privacy);
      setPlaylists(r.selected);
      setStaged([]);
      window.dispatchEvent(new CustomEvent('hq-youtube-checked', { detail: { path: piece.path, checks: checkYoutubeVideo(r.video, undefined, piece.kind === 'short') } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    setData(null);
    setStaged([]);
  }, [job?.id]);
  useEffect(() => {
    if (linked && (display ?? view) !== 'local' && !data && !loading) void load();
  }, [linked, view, display, job?.id]);
  const seenReloads = useRef(link.reloads);
  useEffect(() => {
    if (link.reloads === seenReloads.current) return;
    seenReloads.current = link.reloads;
    if (!data) return;
    if ((staged.length || fromYoutube.length || youtubeThumbnail) && !window.confirm('Reloading from YouTube clears the selected YouTube changes. Continue?')) return;
    setFromYoutube([]); setYoutubeThumbnail(false); localBaseline.current = null;
    void load(true);
  }, [link.reloads]);

  const fields = doc.fields ?? [];
  const text = doc.text ?? '';
  const online = data ? youtubeValues(data.video) : null;
  const stage = (key: RowKey) => { setStaged((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key])); if (isSync(key)) setFromYoutube(items => items.filter(item => item !== key)); if (key === 'Thumbnail') setYoutubeThumbnail(false); };

  // The local thumbnail: this version's Thumbnail/Thumbnail.png (or .jpg), else its first image.
  const localThumb = covers.find((c) => /(^|\/)thumbnail\.(png|jpe?g)$/i.test(c.name)) ?? covers.find((c) => /\.(png|jpe?g)$/i.test(c.name));

  // Captions: the local file to send, and YouTube's, downloaded only when asked.
  const [subtitles, setSubtitles] = useState<FileChoice[]>([]);
  const [subtitle, setSubtitle] = useState('');
  const [localCaptions, setLocalCaptions] = useState<string | null>(null);
  const [ytCaptions, setYtCaptions] = useState<{ track: { language: string; kind: string; name: string } | null; text: string | null } | null>(null);
  useEffect(() => {
    getJson<FileChoice[]>(`/api/youtube/subtitles?piece=${encodeURIComponent(piece.path)}`).then((s) => {
      setSubtitles(s);
      setSubtitle(defaultSubtitle(s));
    }, () => undefined);
  }, [piece.path]);
  useEffect(() => {
    setLocalCaptions(null);
    if (subtitle) getText('projects', subtitle).then(setLocalCaptions, () => setLocalCaptions(null));
  }, [subtitle]);
  const downloadCaptions = () => {
    if (!job) return;
    setBusy(true);
    setError('');
    getJson<typeof ytCaptions>(`/api/youtube/captions?piece=${encodeURIComponent(piece.path)}&id=${encodeURIComponent(job.id)}`)
      .then(setYtCaptions, (e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  // The rows: the fields in the usual order, then any others in the file, then any YouTube setting the file lacks.
  const known = (label: string) => fields.findIndex((f) => f.label.toLowerCase() === label.toLowerCase());
  const shownLabels = [
    ...ORDER.filter((l) => known(l) >= 0 || isSync(l)),
    ...fields.map((f) => f.label).filter((l) => !ORDER.some((o) => o.toLowerCase() === l.toLowerCase())),
  ].filter((l, i, all) => all.findIndex((x) => x.toLowerCase() === l.toLowerCase()) === i);

  // What Push Changes will send.
  const pending = [
    ...staged.map((k) => (k === 'Thumbnail' ? `Thumbnail: ${localThumb?.name ?? ''}` : k === 'Captions' ? `Captions: ${subtitle.split('/').pop()}` : k === 'Description' || k === 'Tags' ? `${k}: the local file's` : `${k}: "${localValue(text, k) ?? ''}"`)),
    ...(data && privacy !== data.video.privacy ? [`Visibility: ${data.video.privacy} → ${privacy}`] : []),
    ...(data ? data.playlists.filter((p) => playlists.includes(p.id) !== data.selected.includes(p.id)).map((p) => `Playlist: ${playlists.includes(p.id) ? 'add to' : 'take out of'} ${p.title}`) : []),
  ];
  const playlistsRead = Math.max(1, Math.ceil((quota?.playlists ?? 10) / 50)) + (quota?.playlists ?? 10);
  const fieldsStaged = staged.some((k) => isSync(k)) || (data && privacy !== data.video.privacy);
  const playlistChanges = data ? data.playlists.filter((p) => playlists.includes(p.id) !== data.selected.includes(p.id)).length : 0;
  const pushCost = playlistsRead + 1 + (fieldsStaged ? 50 : 0) + playlistsRead + 50 * playlistChanges + (staged.includes('Thumbnail') ? 50 : 0) + (staged.includes('Captions') ? 500 : 0) + readVideoCost(quota);

  const push = async () => {
    if (!job || !data) return false;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const desired: YoutubeVideoSettings = { ...data.video };
      for (const k of staged) {
        if (!isSync(k)) continue;
        const value = localValue(text, k) ?? '';
        if (k === 'Title') desired.title = value;
        else if (k === 'Description') desired.description = value;
        else if (k === 'Tags') desired.tags = value.split(',').map((t) => t.trim()).filter(Boolean);
        else if (k === 'Video language') {
          if (!VIDEO_LANGUAGES.some((l) => l.value === value)) throw new Error('The local video language is not one YouTube supports here.');
          desired.language = value;
        } else if (k === 'Made for kids') desired.madeForKids = localBoolean(value);
        else if (k === 'Altered content') desired.synthetic = localBoolean(value);
      }
      desired.privacy = privacy;
      const result = await postJson<{ errors: string[] }>('/api/youtube/video-settings', {
        piece: piece.path,
        id: job.id,
        baseline: data.video,
        desired,
        before: data.selected,
        after: playlists,
        subtitle: staged.includes('Captions') ? subtitle : '',
        cover: staged.includes('Thumbnail') ? localThumb?.path ?? '' : '',
      });
      await load(true);
      if (staged.includes('Captions')) setYtCaptions(null);
      if (result.errors.length) setError(`Some changes were not confirmed: ${result.errors.join('; ')}`);
      else setMessage('Changes saved to YouTube.');
      return result.errors.length === 0;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveToFile = (field: SyncField) => { if (!canSelectIncomingCopy(draft.changes.some(label => label.toLowerCase() === field.toLowerCase()), fromYoutube.includes(field))) return; if (localBaseline.current === null) localBaseline.current = originalDoc.text; setFromYoutube(items => items.includes(field) ? items.filter(item => item !== field) : [...items, field]); setStaged(items => items.filter(item => item !== field)); };
  const saveThumbnail = () => { setYoutubeThumbnail(value => !value); setStaged(items => items.filter(item => item !== 'Thumbnail')); };

  const dirty = draft.pending || fromYoutube.length > 0 || youtubeThumbnail || pending.length > 0;
  useEffect(() => { onDirty?.(dirty); return () => onDirty?.(false); }, [dirty, onDirty]);
  const applyChanges = async () => {
    if ((draft.pending || fromYoutube.length || youtubeThumbnail) && originalDoc.locked) return;
    setBusy(true); setError(''); setMessage(''); let localSaved = false;
    try {
      if (staged.some(isSync) && (await getText('projects', originalDoc.file.path)) !== originalDoc.text) throw new Error('The local source file changed. Reload and compare it before applying.');
      if (fromYoutube.length || youtubeThumbnail) {
        if (!job || !online || !data) throw new Error('YouTube data is not available. Reload and try again.');
        const current = await cachedYoutube<Existing>(`/api/youtube/video-settings?piece=${encodeURIComponent(piece.path)}&id=${encodeURIComponent(job.id)}&captions=0`, true);
        for (const field of fromYoutube) if (youtubeValues(current.video)[field] !== online[field]) throw new Error(`YouTube's ${field} changed. Reload and compare again.`);
        if (youtubeThumbnail && current.video.thumbnail !== data.video.thumbnail) throw new Error('The YouTube thumbnail changed. Reload and compare again.');
      }
      if (draft.pending || fromYoutube.length) {
        await draft.apply(fromYoutube.length ? text => fromYoutube.reduce((result, field) => setLocalValue(result, field, online![field]!), text) : undefined, localBaseline.current ?? undefined);
        localSaved = true; setFromYoutube([]); localBaseline.current = null;
      }
      if (youtubeThumbnail) {
        if (!job || !version) throw new Error('No YouTube video or packaging version is selected.');
        await postJson('/api/youtube/download-thumbnail', { piece: piece.path, id: job.id, version });
        localSaved = true; setYoutubeThumbnail(false); onChanged?.();
      }
      if (pending.length) {
        const success = await push();
        if (!success && localSaved) setMessage('Local changes were saved. Check the YouTube error above.');
      } else setMessage('Changes applied to the local version.');
    } catch (e) { setError(`${localSaved ? 'Some local changes were saved. ' : 'No changes were applied. '}${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(false); }
  };

  const canCompare = linked && !!data;
  const showCopyActions = !display || display === 'diff';
  const shownView: View = linked ? (display ?? view) : 'local';
  const leftName = reverse ? 'YouTube' : versionName ?? 'Local';
  const rightName = reverse ? versionName ?? 'Local' : 'YouTube';
  const directionControls = (selected: CopyDirection | null, canPush: boolean, canPull: boolean, pushChoice: () => void, pullChoice: () => void) => <CopyDirectionControls left={leftName} right={rightName} selected={selected} disabled={busy} canCopyRight={reverse ? canPull : canPush} canCopyLeft={reverse ? canPush : canPull} copyRight={reverse ? pullChoice : pushChoice} copyLeft={reverse ? pushChoice : pullChoice} />;
  const columns = (localPart: React.ReactNode, youtubePart: React.ReactNode, waiting: boolean) =>
    shownView === 'local' ? (
      <div className={waiting ? 'compare-waiting' : undefined}>{waiting && <WaitingBadge />}{localPart}</div>
    ) : shownView === 'youtube' ? (
      <div>{youtubePart}</div>
    ) : (
      <div className={`compare-columns${reverse ? ' compare-reversed' : ''}`}>
        <div className={waiting ? 'compare-waiting' : undefined}>
          {waiting && <WaitingBadge />}
          <strong>{versionName ?? 'Local file'}</strong>
          {localPart}
        </div>
        <div>
          <strong>YouTube</strong>
          {youtubePart}
        </div>
      </div>
    );

  return (
    <div className="local-vs-youtube">
      <div className="lvy-head">
        {!display && <div className="view-switch" role="group" aria-label="What to show">
          {(['local', 'youtube', 'diff'] as View[]).map((v) => (
            <button key={v} className={`small ${shownView === v ? 'active' : ''}`} disabled={!linked && v !== 'local'} onClick={() => chooseView(v)}>
              {v === 'local' ? 'Local' : v === 'youtube' ? 'YouTube' : 'Differences'}
            </button>
          ))}
        </div>}
        {doc.text && <CopyButton text={doc.text} label="Copy All" />}
        <span className="muted small-text">
          {doc.file.name}
          {!linked && ' · Link this video to YouTube at the top to compare.'}
          {linked && !data && (loading ? ' · Reading from YouTube…' : ` · Looking at YouTube reads it (${units(readVideoCost(quota))}).`)}
        </span>
      </div>
      {doc.error && <p className="error">{doc.error}</p>}
      {doc.text === null && !doc.error && <p className="muted">Loading…</p>}
      <AiLineBoxes doc={busy ? { ...doc, locked: true } : doc} />

      {doc.text !== null &&
        shownLabels.map((label) => {
          const index = known(label);
          const field = index >= 0 ? fields[index] : null;
          const sync = isSync(label);
          const rawLocal = sync ? (() => { try { return localValue(text, label); } catch { return field?.value ?? null; } })() : field?.value ?? null;
          const savedField = originalDoc.fields?.find(f => f.label.toLowerCase() === label.toLowerCase());
          const savedLocal = sync ? (() => { try { return localValue(originalDoc.text ?? '', label); } catch { return savedField?.value ?? null; } })() : savedField?.value ?? null;
          const local = label.toLowerCase() === 'tags' && savedLocal !== null ? sortTags(savedLocal) : savedLocal;
          const remote = sync && online ? online[label] : null;
          const diff = sync && local !== null && remote !== null ? metadataDiff(label, local, remote) : null;
          const waiting = staged.includes(label as RowKey);
          const note = LOCAL_ONLY_NOTE[label.toLowerCase()];
          const pulling = sync && fromYoutube.includes(label);
          const edited = draft.changes.some(name => name.toLowerCase() === label.toLowerCase());
          const direction = youtubeCopyDirection(reverse, waiting, pulling);
          const state = direction ? 'Waiting to Apply' : !sync || !canCompare ? '' : remote === null ? (local === null ? '' : "YouTube doesn't report this") : diff?.same ? 'Same' : 'Different';
          const localPreview = <pre className="lvy-value">{local === null ? '(not provided)' : local ? shownView === 'diff' && diff ? <DiffText parts={diff.left} side="local" /> : local : '(empty)'}</pre>;
          const localPart = field ? (doc.locked ? localPreview :
            <EditableComparisonValue doc={doc} index={index} field={label.toLowerCase() === 'tags' ? { ...field, value: sortTags(field.value) } : field} current={localPreview} edited={edited} copySelected={pulling} busy={busy} cancelCopy={() => { if (sync) saveToFile(label); }} />
          ) : (
            <MissingField doc={busy ? { ...doc, locked: true } : doc} label={label} />
          );
          const youtubePart = !sync ? (
            <p className="muted small-text">{note ?? 'Only in the local file.'}</p>
          ) : !data ? (
            <p className="muted small-text">{loading ? 'Reading from YouTube…' : 'Not read yet.'}</p>
          ) : remote === null ? (
            <p className="muted small-text">(YouTube doesn't report this)</p>
          ) : (
            <pre className="lvy-value">{shownView === 'diff' && diff ? <DiffText parts={diff.right} side="youtube" /> : remote || '(empty)'}</pre>
          );
          return (
            <ComparisonRow key={label} label={label} collapsible={isLongComparisonField(label, local, remote)} status={state && <span className={`comparison-status ${direction ? 'comparison-waiting' : state === 'Same' ? 'comparison-same' : state === 'Different' ? 'comparison-different' : ''}`}>{state === 'Same' ? '✓ Same' : state === 'Different' ? '≠ Different' : state}</span>}>
              <div className="lvy-row-head">
                {field?.value && <CopyButton text={field.value} />}
                {draft.changes.includes(label) && originalDoc.fields?.some(f => f.label.toLowerCase() === label.toLowerCase()) && <button className="small" disabled={busy} onClick={() => { if (originalDoc.text !== null) void doc.save(t => copyVersionFields(t, originalDoc.text!, [label])); }}>Undo Edit</button>}
              </div>
              <CopyDirectionFrame left={leftName} right={rightName} selected={shownView === 'diff' ? direction : null}>
              {showCopyActions && sync && shownView === 'diff' && directionControls(direction, !!(canCompare && rawLocal !== null && !busy), !!(canCompare && remote !== null && !busy && !out && !doc.locked && canSelectIncomingCopy(edited, pulling)), () => stage(label), () => saveToFile(label))}
              {showCopyActions && sync && shownView === 'diff' && edited && !doc.locked && remote !== null && <p className="comparison-edit-warning">This field has an unsaved edit. Use Undo Edit before selecting a copy from YouTube.</p>}
              {waiting && edited && <p className="comparison-edit-warning">Your edited {label} will be sent to YouTube when you apply changes.</p>}
              {/* Locked: both sides highlighted. Unlocked: the local side is a box to type in, beside YouTube's highlighted. */}
              {shownView === 'diff' && diff && local !== null && field && !waiting && doc.locked ? (
                <div className={`compare-columns${reverse ? ' compare-reversed' : ''}`}>
                  <div>
                    <strong>{versionName ?? 'Local file'}</strong>
                    <pre className="lvy-value">
                      <DiffText parts={diff.left} side="local" />
                    </pre>
                  </div>
                  <div>
                    <strong>YouTube</strong>
                    {youtubePart}
                  </div>
                </div>
              ) : (
                columns(localPart, youtubePart, false)
              )}
              </CopyDirectionFrame>
              {diff?.reordered && shownView === 'diff' && <p className="muted small-text">The same tags are present; YouTube returned them in a different order.</p>}
              {note && shownView === 'local' && <p className="muted small-text">{note}</p>}
            </ComparisonRow>
          );
        })}

      {/* Thumbnail */}
      <div className="lvy-row">
        <div className="lvy-row-head">
          <strong>Thumbnail</strong>
          {staged.includes('Thumbnail') && <span className="comparison-status comparison-waiting">Waiting to Apply</span>}
        </div>
        <CopyDirectionFrame left={leftName} right={rightName} selected={shownView === 'diff' ? youtubeCopyDirection(reverse, staged.includes('Thumbnail'), youtubeThumbnail) : null}>
        {showCopyActions && shownView === 'diff' && directionControls(youtubeCopyDirection(reverse, staged.includes('Thumbnail'), youtubeThumbnail), !!(canCompare && localThumb && !busy), !!(canCompare && data?.video.thumbnail && version && !busy && !out && !doc.locked), () => stage('Thumbnail'), saveThumbnail)}
        {columns(
          localThumb ? <img className="lvy-thumb" src={fileUrl('projects', localThumb.path, fileStamp(localThumb))} alt="Local thumbnail" /> : <p className="muted small-text">No thumbnail in this version.</p>,
          data ? data.video.thumbnail ? <img className="lvy-thumb" src={data.video.thumbnail} alt="YouTube thumbnail" /> : <p className="muted small-text">Not available.</p> : <p className="muted small-text">{loading ? 'Reading from YouTube…' : 'Not read yet.'}</p>,
          false,
        )}
        </CopyDirectionFrame>
      </div>

      {/* Captions: YouTube's are downloaded only when asked; without them, they can't be compared or pushed. */}
      <div className="lvy-row">
        <div className="lvy-row-head">
          <strong>Captions</strong>
          {staged.includes('Captions') && <span className="comparison-status comparison-waiting">Waiting to Apply</span>}
          {linked && !ytCaptions && (
            <button className="small" disabled={busy || out} onClick={downloadCaptions}>
              Download YouTube Captions
            </button>
          )}
          {linked && !ytCaptions && <span className="muted small-text">about 250 units</span>}
        </div>
        <CopyDirectionFrame left={leftName} right={rightName} selected={shownView === 'diff' ? youtubeCopyDirection(reverse, staged.includes('Captions'), false) : null}>
        {showCopyActions && shownView === 'diff' && directionControls(youtubeCopyDirection(reverse, staged.includes('Captions'), false), !!(canCompare && ytCaptions && subtitle && !busy), false, () => stage('Captions'), () => undefined)}
        {columns(
          subtitles.length ? (
            <>
              <select value={subtitle} onChange={(e) => setSubtitle(e.target.value)}>
                <option value="">No captions file</option>
                {subtitles.map((s) => (
                  <option key={s.path} value={s.path}>
                    {s.name}
                  </option>
                ))}
              </select>
              {localCaptions !== null && <pre className="lvy-value lvy-captions">{captionWords(localCaptions)}</pre>}
            </>
          ) : (
            <p className="muted small-text">No captions file in Subtitles.</p>
          ),
          ytCaptions ? (
            ytCaptions.track ? (
              <>
                <p className="small-text">
                  {ytCaptions.track.language || 'Unknown language'}, {ytCaptions.track.kind.toLowerCase() === 'asr' ? 'made automatically by YouTube' : 'uploaded'}
                </p>
                {ytCaptions.text !== null && <pre className="lvy-value lvy-captions">{captionWords(ytCaptions.text)}</pre>}
              </>
            ) : (
              <p className="muted small-text">YouTube has no captions for this video.</p>
            )
          ) : (
            <p className="muted small-text">Not downloaded. Use Download YouTube Captions to compare them; until then they aren't pushed.</p>
          ),
          false,
        )}
        </CopyDirectionFrame>
      </div>

      {error && <p className="error">{plainYoutubeError(error, quota)}</p>}
      {message && <p className="picked-label small-text">{message}</p>}

      {linked && (
        <div className="lvy-push">
          {data ? (
            <details className="yt-section">
              <summary>Publishing</summary>
              <div className="yt-grid">
                <PlaylistChoices playlists={data.playlists} selected={playlists} setSelected={setPlaylists} />
                <label>
                  Visibility
                  <select value={privacy} onChange={(e) => setPrivacy(e.target.value as YoutubeVideoSettings['privacy'])}>
                    <option value="private">Private</option>
                    <option value="unlisted">Unlisted</option>
                    <option value="public">Public</option>
                  </select>
                </label>
              </div>
              <Related longform={longform} />
            </details>
          ) : (
            <p className="muted small-text">
              <button className="small" disabled={loading || out} onClick={() => void load()}>
                Read from YouTube
              </button>{' '}
              to see its visibility and playlists and push changes ({units(readVideoCost(quota))}).
            </p>
          )}
        </div>
      )}
      <div className={`push-summary${dirty ? ' has-changes' : ''}`}>
        {dirty ? <><strong>Apply Changes Will:</strong><ul>
          {draft.changes.filter(label => !fromYoutube.some(field => field.toLowerCase() === label.toLowerCase())).map(label => <li key={`edit-${label}`}>Save Edited {label} to {versionName ?? 'Local Version'}</li>)}
          {fromYoutube.map(label => <li key={`pull-${label}`}>Copy {label} From YouTube to {versionName ?? 'Local Version'}{draft.changes.some(field => field.toLowerCase() === label.toLowerCase()) ? ' (replaces the edit)' : ''}</li>)}
          {youtubeThumbnail && <li>Copy Thumbnail From YouTube to {versionName ?? 'Local Version'}</li>}
          {pending.map(p => <li key={`push-${p}`}>Send to YouTube: {p}</li>)}
        </ul></> : <span className="muted small-text">No Changes Selected.</span>}
      </div>
      <button disabled={busy || !dirty || (!!pending.length && (out || !data || !link.status?.captionAccess)) || (!!(draft.pending || fromYoutube.length || youtubeThumbnail) && !!originalDoc.locked)} onClick={() => void applyChanges()}>Apply Changes</button>{' '}
      <button disabled={busy || !dirty} onClick={() => { draft.discard(); setFromYoutube([]); setYoutubeThumbnail(false); setStaged([]); localBaseline.current = null; if (data) { setPrivacy(data.video.privacy); setPlaylists(data.selected); } setMessage('Changes discarded.'); }}>Discard Changes</button>{pending.length > 0 && <span className="muted small-text"> {units(pushCost)}</span>}
      {!linked && link.status?.connected && link.job?.status !== 'uploading' && (dirty ? <p className="muted small-text">Apply or discard your changes before uploading.</p> : <NewUpload piece={piece} doc={originalDoc} covers={covers} link={link} longform={longform} localThumb={localThumb} subtitles={subtitles} />)}
    </div>
  );
}

function WaitingBadge() {
  return <span className="waiting-badge" title="Apply Changes, at the bottom, sends this">✓ Waiting to Apply</span>;
}

/** Show either the saved value or the draft, without displaying two large text blocks at once. */
export function EditableComparisonValue({ doc, index, field, current, edited, copySelected, cancelCopy, onEdited, busy = false }: { doc: LoadedDoc; index: number; field: Field; current: ReactNode; edited: boolean; copySelected: boolean; cancelCopy: () => void; onEdited?: () => void; busy?: boolean }) {
  const [tab, setTab] = useState<'current' | 'edited'>('current');
  return <div>
    <div className="comparison-text-tabs" role="group" aria-label={`${field.label} view`}>
      <button type="button" className="small" aria-pressed={tab === 'current'} onClick={() => setTab('current')}>Current</button>
      <button type="button" className="small" aria-pressed={tab === 'edited'} onClick={() => setTab('edited')}>Edited {edited ? '● Changed' : '✓ Same'}</button>
    </div>
    {tab === 'current' ? current : copySelected ? <div className="comparison-edit-warning">A copy into this field is selected. Choose No Copy before editing.{' '}<button type="button" className="small" disabled={busy} onClick={cancelCopy}>Cancel Copy and Edit</button></div> : <FieldEditor doc={busy ? { ...doc, locked: true } : doc} index={index} field={field} onEdited={onEdited} />}
  </div>;
}

/** Editing changes the in-memory draft. Apply Changes writes it to the file. */
export function FieldEditor({ doc, index, field, onEdited }: { doc: LoadedDoc; index: number; field: Field; onEdited?: () => void }) {
  const [draft, setDraft] = useState(field.value);
  const focused = useRef(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!focused.current) setDraft(field.value); }, [field.value]);
  return (
    <>
      <textarea className="field-value field-input" aria-label={field.label} placeholder="(empty)" spellCheck rows={Math.min(20, draft.split('\n').length)} value={draft} readOnly={doc.locked} onFocus={() => { focused.current = true; }} onChange={(e) => { const value = e.target.value; setDraft(value); setError(null); onEdited?.(); void doc.save(text => setFieldValue(text, index, value)).catch((err: Error) => setError(err.message)); }} onBlur={() => { focused.current = false; setDraft(draft.trim()); }} />
      {error && <p className="error small-text">Not staged: {error}</p>}
    </>
  );
}

/** A YouTube setting the file doesn't have yet, with a button that adds it. */
function MissingField({ doc, label }: { doc: LoadedDoc; label: string }) {
  const [error, setError] = useState('');
  return (
    <p className="muted small-text">
      Not in this file yet.{' '}
      <button className="small" disabled={doc.locked} onClick={() => doc.save((t) => setLocalValue(t, label as SyncField, '')).catch((e: Error) => setError(e.message))}>
        Add
      </button>
      {error && <span className="error"> {error}</span>}
    </p>
  );
}

/** Two checkboxes that put the AI-generated lines into the description, or take them out. The file is the record. */
function AiLineBoxes({ doc }: { doc: LoadedDoc }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const has = doc.text === null ? null : readAiLines(doc.text);
  if (!has) return null;
  const change = (want: AiLines) => {
    setSaving(true);
    setError(null);
    doc
      .save((text) => setAiLines(text, want))
      .catch((e: Error) => setError(e.message))
      .finally(() => setSaving(false));
  };
  return (
    <div className="ai-lines small-text">
      <label>
        <input type="checkbox" checked={has.music} disabled={saving || doc.locked} onChange={(e) => change({ ...has, music: e.target.checked })} />
        The music is AI-generated
      </label>
      <label>
        <input type="checkbox" checked={has.visuals} disabled={saving || doc.locked} onChange={(e) => change({ ...has, visuals: e.target.checked })} />
        Some B-roll is AI-generated
      </label>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

export function DiffText({ parts, side }: { parts: DiffPart[]; side: 'local' | 'youtube' }) {
  return (
    <>
      {parts.map((part, i) => (
        <span key={i} className={part.changed ? `diff-${side}` : undefined}>
          {part.text}
        </span>
      ))}
    </>
  );
}

function PlaylistChoices({ playlists, selected, setSelected }: { playlists: YoutubePlaylist[]; selected: string[]; setSelected: (ids: string[]) => void }) {
  const names = playlists.filter((p) => selected.includes(p.id)).map((p) => p.title);
  return (
    <div className="playlist-select">
      <span className="setting-label">Playlists</span>
      <details>
        <summary>{names.length ? `${names.length} selected · ${names.join(', ')}` : 'Select Playlists'}</summary>
        <div className="playlist-options">
          {playlists.length === 0 && <p>No playlists found.</p>}
          {playlists.map((p) => (
            <label key={p.id}>
              <input type="checkbox" checked={selected.includes(p.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, p.id] : selected.filter((id) => id !== p.id))} /> {p.title}
            </label>
          ))}
        </div>
      </details>
    </div>
  );
}

function Related({ longform }: { longform?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (longform) getJson<{ url: string | null }>(`/api/youtube/related?video=${encodeURIComponent(longform)}`).then((r) => setUrl(r.url)).catch(() => undefined);
  }, [longform]);
  if (!longform) return null;
  return (
    <p className="small-text">
      Related video must be chosen in YouTube Studio.{' '}
      {url ? <CopyButton text={url} label="Copy Long-Form Link" /> : 'Add the long-form YouTube link on its video page to have it handy here.'}
    </p>
  );
}

/** For a video not on YouTube yet: Upload sends the local file's values, with the video, thumbnail, captions and playlists chosen here. */
function NewUpload({ piece, doc, covers, link, longform, localThumb, subtitles }: { piece: Piece; doc: LoadedDoc; covers: FileRef[]; link: YoutubeLink; longform?: string; localThumb?: FileRef; subtitles: FileChoice[] }) {
  const [open, setOpen] = useState(false);
  const [video, setVideo] = useState(piece.exports[0]?.path ?? '');
  const [cover, setCover] = useState(localThumb?.path ?? '');
  const [subtitle, setSubtitle] = useState(defaultSubtitle(subtitles));
  const [privacy, setPrivacy] = useState('private');
  const [playlists, setPlaylists] = useState<YoutubePlaylist[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const quota = useYoutubeQuota();
  useEffect(() => setSubtitle(defaultSubtitle(subtitles)), [subtitles]);
  useEffect(() => {
    if (!open || playlists) return;
    cachedYoutube<YoutubePlaylist[]>('/api/youtube/playlists').then((p) => {
      setPlaylists(p);
      setSelected(longform && piece.kind === 'short' && p.some((x) => x.id === SHORTS_PLAYLIST) ? [SHORTS_PLAYLIST] : []);
    }, (e: Error) => setError(e.message));
  }, [open]);
  if (!piece.exports.length) return <p className="muted small-text">To upload, export the video first: there's no video in Exports yet.</p>;
  const value = (label: SyncField) => {
    try {
      return localValue(doc.text ?? '', label) ?? '';
    } catch {
      return '';
    }
  };
  const answer = (label: SyncField) => (/^yes$/i.test(value(label)) ? 'yes' : /^no$/i.test(value(label)) ? 'no' : '');
  const title = value('Title');
  const language = VIDEO_LANGUAGES.some((l) => l.value === value('Video language')) ? value('Video language') : 'en-US';
  const kids = answer('Made for kids') || 'no';
  const synthetic = answer('Altered content');
  return (
    <details className="yt-section lvy-upload" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Upload to YouTube</summary>
      <p className="small-text">Upload sends the title, description, tags and settings above, as they are in the file.</p>
      {!title.trim() && <p className="error small-text">The file has no title yet.</p>}
      {!synthetic && <p className="error small-text">Answer Altered content (Yes or No) in the file first.</p>}
      <div className="yt-grid">
        <label>
          Video
          <select value={video} onChange={(e) => setVideo(e.target.value)}>
            {piece.exports.map((f) => (
              <option key={f.path} value={f.path}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Thumbnail
          <select value={cover} onChange={(e) => setCover(e.target.value)}>
            <option value="">No custom thumbnail</option>
            {covers
              .filter((c) => /\.(png|jpe?g)$/i.test(c.name))
              .map((c) => (
                <option key={c.path} value={c.path}>
                  {c.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Captions
          <select value={subtitle} onChange={(e) => setSubtitle(e.target.value)}>
            <option value="">No captions</option>
            {subtitles.map((s) => (
              <option key={s.path} value={s.path}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Visibility
          <select value={privacy} onChange={(e) => setPrivacy(e.target.value)}>
            <option value="private">Private</option>
            <option value="unlisted">Unlisted</option>
            <option value="public">Public</option>
          </select>
        </label>
        {playlists ? <PlaylistChoices playlists={playlists} selected={selected} setSelected={setSelected} /> : <p className="small-text">Loading playlists…</p>}
      </div>
      <Related longform={longform} />
      <button
        disabled={busy || !playlists || !title.trim() || !synthetic || ((!!subtitle || selected.length > 0) && !link.status?.captionAccess)}
        onClick={async () => {
          if (link.jobs?.some((j) => j.status === 'done') && !window.confirm('This project already has a video linked on YouTube. Upload another copy?')) return;
          setBusy(true);
          setError('');
          try {
            const job = await postJson<UploadJob>('/api/youtube/upload', {
              piece: piece.path,
              video,
              cover,
              subtitle,
              language,
              playlistIds: selected,
              title,
              description: value('Description'),
              tags: value('Tags').split(',').map((t) => t.trim()).filter(Boolean),
              privacy,
              madeForKids: kids === 'yes',
              synthetic: synthetic === 'yes',
            });
            await link.refreshJobs();
            link.setMode(job.id);
            window.dispatchEvent(new CustomEvent('hq-video-status-changed', { detail: piece.path }));
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        Upload
      </button>{' '}
      <span className="muted small-text">
        uses 1 of today’s 100 uploads{cover || subtitle || selected.length ? `, plus ${units((cover ? 50 : 0) + (subtitle ? 400 : 0) + 50 * selected.length)}` : ''}
      </span>
      {error && !(quotaUsedUp(quota) && isQuotaError(error)) && <p className="error">{plainYoutubeError(error, quota)}</p>}
    </details>
  );
}
