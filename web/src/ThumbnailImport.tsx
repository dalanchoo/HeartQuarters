import { useState } from 'react';
import { postJson, type PackagingVersion } from './api';

export function ThumbnailImport({ piece, version, versions, locked, onSaved }: { piece: string; version: string; versions: PackagingVersion[]; locked?: boolean; onSaved: () => void }) {
  const sources = versions.filter(v => v.path !== version && v.covers.some(c => /(^|\/)thumbnail\.(png|jpe?g)$/i.test(c.name)));
  const currentThumbnail = versions.find(v => v.path === version)?.covers.find(c => /(^|\/)thumbnail\.(png|jpe?g)$/i.test(c.name));
  const [source, setSource] = useState(sources.at(-1)?.path ?? '');
  const selectedSource = sources.some(v => v.path === source) ? source : (sources.at(-1)?.path ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  return <details className="thumbnail-import"><summary>Import Thumbnail</summary>
    {currentThumbnail && <button disabled={busy} onClick={async () => { setBusy(true); setMessage(''); try { const result = await postJson<{ path: string }>('/api/expressions/inbox/copy-thumbnail', { piece, image: currentThumbnail.path }); setMessage(`Copied to Expression Inbox as AI: ${result.path}`); window.dispatchEvent(new Event('hq-expression-inbox-changed')); } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }}>Copy Thumbnail to Expression Inbox as AI</button>}
    <p className="muted small-text">Add a PNG or JPEG up to 2 MB. It’s saved as Thumbnail.png or Thumbnail.jpg in this version’s Thumbnail folder. A version holds one thumbnail; for another one, make a new version.</p>
    {sources.length > 0 && <div className="copy-thumbnail"><label>Copy From Version <select value={selectedSource} disabled={busy || locked} onChange={e => setSource(e.target.value)}>{sources.map(v => <option key={v.path} value={v.path}>{v.name}</option>)}</select></label>
      <button disabled={busy || locked || !selectedSource} onClick={async () => { setBusy(true); setMessage(''); try { await postJson('/api/packaging/copy-thumbnail', { piece, source: selectedSource, target: version }); setMessage('Thumbnail copied to this version.'); onSaved(); } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }}>Copy Thumbnail</button></div>}
    <label>Image <input type="file" disabled={locked} accept="image/png,image/jpeg" onChange={(e) => { const selected = e.target.files?.[0] ?? null; setFile(selected); setMessage(''); }} /></label>
    {file && <><button disabled={busy || locked} onClick={async () => {
        setBusy(true); setMessage(''); try {
          if (file.size > 2_000_000) throw new Error('Choose an image up to 2 MB.');
          const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error('Could not read the image.')); reader.onload = () => resolve(String(reader.result).split(',')[1] ?? ''); reader.readAsDataURL(file); });
          await postJson('/api/packaging/import-thumbnail', { piece, version, data });
          setFile(null); setMessage('Thumbnail saved in this packaging version.'); onSaved();
        } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
      }}>{busy ? 'Saving…' : 'Save Thumbnail'}</button></>}
    {message && <p role="status">{message}</p>}
  </details>;
}
