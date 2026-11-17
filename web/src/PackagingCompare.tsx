import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { PackagingVersion, Piece } from './api';
import { lockDocs, usePackagingDocs, type LoadedDoc } from './PackagingDoc';
import { LocalVsYouTube, type YoutubeLink } from './YouTubeCard';
import { VersionCompare } from './VersionCompare';
import { availableComparisonChoices, comparisonSelection, YOUTUBE_SELECTION as YOUTUBE, type ComparisonChoices } from './comparisonSelection';
import { setPendingPackaging } from './pendingPackaging';

/** One set of selectors for viewing and comparing packaging, whether local or on YouTube. */
export function PackagingCompare({ piece, version, doc, locked, unlocked, link, onChanged, longform, onDirtyChange, choices, setChoices }: { piece: Piece; version: PackagingVersion; doc: LoadedDoc; locked: boolean; unlocked: string | null; link: YoutubeLink; onChanged?: () => void; longform?: string; onDirtyChange?: (dirty: boolean) => void; choices: ComparisonChoices; setChoices: Dispatch<SetStateAction<ComparisonChoices>> }) {
  const versions = piece.versions.filter(v => v.docs.some(d => /(^|\/)youtube\.md$/i.test(d.name)));
  const { left, right } = availableComparisonChoices(choices, version.path, versions.map(v => v.path));
  const [dirty, setDirty] = useState(false);
  const pendingId = useRef(Symbol('packaging'));
  useEffect(() => { const id = pendingId.current; setPendingPackaging(id, dirty); return () => setPendingPackaging(id, false); }, [dirty]);
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);
  useEffect(() => { if (!dirty) return; const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [dirty]);
  const changeSelection = (side: 'left' | 'right', value: string) => {
    if (value === (side === 'left' ? left : right)) return;
    if (dirty && !window.confirm('You have unapplied changes. Discard them and change the comparison?')) return;
    setDirty(false);
    setChoices({ left: side === 'left' ? value : left, right: side === 'right' ? value : right });
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
  const optionList = <>{versions.map(v => <option key={v.path} value={v.path}>{v.name} {v.path === unlocked ? '🔓' : '🔒'}{v.path === version.path ? ' (Current)' : ''}</option>)}<option value={YOUTUBE}>YouTube</option></>;

  return <details className="yt-section" open><summary>View and Compare Packaging</summary>
    <div className="compare-columns">
      <label>First Selection <select value={left} onChange={e => changeSelection('left', e.target.value)}>{optionList}</select></label>
      <label>Compare With <select value={right} onChange={e => changeSelection('right', e.target.value)}><option value="">None — View One</option>{optionList}</select></label>
    </div>
    {usesYoutube || !right ? localDoc ? <LocalVsYouTube key={`${localVersion.path}|${left}|${right}`} piece={piece} doc={localDoc} covers={localVersion.covers} version={localVersion.path} versionName={localVersion.name} link={link} onChanged={onChanged} longform={longform} display={display} reverse={selection.reverse} onDirty={setDirty} /> : <p className="muted">Loading Version…</p> :
      unlockedFile && !unlockedDoc ? <p className="muted">Loading Unlocked Version…</p> : <VersionCompare key={`${left}|${right}|${unlocked ?? ''}`} versions={versions} version={unlockedVersion ?? version} doc={unlockedDoc ?? doc} locked={!unlockedVersion || !unlockedDoc} onChanged={onChanged} left={left} right={right} onDirty={setDirty} />}
  </details>;
}
