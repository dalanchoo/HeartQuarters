import { useEffect, useState } from 'react';
import { fileStamp, getText, postJson, thumbUrl, type PackagingVersion } from './api';
import type { LoadedDoc } from './PackagingDoc';
import { parseFields } from './packaging';
import { copyVersionFields } from './versionFields';

export function VersionCompare({ versions, version, doc, locked, onChanged }: { versions: PackagingVersion[]; version: PackagingVersion; doc: LoadedDoc; locked: boolean; onChanged?: () => void }) {
  const options = versions.filter(v => v.path !== version.path && v.docs.some(d => /(^|\/)youtube\.md$/i.test(d.name)));
  const [copyThumb, setCopyThumb] = useState(false); const [source, setSource] = useState(''); const [text, setText] = useState<string | null>(null); const [selected, setSelected] = useState<string[]>([]); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { let active = true; setText(null); setSelected([]); if (source) { const file = options.find(v => v.path === source)?.docs.find(d => /(^|\/)youtube\.md$/i.test(d.name)); if (file) void getText('projects', file.path).then(value => { if (active) { setText(value); setSelected((parseFields(value) ?? []).map(f => f.label)); } }, e => { if (active) setMessage(e.message); }); } return () => { active = false; }; }, [source, version.path]);
  if (!options.length) return null;
  const sourceThumb = options.find(v => v.path === source)?.covers.find(c => /(^|\/)thumbnail\.(png|jpe?g)$/i.test(c.name));
  const currentThumb = version.covers.find(c => /(^|\/)thumbnail\.(png|jpe?g)$/i.test(c.name));
  const fields = text ? parseFields(text) ?? [] : []; const current = doc.fields ?? [];
  return <details className="yt-section"><summary>Compare Local Versions</summary>
    <label>Copy From <select value={source} onChange={e => { setSource(e.target.value); setCopyThumb(false); setMessage(''); }}><option value="">Choose a Version…</option>{options.map(v => <option key={v.path} value={v.path}>{v.name}</option>)}</select></label>
    {fields.map(field => <div className="version-field-compare" key={field.label}>
      <label><input type="checkbox" checked={selected.includes(field.label)} onChange={e => setSelected(e.target.checked ? [...selected, field.label] : selected.filter(s => s !== field.label))} /> {field.label}</label>
      <div className="compare-columns"><div><strong>{options.find(v => v.path === source)?.name}</strong><pre className="lvy-value">{field.value || '(empty)'}</pre></div><div><strong>{version.name}</strong><pre className="lvy-value">{current.find(f => f.label.toLowerCase() === field.label.toLowerCase())?.value || '(empty)'}</pre></div></div>
    </div>)}
    {sourceThumb && <div className="version-field-compare"><label><input type="checkbox" checked={copyThumb} onChange={e => setCopyThumb(e.target.checked)} /> Thumbnail</label><div className="compare-columns"><div><strong>{options.find(v => v.path === source)?.name}</strong><div><img className="lvy-thumb" src={thumbUrl('projects', sourceThumb.path, 320, fileStamp(sourceThumb))} alt="Source thumbnail" /></div></div><div><strong>{version.name}</strong><div>{currentThumb ? <img className="lvy-thumb" src={thumbUrl('projects', currentThumb.path, 320, fileStamp(currentThumb))} alt="Current thumbnail" /> : '(empty)'}</div></div></div></div>}
    {text && <button disabled={locked || busy || (!selected.length && !copyThumb)} onClick={async () => { setBusy(true); setMessage(''); let copied = false; try { if (selected.length) { const sourceDoc = options.find(v => v.path === source)?.docs.find(d => /(^|\/)youtube\.md$/i.test(d.name)); if (!sourceDoc || (await getText('projects', sourceDoc.path)) !== text) throw new Error('The source version changed. Choose it again to reload before copying.'); await doc.save(t => copyVersionFields(t, text, selected)); copied = true; } if (copyThumb && sourceThumb) { await postJson('/api/packaging/copy-thumbnail', { piece: version.path.replace(/\/Packaging\/[^/]+$/i, ''), source, target: version.path, expected: currentThumb ? { size: currentThumb.size, modified: currentThumb.modified } : undefined, sourceExpected: { size: sourceThumb.size, modified: sourceThumb.modified } }); onChanged?.(); } setMessage(`Selected fields copied to ${version.name}.`); } catch (e) { setMessage(`${copied ? 'The selected text was saved, but the thumbnail was not: ' : ''}${e instanceof Error ? e.message : String(e)}`); } finally { setBusy(false); } }}>Copy Selected</button>}
    {locked && <p className="muted small-text">Unlock {version.name} to copy into it.</p>}{message && <p role="status">{message}</p>}
  </details>;
}
