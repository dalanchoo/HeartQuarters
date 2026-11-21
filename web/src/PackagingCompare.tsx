import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { PackagingVersion, Piece } from './api';
import { lockDocs, usePackagingDocs, type LoadedDoc } from './PackagingDoc';
import { LocalVsYouTube, type YoutubeLink } from './YouTubeCard';
import { VersionCompare, type GeneratedDraft } from './VersionCompare';
import { choiceOrder, comparisonSelection, DRAFT_SELECTION as DRAFT, orderedChoices, rightChoices, YOUTUBE_SELECTION as YOUTUBE, type ComparisonChoices } from './comparisonSelection';
import { draftImages, draftText, isCurrentChoice } from './draftPackaging';
import { setPendingPackaging } from './pendingPackaging';
import { LockSwitch } from './LockSwitch';

/** One set of selectors for viewing and comparing packaging, whether local or on YouTube. */
export function PackagingCompare({ piece, version, doc, locked, unlocked, onToggleLock, link, onChanged, longform, onDirtyChange, choices, setChoices, draftImage, setDraftImage, open, setOpen }: { piece: Piece; version: PackagingVersion; doc: LoadedDoc; locked: boolean; unlocked: string | null; onToggleLock: (path: string) => void; link: YoutubeLink; onChanged?: () => void; longform?: string; onDirtyChange?: (dirty: boolean) => void; choices: ComparisonChoices; setChoices: Dispatch<SetStateAction<ComparisonChoices>>; draftImage: string; setDraftImage: (path: string) => void; open: boolean; setOpen: (open: boolean) => void }) {
  const versions = piece.versions.filter(v => v.docs.some(d => /(^|\/)youtube\.md$/i.test(d.name)));
  // Draft: what Generate Packaging made for the chosen pair, with one of its images (the newest unless John picks another).
  const drafts = piece.drafts;
  const choice = drafts?.choice && isCurrentChoice(drafts.choice, drafts.picks) ? drafts.choice : null;
  const images = choice && drafts ? draftImages(choice, drafts.conversations) : [];
  // The image John picked is kept by the card, like the two selections, so locking or unlocking a version (which
  // rebuilds this) doesn't put it back to the newest (John, 2026-11-18).
  const image = images.find(i => i.path === draftImage) ?? images[0] ?? null;
  const generated: GeneratedDraft | undefined = choice ? { piece: piece.path, text: draftText(choice.pick), image, images, chooseImage: setDraftImage } : undefined;
  // Draft first, then the versions, then YouTube; the left is always earlier than the right.
  const order = choiceOrder(versions.map(v => v.path), !!generated);
  const { left, right } = orderedChoices(choices, version.path, order);
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
  const label = (value: string) => {
    if (value === DRAFT) return 'Draft (Generated Packaging)';
    if (value === YOUTUBE) return '▶';
    const v = versions.find(x => x.path === value);
    return v ? `${v.name} ${v.path === unlocked ? '🔓' : '🔒'}${v.path === version.path ? ' (Selected)' : ''}` : value;
  };
  const leftOptions = order.filter(value => rightChoices(value, order).length > 0 || value === YOUTUBE);
  const usesDraft = left === DRAFT || right === DRAFT;

  return <details className="yt-section" open={open} onToggle={e => setOpen(e.currentTarget.open)}><summary>View and Compare Packaging</summary>
    <div className="compare-columns">
      <label>First Selection <select value={left} onChange={e => changeSelection('left', e.target.value)}>{leftOptions.map(value => <option key={value} value={value} aria-label={value === YOUTUBE ? 'YouTube' : undefined}>{label(value)}</option>)}</select></label>
      <label>Compare With <select value={right} onChange={e => changeSelection('right', e.target.value)}><option value="">None — View One</option>{rightChoices(left, order).map(value => <option key={value} value={value} aria-label={value === YOUTUBE ? 'YouTube' : undefined}>{label(value)}</option>)}</select></label>
    </div>
    {/* Which side is which, once; every version's column has a Lock/Unlock switch. Unlocking one selects it and locks the others. */}
    <div className={right ? 'compare-columns compare-names' : 'compare-names'}>
      {(right ? [left, right] : [left]).map(side => {
        const v = versions.find(x => x.path === side);
        return <div key={side} className="compare-name">
          <strong>{side === DRAFT ? 'Draft' : side === YOUTUBE ? 'YouTube' : v?.name ?? side}</strong>
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
    {usesDraft && <p className="muted small-text">The Draft can only be copied into an unlocked version. To send it to YouTube, copy it into a version first, then compare that version with YouTube.</p>}
    {usesDraft ? (
      unlockedFile && !unlockedDoc ? <p className="muted">Loading Unlocked Version…</p> : <VersionCompare key={`${left}|${right}|${unlocked ?? ''}`} versions={versions} version={unlockedVersion ?? version} doc={unlockedDoc ?? doc} locked={!unlockedVersion || !unlockedDoc} onChanged={onChanged} left={left} right={right} onDirty={setDirty} generated={generated} />
    ) : usesYoutube || !right ? localDoc ? <LocalVsYouTube key={`${localVersion.path}|${left}|${right}`} piece={piece} doc={localDoc} covers={localVersion.covers} version={localVersion.path} versionName={localVersion.name} link={link} onChanged={onChanged} longform={longform} display={display} reverse={selection.reverse} onDirty={setDirty} /> : <p className="muted">Loading Version…</p> :
      unlockedFile && !unlockedDoc ? <p className="muted">Loading Unlocked Version…</p> : <VersionCompare key={`${left}|${right}|${unlocked ?? ''}`} versions={versions} version={unlockedVersion ?? version} doc={unlockedDoc ?? doc} locked={!unlockedVersion || !unlockedDoc} onChanged={onChanged} left={left} right={right} onDirty={setDirty} />}
  </details>;
}
