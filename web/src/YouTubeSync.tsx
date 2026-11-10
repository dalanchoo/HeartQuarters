import { useEffect, useState } from 'react';
import { copyText, getJson, postJson, type Piece } from './api';
import type { LoadedDoc } from './PackagingDoc';
import type { UploadJob } from '../../server/youtube';
import type { YoutubeVideoSettings } from '../../server/youtube-video';
import { VIDEO_LANGUAGES } from '../../server/youtube-language';
import { SHORTS_PLAYLIST, type YoutubePlaylist } from '../../server/youtube-playlists';
import { rememberUploadPanel, uploadPanelOpen } from './uploadPanel';
import { defaultSubtitle } from './subtitleChoice';

type FileChoice = { path: string; name: string };
type Status = { configured: boolean; connected: boolean; captionAccess: boolean };
type Existing = { video: YoutubeVideoSettings; playlists: YoutubePlaylist[]; selected: string[]; captions: { language: string; name: string; status: string; kind: string }[] | null; captionError: string | null };

export function YouTubeUpload({ piece, docs, covers, longform }: { piece: Piece; docs: LoadedDoc[]; covers: FileChoice[]; longform?: string }) {
  const doc = docs.find((d) => /^youtube(?:\b|[_. -])/i.test(d.file.name.split('/').pop() ?? ''));
  const [open, setOpen] = useState(() => uploadPanelOpen(localStorage, piece.path));
  return <div className="youtube-upload"><button className="small" onClick={() => { const next = !open; setOpen(next); rememberUploadPanel(localStorage, piece.path, next); }}>Upload to YouTube</button>
    {open && <YouTubePanel key={doc?.file.path ?? piece.path} piece={piece} doc={doc} covers={covers} longform={longform} />}</div>;
}

function YouTubePanel({ piece, doc, covers, longform }: { piece: Piece; doc?: LoadedDoc; covers: FileChoice[]; longform?: string }) {
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
  useEffect(() => { void refreshStatus().catch((e) => setError(e.message)); void refreshJobs().then((items) => setMode(items.find((j) => j.status === 'uploading' || (j.status === 'done' && j.videoId))?.id ?? 'new')).catch((e) => setError(e.message)); }, [piece.path]);
  useEffect(() => { if (!status?.connected) { setChannel(''); return; } getJson<{ title: string }>('/api/youtube/channel').then((c) => setChannel(c.title), (e) => setError(e.message)); }, [status?.connected]);
  useEffect(() => { if (!jobs?.some((j) => j.status === 'uploading')) return; const timer = setInterval(() => { void refreshJobs().catch((e) => setError(e.message)); }, 1500); return () => clearInterval(timer); }, [jobs]);
  const job = jobs?.find((j) => j.id === mode);
  const completed = jobs?.filter((j) => j.status === 'done' && j.videoId) ?? [];
  return <div className="youtube-form"><h4>YouTube</h4>
    {status && !status.connected && <>
      <p>Connect your YouTube channel. Credentials are kept in Windows Credential Manager.</p>
      {!status.configured && <><label>Client ID<input value={clientId} onChange={(e) => setClientId(e.target.value)} /></label><label>Client secret<input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} /></label>
        <button disabled={busy} onClick={() => void action(async () => { await postJson('/api/youtube/configure', { clientId, clientSecret: secret }); setSecret(''); await refreshStatus(); })}>Save Google setup</button></>}
      {status.configured && <><button disabled={busy} onClick={() => void action(async () => { setConnectUrl((await postJson<{ url: string }>('/api/youtube/connect')).url); })}>Start YouTube sign-in</button>{' '}{connectUrl && <a href={connectUrl} target="_blank" rel="noreferrer">Open Google sign-in ↗</a>}{' '}<button onClick={() => void action(refreshStatus)}>I’ve signed in</button></>}
    </>}
    {status?.connected && <>
      <p>Channel: <strong>{channel || 'Checking…'}</strong></p>
      {!status.captionAccess && <p>To save playlists and subtitles, reconnect and grant Google’s additional permission. It also allows editing and deleting YouTube content.{' '}<button disabled={busy} onClick={() => void action(async () => { setConnectUrl((await postJson<{ url: string }>('/api/youtube/connect')).url); })}>Reconnect</button>{' '}{connectUrl && <a href={connectUrl} target="_blank" rel="noreferrer">Open Google sign-in ↗</a>}{' '}<button onClick={() => void action(refreshStatus)}>I’ve signed in</button></p>}
      {completed.length > 0 && <label>Video on YouTube<select value={mode ?? ''} onChange={(e) => setMode(e.target.value)}>{completed.map((j) => <option key={j.id} value={j.id}>Existing upload · {j.videoId}</option>)}<option value="new">Upload a new copy</option></select></label>}
      <details><summary>Link a video already on YouTube</summary><p>Paste the video’s YouTube link to show its current settings here. It must be on the connected channel.</p><label>YouTube video link<input value={existingUrl} onChange={(e) => setExistingUrl(e.target.value)} /></label><button className="small" disabled={busy || !existingUrl.trim()} onClick={() => void action(async () => { const linked = await postJson<UploadJob>('/api/youtube/link', { piece: piece.path, url: existingUrl }); await refreshJobs(); setMode(linked.id); setExistingUrl(''); })}>Link video</button></details>
      {job?.status === 'uploading' && <p>Uploading {Math.round(job.sent / job.total * 100)}%… Please keep HeartQuarters running.</p>}
      {job?.status === 'done' && <ExistingForm key={job.id} piece={piece} job={job} covers={covers} canEdit={status.captionAccess} longform={longform} />}
      {job?.status === 'failed' && <p className="error">Upload failed: {job.error} <button className="small" onClick={() => setMode('new')}>Try again</button></p>}
      {mode === 'new' && (doc?.fields && piece.exports.length ? <NewForm piece={piece} doc={doc} covers={covers} canEdit={status.captionAccess} channel={channel} longform={longform} existing={completed} onStarted={(j) => { setMode(j.id); void refreshJobs(); }} /> : <p>A video export and YouTube packaging are needed for a new upload.</p>)}
      {jobs?.filter((j) => j.status === 'unknown').map((j) => <p className="error" key={j.id}>An earlier upload has an unknown result. Check YouTube Studio before uploading another copy. <button className="small" onClick={() => void action(async () => { await postJson('/api/youtube/studio'); })}>Open Studio</button>{' '}<button className="small" onClick={() => void action(async () => { await postJson('/api/youtube/acknowledge', { piece: piece.path, id: j.id }); await refreshJobs(); })}>I checked Studio</button></p>)}
    </>}
    {error && <p className="error">{error}</p>}
  </div>;
}

function PlaylistChoices({ playlists, selected, setSelected }: { playlists: YoutubePlaylist[]; selected: string[]; setSelected: (ids: string[]) => void }) {
  return <fieldset><legend>YouTube playlists</legend>{playlists.length === 0 && <p>No playlists found.</p>}{playlists.map((p) => <label key={p.id} style={{ display: 'block' }}><input style={{ width: 'auto' }} type="checkbox" checked={selected.includes(p.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, p.id] : selected.filter((id) => id !== p.id))} /> {p.title}</label>)}</fieldset>;
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
  const [video, setVideo] = useState(piece.exports[0].path); const [language, setLanguage] = useState('en-US');
  const [title, setTitle] = useState(field('title')); const [description, setDescription] = useState(field('description')); const [tags, setTags] = useState(field('tags'));
  const [privacy, setPrivacy] = useState('private'); const [kids, setKids] = useState('no'); const [synthetic, setSynthetic] = useState('');
  const [subtitles, setSubtitles] = useState<FileChoice[]>([]); const [subtitle, setSubtitle] = useState(''); const [cover, setCover] = useState('');
  const [playlists, setPlaylists] = useState<YoutubePlaylist[] | null>(null); const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => { getJson<FileChoice[]>(`/api/youtube/subtitles?piece=${encodeURIComponent(piece.path)}`).then((s) => { setSubtitles(s); setSubtitle(defaultSubtitle(s)); }, (e) => setError(e.message));
    getJson<YoutubePlaylist[]>('/api/youtube/playlists').then((p) => { setPlaylists(p); setSelected(longform && piece.kind === 'short' && p.some((x) => x.id === SHORTS_PLAYLIST) ? [SHORTS_PLAYLIST] : []); }, (e) => setError(e.message)); }, [piece.path, longform, piece.kind]);
  return <div><h4>New upload</h4>
    <label>Video<select value={video} onChange={(e) => setVideo(e.target.value)}>{piece.exports.map((f) => <option key={f.path} value={f.path}>{f.name}</option>)}</select></label>
    <Language value={language} setValue={setLanguage} />
    <label>Title<input maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
    <label>Description<textarea rows={7} maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
    <label>Tags (comma-separated)<input value={tags} onChange={(e) => setTags(e.target.value)} /></label>
    <label>Thumbnail<select value={cover} onChange={(e) => setCover(e.target.value)}><option value="">No custom thumbnail</option>{covers.filter((c) => /\.(png|jpe?g)$/i.test(c.name)).map((c) => <option key={c.path} value={c.path}>{c.name}</option>)}</select></label>
    <label>Subtitles<select value={subtitle} onChange={(e) => setSubtitle(e.target.value)}><option value="">{subtitles.length > 1 ? 'Choose a subtitle file or none' : 'No subtitles'}</option>{subtitles.map((s) => <option key={s.path} value={s.path}>{s.name}</option>)}</select></label>
    {playlists ? <PlaylistChoices playlists={playlists} selected={selected} setSelected={setSelected} /> : <p>Loading playlists…</p>}
    <Related longform={longform} />
    <label>Visibility<select value={privacy} onChange={(e) => setPrivacy(e.target.value)}><option value="private">Private</option><option value="unlisted">Unlisted</option><option value="public">Public</option></select></label>
    <Choices label="Made for kids?" value={kids} setValue={setKids} /><Choices label="Contains realistic altered or synthetic content?" value={synthetic} setValue={setSynthetic} />
    <p>Upload sends your chosen video, settings, playlists, thumbnail and subtitles. Public makes the video public.</p>
    <button disabled={busy || !channel || !playlists || !title.trim() || !kids || !synthetic || ((!!subtitle || selected.length > 0) && !canEdit)} onClick={async () => {
      if (existing.length && !window.confirm('This project already has a video linked on YouTube. Upload another copy?')) return;
      setBusy(true); setError(''); try { const job = await postJson<UploadJob>('/api/youtube/upload', { piece: piece.path, video, cover, subtitle, language, playlistIds: selected, title, description, tags: tags.split(',').map((t) => t.trim()).filter(Boolean), privacy, madeForKids: kids === 'yes', synthetic: synthetic === 'yes' }); onStarted(job); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
    }}>Upload</button>{error && <p className="error">{error}</p>}
  </div>;
}

function ExistingForm({ piece, job, covers, canEdit, longform }: { piece: Piece; job: UploadJob; covers: FileChoice[]; canEdit: boolean; longform?: string }) {
  const [data, setData] = useState<Existing | null>(null); const [draft, setDraft] = useState<YoutubeVideoSettings | null>(null);
  const [tagsText, setTagsText] = useState('');
  const [selected, setSelected] = useState<string[]>([]); const [subtitles, setSubtitles] = useState<FileChoice[]>([]);
  const [subtitle, setSubtitle] = useState(''); const [cover, setCover] = useState(''); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const load = async () => { const r = await getJson<Existing>(`/api/youtube/video-settings?piece=${encodeURIComponent(piece.path)}&id=${encodeURIComponent(job.id)}`); setData(r); setDraft(r.video); setTagsText(r.video.tags.join(', ')); setSelected(r.selected); setSubtitle(''); setCover(''); };
  useEffect(() => { void load().catch((e) => setError(e.message)); getJson<FileChoice[]>(`/api/youtube/subtitles?piece=${encodeURIComponent(piece.path)}`).then(setSubtitles, (e) => setError(e.message)); }, [piece.path, job.id]);
  if (!data || !draft) return <div>{error ? <p className="error">{error} <button className="small" onClick={() => void load().catch((e) => setError(e.message))}>Retry</button></p> : <p>Loading current settings from YouTube…</p>}</div>;
  const change = (value: Partial<YoutubeVideoSettings>) => { setDraft({ ...draft, ...value }); setMessage(''); };
  const hasManualCaptions = data.captions?.some((c) => c.kind !== 'ASR' && c.kind !== 'asr') ?? false;
  return <div><h4>Existing YouTube video</h4>
    <button className="small" onClick={() => void postJson('/api/youtube/studio', { videoId: job.videoId }).catch((e) => setError(e.message))}>Open in YouTube Studio ↗</button>
    {job.warning && <p className="error">{job.warning}</p>}
    {job.error && <p className="error">{job.error}</p>}
    {job.subtitleStatus === 'error' && <p className="error">Subtitles could not be confirmed: {job.subtitleError}. Check Studio before trying again.</p>}
    {job.playlistResults?.filter((r) => r.status === 'error').map((r) => <p key={r.id} className="error">Playlist {r.id}: {r.error}</p>)}
    <Language value={draft.language ?? ''} setValue={(language) => change({ language: language || null })} />
    <label>Title<input maxLength={100} value={draft.title} onChange={(e) => change({ title: e.target.value })} /></label>
    <label>Description<textarea rows={7} maxLength={5000} value={draft.description} onChange={(e) => change({ description: e.target.value })} /></label>
    <label>Tags (comma-separated)<input value={tagsText} onChange={(e) => { setTagsText(e.target.value); setMessage(''); }} /></label>
    <PlaylistChoices playlists={data.playlists} selected={selected} setSelected={setSelected} />
    <label>Visibility<select value={draft.privacy} onChange={(e) => change({ privacy: e.target.value as YoutubeVideoSettings['privacy'] })}><option value="private">Private</option><option value="unlisted">Unlisted</option><option value="public">Public</option></select></label>
    <Choices label="Made for kids?" value={draft.madeForKids === null ? '' : draft.madeForKids ? 'yes' : 'no'} setValue={(v) => change({ madeForKids: v === '' ? null : v === 'yes' })} />
    <Choices label="Contains realistic altered or synthetic content?" value={draft.synthetic === null ? '' : draft.synthetic ? 'yes' : 'no'} setValue={(v) => change({ synthetic: v === '' ? null : v === 'yes' })} />
    <p>Current YouTube thumbnail: {data.video.thumbnail ? <a href={data.video.thumbnail} target="_blank" rel="noreferrer">View ↗</a> : 'not available'}</p>
    <label>Thumbnail<select value={cover} onChange={(e) => setCover(e.target.value)}><option value="">Keep current thumbnail</option>{covers.filter((c) => /\.(png|jpe?g)$/i.test(c.name)).map((c) => <option key={c.path} value={c.path}>{c.name}</option>)}</select></label>
    {data.captions === null ? <p className="error">{data.captionError} Check subtitles in Studio.</p> : <><p>YouTube captions: {data.captions.length ? data.captions.map((c) => `${c.language || 'unknown language'} (${c.kind === 'ASR' || c.kind === 'asr' ? 'automatic' : 'uploaded'}, ${c.status || 'status unknown'})`).join(', ') : 'none'}</p>
      {!hasManualCaptions && <label>Add subtitles<select value={subtitle} onChange={(e) => setSubtitle(e.target.value)}><option value="">Keep current captions</option>{subtitles.map((s) => <option key={s.path} value={s.path}>{s.name}</option>)}</select></label>}</>}
    <Related longform={longform} />
    <button disabled={busy || !canEdit || !draft.title.trim()} onClick={async () => { setBusy(true); setError(''); setMessage(''); try {
      const result = await postJson<{ errors: string[] }>('/api/youtube/video-settings', { piece: piece.path, id: job.id, baseline: data.video, desired: { ...draft, tags: tagsText.split(',').map((t) => t.trim()).filter(Boolean) }, before: data.selected, after: selected, subtitle, cover });
      await load(); if (result.errors.length) setError(`Some changes were not confirmed: ${result.errors.join('; ')}`); else setMessage('Changes saved to YouTube.');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }}>Save changes to YouTube</button>{' '}
    <button className="small" disabled={busy} onClick={() => { setError(''); void load().catch((e) => setError(e.message)); }}>Reload from YouTube</button>
    {error && <p className="error">{error}</p>}{message && <p>{message}</p>}
  </div>;
}
