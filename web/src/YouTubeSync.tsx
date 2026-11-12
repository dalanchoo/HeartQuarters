import { useEffect, useState } from 'react';
import { copyText, fileUrl, getJson, getText, postJson, type Piece } from './api';
import type { LoadedDoc } from './PackagingDoc';
import type { UploadJob } from '../../server/youtube';
import type { YoutubeVideoSettings } from '../../server/youtube-video';
import { VIDEO_LANGUAGES } from '../../server/youtube-language';
import { SHORTS_PLAYLIST, type YoutubePlaylist } from '../../server/youtube-playlists';
import { rememberUploadPanel, uploadPanelOpen } from './uploadPanel';
import { defaultSubtitle } from './subtitleChoice';
import { alteredContentValue, comparisonState, localBoolean, localValue, setLocalValue, SYNC_FIELDS, youtubeValues, type SyncField } from './youtubePackaging';
import { existingYoutubeJob, preferredYoutubeJob, rememberYoutubeJob, shouldLinkLongform, youtubeVideoUrl } from './youtubePanel';
import { metadataDiff, type DiffPart } from './metadataDiff';
import { checkYoutubeVideo } from './videoChecks';

type FileChoice = { path: string; name: string };
type Status = { configured: boolean; connected: boolean; captionAccess: boolean };
type Existing = { video: YoutubeVideoSettings; playlists: YoutubePlaylist[]; selected: string[]; captions: { language: string; name: string; status: string; kind: string }[] | null; captionError: string | null };

export function YouTubeUpload({ piece, docs, covers, version, onChanged, longform, longformProject }: { piece: Piece; docs: LoadedDoc[]; covers: FileChoice[]; version?: string; onChanged?: () => void; longform?: string; longformProject?: string }) {
  const doc = docs.find((d) => /^youtube(?:\b|[_. -])/i.test(d.file.name.split('/').pop() ?? ''));
  const [open, setOpen] = useState(() => uploadPanelOpen(localStorage, piece.path));
  return <details className="youtube-upload" open={open} onToggle={(e) => { const next = e.currentTarget.open; setOpen(next); rememberUploadPanel(localStorage, piece.path, next); }}><summary>YouTube upload & settings</summary>
    {open && <YouTubePanel key={doc?.file.path ?? piece.path} piece={piece} doc={doc} covers={covers} version={version} onChanged={onChanged} longform={longform} longformProject={longformProject} />}</details>;
}

function YouTubePanel({ piece, doc, covers, version, onChanged, longform, longformProject }: { piece: Piece; doc?: LoadedDoc; covers: FileChoice[]; version?: string; onChanged?: () => void; longform?: string; longformProject?: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [jobs, setJobs] = useState<UploadJob[] | null>(null);
  const [mode, setMode] = useState<string | null>(null);
  const [channel, setChannel] = useState(''); const [connectUrl, setConnectUrl] = useState('');
  const [clientId, setClientId] = useState(''); const [secret, setSecret] = useState('');
  const [existingUrl, setExistingUrl] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const refreshStatus = async () => setStatus(await getJson<Status>('/api/youtube/status'));
  const refreshJobs = async () => { const items = await getJson<UploadJob[]>(`/api/youtube/uploads?piece=${encodeURIComponent(piece.path)}`); setJobs(items); return items; };
  const action = async (fn: () => Promise<void>) => { setBusy(true); setError(''); try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  useEffect(() => {
    let stale = false;
    const start = async () => {
      const [connection, items] = await Promise.all([getJson<Status>('/api/youtube/status'), getJson<UploadJob[]>(`/api/youtube/uploads?piece=${encodeURIComponent(piece.path)}`)]);
      if (stale) return; setStatus(connection); setJobs(items);
      const existing = existingYoutubeJob(items, preferredYoutubeJob(localStorage, piece.path));
      if (existing) { setMode(existing.id); return; }
      if (shouldLinkLongform(items, connection.connected, longformProject)) {
        try {
          const related = await getJson<{ url: string | null }>(`/api/youtube/related?video=${encodeURIComponent(longformProject!)}`);
          if (related.url) {
            const linked = await postJson<UploadJob>('/api/youtube/link', { piece: piece.path, url: related.url });
            if (!stale) { setJobs([...items, linked]); setMode(linked.id); rememberYoutubeJob(localStorage, piece.path, linked.id); }
            return;
          }
        } catch (e) { if (!stale) setError(`Couldn't connect the saved long-form link: ${e instanceof Error ? e.message : String(e)}`); }
      }
      if (!stale) setMode('new');
    };
    void start().catch((e) => { if (!stale) setError(e.message); });
    return () => { stale = true; };
  }, [piece.path, longformProject]);
  useEffect(() => { if (!status?.connected) { setChannel(''); return; } getJson<{ title: string }>('/api/youtube/channel').then((c) => setChannel(c.title), (e) => setError(e.message)); }, [status?.connected]);
  useEffect(() => { if (!jobs?.some((j) => j.status === 'uploading')) return; const timer = setInterval(() => { void refreshJobs().catch((e) => setError(e.message)); }, 1500); return () => clearInterval(timer); }, [jobs]);
  const job = jobs?.find((j) => j.id === mode);
  const completed = jobs?.filter((j) => j.status === 'done' && j.videoId) ?? [];
  useEffect(() => { if (job?.status === 'done') window.dispatchEvent(new CustomEvent('hq-video-status-changed')); }, [job?.status, job?.videoId]);
  useEffect(() => { setExistingUrl(job?.videoId ? youtubeVideoUrl(job.videoId, piece.kind === 'short') : ''); }, [job?.id, job?.videoId, piece.kind]);
  return <div className="youtube-form"><h4>YouTube</h4>
    {(!status || !jobs || (status.connected && mode === null)) && !error && <YouTubeLoading />}
    {status && !status.connected && <>
      <p>Connect your YouTube channel. Credentials are kept in Windows Credential Manager.</p>
      {!status.configured && <><label>Client ID<input value={clientId} onChange={(e) => setClientId(e.target.value)} /></label><label>Client secret<input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} /></label>
        <button disabled={busy} onClick={() => void action(async () => { await postJson('/api/youtube/configure', { clientId, clientSecret: secret }); setSecret(''); await refreshStatus(); })}>Save Google setup</button></>}
      {status.configured && <><button disabled={busy} onClick={() => void action(async () => { setConnectUrl((await postJson<{ url: string }>('/api/youtube/connect')).url); })}>Start YouTube sign-in</button>{' '}{connectUrl && <a href={connectUrl} target="_blank" rel="noreferrer">Open Google sign-in ↗</a>}{' '}<button onClick={() => void action(refreshStatus)}>I’ve signed in</button></>}
    </>}
    {status?.connected && <>
      <p>Channel: <strong>{channel || 'Checking…'}</strong></p>
      {!status.captionAccess && <p>To save playlists and subtitles, reconnect and grant Google’s additional permission. It also allows editing and deleting YouTube content.{' '}<button disabled={busy} onClick={() => void action(async () => { setConnectUrl((await postJson<{ url: string }>('/api/youtube/connect')).url); })}>Reconnect</button>{' '}{connectUrl && <a href={connectUrl} target="_blank" rel="noreferrer">Open Google sign-in ↗</a>}{' '}<button onClick={() => void action(refreshStatus)}>I’ve signed in</button></p>}
      {jobs && mode !== null && <>
      <label>YouTube video link<input value={existingUrl} disabled={job?.status === 'uploading'} onChange={(e) => setExistingUrl(e.target.value)} placeholder="Paste a YouTube link if this video is already uploaded" /></label>
      <div className="youtube-link-row"><button disabled={busy || job?.status === 'uploading' || !existingUrl.trim() || (!!job?.videoId && existingUrl.trim() === youtubeVideoUrl(job.videoId, piece.kind === 'short'))} onClick={() => {
        if (job?.status === 'done' && !window.confirm('Changing the linked video will discard any unsaved changes in these YouTube settings. Continue?')) return;
        void action(async () => { const linked = await postJson<UploadJob>('/api/youtube/link', { piece: piece.path, url: existingUrl }); await refreshJobs(); setMode(linked.id); setExistingUrl(youtubeVideoUrl(linked.videoId!, piece.kind === 'short')); rememberYoutubeJob(localStorage, piece.path, linked.id); window.dispatchEvent(new CustomEvent('hq-video-status-changed', { detail: piece.path })); });
      }}>{job?.status === 'done' ? 'Change linked video' : 'Link existing video'}</button>
        {job?.status === 'done' && <button onClick={() => void action(async () => { await postJson('/api/youtube/studio', { videoId: job.videoId }); })}>Open in YouTube Studio ↗</button>}
      </div>
      <p className="muted small-text">{job?.status === 'done' ? 'This is the video whose settings are shown below. To link a different video, paste its URL and choose Change linked video.' : 'If the video is already on your connected YouTube channel, paste its link and choose Link existing video.'}</p>
      {new Set(completed.map((j) => j.videoId)).size > 1 && <p className="error">More than one YouTube video was previously linked to this project. Check the URL above before saving changes.</p>}
      </>}
      {job?.status === 'uploading' && <p>{job.phase === 'waiting-thumbnail' ? 'Video uploaded. Waiting for YouTube to finish processing before sending its thumbnail…' : `Uploading ${Math.round(job.sent / job.total * 100)}%…`} Please keep HeartQuarters running.</p>}
      {job?.status === 'done' && <ExistingForm key={job.id} piece={piece} job={job} doc={doc} covers={covers} version={version} onChanged={onChanged} canEdit={status.captionAccess} longform={longform} />}
      {job?.status === 'failed' && <p className="error">Upload failed: {job.error} <button className="small" onClick={() => setMode('new')}>Try again</button></p>}
      {mode === 'new' && (doc?.fields && piece.exports.length ? <NewForm piece={piece} doc={doc} covers={covers} canEdit={status.captionAccess} channel={channel} longform={longform} existing={completed} onStarted={(j) => { setMode(j.id); rememberYoutubeJob(localStorage, piece.path, j.id); void refreshJobs(); window.dispatchEvent(new CustomEvent('hq-video-status-changed', { detail: piece.path })); }} /> : <p>A video export and YouTube packaging are needed for a new upload.</p>)}
      {jobs?.filter((j) => j.status === 'unknown').map((j) => <p className="error" key={j.id}>An earlier upload has an unknown result. Check YouTube Studio before uploading another copy. <button className="small" onClick={() => void action(async () => { await postJson('/api/youtube/studio'); })}>Open Studio</button>{' '}<button className="small" onClick={() => void action(async () => { await postJson('/api/youtube/acknowledge', { piece: piece.path, id: j.id }); await refreshJobs(); })}>I checked Studio</button></p>)}
    </>}
    {error && <p className="error">{error}</p>}
  </div>;
}

function YouTubeLoading() {
  return <div className="youtube-loading" role="status" aria-busy="true"><strong>Loading YouTube settings…</strong><div className="loading-line" /><div className="loading-line short" /></div>;
}

function PlaylistChoices({ playlists, selected, setSelected }: { playlists: YoutubePlaylist[]; selected: string[]; setSelected: (ids: string[]) => void }) {
  const names = playlists.filter((p) => selected.includes(p.id)).map((p) => p.title);
  return <div className="playlist-select"><span className="setting-label">Playlists</span><details><summary>{names.length ? `${names.length} selected · ${names.join(', ')}` : 'Select playlists'}</summary><div className="playlist-options">{playlists.length === 0 && <p>No playlists found.</p>}{playlists.map((p) => <label key={p.id}><input type="checkbox" checked={selected.includes(p.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, p.id] : selected.filter((id) => id !== p.id))} /> {p.title}</label>)}</div></details></div>;
}
function Language({ value, setValue }: { value: string; setValue: (value: string) => void }) {
  return <label>Video language<select value={value} onChange={(e) => setValue(e.target.value)}><option value="" disabled={value !== ''}>Unknown</option>{value && !VIDEO_LANGUAGES.some((l) => l.value === value) && <option value={value}>{value}</option>}{VIDEO_LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}</select></label>;
}
function Choices({ label, value, setValue }: { label: string; value: string; setValue: (value: string) => void }) {
  return <label>{label}<select value={value} onChange={(e) => setValue(e.target.value)}><option value="" disabled={value !== ''}>Not specified</option><option value="no">No</option><option value="yes">Yes</option></select></label>;
}
function Related({ longform }: { longform?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { if (longform) getJson<{ url: string | null }>(`/api/youtube/related?video=${encodeURIComponent(longform)}`).then((r) => setUrl(r.url)).catch(() => {}); }, [longform]);
  if (!longform) return null;
  return <p>Related video must be chosen in YouTube Studio. {url ? <button className="small" onClick={() => void copyText(url)}>Copy long-form link</button> : 'Add the long-form YouTube link on its video page to have it handy here.'}</p>;
}

function NewForm({ piece, doc, covers, canEdit, channel, longform, existing, onStarted }: { piece: Piece; doc: LoadedDoc; covers: FileChoice[]; canEdit: boolean; channel: string; longform?: string; existing: UploadJob[]; onStarted: (j: UploadJob) => void }) {
  const field = (name: string) => doc.fields?.find((f) => f.label.toLowerCase() === name)?.value ?? '';
  const storedLanguage = field('video language');
  const initialAnswer = (name: string) => { const value = field(name).toLowerCase(); return value === 'yes' || value === 'no' ? value : ''; };
  const [video, setVideo] = useState(piece.exports[0].path); const [language, setLanguage] = useState(VIDEO_LANGUAGES.some((l) => l.value === storedLanguage) ? storedLanguage : 'en-US');
  const [title, setTitle] = useState(field('title')); const [description, setDescription] = useState(field('description')); const [tags, setTags] = useState(field('tags'));
  const [privacy, setPrivacy] = useState('private'); const [kids, setKids] = useState(initialAnswer('made for kids') || 'no'); const [synthetic, setSynthetic] = useState(initialAnswer('altered content'));
  const [subtitles, setSubtitles] = useState<FileChoice[]>([]); const [subtitle, setSubtitle] = useState(''); const [cover, setCover] = useState('');
  const [playlists, setPlaylists] = useState<YoutubePlaylist[] | null>(null); const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [loadedText, setLoadedText] = useState(doc.text);
  useEffect(() => { getJson<FileChoice[]>(`/api/youtube/subtitles?piece=${encodeURIComponent(piece.path)}`).then((s) => { setSubtitles(s); setSubtitle(defaultSubtitle(s)); }, (e) => setError(e.message));
    // Playlists aren't kept in the file: a short of a longform starts in the Shorts playlist, anything else in none.
    getJson<YoutubePlaylist[]>('/api/youtube/playlists').then((p) => { setPlaylists(p); setSelected(longform && piece.kind === 'short' && p.some((x) => x.id === SHORTS_PLAYLIST) ? [SHORTS_PLAYLIST] : []); }, (e) => setError(e.message)); }, [piece.path, longform, piece.kind]);
  return <div><h4>New upload</h4>
    <p className="muted small-text">To compare with a video already on YouTube, link it above.</p>
    <p className="muted small-text">Starting from {doc.file.name}. Edits here are sent to YouTube when you upload; they do not change the local file.</p>
    {doc.text !== loadedText && <p className="error">The local file changed after this form was opened. Load its latest values before uploading.</p>}
    <button className="small" onClick={() => {
      if (!window.confirm('Load the current local file? This replaces the title, description, tags and YouTube settings currently in this form.')) return;
      try {
        const localLanguage = field('video language');
        setTitle(field('title')); setDescription(field('description')); setTags(field('tags'));
        setLanguage(VIDEO_LANGUAGES.some((l) => l.value === localLanguage) ? localLanguage : 'en-US');
        setKids(initialAnswer('made for kids') || 'no'); setSynthetic(initialAnswer('altered content'));
        setLoadedText(doc.text); setError('');
      } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    }}>Load values from local file</button>
    <details className="yt-section" open><summary>Video details</summary><div className="yt-grid">
    <label>Video<select value={video} onChange={(e) => setVideo(e.target.value)}>{piece.exports.map((f) => <option key={f.path} value={f.path}>{f.name}</option>)}</select></label>
    <Language value={language} setValue={setLanguage} />
    <label className="yt-full">Title<input maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
    <label className="yt-full">Description<textarea rows={7} maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
    <label className="yt-full">Tags (comma-separated)<textarea className="youtube-tags" rows={3} value={tags} onChange={(e) => setTags(e.target.value)} /></label>
    </div></details>
    <details className="yt-section" open><summary>Media</summary><div className="yt-grid">
    <label>Thumbnail<select value={cover} onChange={(e) => setCover(e.target.value)}><option value="">No custom thumbnail</option>{covers.filter((c) => /\.(png|jpe?g)$/i.test(c.name)).map((c) => <option key={c.path} value={c.path}>{c.name}</option>)}</select></label>
    <label>Subtitles<select value={subtitle} onChange={(e) => setSubtitle(e.target.value)}><option value="">{subtitles.length > 1 ? 'Choose a subtitle file or none' : 'No subtitles'}</option>{subtitles.map((s) => <option key={s.path} value={s.path}>{s.name}</option>)}</select></label>
    </div></details>
    <details className="yt-section" open><summary>Publishing</summary><div className="yt-grid">
    {playlists ? <PlaylistChoices playlists={playlists} selected={selected} setSelected={setSelected} /> : <p>Loading playlists…</p>}
    <label>Visibility<select value={privacy} onChange={(e) => setPrivacy(e.target.value)}><option value="private">Private</option><option value="unlisted">Unlisted</option><option value="public">Public</option></select></label>
    <Choices label="Made for kids?" value={kids} setValue={setKids} /><Choices label="Contains realistic altered or synthetic content?" value={synthetic} setValue={setSynthetic} />
    </div><Related longform={longform} /></details>
    <p>Upload sends your chosen video, settings, playlists, thumbnail and subtitles. Public makes the video public.</p>
    <button disabled={busy || !channel || !playlists || !title.trim() || !kids || !synthetic || doc.text !== loadedText || ((!!subtitle || selected.length > 0) && !canEdit)} onClick={async () => {
      if (existing.length && !window.confirm('This project already has a video linked on YouTube. Upload another copy?')) return;
      setBusy(true); setError(''); try { const current = await getText('projects', doc.file.path); if (current.replace(/^\uFEFF/, '') !== (loadedText ?? '').replace(/^\uFEFF/, '')) throw new Error('The local file changed outside HeartQuarters. Reload the project and review it before uploading.'); const job = await postJson<UploadJob>('/api/youtube/upload', { piece: piece.path, video, cover, subtitle, language, playlistIds: selected, title, description, tags: tags.split(',').map((t) => t.trim()).filter(Boolean), privacy, madeForKids: kids === 'yes', synthetic: synthetic === 'yes' }); onStarted(job);
        // YouTube doesn't report this setting back, so the file keeps the answer that was sent.
        void doc.save((text) => setLocalValue(text, 'Altered content', alteredContentValue(synthetic === 'yes')!)).catch(() => {}); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
    }}>Upload</button>{error && <p className="error">{error}</p>}
  </div>;
}

function ExistingForm({ piece, job, doc, covers, version, onChanged, canEdit, longform }: { piece: Piece; job: UploadJob; doc?: LoadedDoc; covers: FileChoice[]; version?: string; onChanged?: () => void; canEdit: boolean; longform?: string }) {
  const [data, setData] = useState<Existing | null>(null); const [draft, setDraft] = useState<YoutubeVideoSettings | null>(null);
  const [tagsText, setTagsText] = useState('');
  const [selected, setSelected] = useState<string[]>([]); const [subtitles, setSubtitles] = useState<FileChoice[]>([]);
  const [subtitle, setSubtitle] = useState(''); const [cover, setCover] = useState(''); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const [downloadName, setDownloadName] = useState('YouTube thumbnail');
  const load = async () => { const r = await getJson<Existing>(`/api/youtube/video-settings?piece=${encodeURIComponent(piece.path)}&id=${encodeURIComponent(job.id)}`); setData(r); setDraft(r.video); setTagsText(r.video.tags.join(', ')); setSelected(r.selected); setSubtitle(''); setCover(''); window.dispatchEvent(new CustomEvent('hq-youtube-checked', { detail: { path: piece.path, checks: checkYoutubeVideo(r.video, r.captions, piece.kind === 'short') } })); };
  useEffect(() => { void load().catch((e) => setError(e.message)); getJson<FileChoice[]>(`/api/youtube/subtitles?piece=${encodeURIComponent(piece.path)}`).then(setSubtitles, (e) => setError(e.message)); }, [piece.path, job.id]);
  if (!data || !draft) return <div>{error ? <p className="error">{error} <button className="small" onClick={() => void load().catch((e) => setError(e.message))}>Retry</button></p> : <YouTubeLoading />}</div>;
  const change = (value: Partial<YoutubeVideoSettings>) => { setDraft({ ...draft, ...value }); setMessage(''); };
  const hasManualCaptions = data.captions?.some((c) => c.kind !== 'ASR' && c.kind !== 'asr') ?? false;
  const useLocal = (field: SyncField, value: string): boolean => {
    try {
      if (field === 'Title') change({ title: value });
      else if (field === 'Description') change({ description: value });
      else if (field === 'Tags') setTagsText(value);
      else if (field === 'Video language') { if (!VIDEO_LANGUAGES.some((l) => l.value === value)) throw new Error('The local video language is not supported by this screen.'); change({ language: value }); }
      else if (field === 'Made for kids') change({ madeForKids: localBoolean(value) });
      else if (field === 'Altered content') change({ synthetic: localBoolean(value) });
      setError(''); setMessage(`${field} copied into the YouTube form. Save changes to send it.`);
      return true;
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); return false; }
  };
  return <div><h4>Existing YouTube video</h4>
    {job.warning && <p className="error">{job.warning}</p>}
    {job.error && <p className="error">{job.error}</p>}
    {job.subtitleStatus === 'error' && <p className="error">Subtitles could not be confirmed: {job.subtitleError}. Check Studio before trying again.</p>}
    {job.playlistResults?.filter((r) => r.status === 'error').map((r) => <p key={r.id} className="error">Playlist {r.id}: {r.error}</p>)}
    {doc?.text !== null && doc?.text !== undefined && <MetadataComparison doc={doc} video={data.video} playlists={data.playlists} selected={data.selected} piece={piece.path} jobId={job.id} useLocal={useLocal} />}
    <details className="yt-section" open><summary>Video details on YouTube</summary><div className="yt-grid">
    <Language value={draft.language ?? ''} setValue={(language) => change({ language: language || null })} />
    <label>Title<input maxLength={100} value={draft.title} onChange={(e) => change({ title: e.target.value })} /></label>
    <label className="yt-full">Description<textarea rows={7} maxLength={5000} value={draft.description} onChange={(e) => change({ description: e.target.value })} /></label>
    <label className="yt-full">Tags (comma-separated)<textarea className="youtube-tags" rows={3} value={tagsText} onChange={(e) => { setTagsText(e.target.value); setMessage(''); }} /></label>
    </div></details>
    <details className="yt-section" open><summary>Publishing</summary><div className="yt-grid">
    <PlaylistChoices playlists={data.playlists} selected={selected} setSelected={setSelected} />
    <label>Visibility<select value={draft.privacy} onChange={(e) => change({ privacy: e.target.value as YoutubeVideoSettings['privacy'] })}><option value="private">Private</option><option value="unlisted">Unlisted</option><option value="public">Public</option></select></label>
    <Choices label="Made for kids?" value={draft.madeForKids === null ? '' : draft.madeForKids ? 'yes' : 'no'} setValue={(v) => change({ madeForKids: v === '' ? null : v === 'yes' })} />
    <Choices label="Contains realistic altered or synthetic content?" value={draft.synthetic === null ? '' : draft.synthetic ? 'yes' : 'no'} setValue={(v) => change({ synthetic: v === '' ? null : v === 'yes' })} />
    </div><Related longform={longform} /></details>
    <details className="yt-section"><summary>Thumbnail & subtitles</summary><div className="yt-grid">
    <div className="yt-full thumbnail-compare"><div><strong>Local thumbnail</strong>{cover ? <img src={fileUrl('projects', cover)} alt="Selected local thumbnail" /> : <p>Choose a local thumbnail below to compare.</p>}</div><div><strong>On YouTube</strong>{data.video.thumbnail ? <img src={data.video.thumbnail} alt="Current YouTube thumbnail" /> : <p>Not available</p>}</div></div>
    <label>Local thumbnail to push<select value={cover} onChange={(e) => setCover(e.target.value)}><option value="">Keep current thumbnail</option>{covers.filter((c) => /\.(png|jpe?g)$/i.test(c.name)).map((c) => <option key={c.path} value={c.path}>{c.name}</option>)}</select></label>
    <div><label>Save YouTube copy as (without extension)<input value={downloadName} onChange={(e) => setDownloadName(e.target.value)} /></label><button disabled={busy || !version || !data.video.thumbnail || !downloadName.trim()} onClick={async () => { setBusy(true); setError(''); setMessage(''); try { await postJson('/api/youtube/download-thumbnail', { piece: piece.path, id: job.id, version, name: downloadName }); setMessage('YouTube thumbnail saved in this packaging version.'); onChanged?.(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }}>Download YouTube thumbnail</button><p className="muted small-text">Saves YouTube’s available copy, which may differ in quality from the original.</p></div>
    {data.captions === null ? <p className="error">{data.captionError} Check subtitles in Studio.</p> : <><p>YouTube captions: {data.captions.length ? data.captions.map((c) => `${c.language || 'unknown language'} (${c.kind === 'ASR' || c.kind === 'asr' ? 'automatic' : 'uploaded'}, ${c.status || 'status unknown'})`).join(', ') : 'none'}</p>
      <label>Captions file to send<select value={subtitle} onChange={(e) => setSubtitle(e.target.value)}><option value="">Keep current captions</option>{subtitles.map((s) => <option key={s.path} value={s.path}>{s.name}</option>)}</select></label>
      <p className="muted small-text">{subtitle ? (hasManualCaptions ? 'Push changes replaces the captions you uploaded in this language, so there is still only one track.' : 'Push changes adds these captions.') : ''}{job.subtitleFile ? ` Last sent from HeartQuarters: ${job.subtitleFile.split('/').pop()}.` : ''}</p></>}
    </div></details>
    <button disabled={busy || !canEdit || !draft.title.trim()} onClick={async () => { setBusy(true); setError(''); setMessage(''); try {
      const result = await postJson<{ errors: string[] }>('/api/youtube/video-settings', { piece: piece.path, id: job.id, baseline: data.video, desired: { ...draft, tags: tagsText.split(',').map((t) => t.trim()).filter(Boolean) }, before: data.selected, after: selected, subtitle, cover });
      // YouTube doesn't report Altered content back, so the file keeps the answer that was sent.
      const altered = alteredContentValue(draft.synthetic);
      if (doc && altered) { try { await doc.save((text) => setLocalValue(text, 'Altered content', altered)); } catch (e) { result.errors.push(`Altered content wasn't saved to ${doc.file.name}: ${e instanceof Error ? e.message : String(e)}`); } }
      await load(); if (result.errors.length) setError(`Some changes were not confirmed: ${result.errors.join('; ')}`); else setMessage('Changes saved to YouTube.');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }}>Push changes to YouTube</button>{' '}
    <button className="small" disabled={busy} onClick={() => {
      const changed = JSON.stringify(draft) !== JSON.stringify(data.video) || tagsText !== data.video.tags.join(', ') || [...selected].sort().join('|') !== [...data.selected].sort().join('|') || !!cover || !!subtitle;
      if (changed && !window.confirm('Reloading from YouTube will discard changes in this form that you have not pushed. Continue?')) return;
      setError(''); void load().catch((e) => setError(e.message));
    }}>Reload from YouTube</button>
    {error && <p className="error">{error}</p>}{message && <p>{message}</p>}
  </div>;
}

function MetadataComparison({ doc, video, playlists, selected, piece, jobId, useLocal }: { doc: LoadedDoc; video: YoutubeVideoSettings; playlists: YoutubePlaylist[]; selected: string[]; piece: string; jobId: string; useLocal: (field: SyncField, value: string) => boolean }) {
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [error, setError] = useState('');
  if (doc.text === null) return null;
  const snapshot = doc.text; const online = youtubeValues(video);
  const verifyOnline = async (fields: SyncField[]) => {
    const current = await getJson<Existing>(`/api/youtube/video-settings?piece=${encodeURIComponent(piece)}&id=${encodeURIComponent(jobId)}`);
    const values = youtubeValues(current.video);
    if (fields.some((field) => values[field] !== online[field])) throw new Error('The YouTube value changed since it was loaded. Reload from YouTube and compare again.');
  };
  return <details className="yt-section metadata-compare"><summary>Compare local file and YouTube</summary>
    <p className="muted small-text">Local means {doc.file.path}. YouTube shows the last values loaded from your channel. Copying to YouTube stages the change until you save; copying to the file saves that field immediately.</p>
    <button disabled={busy} onClick={async () => {
      const fields: SyncField[] = ['Video language', 'Made for kids', 'Altered content'];
      const available = fields.filter((field) => online[field] !== null);
      if (!available.length || !window.confirm(`Save these YouTube settings to ${doc.file.name}: ${available.join(', ')}? Existing values for these fields will be replaced.`)) return;
      setBusy(true); setError(''); setMessage('');
      try { await verifyOnline(available); await doc.save((text) => { if (text !== snapshot) throw new Error('The local file changed. Review it again before copying.'); return available.reduce((result, field) => setLocalValue(result, field, online[field]!), text); }); setMessage('YouTube settings saved to the local file. Values YouTube did not provide were left alone.'); }
      catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
    }}>Save YouTube settings to local file</button>
    {SYNC_FIELDS.map((field) => {
      let local: string | null = null; let issue = '';
      try { local = localValue(snapshot, field); } catch (e) { issue = e instanceof Error ? e.message : String(e); }
      const remote = online[field];
      const diff = local !== null && remote !== null ? metadataDiff(field, local, remote) : null;
      const state = comparisonState(local, remote, diff?.same, issue);
      return <details className="compare-field" key={field}><summary><span>{field}</span><span className={`comparison-status ${state === 'Same' ? 'comparison-same' : state === 'Different' ? 'comparison-different' : ''}`}>{state}</span></summary>
        {issue && <p className="error">{issue}</p>}
        {diff?.reordered && <p className="muted small-text">The same tags are present; YouTube returned them in a different order.</p>}
        {diff?.limited && <p className="muted small-text">This text is too long to highlight individual words, so both values are highlighted.</p>}
        <div className="compare-columns"><div><strong>Local file</strong><pre>{local === null ? '(not in this file)' : local === '' ? '(empty)' : diff ? <DiffText parts={diff.left} side="local" /> : local}</pre></div><div><strong>YouTube</strong><pre>{remote === null ? '(not provided by YouTube)' : remote === '' ? '(empty)' : diff ? <DiffText parts={diff.right} side="youtube" /> : remote}</pre></div></div>
        <div className="compare-actions"><button disabled={busy || !!issue || local === null} onClick={async () => { if (local === null) return; setBusy(true); setError(''); setMessage(''); try { const current = await getText('projects', doc.file.path); if (current.replace(/^\uFEFF/, '') !== snapshot.replace(/^\uFEFF/, '')) throw new Error('The local file changed outside HeartQuarters. Reload the project and compare again.'); if (useLocal(field, local)) setMessage(`${field} is ready in the YouTube form. Click Push changes to YouTube to apply it.`); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }}>Use local on YouTube →</button>
          <button disabled={busy || !!issue || remote === null} onClick={async () => { if (remote === null || !window.confirm(`Save YouTube's ${field} into ${doc.file.name}? This changes your local file.`)) return; setBusy(true); setError(''); setMessage(''); try {
            await verifyOnline([field]); await doc.save((text) => { if (text !== snapshot) throw new Error('The local file changed. Review it again before copying.'); return setLocalValue(text, field, remote); }); setMessage(`${field} saved to the local file.`);
          } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }}>← Save YouTube value to file</button></div>
      </details>;
    })}
    {message && <p>{message}</p>}{error && <p className="error">{error}</p>}
  </details>;
}

function DiffText({ parts, side }: { parts: DiffPart[]; side: 'local' | 'youtube' }) {
  return <>{parts.map((part, i) => <span key={i} className={part.changed ? `diff-${side}` : undefined}>{part.text}</span>)}</>;
}
