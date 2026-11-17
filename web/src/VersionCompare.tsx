import { useEffect, useState } from 'react';
import { fileStamp, getText, postJson, thumbUrl, type PackagingVersion } from './api';
import type { LoadedDoc } from './PackagingDoc';
import { parseFields } from './packaging';
import { comparisonLabels, copyVersionFields } from './versionFields';

const youtubeFile = (version?: PackagingVersion) => version?.docs.find(d => /(^|\/)youtube\.md$/i.test(d.name));
const thumbnail = (version?: PackagingVersion) => version?.covers.find(c => /(^|\/)thumbnail\.(png|jpe?g)$/i.test(c.name));

function useVersionText(path: string, version: PackagingVersion | undefined, currentPath: string, doc: LoadedDoc) {
  const [loaded, setLoaded] = useState<{ path: string; text: string | null; error?: string }>({ path: '', text: null });
  const file = youtubeFile(version);
  useEffect(() => {
    if (!path || path === currentPath || !file) return;
    let active = true;
    setLoaded({ path, text: null });
    void getText('projects', file.path).then(
      text => { if (active) setLoaded({ path, text }); },
      e => { if (active) setLoaded({ path, text: null, error: e instanceof Error ? e.message : String(e) }); },
    );
    return () => { active = false; };
  }, [path, currentPath, file?.path]);
  if (!path) return { text: null, error: undefined };
  if (path === currentPath) return { text: doc.text, error: doc.error };
  return loaded.path === path ? loaded : { text: null, error: undefined };
}

export function VersionCompare({ versions, version, doc, locked, onChanged }: { versions: PackagingVersion[]; version: PackagingVersion; doc: LoadedDoc; locked: boolean; onChanged?: () => void }) {
  const options = versions.filter(v => youtubeFile(v));
  const [left, setLeft] = useState('');
  const [right, setRight] = useState(version.path);
  const [selected, setSelected] = useState<string[]>([]);
  const [copyThumb, setCopyThumb] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const leftVersion = options.find(v => v.path === left);
  const rightVersion = options.find(v => v.path === right);
  const leftData = useVersionText(left, leftVersion, version.path, doc);
  const rightData = useVersionText(right, rightVersion, version.path, doc);
  if (options.length < 2) return null;

  const leftText = leftData.text;
  const rightText = rightData.text;
  const ready = leftText !== null && rightText !== null;
  const leftFields = parseFields(leftText ?? '') ?? [];
  const rightFields = parseFields(rightText ?? '') ?? [];
  const labels = ready ? comparisonLabels(leftText, rightText) : [];
  const leftThumb = thumbnail(leftVersion);
  const rightThumb = thumbnail(rightVersion);
  const targetIsLeft = left === version.path && right !== version.path;
  const targetIsRight = right === version.path && left !== version.path;
  const sourceVersion = targetIsLeft ? rightVersion : targetIsRight ? leftVersion : undefined;
  const sourceText = targetIsLeft ? rightText : targetIsRight ? leftText : null;
  const sourceFields = targetIsLeft ? rightFields : leftFields;
  const sourceThumb = targetIsLeft ? rightThumb : leftThumb;
  const targetThumb = thumbnail(version);
  const canCopy = !!sourceVersion && sourceText !== null && !locked;
  const sourceHas = (label: string) => sourceFields.some(f => f.label.toLowerCase() === label.toLowerCase());
  const reset = () => { setSelected([]); setCopyThumb(false); setMessage(''); };
  const optionList = options.map(v => <option key={v.path} value={v.path}>{v.name}{v.path === version.path ? ' (Current)' : ''}</option>);

  return <details className="yt-section"><summary>Compare Local Versions</summary>
    <div className="compare-columns">
      <label>Left Version <select value={left} onChange={e => { setLeft(e.target.value); reset(); }}><option value="">Choose a Version…</option>{optionList}</select></label>
      <label>Right Version <select value={right} onChange={e => { setRight(e.target.value); reset(); }}><option value="">Choose a Version…</option>{optionList}</select></label>
    </div>
    {(leftData.error || rightData.error) && <p className="error">Could Not Read Version: {leftData.error || rightData.error}</p>}
    {left && right && !ready && !leftData.error && !rightData.error && <p className="muted">Loading Versions…</p>}
    {ready && labels.map(label => {
      const leftValue = leftFields.find(f => f.label.toLowerCase() === label.toLowerCase())?.value;
      const rightValue = rightFields.find(f => f.label.toLowerCase() === label.toLowerCase())?.value;
      return <div className="version-field-compare" key={label}>
        <label><input type="checkbox" disabled={!canCopy || !sourceHas(label)} checked={selected.includes(label)} onChange={e => setSelected(e.target.checked ? [...selected, label] : selected.filter(s => s !== label))} /> {label} <span className={`comparison-status ${leftValue === rightValue ? 'comparison-same' : 'comparison-different'}`}>{leftValue === rightValue ? 'Same' : 'Different'}</span></label>
        <div className="compare-columns"><div><strong>{leftVersion?.name}</strong><pre className="lvy-value">{leftValue || '(empty)'}</pre></div><div><strong>{rightVersion?.name}</strong><pre className="lvy-value">{rightValue || '(empty)'}</pre></div></div>
      </div>;
    })}
    {ready && (leftThumb || rightThumb) && <div className="version-field-compare"><label><input type="checkbox" disabled={!canCopy || !sourceThumb} checked={copyThumb} onChange={e => setCopyThumb(e.target.checked)} /> Thumbnail</label><div className="compare-columns">{[leftThumb, rightThumb].map((thumb, i) => <div key={i}><strong>{i === 0 ? leftVersion?.name : rightVersion?.name}</strong><div>{thumb ? <img className="lvy-thumb" src={thumbUrl('projects', thumb.path, 320, fileStamp(thumb))} alt={`${i === 0 ? leftVersion?.name : rightVersion?.name} thumbnail`} /> : '(empty)'}</div></div>)}</div></div>}
    {ready && sourceVersion && <button disabled={!canCopy || busy || (!selected.length && !copyThumb)} onClick={async () => {
      if (sourceText === null) return;
      setBusy(true); setMessage(''); let copied = false;
      try {
        if (selected.length) {
          const sourceDoc = youtubeFile(sourceVersion);
          if (!sourceDoc || (await getText('projects', sourceDoc.path)) !== sourceText) throw new Error('The source version changed. Choose it again to reload before copying.');
          await doc.save(t => copyVersionFields(t, sourceText, selected)); copied = true;
        }
        if (copyThumb && sourceThumb) {
          await postJson('/api/packaging/copy-thumbnail', { piece: version.path.replace(/\/Packaging\/[^/]+$/i, ''), source: sourceVersion.path, target: version.path, expected: targetThumb ? { size: targetThumb.size, modified: targetThumb.modified } : undefined, sourceExpected: { size: sourceThumb.size, modified: sourceThumb.modified } });
          onChanged?.();
        }
        setMessage(`Selected fields copied to ${version.name}.`);
      } catch (e) { setMessage(`${copied ? 'The selected text was saved, but the thumbnail was not: ' : ''}${e instanceof Error ? e.message : String(e)}`); }
      finally { setBusy(false); }
    }}>Copy Selected to {version.name}</button>}
    {ready && (!sourceVersion || locked) && <p className="muted small-text">{locked && sourceVersion ? `Unlock ${version.name} to copy into it.` : 'To copy, select the current version on one side and another version on the other.'}</p>}
    {message && <p role="status">{message}</p>}
  </details>;
}
