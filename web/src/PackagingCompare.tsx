import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { PackagingVersion, Piece } from './api';
import { lockDocs, usePackagingDocs, type LoadedDoc } from './PackagingDoc';
import { LocalVsYouTube, type YoutubeLink } from './YouTubeCard';
import { VersionCompare } from './VersionCompare';
import { choiceOrder, comparisonSelection, orderedChoices, rightChoices, YOUTUBE_SELECTION as YOUTUBE, type ComparisonChoices } from './comparisonSelection';
import { setPendingEdit } from './unsavedEdits';
import { LockSwitch } from './LockSwitch';
import { PackagingChoice } from './PackagingChoice';

export { PackagingChoice };

/** One set of selectors for viewing and comparing packaging, whether local or on YouTube. */
export function PackagingCompare({ piece, version, doc, locked, unlocked, onToggleLock, link, onChanged, longform, onDirtyChange, choices, setChoices, open, setOpen }: { piece: Piece; version: PackagingVersion; doc: LoadedDoc; locked: boolean; unlocked: string | null; onToggleLock: (path: string) => void; link: YoutubeLink; onChanged?: () => void; longform?: string; onDirtyChange?: (dirty: boolean) => void; choices: ComparisonChoices; setChoices: Dispatch<SetStateAction<ComparisonChoices>>; open: boolean; setOpen: (open: boolean) => void }) {
  const versions = piece.versions.filter(v => v.docs.some(d => /(^|\/)youtube\.md$/i.test(d.name)));
  // Archived drafts (D01...), then versions (Legacy, V01...), then YouTube; the left is always earlier than the right.
  const draftPaths = versions.filter(v => /^D\d+$/i.test(v.name)).map(v => v.path);
  const versionPaths = versions.filter(v => !/^D\d+$/i.test(v.name)).map(v => v.path);
  const order = choiceOrder([...draftPaths, ...versionPaths], false);
  const { left, right } = orderedChoices(choices, version.path, order);
  const [dirty, setDirty] = useState(false);
  const [heldHeight, setHeldHeight] = useState<number | null>(null);
  const [compareReady, setCompareReady] = useState(true);
  const bodyRef = useRef<HTMLDivElement>(null);
  const pendingId = useRef(Symbol('packaging'));
  useEffect(() => { const id = pendingId.current; setPendingEdit(id, dirty); return () => setPendingEdit(id, false); }, [dirty]);
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);
  useEffect(() => { if (!dirty) return; const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [dirty]);
  const changeSelection = (side: 'left' | 'right', value: string) => {
    if (value === (side === 'left' ? left : right)) return;
    if (dirty && !window.confirm('You have unapplied changes. Discard them and change the comparison?')) return;
    const height = bodyRef.current?.offsetHeight ?? 0;
    if (height > 0) setHeldHeight(height);
    const nextLeft = side === 'left' ? value : left;
    const nextRight = side === 'right' ? value : right;
    if (nextRight && nextLeft !== YOUTUBE && nextRight !== YOUTUBE) setCompareReady(false);
    setDirty(false);
    setChoices({ left: nextLeft, right: nextRight });
  };
  const selection = comparisonSelection(left, right, version.path);
  const { youtube: usesYoutube, localPath, display } = selection;
  const localVersion = versions.find(v => v.path === localPath) ?? version;
  const otherFile = localVersion.path === version.path ? undefined : localVersion.docs.find(d => /(^|\/)youtube\.md$/i.test(d.name));
  const otherDocs = usePackagingDocs(otherFile ? [otherFile] : []);
  const loadedOther = otherDocs.find(d => d.file.path === otherFile?.path);
  const localDoc = otherFile ? (loadedOther ? (unlocked === localVersion.path ? loadedOther : lockDocs([loadedOther])[0]) : undefined) : doc;
  const unlockedVersion = versions.find(v => v.path === unlocked);
  const unlockedFile = unlockedVersion && unlockedVersion.path !== version.path ? unlockedVersion.docs.find(d => /(^|\/)youtube\.md$/i.test(d.name)) : undefined;
  const unlockedDocs = usePackagingDocs(unlockedFile ? [unlockedFile] : []);
  const unlockedDoc = unlockedFile ? unlockedDocs.find(d => d.file.path === unlockedFile.path) : (!locked ? doc : undefined);
  const bodyReady = usesYoutube || !right ? !!localDoc : (!unlockedFile || !!unlockedDoc) && compareReady;
  useEffect(() => {
    if (bodyReady && heldHeight !== null) setHeldHeight(null);
  }, [bodyReady, heldHeight]);
  const label = (value: string) => {
    if (value === YOUTUBE) return 'YouTube';
    const v = versions.find(x => x.path === value);
    return v ? `${v.name} ${v.path === unlocked ? '🔓' : '🔒'}${v.path === version.path ? ' (Selected)' : ''}` : value;
  };
  const leftOptions = order.filter(value => rightChoices(value, order).length > 0 || value === YOUTUBE);

  return <details className="yt-section" open={open} onToggle={e => setOpen(e.currentTarget.open)}><summary>View and Compare Packaging</summary>
    <div className="compare-columns">
      <div className="packaging-choice-field"><span>First Selection</span><PackagingChoice name="First Selection" value={left} options={leftOptions} label={label} onChange={value => changeSelection('left', value)} /></div>
      <div className="packaging-choice-field"><span>Compare With</span><PackagingChoice name="Compare With" value={right} options={['', ...rightChoices(left, order)]} label={value => value ? label(value) : 'None — View One'} onChange={value => changeSelection('right', value)} /></div>
    </div>
    {/* Which side is which, once; every version's column has a Lock/Unlock switch. Unlocking one selects it and locks the others. */}
    <div className={right ? 'compare-columns compare-names' : 'compare-names'}>
      {(right ? [left, right] : [left]).map(side => {
        const v = versions.find(x => x.path === side);
        return <div key={side} className="compare-name">
          <strong>{side === YOUTUBE ? 'YouTube' : v?.name ?? side}</strong>
          {v && <LockSwitch locked={unlocked !== v.path} name={v.name} onToggle={() => onToggleLock(v.path)} />}
        </div>;
      })}
    </div>
    {(() => {
      // When neither version on show is unlocked, say how to edit or copy.
      const shown = (right ? [left, right] : [left]).map(side => versions.find(x => x.path === side)).filter((v): v is PackagingVersion => !!v);
      if (!shown.length || shown.some(v => v.path === unlocked)) return null;
      return <p className="lock-hint">Unlock {shown.map(v => v.name).join(' or ')} to edit it or copy into it.</p>;
    })()}
    <div ref={bodyRef} style={heldHeight ? { minHeight: heldHeight } : undefined}>
      {usesYoutube || !right ? localDoc ? <LocalVsYouTube key={`${localVersion.path}|${left}|${right}`} piece={piece} doc={localDoc} covers={localVersion.covers} version={localVersion.path} versionName={localVersion.name} link={link} onChanged={onChanged} longform={longform} display={display} reverse={selection.reverse} onDirty={setDirty} /> : <p className="muted">Loading Version…</p> :
        unlockedFile && !unlockedDoc ? <p className="muted">Loading Unlocked Version…</p> : <VersionCompare key={`${left}|${right}|${unlocked ?? ''}`} versions={versions} version={unlockedVersion ?? version} doc={unlockedDoc ?? doc} locked={!unlockedVersion || !unlockedDoc} onChanged={onChanged} left={left} right={right} onDirty={setDirty} onReady={setCompareReady} />}
    </div>
  </details>;
}
