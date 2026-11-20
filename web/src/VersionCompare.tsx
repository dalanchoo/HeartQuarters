import { useEffect, useRef, useState } from 'react';
import { fileStamp, getText, postJson, thumbUrl, type FileRef, type PackagingVersion } from './api';
import type { LoadedDoc } from './PackagingDoc';
import { parseFields, sortTags, undoFieldEdit } from './packaging';
import { comparisonLabels, copyVersionFields } from './versionFields';
import { copyValuesMatch, metadataDiff } from './metadataDiff';
import { DiffText, EditableComparisonValue, FieldEditor } from './YouTubeCard';
import { ComparisonRow, isLongComparisonField } from './ComparisonRow';
import { DRAFT_SELECTION, localCopyTarget } from './comparisonSelection';
import { missingTagInOpening, wouldLoseChapters } from './youtubePackaging';
import { useStagedDoc } from './useStagedDoc';
import { CopyDirectionControls, CopyDirectionFrame, localCopyDirection } from './CopyDirection';
import { canSelectIncomingCopy } from './stagedPackaging';
import { AiHighlightedText, AiWritingChecker } from './AiWritingChecker';
import { setFieldValue } from './packaging';

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

/** The Draft from Generate Packaging: its text in YouTube.md form, the draft image chosen for it, and the others to choose from. */
export interface GeneratedDraft { piece: string; text: string; image: FileRef | null; images: (FileRef & { label: string })[]; chooseImage: (path: string) => void }
const DRAFT_VERSION: PackagingVersion = { name: 'Draft', path: DRAFT_SELECTION, docs: [], notes: null, covers: [] };

export function VersionCompare({ versions, version, doc: originalDoc, locked, onChanged, left, right, onDirty, generated }: { versions: PackagingVersion[]; version: PackagingVersion; doc: LoadedDoc; locked: boolean; onChanged?: () => void; left: string; right: string; onDirty?: (dirty: boolean) => void; generated?: GeneratedDraft }) {
  const draft = useStagedDoc(originalDoc);
  const doc = draft.doc;
  const [selected, setSelected] = useState<string[]>([]);
  const targetBaseline = useRef<string | null>(null);
  const options = versions.filter(v => youtubeFile(v));
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const isDraft = (path: string) => path === DRAFT_SELECTION && !!generated;
  const leftVersion = isDraft(left) ? DRAFT_VERSION : options.find(v => v.path === left);
  const rightVersion = isDraft(right) ? DRAFT_VERSION : options.find(v => v.path === right);
  const leftLoaded = useVersionText(left, leftVersion, version.path, doc);
  const rightLoaded = useVersionText(right, rightVersion, version.path, doc);
  // The Draft isn't a file: its text comes from Generate Packaging.
  const leftData = isDraft(left) ? { text: generated!.text, error: undefined } : leftLoaded;
  const rightData = isDraft(right) ? { text: generated!.text, error: undefined } : rightLoaded;
  const leftText = leftData.text;
  const rightText = rightData.text;
  const ready = leftText !== null && (!right || rightText !== null);
  const leftFields = parseFields(leftText ?? '') ?? [];
  const rightFields = parseFields(rightText ?? '') ?? [];
  const labels = ready ? comparisonLabels(leftText, rightText ?? '') : [];
  const leftThumb = isDraft(left) ? generated!.image ?? undefined : thumbnail(leftVersion);
  const rightThumb = isDraft(right) ? generated!.image ?? undefined : thumbnail(rightVersion);
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
    if (!canSelectIncomingCopy(draft.changes.some(field => field.toLowerCase() === label.toLowerCase()), selected.includes(label))) return;
    if (targetBaseline.current === null) targetBaseline.current = originalDoc.text;
    setSelected(items => items.includes(label) ? items.filter(item => item !== label) : [...items, label]);
    setMessage('');
  };
  const dirty = draft.pending || selected.length > 0;
  const targetDescription = (parseFields(originalDoc.text ?? '') ?? []).find(f => f.label.toLowerCase() === 'description')?.value ?? '';
  const sourceDescription = sourceFields.find(f => f.label.toLowerCase() === 'description')?.value ?? '';
  const losesChapters = selected.includes('Description') && wouldLoseChapters(targetDescription, sourceDescription);
  useEffect(() => { onDirty?.(dirty); return () => onDirty?.(false); }, [dirty, onDirty]);
  const apply = async () => {
    if (!canCopy && selected.length) return;
    setBusy(true); setMessage('');
    let savedText = false;
    try {
      const labelsToCopy = selected.filter(label => label !== 'Thumbnail');
      const fromDraft = sourceVersion === DRAFT_VERSION;
      if (labelsToCopy.length && !fromDraft) {
        const sourceDoc = youtubeFile(sourceVersion);
        if (!sourceDoc || (await getText('projects', sourceDoc.path)) !== sourceText) throw new Error('The source version changed. Reload it before applying.');
      }
      if (draft.pending || labelsToCopy.length) {
        await draft.apply(labelsToCopy.length ? t => copyVersionFields(t, sourceText!, labelsToCopy) : undefined, targetBaseline.current ?? undefined);
        savedText = true;
        setSelected(items => items.filter(item => item === 'Thumbnail'));
      }
      if (selected.includes('Thumbnail') && fromDraft) {
        // A draft image is enlarged to full size as the version's thumbnail, the same as Use Thumbnail.
        if (!generated?.image) throw new Error('Choose a draft image for the Draft first.');
        await postJson('/api/packaging/use-draft', { piece: generated.piece, image: generated.image.path, version: version.path, thumbnail: true, title: false });
        setSelected([]);
        onChanged?.();
      } else if (selected.includes('Thumbnail')) {
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
      const savedFields = parseFields(originalDoc.text ?? '') ?? [];
      const leftValue = displayValue((left === version.path ? savedFields : leftFields).find(f => f.label.toLowerCase() === label.toLowerCase())?.value);
      const rightValue = displayValue((right === version.path ? savedFields : rightFields).find(f => f.label.toLowerCase() === label.toLowerCase())?.value);
      const diff = right ? metadataDiff(label, leftValue ?? '', rightValue ?? '') : null;
      const sameValues = copyValuesMatch(label, leftValue, rightValue);
      const direction = localCopyDirection(selected.includes(label), targetIsRight);
      const index = (doc.fields ?? []).findIndex(f => f.label.toLowerCase() === label.toLowerCase());
      const edited = draft.changes.some(field => field.toLowerCase() === label.toLowerCase());
      // vidIQ's check: one of that side's tags, word for word, in its description's first 200 characters. Each warning
      // sits over its own column, named for that side (John, 2026-11-18); a side without tags has nothing to check.
      const tagsOf = (s: string) => ((s === version.path ? savedFields : s === left ? leftFields : rightFields).find(f => f.label.toLowerCase() === 'tags')?.value) ?? '';
      const isDescription = label.toLowerCase() === 'description';
      const warnLeft = isDescription && missingTagInOpening(leftValue, tagsOf(left));
      const warnRight = isDescription && !!right && missingTagInOpening(rightValue, tagsOf(right));
      const tagWarning = (name: string) => <span className="comparison-status comparison-different" title="vidIQ scores a description 50 instead of 100 when none of the tags appears word for word in its first 200 characters.">⚠ {name}: No Tag in First 200 Characters</span>;
      const leftName = isDraft(left) ? 'Draft' : leftVersion?.name ?? 'Left';
      const rightName = right && isDraft(right) ? 'Draft' : rightVersion?.name ?? 'Right';
      const status = <>{!right && warnLeft && tagWarning(leftName)}{diff && <span className={`comparison-status ${diff.same && leftValue !== undefined && rightValue !== undefined ? 'comparison-same' : 'comparison-different'}`}>{diff.same && leftValue !== undefined && rightValue !== undefined ? '✓ Same' : '≠ Different'}</span>}{direction && <span className="comparison-status comparison-waiting">Selected to Copy</span>}</>;
      const side = (which: 'left' | 'right', value: string | undefined) => {
        const preview = <pre className="lvy-value">{value === undefined ? '(not provided)' : value ? <DiffText parts={which === 'left' ? diff!.left : diff!.right} side={which === 'left' ? 'local' : 'youtube'} /> : '(empty)'}</pre>;
        return <div>{!locked && (which === 'left' ? targetIsLeft : targetIsRight) && index >= 0 ? <EditableComparisonValue doc={doc} index={index} field={{ ...doc.fields![index], value: displayValue(doc.fields![index].value) ?? '' }} current={preview} savedValue={displayValue(savedFields.find(f => f.label.toLowerCase() === label.toLowerCase())?.value) ?? ''} edited={edited} copySelected={!!direction} busy={busy} cancelCopy={() => toggle(label)} undoEdit={async () => { if (originalDoc.text === null) throw new Error('The saved file is still loading.'); await doc.save(t => undoFieldEdit(t, originalDoc.text!, label)); }} /> : <>{preview}<AiWritingChecker text={value ?? ''} label={label} /></>}</div>;
      };
      const controls = right ? <CopyDirectionControls left={leftVersion?.name ?? 'Left'} right={rightVersion?.name ?? 'Right'} selected={direction} disabled={busy} showCopyRight={targetIsRight} showCopyLeft={targetIsLeft} canCopyRight={!busy && canCopy && targetIsRight && sourceHas(label) && !sameValues && canSelectIncomingCopy(edited, !!direction)} canCopyLeft={!busy && canCopy && targetIsLeft && sourceHas(label) && !sameValues && canSelectIncomingCopy(edited, !!direction)} copyRight={() => toggle(label)} copyLeft={() => toggle(label)} /> : null;
      return <ComparisonRow key={label} label={label} status={status} actions={controls} collapsible={isLongComparisonField(label, leftValue, rightValue)}>
        {right ? <CopyDirectionFrame left={leftVersion?.name ?? 'Left'} right={rightVersion?.name ?? 'Right'} selected={direction}>
          {edited && canCopy && sourceHas(label) && <p className="comparison-edit-warning">This field has an unsaved edit. Choose Edited, then Undo Edit before selecting a copy into {version.name}.</p>}
          {(warnLeft || warnRight) && <div className="compare-warnings"><div>{warnLeft && tagWarning(leftName)}</div><div>{warnRight && tagWarning(rightName)}</div></div>}
          <div className="compare-columns">{side('left', leftValue)}{side('right', rightValue)}</div>
        </CopyDirectionFrame> : left === version.path && index >= 0 ? <><FieldEditor doc={doc} index={index} field={doc.fields![index]} /><AiWritingChecker text={doc.fields![index].value} label={label} onReplace={doc.locked ? undefined : (next) => doc.save((text) => setFieldValue(text, index, next))} /></> : <><pre className="lvy-value">{leftValue ? <AiHighlightedText text={leftValue} /> : '(empty)'}</pre><AiWritingChecker text={leftValue ?? ''} label={label} /></>}
        {diff?.reordered && <p className="muted small-text">The same tags are present in a different order.</p>}
      </ComparisonRow>;
    })}
    {ready && (leftThumb || rightThumb || (generated && (isDraft(left) || isDraft(right)))) && <div className="version-field-compare"><div className="lvy-row-head"><span className="comparison-label"><strong>Thumbnail</strong></span>{right && <span className="comparison-actions"><CopyDirectionControls left={leftVersion?.name ?? 'Left'} right={rightVersion?.name ?? 'Right'} selected={localCopyDirection(selected.includes('Thumbnail'), targetIsRight)} disabled={busy} showCopyRight={targetIsRight} showCopyLeft={targetIsLeft} canCopyRight={!busy && canCopy && targetIsRight && !!sourceThumb} canCopyLeft={!busy && canCopy && targetIsLeft && !!sourceThumb} copyRight={() => toggle('Thumbnail')} copyLeft={() => toggle('Thumbnail')} /></span>}</div><CopyDirectionFrame left={leftVersion?.name ?? 'Left'} right={rightVersion?.name ?? 'Right'} selected={localCopyDirection(selected.includes('Thumbnail'), targetIsRight)}>
      <div className={right ? 'compare-columns' : undefined}>{(right ? [leftThumb, rightThumb] : [leftThumb]).map((thumb, i) => {
        const side = i === 0 ? left : right;
        const name = i === 0 ? leftVersion?.name : rightVersion?.name;
        // The name above each image, with the Draft's image menu beside its name, so both images start level.
        return <div key={i}><div className="thumb-name"><strong>{name}</strong>
          {isDraft(side) && (generated!.images.length ? <select className="draft-image-select" value={generated!.image?.path ?? ''} disabled={busy} onChange={e => generated!.chooseImage(e.target.value)}>{generated!.images.map((img, n) => <option key={img.path} value={img.path}>{img.label}{n === 0 ? ' (Newest)' : ''}</option>)}</select> : <span className="muted small-text">No draft images for this pair yet.</span>)}</div>
          <div>{thumb ? <img className="lvy-thumb" src={thumbUrl('projects', thumb.path, 320, fileStamp(thumb))} alt={`${name} thumbnail`} /> : isDraft(side) ? null : '(empty)'}</div></div>;
      })}</div>
    </CopyDirectionFrame></div>}
    {ready && right && !sourceVersion && <p className="muted small-text">To edit or copy, unlock one of the two versions above.</p>}
    <div className={`push-summary${dirty ? ' has-changes' : ''}`}>{dirty ? <>{draft.clashes.length > 0 && <p className="error-note" role="alert">{draft.clashes.join(', ')} also changed outside this page since you started editing (by the AI, another part of this page or another program), so Apply can't combine them. Copy your edit somewhere, click Discard Changes to see the newer text, then put your edit back.</p>}<strong>Apply Changes Will:</strong><ul>{draft.changes.filter(label => !selected.includes(label)).map(label => <li key={`edit-${label}`}>Save Edited {label} to {version.name}</li>)}{selected.map(label => <li key={`copy-${label}`}>Copy {label} From {sourceVersion?.name} to {version.name}{draft.changes.includes(label) ? ' (replaces the edit)' : ''}</li>)}</ul>{losesChapters && <p role="alert">{sourceVersion?.name}&apos;s description has no chapter list, but {version.name}&apos;s has. Copying it replaces the whole description, chapters included.</p>}</> : <span className="muted small-text">No Changes Selected.</span>}</div>
    <button disabled={!dirty || busy || locked} onClick={() => void apply()}>Apply Changes</button>{' '}<button disabled={!dirty || busy} onClick={() => { draft.discard(); setSelected([]); targetBaseline.current = null; setMessage('Changes discarded.'); }}>Discard Changes</button>
    {message && <p role="status">{message}</p>}
  </div>;
}
