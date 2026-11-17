import { useEffect, useRef, useState } from 'react';
import { fileStamp, getText, postJson, thumbUrl, type PackagingVersion } from './api';
import type { LoadedDoc } from './PackagingDoc';
import { parseFields, sortTags } from './packaging';
import { comparisonLabels, copyVersionFields } from './versionFields';
import { metadataDiff } from './metadataDiff';
import { DiffText, FieldEditor } from './YouTubeCard';
import { ComparisonRow, isLongComparisonField } from './ComparisonRow';
import { localCopyTarget } from './comparisonSelection';
import { useStagedDoc } from './useStagedDoc';

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

export function VersionCompare({ versions, version, doc: originalDoc, locked, onChanged, left, right, onDirty }: { versions: PackagingVersion[]; version: PackagingVersion; doc: LoadedDoc; locked: boolean; onChanged?: () => void; left: string; right: string; onDirty?: (dirty: boolean) => void }) {
  const draft = useStagedDoc(originalDoc);
  const doc = draft.doc;
  const [selected, setSelected] = useState<string[]>([]);
  const targetBaseline = useRef<string | null>(null);
  const options = versions.filter(v => youtubeFile(v));
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
  const target = localCopyTarget(left, right, locked ? null : version.path);
  const targetIsLeft = target?.target === left;
  const targetIsRight = target?.target === right;
  const sourceVersion = targetIsLeft ? rightVersion : targetIsRight ? leftVersion : undefined;
  const sourceText = targetIsLeft ? rightText : targetIsRight ? leftText : null;
  const sourceFields = targetIsLeft ? rightFields : leftFields;
  const sourceThumb = targetIsLeft ? rightThumb : leftThumb;
  const targetThumb = thumbnail(version);
  const canCopy = !!sourceVersion && sourceText !== null && !locked;
  const sourceHas = (label: string) => sourceFields.some(f => f.label.toLowerCase() === label.toLowerCase());
  const toggle = (label: string) => {
    if (!sourceVersion || sourceText === null || !canCopy) return;
    if (targetBaseline.current === null) targetBaseline.current = originalDoc.text;
    setSelected(items => items.includes(label) ? items.filter(item => item !== label) : [...items, label]);
    setMessage('');
  };
  const dirty = draft.pending || selected.length > 0;
  useEffect(() => { onDirty?.(dirty); return () => onDirty?.(false); }, [dirty, onDirty]);
  const apply = async () => {
    if (!canCopy && selected.length) return;
    setBusy(true); setMessage('');
    let savedText = false;
    try {
      const labelsToCopy = selected.filter(label => label !== 'Thumbnail');
      if (labelsToCopy.length) {
        const sourceDoc = youtubeFile(sourceVersion);
        if (!sourceDoc || (await getText('projects', sourceDoc.path)) !== sourceText) throw new Error('The source version changed. Reload it before applying.');
      }
      if (draft.pending || labelsToCopy.length) {
        await draft.apply(labelsToCopy.length ? t => copyVersionFields(t, sourceText!, labelsToCopy) : undefined, targetBaseline.current ?? undefined);
        savedText = true;
        setSelected(items => items.filter(item => item === 'Thumbnail'));
      }
      if (selected.includes('Thumbnail')) {
        if (!sourceThumb || !sourceVersion) throw new Error('The source version has no thumbnail.');
        await postJson('/api/packaging/copy-thumbnail', { piece: version.path.replace(/\/Packaging\/[^/]+$/i, ''), source: sourceVersion.path, target: version.path, expected: targetThumb ? { size: targetThumb.size, modified: targetThumb.modified } : undefined, sourceExpected: { size: sourceThumb.size, modified: sourceThumb.modified } });
        setSelected([]);
        onChanged?.();
      }
      targetBaseline.current = null;
      setMessage(`Changes applied to ${version.name}.`);
    } catch (e) { setMessage(`${savedText ? 'Text was saved, but the thumbnail was not. ' : 'Nothing was saved. '}${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(false); }
  };
  return <div>
    {(leftData.error || rightData.error) && <p className="error">Could Not Read Version: {leftData.error || rightData.error}</p>}
    {left && !ready && !leftData.error && !rightData.error && <p className="muted">Loading Versions…</p>}
    {ready && labels.map(label => {
      const displayValue = (value: string | undefined) => value !== undefined && label.toLowerCase() === 'tags' ? sortTags(value) : value;
      const leftValue = displayValue(leftFields.find(f => f.label.toLowerCase() === label.toLowerCase())?.value);
      const rightValue = displayValue(rightFields.find(f => f.label.toLowerCase() === label.toLowerCase())?.value);
      const diff = right ? metadataDiff(label, leftValue ?? '', rightValue ?? '') : null;
      const index = (doc.fields ?? []).findIndex(f => f.label.toLowerCase() === label.toLowerCase());
      const status = diff && <span className={`comparison-status ${diff.same && leftValue !== undefined && rightValue !== undefined ? 'comparison-same' : 'comparison-different'}`}>{diff.same && leftValue !== undefined && rightValue !== undefined ? '✓ Same' : '≠ Different'}</span>;
      const side = (which: 'left' | 'right', value: string | undefined) => <div><strong>{which === 'left' ? leftVersion?.name : rightVersion?.name}</strong><pre className="lvy-value">{value === undefined ? '(not provided)' : value ? <DiffText parts={which === 'left' ? diff!.left : diff!.right} side={which === 'left' ? 'local' : 'youtube'} /> : '(empty)'}</pre>{!locked && (which === 'left' ? targetIsLeft : targetIsRight) && index >= 0 && <><span className="muted small-text">Edit {version.name}</span><FieldEditor doc={doc} index={index} field={{ ...doc.fields![index], value: displayValue(doc.fields![index].value) ?? '' }} onEdited={() => setSelected(items => items.filter(item => item !== label))} /></>}</div>;
      return <ComparisonRow key={label} label={label} status={status} collapsible={isLongComparisonField(label, leftValue, rightValue)}>
        {canCopy && sourceHas(label) && <button className="small" disabled={busy} onClick={() => toggle(label)}>{selected.includes(label) ? 'Don’t Copy' : `Copy ${sourceVersion?.name} to ${version.name}`}</button>}
        {draft.changes.includes(label) && originalDoc.fields?.some(f => f.label.toLowerCase() === label.toLowerCase()) && <button className="small" disabled={busy} onClick={() => { if (originalDoc.text !== null) void doc.save(t => copyVersionFields(t, originalDoc.text!, [label])); }}>Undo Edit</button>}
        {right ? <div className="compare-columns">{side('left', leftValue)}{side('right', rightValue)}</div> : left === version.path && index >= 0 ? <FieldEditor doc={doc} index={index} field={doc.fields![index]} /> : <pre className="lvy-value">{leftValue || '(empty)'}</pre>}
        {diff?.reordered && <p className="muted small-text">The same tags are present in a different order.</p>}
      </ComparisonRow>;
    })}
    {ready && (leftThumb || rightThumb) && <div className="version-field-compare"><strong>Thumbnail</strong>{canCopy && sourceThumb && <button className="small" disabled={busy} onClick={() => toggle('Thumbnail')}>{selected.includes('Thumbnail') ? 'Don’t Copy' : `Copy ${sourceVersion?.name} to ${version.name}`}</button>}<div className={right ? 'compare-columns' : undefined}>{(right ? [leftThumb, rightThumb] : [leftThumb]).map((thumb, i) => <div key={i}><strong>{i === 0 ? leftVersion?.name : rightVersion?.name}</strong><div>{thumb ? <img className="lvy-thumb" src={thumbUrl('projects', thumb.path, 320, fileStamp(thumb))} alt={`${i === 0 ? leftVersion?.name : rightVersion?.name} thumbnail`} /> : '(empty)'}</div></div>)}</div></div>}
    {ready && right && !sourceVersion && <p className="muted small-text">To edit or copy, unlock one of the two versions above.</p>}
    <div className={`push-summary${dirty ? ' has-changes' : ''}`}>{dirty ? <><strong>Apply Changes Will:</strong><ul>{draft.changes.filter(label => !selected.includes(label)).map(label => <li key={`edit-${label}`}>Save Edited {label} to {version.name}</li>)}{selected.map(label => <li key={`copy-${label}`}>Copy {label} From {sourceVersion?.name} to {version.name}{draft.changes.includes(label) ? ' (replaces the edit)' : ''}</li>)}</ul></> : <span className="muted small-text">No Changes Selected.</span>}</div>
    <button disabled={!dirty || busy || locked} onClick={() => void apply()}>Apply Changes</button>{' '}<button disabled={!dirty || busy} onClick={() => { draft.discard(); setSelected([]); targetBaseline.current = null; setMessage('Changes discarded.'); }}>Discard Changes</button>
    {message && <p role="status">{message}</p>}
  </div>;
}
