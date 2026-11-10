import { useEffect, useState } from 'react';
import { getJson, postJson, type Piece } from './api';
import type { LoadedDoc } from './PackagingDoc';
import type { UploadJob } from '../../server/youtube';

export function YouTubeUpload({ piece, docs, covers }: { piece: Piece; docs: LoadedDoc[]; covers: { path: string; name: string }[] }) {
  const doc = docs.find((d) => /^youtube(?:\b|[_. -])/i.test(d.file.name.split('/').pop() ?? ''));
  const [open, setOpen] = useState(false);
  if (!piece.exports.length || !doc?.fields) return null;
  return <div className="youtube-upload"><button className="small" onClick={() => setOpen(!open)}>Upload to YouTube</button>
    {open && <UploadForm key={doc.file.path} piece={piece} doc={doc} covers={covers} />}</div>;
}

function UploadForm({ piece, doc, covers }: { piece: Piece; doc: LoadedDoc; covers: { path: string; name: string }[] }) {
  const field = (name: string) => doc.fields?.find((f) => f.label.toLowerCase() === name)?.value ?? '';
  const [video, setVideo] = useState(piece.exports[0].path);
  const [cover, setCover] = useState('');
  const [title, setTitle] = useState(field('title'));
  const [description, setDescription] = useState(field('description'));
  const [tags, setTags] = useState(field('tags'));
  const [privacy, setPrivacy] = useState('private');
  const [kids, setKids] = useState('');
  const [synthetic, setSynthetic] = useState('');
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [status, setStatus] = useState<{ configured: boolean; connected: boolean } | null>(null);
  const [channel, setChannel] = useState<{ title: string } | null>(null);
  const [url, setUrl] = useState('');
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = () => getJson<{ configured: boolean; connected: boolean }>('/api/youtube/status').then(setStatus).catch((e) => setError(e.message));
  const refreshJobs = () => getJson<UploadJob[]>(`/api/youtube/uploads?piece=${encodeURIComponent(piece.path)}`).then(setJobs).catch((e) => setError(e.message));
  useEffect(() => { void refresh(); void refreshJobs(); }, [piece.path]);
  useEffect(() => {
    if (!status?.connected) { setChannel(null); return; }
    getJson<{ title: string }>('/api/youtube/channel').then(setChannel, (e) => setError(e.message));
  }, [status?.connected]);
  useEffect(() => { if (!jobs.some((j) => j.status === 'uploading')) return; const timer = setInterval(refreshJobs, 1500); return () => clearInterval(timer); }, [jobs]);
  const action = async (fn: () => Promise<void>) => { setBusy(true); setError(''); try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  return <div className="youtube-form">
    <h4>Upload to YouTube</h4>
    {!status?.connected && <>
      <p>Connect your YouTube channel using a Google Cloud desktop OAuth client. Credentials are kept in Windows Credential Manager.</p>
      {!status?.configured && <>
        <label>Client ID<input value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" /></label>
        <label>Client secret<input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" /></label>
        <button disabled={busy} onClick={() => void action(async () => { await postJson('/api/youtube/configure', { clientId, clientSecret: secret }); setSecret(''); await refresh(); })}>Save Google setup</button>
      </>}
      {status?.configured && <>
        <button disabled={busy} onClick={() => void action(async () => { const result = await postJson<{ url: string }>('/api/youtube/connect'); setUrl(result.url); })}>Start YouTube sign-in</button>{' '}
        {url && <a href={url} target="_blank" rel="noreferrer">Open Google sign-in ↗</a>}{' '}
        <button onClick={() => void refresh()}>I’ve signed in</button>{' '}
        <button onClick={() => void action(async () => { await postJson('/api/youtube/disconnect'); setUrl(''); await refresh(); })}>Change Google setup</button>
      </>}
    </>}
    {status?.connected && <>
      <p>Channel: <strong>{channel?.title ?? 'Checking…'}</strong> <button className="small" onClick={() => void action(async () => { await postJson('/api/youtube/disconnect'); await refresh(); })}>Disconnect</button></p>
      <label>Video<select value={video} onChange={(e) => setVideo(e.target.value)}>{piece.exports.map((f) => <option key={f.path} value={f.path}>{f.name}</option>)}</select></label>
      <label>Title<input maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      <label>Description<textarea rows={7} maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      <label>Tags (comma-separated)<input value={tags} onChange={(e) => setTags(e.target.value)} /></label>
      <label>Thumbnail<select value={cover} onChange={(e) => setCover(e.target.value)}><option value="">No custom thumbnail</option>{covers.filter((c) => /\.(png|jpe?g)$/i.test(c.name)).map((c) => <option key={c.path} value={c.path}>{c.name}</option>)}</select></label>
      <label>Visibility<select value={privacy} onChange={(e) => setPrivacy(e.target.value)}><option value="private">Private</option><option value="unlisted">Unlisted</option><option value="public">Public</option></select></label>
      <label>Made for kids?<select value={kids} onChange={(e) => setKids(e.target.value)}><option value="">Choose…</option><option value="no">No</option><option value="yes">Yes</option></select></label>
      <label>Contains realistic altered or synthetic content?<select value={synthetic} onChange={(e) => setSynthetic(e.target.value)}><option value="">Choose…</option><option value="no">No</option><option value="yes">Yes</option></select></label>
      <p>Review these details before uploading. Choosing Public makes the video public on YouTube.</p>
      <button disabled={busy || !channel || !kids || !synthetic || !title.trim() || jobs.some((j) => j.status === 'uploading')} onClick={() => void action(async () => {
        if (jobs.some((j) => j.video === video && j.status === 'done') && !window.confirm('This export has already been uploaded. Upload another copy?')) return;
        await postJson('/api/youtube/upload', { piece: piece.path, video, cover, title, description, tags: tags.split(',').map((t) => t.trim()).filter(Boolean), privacy, madeForKids: kids === 'yes', synthetic: synthetic === 'yes' }); await refreshJobs();
      })}>Upload {privacy === 'public' ? 'publicly' : privacy === 'unlisted' ? 'as unlisted' : 'privately'}</button>
    </>}
    {error && <p className="error">{error}</p>}
    {jobs.map((j) => <div key={j.id} className="youtube-job">
      <strong>{j.status === 'uploading' ? `Uploading ${Math.round(j.sent / j.total * 100)}%` : j.status === 'unknown' ? 'Upload result unknown' : j.status === 'checked' ? 'Uncertain upload checked' : j.status === 'failed' ? 'Upload failed' : 'Uploaded'}</strong>
      {j.videoId && <> · <a href={`https://studio.youtube.com/video/${encodeURIComponent(j.videoId)}/edit`} target="_blank" rel="noreferrer">Open in YouTube Studio ↗</a></>}
      {j.error && <p className="error">{j.error}</p>}{j.warning && <p className="error">{j.warning}</p>}
      {j.status === 'unknown' && <p>Check YouTube Studio before trying again; the upload may have reached YouTube.{' '}<a href="https://studio.youtube.com/" target="_blank" rel="noreferrer">Open YouTube Studio ↗</a>{' '}<button className="small" onClick={() => void action(async () => { await postJson('/api/youtube/acknowledge', { piece: piece.path, id: j.id }); await refreshJobs(); })}>I checked Studio</button></p>}
    </div>)}
  </div>;
}
