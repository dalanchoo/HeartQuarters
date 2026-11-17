import { useEffect, useState } from 'react';
import { fileStamp, getText, postJson, thumbUrl, type PackagingVersion } from './api';
import type { LoadedDoc } from './PackagingDoc';
import { parseFields } from './packaging';
import { comparisonLabels, copyVersionFields } from './versionFields';
import { metadataDiff } from './metadataDiff';
import { DiffText, FieldEditor } from './YouTubeCard';

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

export function VersionCompare({ versions, version, doc, locked, onChanged, left, right }: { versions: PackagingVersion[]; version: PackagingVersion; doc: LoadedDoc; locked: boolean; onChanged?: () => void; left: string; right: string }) {
  const options = versions.filter(v => youtubeFile(v));
  const [selected, setSelected] = useState<string[]>([]);
  const [copyThumb, setCopyThumb] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const leftVersion = options.find(v => v.path === left);
  const rightVersion = options.find(v => v.path === right);
  const leftData = useVersionText(left, leftVersion, version.path, doc);
  const rightData = useVersionText(right, rightVersion, version.path, doc);
  const leftText = leftData.text;
  const rightText = rightData.text;
  const ready = leftText !== null && (!right || rightText !== null);
  const leftFields = parseFields(leftText ?? '') ?? [];
  const rightFields = parseFields(rightText ?? '') ?? [];
  const labels = ready ? comparisonLabels(leftText, rightText ?? '') : [];
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
  return <div>
    {(leftData.error || rightData.error) && <p className="error">Could Not Read Version: {leftData.error || rightData.error}</p>}
    {left && !ready && !leftData.error && !rightData.error && <p className="muted">Loading Versions…</p>}
    {ready && labels.map(label => {
      const leftValue = leftFields.find(f => f.label.toLowerCase() === label.toLowerCase())?.value;
      const rightValue = rightFields.find(f => f.label.toLowerCase() === label.toLowerCase())?.value;
      const diff = right ? metadataDiff(label, leftValue ?? '', rightValue ?? '') : null;
      const index = (doc.fields ?? []).findIndex(f => f.label.toLowerCase() === label.toLowerCase());
      return <div className="version-field-compare" key={label}>
        <label>{right && <input type="checkbox" disabled={!canCopy || !sourceHas(label)} checked={selected.includes(label)} onChange={e => setSelected(e.target.checked ? [...selected, label] : selected.filter(s => s !== label))} />} {label} {diff && <span className={`comparison-status ${diff.same && leftValue !== undefined && rightValue !== undefined ? 'comparison-same' : 'comparison-different'}`}>{diff.same && leftValue !== undefined && rightValue !== undefined ? 'Same' : 'Different'}</span>}</label>
        {right ? <div className="compare-columns"><div><strong>{leftVersion?.name}</strong><pre className="lvy-value">{leftValue === undefined ? '(not provided)' : leftValue ? <DiffText parts={diff!.left} side="local" /> : '(empty)'}</pre></div><div><strong>{rightVersion?.name}</strong><pre className="lvy-value">{rightValue === undefined ? '(not provided)' : rightValue ? <DiffText parts={diff!.right} side="youtube" /> : '(empty)'}</pre></div></div> : left === version.path && index >= 0 ? <FieldEditor doc={doc} index={index} field={doc.fields![index]} /> : <pre className="lvy-value">{leftValue || '(empty)'}</pre>}
        {diff?.reordered && <p className="muted small-text">The same tags are present in a different order.</p>}
      </div>;
    })}
    {ready && (leftThumb || rightThumb) && <div className="version-field-compare"><label>{right && <input type="checkbox" disabled={!canCopy || !sourceThumb} checked={copyThumb} onChange={e => setCopyThumb(e.target.checked)} />} Thumbnail</label><div className={right ? 'compare-columns' : undefined}>{(right ? [leftThumb, rightThumb] : [leftThumb]).map((thumb, i) => <div key={i}><strong>{i === 0 ? leftVersion?.name : rightVersion?.name}</strong><div>{thumb ? <img className="lvy-thumb" src={thumbUrl('projects', thumb.path, 320, fileStamp(thumb))} alt={`${i === 0 ? leftVersion?.name : rightVersion?.name} thumbnail`} /> : '(empty)'}</div></div>)}</div></div>}
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
    {ready && right && (!sourceVersion || locked) && <p className="muted small-text">{locked && sourceVersion ? `Unlock ${version.name} to copy into it.` : 'To copy, select the current version on one side and another version on the other.'}</p>}
    {message && <p role="status">{message}</p>}
  </div>;
}
