import { useEffect, useState } from 'react';
import { getJson, openInExplorer, postJson, thumbUrl, type ExpressionCategory, type ExpressionPhoto } from './api';
import { CategoryPicker } from './CategoryPicker';
import { isAiExpression } from '../../server/expression-origin';

type Job = { id: string; photo: string; state: 'working' | 'done' | 'failed'; result?: string; error?: string };

export function ExpressionInbox({ photos, categories, onView, onRefresh }: { photos: ExpressionPhoto[]; categories: ExpressionCategory[]; onView: (photo: ExpressionPhoto) => void; onRefresh: () => void }) {
  const [ai, setAi] = useState(false); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
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
    <div className="photo-grid">{photos.map(photo => {
      const job = jobs.find(item => item.photo === photo.path && item.state === 'working');
      return <article className="expression-photo-choice" key={photo.path}>
        <button className="photo" onClick={() => onView(photo)}><img src={thumbUrl('expressions', photo.path, 360, photo.revision)} alt={photo.name} loading="lazy" /><span>{photo.name}</span></button>
        <p className="small-text">{isAiExpression(photo) ? 'AI Image' : 'Not Marked as AI'}</p>
        {!isAiExpression(photo) && <button disabled={busy} onClick={() => void run(async () => { await postJson('/api/expressions/mark-ai', { photo: photo.path }); onRefresh(); })}>Mark as AI</button>}
        <CategoryPicker label="File in Category" value={destination[photo.path] ?? ''} options={categories.filter(c => c.path && !parents.has(c.path)).map(c => ({ value: c.path, label: c.path.split('/').join(' > ') }))} onChange={value => setDestination(old => ({ ...old, [photo.path]: value }))} />
        <button disabled={busy || !destination[photo.path]} onClick={() => void run(async () => { const result = await postJson<{ path: string }>('/api/expressions/inbox/file', { photo: photo.path, category: destination[photo.path] }); setMessage(`Filed ${result.path}.`); onRefresh(); })}>File in Category</button>
        <details><summary>Prepare Portrait With AI</summary><p className="small-text">Creates a separate AI candidate with a neutral background. Check the expression carefully; AI may change it. The original stays in the inbox.</p>
          {(['codex', 'gemini'] as const).map(model => <button key={model} disabled={busy || !!job} onClick={() => void run(async () => { const next = await postJson<Job>('/api/expressions/inbox/prepare', { photo: photo.path, ai: model }); setJobs(old => [...old, next]); })}>Prepare With {model === 'codex' ? 'ChatGPT' : 'Gemini'}</button>)}
          {job && <p role="status">Preparing a separate candidate…</p>}
          {jobs.filter(item => item.photo === photo.path && item.state !== 'working').map(item => <div key={item.id} role="status">{item.state === 'done' && item.result ? <><p>Compare the expression before filing the candidate.</p><div className="expression-inbox-comparison"><div><strong>Original</strong><img src={thumbUrl('expressions', photo.path, 360, photo.revision)} alt="Original portrait" /></div><div><strong>Prepared Candidate</strong><img src={thumbUrl('expressions', item.result, 360)} alt="Prepared candidate" /></div></div></> : <p>{item.error}</p>}</div>)}
        </details>
      </article>;
    })}</div>
  </section>;
}
