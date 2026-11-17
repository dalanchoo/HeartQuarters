import { useEffect, useRef, useState } from 'react';
import { fileUrl, getJson, openInExplorer, postJson, thumbUrl, type ExpressionCategory, type ExpressionPhoto } from './api';
import { CategoryPicker } from './CategoryPicker';
import { PortraitOutlineEditor } from './PortraitOutlineEditor';
import { isAiExpression } from '../../server/expression-origin';

type Job = { id: string; photo: string; state: 'working' | 'done' | 'failed'; result?: string; error?: string };

export function ExpressionInbox({ photos, categories, onView, onRefresh }: { photos: ExpressionPhoto[]; categories: ExpressionCategory[]; onView: (photo: ExpressionPhoto) => void; onRefresh: () => void }) {
  const [ai, setAi] = useState(false); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const [editing, setEditing] = useState<ExpressionPhoto | null>(null);
  const [outlining, setOutlining] = useState<ExpressionPhoto | null>(null);
  const [destination, setDestination] = useState<Record<string, string>>({}); const [jobs, setJobs] = useState<Job[]>([]);
  const parents = new Set(categories.map(c => c.parent));
  useEffect(() => {
    if (!jobs.some(job => job.state === 'working')) return;
    let alive = true;
    const timer = setInterval(() => { void Promise.all(jobs.filter(job => job.state === 'working').map(job => getJson<Job>(`/api/expressions/inbox/prepare?id=${encodeURIComponent(job.id)}`))).then(updated => { if (!alive) return; setJobs(current => current.map(job => updated.find(item => item.id === job.id) ?? job)); if (updated.some(job => job.state === 'done')) onRefresh(); }, () => undefined); }, 3000);
    return () => { alive = false; clearInterval(timer); };
  }, [jobs, onRefresh]);
  const run = async (fn: () => Promise<void>) => { setBusy(true); setMessage(''); try { await fn(); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } };
  const upload = (files: File[]) => void run(async () => {
    try { for (const file of files) {
      if (file.size > 15_000_000) throw new Error(`${file.name} exceeds the 15 MB limit. Earlier photos were added.`);
      const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error(`Could not read ${file.name}.`)); reader.onload = () => resolve(String(reader.result).split(',')[1] ?? ''); reader.readAsDataURL(file); });
      await postJson('/api/expressions/inbox/import', { name: file.name, data, ai });
    }
    setMessage(`${files.length} ${files.length === 1 ? 'photo added' : 'photos added'} to the inbox.`); } finally { onRefresh(); }
  });
  return <section className="expression-inbox">
    <h2>Expression Inbox</h2>
    <p>Drop photos here or put them in the <strong>_Inbox</strong> folder inside Expressions. Open a photo to assess and confirm attributes; confirming an expression files it in that category.</p>
    <div className="expression-inbox-drop" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (!busy) upload([...e.dataTransfer.files]); }}>
      <label>Choose Photos <input type="file" multiple accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e => { const files = [...(e.target.files ?? [])]; e.target.value = ''; if (files.length) upload(files); }} /></label>
      <span> or drop PNG, JPEG, or WebP photos here (up to 15 MB each).</span>
      <label><input type="checkbox" checked={ai} disabled={busy} onChange={e => setAi(e.target.checked)} /> Mark Imported Photos as AI</label>
    </div>
    <div className="versions"><button disabled={busy} onClick={() => void run(async () => { await postJson('/api/expressions/inbox/open'); await openInExplorer('expressions', '_Inbox'); })}>Open Inbox Folder</button><button disabled={busy} onClick={onRefresh}>Refresh Inbox</button></div>
    {message && <p role="status">{message}</p>}
    {!photos.length && <p className="muted">No photos waiting to be reviewed.</p>}
    {outlining && <PortraitOutlineEditor key={outlining.path} photo={outlining} onClose={() => setOutlining(null)} onSaved={() => { onRefresh(); setMessage('Cutout copy added to the inbox.'); setOutlining(null); }} />}
    {editing && <PhotopeaEditor key={editing.path} photo={editing} onClose={() => setEditing(null)} onSaved={() => { onRefresh(); setMessage('Edited copy added to the inbox.'); setEditing(null); }} />}
    <div className="photo-grid">{photos.map(photo => {
      const job = jobs.find(item => item.photo === photo.path && item.state === 'working');
      return <article className="expression-photo-choice" key={photo.path}>
        <button className="photo" onClick={() => onView(photo)}><img src={thumbUrl('expressions', photo.path, 360, photo.revision)} alt={photo.name} loading="lazy" /><span>{photo.name}</span></button>
        <p className="small-text">{isAiExpression(photo) ? 'AI Image' : 'Not Marked as AI'}</p>
        {!isAiExpression(photo) && <button disabled={busy} onClick={() => void run(async () => { await postJson('/api/expressions/mark-ai', { photo: photo.path }); onRefresh(); })}>Mark as AI</button>}
        <button disabled={busy || !!job} onClick={() => { if (!window.confirm(`Move ${photo.name} and its sidecars to HeartQuarters Trash?`)) return; void run(async () => { await postJson('/api/expressions/inbox/trash', { photo: photo.path }); setMessage(`${photo.name} moved to HeartQuarters Trash.`); onRefresh(); }); }}>Move to Trash</button>
        <CategoryPicker label="File in Category" value={destination[photo.path] ?? ''} options={categories.filter(c => c.path && !parents.has(c.path)).map(c => ({ value: c.path, label: c.path.split('/').join(' > ') }))} onChange={value => setDestination(old => ({ ...old, [photo.path]: value }))} />
        <button disabled={busy || !destination[photo.path]} onClick={() => void run(async () => { const result = await postJson<{ path: string }>('/api/expressions/inbox/file', { photo: photo.path, category: destination[photo.path] }); setMessage(`Filed ${result.path}.`); onRefresh(); })}>File in Category</button>
        <button disabled={busy} onClick={() => { setEditing(null); setOutlining(photo); }}>Outline and Crop</button>
        <button disabled={busy} onClick={() => { setOutlining(null); setEditing(photo); }}>Edit in Photopea</button>
        <details><summary>Prepare Portrait With AI</summary><p className="small-text">Creates a separate AI candidate with a neutral background. Check the expression carefully; AI may change it. The original stays in the inbox.</p>
          {(['codex', 'gemini'] as const).map(model => <button key={model} disabled={busy || !!job} onClick={() => void run(async () => { const next = await postJson<Job>('/api/expressions/inbox/prepare', { photo: photo.path, ai: model }); setJobs(old => [...old, next]); })}>Prepare With {model === 'codex' ? 'ChatGPT' : 'Gemini'}</button>)}
          {job && <p role="status">Preparing a separate candidate…</p>}
          {jobs.filter(item => item.photo === photo.path && item.state !== 'working').map(item => <div key={item.id} role="status">{item.state === 'done' && item.result ? <><p>Compare the expression before filing the candidate.</p><div className="expression-inbox-comparison"><div><strong>Original</strong><img src={thumbUrl('expressions', photo.path, 360, photo.revision)} alt="Original portrait" /></div><div><strong>Prepared Candidate</strong><img src={thumbUrl('expressions', item.result, 360)} alt="Prepared candidate" /></div></div></> : <p>{item.error}</p>}</div>)}
        </details>
      </article>;
    })}</div>
  </section>;
}

/** Photopea receives only the selected image and returns an edited PNG on request. */
function PhotopeaEditor({ photo, onClose, onSaved }: { photo: ExpressionPhoto; onClose: () => void; onSaved: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const sent = useRef(false), pending = useRef(false), saved = useRef(onSaved);
  saved.current = onSaved;
  const [ready, setReady] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    const receive = (event: MessageEvent) => {
      if (event.origin !== 'https://www.photopea.com' || event.source !== frame.current?.contentWindow) return;
      if (event.data === 'done' && !sent.current) {
        sent.current = true;
        void fetch(fileUrl('expressions', photo.path, photo.revision)).then(response => { if (!response.ok) throw new Error('Could not load the photo.'); return response.arrayBuffer(); }).then(bytes => { if (alive) frame.current?.contentWindow?.postMessage(bytes, 'https://www.photopea.com'); }).catch((e: Error) => { if (alive) setError(e.message); });
      } else if (event.data === 'done' && !pending.current) setReady(true);
      else if (event.data instanceof ArrayBuffer && pending.current) {
        pending.current = false;
        const reader = new FileReader();
        reader.onerror = () => { setSaving(false); setError('Could not read the edited image.'); };
        reader.onload = () => { void postJson('/api/expressions/inbox/import', { name: `${photo.name} - Edited.png`, data: String(reader.result).split(',')[1] ?? '', ai: isAiExpression(photo) }).then(() => { if (alive) saved.current(); }, (e: Error) => { if (alive) { setSaving(false); setError(e.message); } }); };
        reader.readAsDataURL(new Blob([event.data], { type: 'image/png' }));
      }
    };
    window.addEventListener('message', receive);
    return () => { alive = false; window.removeEventListener('message', receive); };
  }, [photo.path, photo.revision]);
  return <section className="expression-photopea"><h3>Edit in Photopea: {photo.name}</h3>
    <p>Photopea is an online editor. Edit the photo, then save an edited copy below; the original stays in the inbox. Some Photopea features may be unavailable. For a simple manual cutout, use Outline and Crop instead.</p>
    <p><button disabled={!ready || saving} onClick={() => { setSaving(true); setError(''); pending.current = true; frame.current?.contentWindow?.postMessage('app.activeDocument.saveToOE("png");', 'https://www.photopea.com'); }}>Save Edited Copy to Inbox</button>{' '}<button disabled={saving} onClick={onClose}>Close Editor</button></p>
    {error && <p role="alert">{error}</p>}
    {!ready && !error && <p>Loading Photopea…</p>}
    <iframe ref={frame} title="Photopea Image Editor" src="https://www.photopea.com/#%7B%7D" style={{ width: '100%', height: 'min(75vh, 800px)', border: '1px solid #bbc4cf' }} />
  </section>;
}
