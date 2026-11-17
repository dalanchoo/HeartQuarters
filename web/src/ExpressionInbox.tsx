import { useState } from 'react';
import { openInExplorer, postJson, thumbUrl, type ExpressionPhoto } from './api';
import { isAiExpression } from '../../server/expression-origin';

export function ExpressionInbox({ photos, onView, onRefresh }: { photos: ExpressionPhoto[]; onView: (photo: ExpressionPhoto) => void; onRefresh: () => void }) {
  const [ai, setAi] = useState(false); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
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
    <details className="expression-inbox-import">
      <summary>Add Photos</summary>
      <p>Drop photos here or put them in the <strong>_Inbox</strong> folder. Open a photo to assess it; confirming an expression files it in that category.</p>
      <div className="expression-inbox-drop" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (!busy) upload([...e.dataTransfer.files]); }}>
        <label>Choose Photos <input type="file" multiple accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e => { const files = [...(e.target.files ?? [])]; e.target.value = ''; if (files.length) upload(files); }} /></label>
        <span> or drop PNG, JPEG, or WebP photos here (up to 15 MB each).</span>
        <label><input type="checkbox" checked={ai} disabled={busy} onChange={e => setAi(e.target.checked)} /> Mark Imported Photos as AI</label>
      </div>
    </details>
    <div className="versions"><button disabled={busy} onClick={() => void run(async () => { await postJson('/api/expressions/inbox/open'); await openInExplorer('expressions', '_Inbox'); })}>Open Inbox Folder</button><button disabled={busy} onClick={onRefresh}>Refresh Inbox</button></div>
    {message && <p role="status">{message}</p>}
    {!photos.length && <p className="muted">No photos waiting to be reviewed.</p>}
    <div className="photo-grid">{photos.map(photo => {
      return <article className="expression-photo-choice" key={photo.path}>
        <button className="photo" onClick={() => onView(photo)}><img src={thumbUrl('expressions', photo.path, 360, photo.revision)} alt={photo.name} loading="lazy" /><span>{photo.name}</span></button>
        <p className="small-text expression-inbox-origin">{isAiExpression(photo) ? 'AI Image' : 'Not Marked as AI'}</p>
        <div className="expression-inbox-actions">
        <button disabled={busy} onClick={() => { if (!window.confirm(`Move ${photo.name} and its sidecars to HeartQuarters Trash?`)) return; void run(async () => { await postJson('/api/expressions/inbox/trash', { photo: photo.path }); setMessage(`${photo.name} moved to HeartQuarters Trash.`); onRefresh(); }); }}>Move to Trash</button>
        <a className="button-link" href="https://www.photopea.com/" target="_blank" rel="noopener noreferrer" aria-disabled={busy} onClick={e => { if (busy) { e.preventDefault(); return; } void run(async () => { const copy = await postJson<{ path: string }>('/api/expressions/inbox/photopea-copy', { photo: photo.path }); setMessage(`Created ${copy.path}. Drag the selected file from File Explorer into Photopea.`); onRefresh(); }); }}>Prepare Copy for Photopea</a>
        </div>
      </article>;
    })}</div>
  </section>;
}
