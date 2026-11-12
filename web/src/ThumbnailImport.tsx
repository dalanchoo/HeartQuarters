import { useState } from 'react';
import { postJson } from './api';

export function ThumbnailImport({ piece, version, onSaved }: { piece: string; version: string; onSaved: () => void }) {
  const [file, setFile] = useState<File | null>(null); const [name, setName] = useState('');
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  return <details className="thumbnail-import"><summary>Import thumbnail</summary>
    <p className="muted small-text">Add a PNG or JPEG up to 2 MB to this version’s Covers folder. Existing files are never replaced.</p>
    <label>Image <input type="file" accept="image/png,image/jpeg" onChange={(e) => { const selected = e.target.files?.[0] ?? null; setFile(selected); setName(selected?.name ?? ''); setMessage(''); }} /></label>
    {file && <><label>Save as <input value={name} onChange={(e) => setName(e.target.value)} /></label>{' '}
      <button disabled={busy || !name.trim()} onClick={async () => {
        setBusy(true); setMessage(''); try {
          if (file.size > 2_000_000) throw new Error('Choose an image up to 2 MB.');
          const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error('Could not read the image.')); reader.onload = () => resolve(String(reader.result).split(',')[1] ?? ''); reader.readAsDataURL(file); });
          await postJson('/api/packaging/import-thumbnail', { piece, version, name, data });
          setFile(null); setMessage('Thumbnail saved in this packaging version.'); onSaved();
        } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
      }}>{busy ? 'Saving…' : 'Save Thumbnail'}</button></>}
    {message && <p role="status">{message}</p>}
  </details>;
}
